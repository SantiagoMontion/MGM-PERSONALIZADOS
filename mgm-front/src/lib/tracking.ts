const RAW_API_BASE = typeof import.meta.env.VITE_API_BASE === 'string'
  ? import.meta.env.VITE_API_BASE
  : typeof import.meta.env.VITE_API_URL === 'string'
    ? import.meta.env.VITE_API_URL
    : '';

const API_BASE = RAW_API_BASE.trim().replace(/\/+$/, '');
const TRACK_ENDPOINT = API_BASE ? `${API_BASE}/track` : '/api/track';
const DEDUPE_WINDOW_MS = 1500;
const recentEvents = new Map<string, number>();

function resolveTrackingEnabled(): boolean {
  const raw = import.meta.env?.VITE_TRACKING_ENABLED;
  if (raw == null || String(raw).trim() === '') {
    return Boolean(import.meta.env?.DEV);
  }
  const normalized = String(raw).trim().toLowerCase();
  return normalized !== '0' && normalized !== 'false';
}

const isTrackingEnabled = resolveTrackingEnabled();

function resolveDebugEnabled(): boolean {
  if (typeof window !== 'undefined' && (window as any).__TRACK_DEBUG__ === true) {
    return true;
  }
  const raw = import.meta.env?.VITE_TRACKING_DEBUG;
  if (raw == null) {
    return false;
  }
  const normalized = String(raw).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function generateRidSuffix(length = 12): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const targetLength = Number.isFinite(length) && length > 0 ? Math.floor(length) : 12;
  if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(targetLength);
    window.crypto.getRandomValues(buffer);
    let output = '';
    for (const value of buffer) {
      output += alphabet[value % alphabet.length];
    }
    return output;
  }
  let output = '';
  for (let index = 0; index < targetLength; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length);
    output += alphabet[randomIndex];
  }
  return output;
}

export function ensureTrackingRid(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const globalRid = typeof (window as any).__RID === 'string' ? (window as any).__RID.trim() : '';
  if (globalRid) {
    return globalRid;
  }

  try {
    if (window.localStorage) {
      const stored = window.localStorage.getItem('rid');
      if (typeof stored === 'string') {
        const trimmed = stored.trim();
        if (trimmed) {
          (window as any).__RID = trimmed;
          return trimmed;
        }
      }
    }
  } catch {
    // ignore storage errors
  }

  const suffixLength = 12 + Math.floor(Math.random() * 5);
  const generated = `mgad${generateRidSuffix(suffixLength)}`;
  (window as any).__RID = generated;
  try {
    if (window.localStorage) {
      window.localStorage.setItem('rid', generated);
    }
  } catch {
    // ignore storage write errors
  }
  return generated;
}

function buildExtraPayload(data: Record<string, any> | undefined) {
  if (!data) {
    return undefined;
  }

  const extra: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const lowered = key.toLowerCase();
    if (
      lowered === 'event'
      || lowered === 'event_name'
      || lowered === 'rid'
      || lowered === 'design_slug'
      || lowered === 'designslug'
      || lowered === 'cta'
      || lowered === 'cta_type'
      || lowered === 'ctatype'
      || lowered === 'product_handle'
      || lowered === 'producthandle'
      || lowered === 'extra'
    ) {
      continue;
    }
    extra[key] = value;
  }

  if (data.extra) {
    if (typeof data.extra === 'string') {
      try {
        const parsed = JSON.parse(data.extra);
        if (parsed && typeof parsed === 'object') {
          Object.assign(extra, parsed as Record<string, any>);
        }
      } catch {
        extra.extra = data.extra;
      }
    } else if (typeof data.extra === 'object') {
      Object.assign(extra, data.extra);
    }
  }

  return Object.keys(extra).length ? extra : undefined;
}

export function trackEvent(eventName: string, data?: Record<string, any>) {
  try {
    if (!eventName || typeof eventName !== 'string') return;
    if (!isTrackingEnabled) return;
    if (typeof window === 'undefined') return;
    if (!TRACK_ENDPOINT) return;

    const ridCandidate = data?.rid ?? ensureTrackingRid();
    const rid = toOptionalString(ridCandidate);
    const dedupeKey = `${eventName}|${rid ?? ''}`;
    const now = Date.now();
    const lastTimestamp = recentEvents.get(dedupeKey);
    if (lastTimestamp && now - lastTimestamp < DEDUPE_WINDOW_MS) {
      return;
    }
    recentEvents.set(dedupeKey, now);
    for (const [key, timestamp] of Array.from(recentEvents.entries())) {
      if (now - timestamp > DEDUPE_WINDOW_MS) {
        recentEvents.delete(key);
      }
    }

    const designSlug = toOptionalString(data?.design_slug ?? (data as any)?.designSlug);
    const productHandle = toOptionalString(data?.product_handle ?? (data as any)?.productHandle);
    const rawCta = toOptionalString(data?.cta_type ?? (data as any)?.ctaType ?? data?.cta);
    let ctaType = rawCta;
    if (!ctaType && eventName.startsWith('cta_click_')) {
      ctaType = eventName.replace('cta_click_', '');
    }

    const payload = {
      event: eventName,
      event_name: eventName,
      rid,
      cta_type: ctaType,
      design_slug: designSlug,
      product_handle: productHandle,
      extra: buildExtraPayload(data),
      origin: typeof location !== 'undefined' && location ? location.origin : undefined,
    };

    const debugEnabled = resolveDebugEnabled();
    const endpoint = debugEnabled ? `${TRACK_ENDPOINT}?echo=1` : TRACK_ENDPOINT;

    if (!debugEnabled && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(payload)) {
        if (value == null) continue;
        if (typeof value === 'object') {
          try {
            params.append(key, JSON.stringify(value));
          } catch {
            continue;
          }
        } else {
          params.append(key, String(value));
        }
      }
      const sent = navigator.sendBeacon(TRACK_ENDPOINT, params);
      if (debugEnabled) {
        console.debug('[track]', { event: eventName, rid, sent });
      }
      return;
    }

    const bodyJson = JSON.stringify(payload);
    fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bodyJson,
      keepalive: true,
    })
      .then(async (response) => {
        if (!debugEnabled) return;
        let diagId: string | null = null;
        try {
          const cloned = response.clone();
          const json = await cloned.json();
          diagId = json?.diagId ?? json?.diag_id ?? null;
        } catch {
          diagId = null;
        }
        console.debug('[track]', {
          event: eventName,
          rid,
          status: response.status,
          diagId,
        });
      })
      .catch((error) => {
        if (!debugEnabled) return;
        console.debug('[track]', {
          event: eventName,
          rid,
          status: 'error',
          error: error?.message || String(error),
        });
      });
  } catch {
    // ignore tracking errors
  }
}

export default { trackEvent, ensureTrackingRid };
