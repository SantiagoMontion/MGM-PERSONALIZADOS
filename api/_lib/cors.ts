import type { VercelRequest, VercelResponse } from '@vercel/node';

const ALLOW_HEADERS = 'content-type, authorization, x-debug-fast, accept, x-requested-with';
const ALLOW_METHODS = 'POST, OPTIONS';

type CorsDecision = {
  requestedOrigin: string | null;
  normalizedOrigin: string | null;
  allowedOrigin: string | null;
  allowed: boolean;
};

function sanitizeOrigin(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, '');
}

export function normalizeOrigin(value: string | null | undefined): string | null {
  const sanitized = sanitizeOrigin(value);
  return sanitized ? sanitized.toLowerCase() : null;
}

export function getAllowedOriginsFromEnv(): string[] {
  const allowSet = new Map<string, string>();

  const frontOrigin = sanitizeOrigin(process.env.FRONT_ORIGIN);
  if (frontOrigin) {
    const normalized = normalizeOrigin(frontOrigin);
    if (normalized) {
      allowSet.set(normalized, frontOrigin);
    }
  }

  const envOrigins = typeof process.env.ALLOWED_ORIGINS === 'string'
    ? process.env.ALLOWED_ORIGINS.split(',')
    : [];

  for (const entry of envOrigins) {
    const sanitized = sanitizeOrigin(entry);
    if (!sanitized) continue;
    const normalized = normalizeOrigin(sanitized);
    if (normalized) {
      allowSet.set(normalized, sanitized);
    }
  }

  return Array.from(allowSet.values());
}

export function resolveCorsDecision(originHeader: string | undefined, allowList?: string[]): CorsDecision {
  const requestedOrigin = sanitizeOrigin(originHeader);
  const normalizedOrigin = normalizeOrigin(originHeader);
  const allowedOrigins = allowList && allowList.length ? allowList : getAllowedOriginsFromEnv();

  const allowMap = new Map<string, string>();
  for (const entry of allowedOrigins) {
    const sanitized = sanitizeOrigin(entry);
    const normalized = normalizeOrigin(entry);
    if (sanitized && normalized) {
      allowMap.set(normalized, sanitized);
    }
  }

  if (normalizedOrigin && allowMap.has(normalizedOrigin)) {
    return {
      requestedOrigin,
      normalizedOrigin,
      allowedOrigin: allowMap.get(normalizedOrigin) ?? null,
      allowed: true,
    };
  }

  if (normalizedOrigin && normalizedOrigin.startsWith('http://localhost')) {
    return {
      requestedOrigin,
      normalizedOrigin,
      allowedOrigin: requestedOrigin,
      allowed: true,
    };
  }

  if (normalizedOrigin && normalizedOrigin.startsWith('http://127.0.0.1')) {
    return {
      requestedOrigin,
      normalizedOrigin,
      allowedOrigin: requestedOrigin,
      allowed: true,
    };
  }

  return {
    requestedOrigin,
    normalizedOrigin,
    allowedOrigin: null,
    allowed: false,
  };
}

export function applyCors(req: VercelRequest, res: VercelResponse): void {
  const originHeader =
    typeof req.headers.origin === 'string' && req.headers.origin.trim().length > 0
      ? req.headers.origin
      : undefined;
  const decision = resolveCorsDecision(originHeader);

  if (decision.allowed && decision.allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', decision.allowedOrigin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', ALLOW_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOW_HEADERS);

  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json');
  }
}

export function ensureJsonContentType(res: VercelResponse) {
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json');
  }
}

export type { CorsDecision };
