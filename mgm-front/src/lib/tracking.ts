const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const TRACK_URL = API ? `${API}/track` : '';
const DEDUP_WINDOW_MS = 1500;
const recentEvents = new Map<string, number>();

const isTrackingDisabled = (() => {
  const raw = import.meta.env?.VITE_TRACKING_ENABLED;
  if (raw == null) return false;
  return String(raw).trim() === '0';
})();

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

export function trackEvent(eventName: string, data?: Record<string, any>) {
  try {
    if (!eventName || typeof eventName !== 'string') return;
    if (isTrackingDisabled) return;
    if (typeof window === 'undefined') return;
    if (!TRACK_URL) return;

    const ridCandidate = data?.rid ?? (window as any)?.__RID;
    const rid = toOptionalString(ridCandidate);
    const dedupKey = `${eventName}|${rid ?? ''}`;
    const now = Date.now();
    const lastTimestamp = recentEvents.get(dedupKey);
    if (lastTimestamp && now - lastTimestamp < DEDUP_WINDOW_MS) {
      return;
    }
    recentEvents.set(dedupKey, now);
    for (const [key, timestamp] of Array.from(recentEvents.entries())) {
      if (now - timestamp > DEDUP_WINDOW_MS) {
        recentEvents.delete(key);
      }
    }

    const payload = {
      event_name: eventName,
      rid,
      design_slug: toOptionalString(data?.design_slug) ?? undefined,
      product_id: toOptionalString(data?.product_id) ?? undefined,
      variant_id: toOptionalString(data?.variant_id) ?? undefined,
      amount: data?.amount ?? undefined,
      currency: data?.currency ?? undefined,
      order_id: data?.order_id ?? undefined,
      origin: typeof location !== 'undefined' && location ? location.origin : undefined,
      details: data?.details ?? undefined,
    };

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(TRACK_URL, blob);
      return;
    }
    fetch(TRACK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore all tracking errors
  }
}
