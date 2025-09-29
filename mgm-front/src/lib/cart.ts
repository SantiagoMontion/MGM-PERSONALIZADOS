export interface OpenCartOptions {
  target?: string;
  popup?: Window | null;
  focus?: boolean;
}

export function openCartUrl(rawUrl: string, options?: OpenCartOptions): boolean {
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!url) {
    console.warn?.('[openCartUrl] empty url', rawUrl);
    return false;
  }
  const target = options?.target ?? '_blank';
  const focus = options?.focus !== false;
  const popup = options?.popup && !options.popup.closed ? options.popup : null;
  try {
    new URL(url);
  } catch (err) {
    console.error('[openCartUrl] invalid url', err);
    return false;
  }
  if (popup) {
    try {
      popup.opener = null;
    } catch (openerErr) {
      console.debug?.('[openCartUrl] opener_clear_failed', openerErr);
    }
    try {
      popup.location.replace(url);
      if (focus && typeof popup.focus === 'function') popup.focus();
      return true;
    } catch (err) {
      console.warn?.('[openCartUrl] popup_navigation_failed', err);
    }
  }
  const features = target === '_blank' ? 'noopener' : undefined;
  const win =
    features !== undefined
      ? window.open(url, target, features)
      : window.open(url, target);
  if (win && target === '_blank') {
    try {
      win.opener = null;
    } catch (openerErr) {
      console.debug?.('[openCartUrl] opener_clear_failed', openerErr);
    }
  }
  if (win && focus && typeof win.focus === 'function') {
    try {
      win.focus();
    } catch (focusErr) {
      console.warn?.('[openCartUrl] focus_failed', focusErr);
    }
  }
  return !!win;
}
