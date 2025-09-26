export interface OpenCartOptions {
  target?: string;
  popup?: Window | null;
  focus?: boolean;
}

export function openCartUrl(rawUrl: string, options?: OpenCartOptions): boolean {
  const target = options?.target ?? '_blank';
  const focus = options?.focus !== false;
  try {
    const parsed = new URL(rawUrl);
    const popup = options?.popup && !options.popup.closed ? options.popup : null;
    if (popup) {
      try {
        popup.location.href = rawUrl;
        if (focus && typeof popup.focus === 'function') popup.focus();
        return true;
      } catch (err) {
        console.warn?.('[openCartUrl] popup_navigation_failed', err);
      }
    }
  } catch (err) {
    console.error('[openCartUrl] invalid url', err);
  }
  const features = target === '_blank' ? 'noopener' : undefined;
  const win = window.open(rawUrl, target, features);
  if (win && focus && typeof win.focus === 'function') {
    try {
      win.focus();
    } catch (focusErr) {
      console.warn?.('[openCartUrl] focus_failed', focusErr);
    }
  }
  return !!win;
}
