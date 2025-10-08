import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';
import { ensureCors, applyCorsHeaders } from './_lib/cors.js';
import type { CorsDecision } from './_lib/cors.js';

const PASSTHROUGH_PLACEHOLDER_URL = 'https://picsum.photos/seed/mgm/800/600';
const DEFAULT_MAX_BYTES = 40 * 1024 * 1024;
const DIRECT_UPLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;
const UPLOAD_ALLOW_METHODS = 'POST, OPTIONS';
const UPLOAD_ALLOW_HEADERS = 'content-type, authorization, x-diag';
const UPLOAD_CORS_MAX_AGE = '86400';
export const config = {
  api: {
    bodyParser: true,
    // NOTE: Vercel requires a literal here when statically analyzing the route.
    sizeLimit: '32mb',
  },
  maxDuration: 60,
};

type MultipartFile = {
  fieldName: string;
  filename: string;
  contentType: string;
  size: number;
  buffer: Buffer;
};

type ParsedRequest =
  | {
      kind: 'empty';
      receivedBytes: number;
      json: null;
      fields: Record<string, string>;
      file: null;
    }
  | {
      kind: 'json';
      receivedBytes: number;
      json: Record<string, any> | null;
      fields: Record<string, string>;
      file: null;
    }
  | {
      kind: 'multipart';
      receivedBytes: number;
      json: null;
      fields: Record<string, string>;
      file: MultipartFile | null;
    };

type NormalizedPayload = {
  mode: 'none' | 'url' | 'json_base64' | 'multipart';
  receivedBytes: number;
  url: string | null;
  json: Record<string, any> | null;
  fields: Record<string, string>;
  file: MultipartFile | null;
  buffer:
    | null
    | {
        buffer: Buffer;
        contentType: string | null;
      };
};

type Base64Candidate = {
  raw: string;
  base64: string;
  contentType: string | null;
  approxBytes: number | null;
};

class PayloadTooLargeError extends Error {
  public readonly bytes: number;

  constructor(bytes: number) {
    super('payload_too_large');
    this.name = 'PayloadTooLargeError';
    this.bytes = bytes;
  }
}

class InvalidBodyError extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'InvalidBodyError';
    this.code = code;
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseMaxBytes(): number {
  const raw = process.env.UPLOAD_ORIGINAL_MAX_BYTES;
  const parsed = toNumber(raw);
  if (parsed && parsed > 0) {
    return parsed;
  }
  return DEFAULT_MAX_BYTES;
}

function getContentLength(req: VercelRequest): number | null {
  const header = req.headers['content-length'];
  if (Array.isArray(header)) {
    const first = header.find((value) => typeof value === 'string');
    return toNumber(first);
  }
  return toNumber(header);
}

function getFirstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) {
        return entry;
      }
    }
    return null;
  }
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return null;
}

function getApproxImageBase64Bytes(req: VercelRequest): number | null {
  const headerCandidates = [
    'x-image-base64-bytes',
    'x-image-base64-size',
    'x-image-base64-length',
    'x-image-bytes',
    'x-image-size',
    'x-image-length',
    'x-base64-bytes',
    'x-base64-size',
    'x-base64-length',
    'x-payload-bytes',
    'x-request-bytes',
    'x-body-bytes',
  ];

  for (const headerName of headerCandidates) {
    const raw = getFirstHeaderValue(req.headers?.[headerName]);
    const parsed = toNumber(raw);
    if (parsed && parsed > 0) {
      return parsed;
    }
  }

  const queryCandidates = [
    'imageBase64Bytes',
    'image_base64_bytes',
    'imageBase64Size',
    'image_base64_size',
    'imageBase64Length',
    'image_base64_length',
  ];
  const query: Record<string, unknown> | undefined = (req as any)?.query;
  if (query && typeof query === 'object') {
    for (const key of queryCandidates) {
      const value = (query as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (const entry of value) {
          const parsed = toNumber(entry as any);
          if (parsed && parsed > 0) {
            return parsed;
          }
        }
      } else {
        const parsed = toNumber(value as any);
        if (parsed && parsed > 0) {
          return parsed;
        }
      }
    }
  }

  return null;
}

function getContentType(req: VercelRequest): string {
  const header = req.headers['content-type'] || req.headers['Content-Type'];
  if (Array.isArray(header)) {
    return (header[0] || '').trim();
  }
  return typeof header === 'string' ? header.trim() : '';
}

function getBaseContentType(contentTypeHeader: string): string {
  if (!contentTypeHeader) return '';
  return contentTypeHeader.split(';')[0].trim().toLowerCase();
}

function applyUploadCors(
  req: VercelRequest,
  res: VercelResponse,
  corsDecision?: CorsDecision,
): CorsDecision {
  const resolved = applyCorsHeaders(req, res, corsDecision);
  try {
    res.setHeader('Access-Control-Allow-Methods', UPLOAD_ALLOW_METHODS);
  } catch {}
  try {
    res.setHeader('Access-Control-Allow-Headers', UPLOAD_ALLOW_HEADERS);
  } catch {}
  try {
    res.setHeader('Access-Control-Max-Age', UPLOAD_CORS_MAX_AGE);
  } catch {}
  return resolved;
}

function respondJson(
  req: VercelRequest,
  res: VercelResponse,
  corsDecision: CorsDecision,
  statusCode: number,
  payload: Record<string, any>,
): void {
  const body =
    payload && typeof payload === 'object'
      ? {
          ...payload,
          ...(typeof payload.error === 'string' && !payload.code
            ? { code: payload.error }
            : {}),
        }
      : payload;

  applyUploadCors(req, res, corsDecision);
  if (typeof res.status === 'function') {
    res.status(statusCode);
    if (typeof res.json === 'function') {
      res.json(body);
      return;
    }
  }
  res.statusCode = statusCode;
  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  } catch {}
  res.end(JSON.stringify(body));
}

function respondPayloadTooLarge(
  req: VercelRequest,
  res: VercelResponse,
  corsDecision: CorsDecision,
  diagId: string,
  limitBytes: number,
  receivedBytes: number,
): void {
  respondJson(req, res, corsDecision, 413, {
    ok: false,
    error: 'payload_too_large',
    code: 'payload_too_large',
    limitBytes,
    receivedBytes,
    diagId,
  });
}

function respondUseDirectUpload(
  req: VercelRequest,
  res: VercelResponse,
  corsDecision: CorsDecision,
  diagId: string,
  thresholdBytes: number,
  sizeBytes: number | null,
): void {
  respondJson(req, res, corsDecision, 200, {
    ok: false,
    error: 'use_direct_upload',
    code: 'use_direct_upload',
    diagId,
    thresholdBytes,
    sizeBytes,
  });
}

function readRequestBody(
  req: VercelRequest,
  limitBytes: number,
): Promise<{ buffer: Buffer; bytes: number }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let finished = false;

    const cleanup = () => {
      req.off?.('data', onData);
      req.off?.('end', onEnd);
      req.off?.('error', onError);
    };

    const abort = (err: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      try {
        req.pause?.();
        req.destroy?.();
      } catch {}
      reject(err);
    };

    const onData = (chunk: Buffer | string) => {
      if (finished) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (limitBytes > 0 && total > limitBytes) {
        abort(new PayloadTooLargeError(total));
        return;
      }
      chunks.push(buf);
    };

    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve({ buffer: Buffer.concat(chunks), bytes: total });
    };

    const onError = (err: Error) => {
      abort(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

async function parseMultipartFormData(
  body: Buffer,
  contentTypeHeader: string,
): Promise<{ fields: Record<string, string>; file: MultipartFile | null }> {
  const RequestCtor = (globalThis as any).Request;
  if (typeof RequestCtor !== 'function') {
    throw new Error('Request constructor unavailable');
  }

  const request = new RequestCtor('http://localhost', {
    method: 'POST',
    headers: { 'content-type': contentTypeHeader },
    body,
  });

  const formData: any = await (request as any).formData();
  const fields: Record<string, string> = {};
  let selectedFile: MultipartFile | null = null;

  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      fields[key] = value;
      continue;
    }

    const blob = value as any;
    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const file: MultipartFile = {
      fieldName: key,
      filename:
        typeof (value as any).name === 'string' && (value as any).name
          ? String((value as any).name)
          : typeof blob?.name === 'string' && blob.name
            ? String(blob.name)
            : 'upload.bin',
      contentType:
        typeof (value as any).type === 'string' && (value as any).type
          ? String((value as any).type)
          : typeof blob?.type === 'string' && blob.type
            ? String(blob.type)
            : 'application/octet-stream',
      size: buffer.length,
      buffer,
    };

    if (!selectedFile || key === 'file') {
      selectedFile = file;
    }
  }

  return { fields, file: selectedFile };
}

function parseJsonBody(body: Buffer): Record<string, any> | null {
  if (!body || body.length === 0) {
    return null;
  }
  const text = body.toString('utf8');
  if (!text.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, any>;
    }
    return null;
  } catch (error) {
    throw new InvalidBodyError('invalid_json');
  }
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function decodeBase64(value: string): Buffer | null {
  try {
    const sanitized = value.replace(/\s+/g, '');
    if (!sanitized) return null;
    return Buffer.from(sanitized, 'base64');
  } catch {
    return null;
  }
}

function resolveBase64Components(value: string): { base64: string; contentType: string | null } | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dataUrlMatch = /^data:([^;,]+);base64,(.+)$/i.exec(trimmed);
  if (dataUrlMatch) {
    const contentType = dataUrlMatch[1]?.trim() || null;
    const payload = dataUrlMatch[2]?.trim() || '';
    if (!payload) return null;
    return { base64: payload, contentType };
  }

  if (/^data:/i.test(trimmed)) {
    // Data URL without explicit base64 component, skip to avoid mis-parsing.
    return null;
  }

  const sanitized = trimmed.replace(/\s+/g, '');
  if (!sanitized) return null;
  return { base64: sanitized, contentType: null };
}

function estimateBase64Bytes(base64: string): number | null {
  if (typeof base64 !== 'string' || !base64) return null;
  const sanitized = base64.replace(/\s+/g, '');
  if (!sanitized) return null;
  const length = sanitized.length;
  if (!length) return null;
  const padding = sanitized.endsWith('==') ? 2 : sanitized.endsWith('=') ? 1 : 0;
  const estimated = Math.floor((length * 3) / 4) - padding;
  return estimated >= 0 ? estimated : 0;
}

function findBase64Candidate(payload: Record<string, any> | null): Base64Candidate | null {
  if (!payload) return null;
  const candidates: Array<{ value: unknown }> = [
    { value: (payload as any).imageBase64 },
    { value: (payload as any).image_base64 },
    { value: (payload as any).file_base64 },
    { value: (payload as any).base64 },
    { value: (payload as any).data_url },
  ];

  for (const entry of candidates) {
    if (typeof entry.value !== 'string') continue;
    const trimmed = entry.value.trim();
    if (!trimmed) continue;
    const components = resolveBase64Components(trimmed);
    if (!components) continue;
    const approxBytes = estimateBase64Bytes(components.base64);
    return {
      raw: trimmed,
      base64: components.base64,
      contentType: components.contentType,
      approxBytes,
    };
  }

  return null;
}

async function parseRequest(
  req: VercelRequest,
  limitBytes: number,
): Promise<ParsedRequest> {
  const contentTypeHeader = getContentType(req);
  const baseContentType = getBaseContentType(contentTypeHeader);

  if (!contentTypeHeader && !req.readableEnded && !req.complete) {
    // fallthrough to body parser
  }

  const { buffer, bytes } = await readRequestBody(req, limitBytes);

  if (!baseContentType) {
    const json = parseJsonBody(buffer);
    if (json) {
      return {
        kind: 'json',
        receivedBytes: bytes,
        json,
        fields: {} as Record<string, string>,
        file: null,
      };
    }
    return {
      kind: 'empty',
      receivedBytes: bytes,
      json: null,
      fields: {} as Record<string, string>,
      file: null,
    };
  }

  if (baseContentType === 'application/json' || baseContentType === 'text/json') {
    const json = parseJsonBody(buffer);
    return {
      kind: 'json',
      receivedBytes: bytes,
      json,
      fields: {} as Record<string, string>,
      file: null,
    };
  }

  if (baseContentType === 'multipart/form-data') {
    const parsed = await parseMultipartFormData(buffer, contentTypeHeader);
    return {
      kind: 'multipart',
      receivedBytes: bytes,
      json: null,
      fields: parsed.fields,
      file: parsed.file,
    };
  }

  const json = parseJsonBody(buffer);
  if (json) {
    return {
      kind: 'json',
      receivedBytes: bytes,
      json,
      fields: {} as Record<string, string>,
      file: null,
    };
  }

  return {
    kind: 'empty',
    receivedBytes: bytes,
    json: null,
    fields: {} as Record<string, string>,
    file: null,
  };
}

function normalizePayload(parsed: ParsedRequest, base64Candidate?: Base64Candidate): NormalizedPayload {
  const urlCandidate = parsed.kind === 'json' && parsed.json ? normalizeString(parsed.json.url) : '';
  const url = urlCandidate || null;

  let buffer: NormalizedPayload['buffer'] = null;
  if (parsed.kind === 'json' && parsed.json) {
    const candidate = base64Candidate ?? findBase64Candidate(parsed.json);
    if (candidate) {
      const decoded = decodeBase64(candidate.base64);
      if (decoded?.length) {
        buffer = {
          buffer: decoded,
          contentType: candidate.contentType,
        };
      }
    }
  }

  const fields = parsed.kind === 'multipart' ? parsed.fields : parsed.kind === 'json' && parsed.json ? { ...parsed.json } : {};
  const file = parsed.kind === 'multipart' ? parsed.file : null;

  let mode: NormalizedPayload['mode'] = 'none';
  if (file && file.size > 0) {
    mode = 'multipart';
  } else if (buffer && buffer.buffer.length > 0) {
    mode = 'json_base64';
  } else if (url) {
    mode = 'url';
  }

  return {
    mode,
    receivedBytes: parsed.receivedBytes,
    url,
    json: parsed.kind === 'json' ? parsed.json : null,
    fields,
    file,
    buffer,
  };
}

function buildHandlerPayload(normalized: NormalizedPayload): Record<string, any> {
  if (normalized.mode === 'multipart') {
    const payload: Record<string, any> = { ...normalized.fields };
    const file = normalized.file;
    if (file) {
      payload.file_buffer = file.buffer;
      payload.file_fieldname = file.fieldName;
      if (!payload.file_name) {
        payload.file_name = payload.fileName || payload.filename || file.filename;
      }
      if (!payload.filename) {
        payload.filename = file.filename;
      }
      const contentTypeCandidate =
        payload.file_content_type
        || payload.fileContentType
        || payload.file_mime
        || payload.fileMime
        || payload.mime
        || payload.mime_type
        || payload.content_type
        || file.contentType;
      if (!payload.file_content_type) {
        payload.file_content_type = contentTypeCandidate;
      }
      if (!payload.mime) {
        payload.mime = contentTypeCandidate;
      }
      if (!payload.content_type) {
        payload.content_type = contentTypeCandidate;
      }
      if (!payload.size_bytes) {
        payload.size_bytes = payload.sizeBytes || payload.file_size || payload.fileSize || file.size;
      }
    }
    return payload;
  }

  const payload = normalized.json ? { ...normalized.json } : {};
  if (normalized.buffer) {
    payload.file_buffer = normalized.buffer.buffer;
    if (!payload.mime && !payload.mime_type && !payload.content_type && !payload.file_content_type && normalized.buffer.contentType) {
      payload.mime = normalized.buffer.contentType;
    }
    if (!payload.file_content_type && normalized.buffer.contentType) {
      payload.file_content_type = normalized.buffer.contentType;
    }
    if (!payload.content_type && normalized.buffer.contentType) {
      payload.content_type = normalized.buffer.contentType;
    }
    if (!payload.size_bytes && !payload.sizeBytes) {
      payload.size_bytes = normalized.buffer.buffer.length;
    }
  }
  return payload;
}

function calculateEffectiveReceivedBytes(
  normalized: NormalizedPayload,
  fallback: number,
): number {
  const bufferSize = normalized.buffer?.buffer?.length ?? 0;
  const fileSize = normalized.file?.size ?? 0;
  return Math.max(fallback, bufferSize, fileSize);
}

function respondUploadCorsDenied(
  req: VercelRequest,
  res: VercelResponse,
  decision: CorsDecision,
  diagId: string,
): void {
  applyUploadCors(req, res, decision);
  if (typeof res.status === 'function') {
    res.status(403);
  } else {
    res.statusCode = 403;
  }
  try {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  } catch {}
  res.end(JSON.stringify({ ok: false, error: 'origin_not_allowed', code: 'origin_not_allowed', diagId }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const diagId = randomUUID();
  res.setHeader('X-Upload-Diag-Id', diagId);

  const corsDecision = ensureCors(req, res);

  if (!corsDecision.allowed || !corsDecision.allowedOrigin) {
    respondUploadCorsDenied(req, res, corsDecision, diagId);
    return;
  }

  if (req.method === 'OPTIONS') {
    applyUploadCors(req, res, corsDecision);
    if (typeof res.status === 'function') {
      res.status(204);
    } else {
      res.statusCode = 204;
    }
    res.end();
    return;
  }

  applyUploadCors(req, res, corsDecision);

  if (req.method !== 'POST') {
    respondJson(req, res, corsDecision, 405, { ok: false, error: 'method_not_allowed', diagId });
    return;
  }

  const maxBytes = parseMaxBytes();
  const directThreshold = DIRECT_UPLOAD_THRESHOLD_BYTES;
  const contentLength = getContentLength(req);
  if (contentLength && contentLength > maxBytes) {
    respondPayloadTooLarge(req, res, corsDecision, diagId, maxBytes, contentLength);
    return;
  }
  if (contentLength && contentLength > directThreshold) {
    respondUseDirectUpload(req, res, corsDecision, diagId, directThreshold, contentLength);
    return;
  }

  const approxBase64Bytes = getApproxImageBase64Bytes(req);
  if (approxBase64Bytes && approxBase64Bytes > directThreshold) {
    respondUseDirectUpload(req, res, corsDecision, diagId, directThreshold, approxBase64Bytes);
    return;
  }

  let parsed: ParsedRequest;
  try {
    parsed = await parseRequest(req, maxBytes);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      respondPayloadTooLarge(req, res, corsDecision, diagId, maxBytes, error.bytes);
      return;
    }
    const code = error instanceof InvalidBodyError ? error.code : 'invalid_body';
    respondJson(req, res, corsDecision, 400, { ok: false, error: code, diagId });
    return;
  }

  let base64Candidate: Base64Candidate | null = null;
  if (parsed.kind === 'json' && parsed.json) {
    base64Candidate = findBase64Candidate(parsed.json);
    if (base64Candidate?.approxBytes && base64Candidate.approxBytes > directThreshold) {
      respondUseDirectUpload(
        req,
        res,
        corsDecision,
        diagId,
        directThreshold,
        base64Candidate.approxBytes,
      );
      return;
    }
  }

  const normalized = normalizePayload(parsed, base64Candidate ?? undefined);
  const payloadBufferBytes = normalized.buffer?.buffer?.length ?? 0;
  const payloadFileBytes = normalized.file?.size ?? 0;
  if (
    payloadFileBytes > directThreshold ||
    payloadBufferBytes > directThreshold
  ) {
    const sizeBytes = Math.max(
      payloadFileBytes,
      payloadBufferBytes,
      parsed.receivedBytes ?? 0,
      contentLength ?? 0,
    );
    respondUseDirectUpload(
      req,
      res,
      corsDecision,
      diagId,
      directThreshold,
      sizeBytes || null,
    );
    return;
  }

  const effectiveBytes = calculateEffectiveReceivedBytes(normalized, parsed.receivedBytes);

  if (effectiveBytes > maxBytes) {
    respondPayloadTooLarge(req, res, corsDecision, diagId, maxBytes, effectiveBytes);
    return;
  }

  const uploadEnabled = process?.env?.UPLOAD_ENABLED === '1';
  const shouldCallHandler =
    uploadEnabled && (normalized.mode === 'multipart' || normalized.mode === 'json_base64');

  if (shouldCallHandler) {
    try {
      const module = await import('../lib/handlers/uploadOriginal.js');
      const realHandler = module?.default;
      if (typeof realHandler !== 'function') {
        throw new Error('upload_handler_unavailable');
      }

      const payloadForHandler = buildHandlerPayload(normalized);
      (req as any).body = payloadForHandler;

      const enhancedRes = res as VercelResponse & { status?: any; json?: any };
      const originalStatus = typeof enhancedRes.status === 'function' ? enhancedRes.status.bind(enhancedRes) : null;
      if (!originalStatus) {
        enhancedRes.status = (code: number) => {
          enhancedRes.statusCode = code;
          return enhancedRes;
        };
      }
      const originalJson = typeof enhancedRes.json === 'function' ? enhancedRes.json.bind(enhancedRes) : null;
      enhancedRes.json = (body: any) => {
        let payload = body;
        if (payload && typeof payload === 'object' && payload.ok === true) {
          const derivedPublicUrl =
            payload.publicUrl ?? payload.public_url ?? payload.file_original_url ?? null;
          if (payload.publicUrl !== derivedPublicUrl) {
            payload = { ...payload, publicUrl: derivedPublicUrl };
          }
        }
        if (originalJson) {
          return originalJson(payload);
        }
        try {
          enhancedRes.setHeader?.('Content-Type', 'application/json');
        } catch {}
        enhancedRes.end(JSON.stringify(payload));
        return enhancedRes;
      };

      await realHandler(req, enhancedRes);
    } catch (error) {
      if (!res.headersSent) {
        respondJson(req, res, corsDecision, 500, { ok: false, error: 'upload_unavailable', diagId });
      }
    }
    return;
  }

  const publicUrl = normalized.url || PASSTHROUGH_PLACEHOLDER_URL;
  respondJson(req, res, corsDecision, 200, {
    ok: true,
    mode: 'passthrough',
    publicUrl,
    diagId,
  });
}
