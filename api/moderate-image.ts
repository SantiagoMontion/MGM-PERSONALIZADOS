import type { VercelRequest, VercelResponse } from '@vercel/node';
import { applyCors, ensureCors, type CorsDecision } from './_lib/cors.js';
import { createDiagId } from './_lib/diag.js';
import logger from '../lib/_lib/logger.js';
import { normalizeLabels } from './_lib/moderation/labels.js';

const DEFAULT_PREVIEW_LIMIT_BYTES = 2_000_000;
const PREVIEW_LIMIT_BYTES = Number.isFinite(Number(process.env.MOD_PREVIEW_LIMIT_BYTES))
  ? Number(process.env.MOD_PREVIEW_LIMIT_BYTES)
  : DEFAULT_PREVIEW_LIMIT_BYTES;
const BLOCK_NUDITY = new Set([
  'nudity',
  'explicit_nudity',
  'graphic_nudity',
  'sexual',
  'porn',
  'adult_content',
  'sexual_activity',
  'sexual_minors',
]);
const BLOCK_EXTREMISM = new Set([
  'nazi',
  'nazism',
  'swastika',
  'hitler',
  'ss_symbol',
  'third_reich',
  'hate_symbol',
  'extremist_symbol',
]);
const ALLOW_CURRENCY = new Set(['currency', 'banknote', 'bank_note', 'money', 'bill']);
const BODY_LIMIT_BYTES = 8 * 1024 * 1024;
const MODERATION_ALLOW_METHODS = 'POST, OPTIONS';
const REQUIRED_MODERATION_HEADERS = ['content-type', 'x-preview', 'x-diag', 'authorization'] as const;

class PayloadTooLargeError extends Error {
  bytes: number;

  constructor(bytes: number) {
    super('payload_too_large');
    this.name = 'PayloadTooLargeError';
    this.bytes = bytes;
  }
}

function parseBooleanish(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (Array.isArray(value)) {
    return value.some((entry) => parseBooleanish(entry));
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return false;
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

async function readRequestBody(req: VercelRequest): Promise<{ text: string; bytes: number }> {
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
      if (BODY_LIMIT_BYTES > 0 && total > BODY_LIMIT_BYTES) {
        abort(new PayloadTooLargeError(total));
        return;
      }
      chunks.push(buf);
    };

    const onEnd = () => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve({ text: Buffer.concat(chunks).toString('utf8'), bytes: total });
    };

    const onError = (err: Error) => {
      abort(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function computeBase64Bytes(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const normalized = trimmed.replace(/^data:[^;]+;base64,/i, '');
  try {
    return Buffer.byteLength(normalized, 'base64');
  } catch {
    return 0;
  }
}

function applyModerationCors(
  req: VercelRequest,
  res: VercelResponse,
  decision?: CorsDecision,
): CorsDecision {
  const resolved = applyCors(req, res, decision);
  res.setHeader('Access-Control-Allow-Methods', MODERATION_ALLOW_METHODS);
  const existing = res.getHeader('Access-Control-Allow-Headers');
  const headerSet = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== 'string') return;
    const segments = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    for (const segment of segments) {
      headerSet.add(segment.toLowerCase());
    }
  };
  if (Array.isArray(existing)) {
    for (const value of existing) {
      push(value);
    }
  } else if (existing) {
    push(existing);
  }
  for (const header of REQUIRED_MODERATION_HEADERS) {
    headerSet.add(header);
  }
  res.setHeader('Access-Control-Allow-Headers', Array.from(headerSet).join(', '));
  return resolved;
}

function respondJson(
  req: VercelRequest,
  res: VercelResponse,
  corsDecision: CorsDecision,
  status: number,
  payload: Record<string, unknown>,
): void {
  const body: Record<string, unknown> = payload ?? {};
  applyModerationCors(req, res, corsDecision);
  const diagValue = typeof (body as Record<string, unknown>).diagId === 'string'
    ? ((body as Record<string, unknown>).diagId as string)
    : null;
  if (diagValue) {
    res.setHeader('X-Diag-Id', diagValue);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(status);
    res.json(body);
    return;
  }
  if (typeof res.status === 'function') {
    res.status(status);
  } else {
    res.statusCode = status;
  }
  res.end(JSON.stringify(body));
}

function resolveExtremismReason(labels: Set<string>): 'nazism' | 'extremism' {
  const naziIndicators = ['nazi', 'nazism', 'swastika', 'hitler', 'third_reich'];
  for (const indicator of naziIndicators) {
    if (labels.has(indicator)) {
      return 'nazism';
    }
  }
  return 'extremism';
}

function collectLabelSources(payload: Record<string, unknown> | null | undefined): unknown[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const sources: unknown[] = [];
  const keys = [
    'label',
    'labels',
    'moderationLabel',
    'moderationLabels',
    'ModerationLabel',
    'ModerationLabels',
    'moderation_labels',
    'moderation',
    'moderationResult',
    'moderationResults',
    'moderation_result',
    'moderation_results',
    'analysis',
    'analyses',
    'category',
    'categories',
    'tag',
    'tags',
    'concept',
    'concepts',
    'class',
    'classes',
    'result',
    'results',
    'output',
    'outputs',
    'prediction',
    'predictions',
    'detection',
    'detections',
    'flag',
    'flags',
    'reason',
    'reasons',
  ];
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      sources.push(record[key]);
    }
  }
  const providers = (record as Record<string, unknown> & { providers?: unknown[] }).providers;
  if (Array.isArray(providers)) {
    for (const entry of providers) {
      if (entry && typeof entry === 'object') {
        sources.push(...collectLabelSources(entry as Record<string, unknown>));
      }
    }
  }
  const results = (record as Record<string, unknown> & { results?: unknown[] }).results;
  if (Array.isArray(results)) {
    for (const entry of results) {
      if (entry && typeof entry === 'object') {
        sources.push(...collectLabelSources(entry as Record<string, unknown>));
      }
    }
  }
  const outputs = (record as Record<string, unknown> & { outputs?: unknown[] }).outputs;
  if (Array.isArray(outputs)) {
    for (const entry of outputs) {
      if (entry && typeof entry === 'object') {
        sources.push(...collectLabelSources(entry as Record<string, unknown>));
      }
    }
  }
  const detections = (record as Record<string, unknown> & { detections?: unknown[] }).detections;
  if (Array.isArray(detections)) {
    for (const entry of detections) {
      if (entry && typeof entry === 'object') {
        sources.push(...collectLabelSources(entry as Record<string, unknown>));
      }
    }
  }
  const predictions = (record as Record<string, unknown> & { predictions?: unknown[] }).predictions;
  if (Array.isArray(predictions)) {
    for (const entry of predictions) {
      if (entry && typeof entry === 'object') {
        sources.push(...collectLabelSources(entry as Record<string, unknown>));
      }
    }
  }
  return sources;
}

export const config = {
  api: {
    bodyParser: false,
    sizeLimit: '8mb',
  },
  memory: 256,
  maxDuration: 10,
} as const;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const diagId = createDiagId();
  const ensuredCors = ensureCors(req, res);
  const corsDecision = applyModerationCors(req, res, ensuredCors);

  if (!corsDecision.allowed || !corsDecision.allowedOrigin) {
    respondJson(req, res, corsDecision, 403, {
      ok: false,
      error: 'origin_not_allowed',
      diagId,
    });
    return;
  }

  if (req.method === 'OPTIONS') {
    applyModerationCors(req, res, corsDecision);
    if (typeof res.status === 'function') {
      res.status(204);
    } else {
      res.statusCode = 204;
    }
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    respondJson(req, res, corsDecision, 405, {
      ok: false,
      code: 'method_not_allowed',
      diagId,
    });
    return;
  }

  let text: string | null = null;
  let receivedBytes = 0;
  try {
    const body = await readRequestBody(req);
    text = body.text;
    receivedBytes = body.bytes;
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      respondJson(req, res, corsDecision, 413, {
        ok: false,
        code: 'payload_too_large',
        diagId,
        receivedBytes: err.bytes,
        limitBytes: BODY_LIMIT_BYTES,
      });
      return;
    }
    logger.error?.('[moderate-image] body_read_failed', { diagId, error: err instanceof Error ? err.message : err });
    respondJson(req, res, corsDecision, 400, {
      ok: false,
      code: 'invalid_body',
      diagId,
    });
    return;
  }

  let payload: Record<string, unknown> = {};
  if (text && text.trim()) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        payload = parsed as Record<string, unknown>;
      } else {
        payload = {};
      }
    } catch (err) {
      logger.warn?.('[moderate-image] invalid_json', { diagId, error: err instanceof Error ? err.message : err });
      respondJson(req, res, corsDecision, 400, {
        ok: false,
        code: 'invalid_json',
        diagId,
      });
      return;
    }
  }

  const isPreview =
    parseBooleanish((req.query as Record<string, unknown> | undefined)?.['preview'])
    || parseBooleanish(req.headers['x-preview']);

  let previewBase64: string | null = null;
  const previewCandidates = [
    payload['imageBase64'],
    payload['image_base64'],
    payload['previewBase64'],
    payload['preview_base64'],
  ];
  for (const candidate of previewCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      previewBase64 = candidate;
      break;
    }
  }

  const previewBytes = computeBase64Bytes(previewBase64);

  if (isPreview && PREVIEW_LIMIT_BYTES > 0 && previewBytes > PREVIEW_LIMIT_BYTES) {
    logger.info?.('[moderate-image] preview_too_large', {
      diagId,
      previewBytes,
      limitBytes: PREVIEW_LIMIT_BYTES,
    });
    respondJson(req, res, corsDecision, 413, {
      ok: false,
      code: 'preview_too_large',
      diagId,
      limitBytes: PREVIEW_LIMIT_BYTES,
      previewBytes,
    });
    return;
  }

  const labelSources = collectLabelSources(payload);
  const normalizedLabels = normalizeLabels(labelSources);
  const labelSet = new Set(normalizedLabels);

  const hasNudity = normalizedLabels.some((label) => BLOCK_NUDITY.has(label));
  const extremismMatches = normalizedLabels.filter((label) => BLOCK_EXTREMISM.has(label));
  const hasExtremism = extremismMatches.length > 0;
  const hasLabels = normalizedLabels.length > 0;
  const onlyCurrency = hasLabels && normalizedLabels.every((label) => ALLOW_CURRENCY.has(label));
  const currencyPresent = normalizedLabels.some((label) => ALLOW_CURRENCY.has(label));

  const allowBanknotesRaw = process.env.MOD_ALLOW_BANKNOTES ?? '1';
  const allowBanknotes = allowBanknotesRaw === '1';

  let decision: 'allowed' | 'blocked_nudity' | 'blocked_extremism' | 'allowed_banknote' = 'allowed';

  if (hasNudity) {
    decision = 'blocked_nudity';
  } else if (hasExtremism || (!allowBanknotes && onlyCurrency && currencyPresent)) {
    decision = 'blocked_extremism';
  } else if (onlyCurrency && currencyPresent) {
    decision = 'allowed_banknote';
  }

  logger.info?.('[moderate-image] decision', {
    diagId,
    decision,
    labels: Array.from(labelSet),
    allowBanknotes: allowBanknotesRaw,
    preview: isPreview,
    receivedBytes,
  });

  if (decision === 'blocked_nudity') {
    respondJson(req, res, corsDecision, 422, {
      ok: false,
      code: 'moderation_blocked',
      reason: 'nudity',
      diagId,
    });
    return;
  }

  if (decision === 'blocked_extremism') {
    const extremismSet = new Set(extremismMatches);
    const reason = resolveExtremismReason(extremismSet.size ? extremismSet : labelSet);
    respondJson(req, res, corsDecision, 422, {
      ok: false,
      code: 'moderation_blocked',
      reason,
      diagId,
    });
    return;
  }

  respondJson(req, res, corsDecision, 200, {
    ok: true,
    diagId,
  });
}
