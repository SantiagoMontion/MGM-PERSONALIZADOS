export interface OpenCartOptions {
  target?: string;
  popup?: Window | null;
  focus?: boolean;
}

const CART_ADD_PATH = '/cart/add';

function normalizePathname(path: string) {
  return path.replace(/\/+$/, '') || '/';
}

function buildHiddenInput(name: string, value: string) {
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = name;
  input.value = value;
  return input;
}

function submitCartForm(url: URL, target: string, popup?: Window | null, focus = true) {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = `${url.origin}${url.pathname}`;
  form.enctype = 'application/x-www-form-urlencoded';
  const params = new URLSearchParams(url.search);
  if (!params.has('form_type')) params.set('form_type', 'product');
  if (!params.has('utf8')) params.set('utf8', '✓');

  params.forEach((value, key) => {
    form.appendChild(buildHiddenInput(key, value));
  });

  // Ensure return_to defaults to home when missing
  if (!params.has('return_to')) {
    form.appendChild(buildHiddenInput('return_to', '/'));
  }

  let targetName = target;
  let popupRef: Window | null = popup && !popup.closed ? popup : null;
  if (targetName === '_blank') {
    if (!popupRef) {
      targetName = `mgm_cart_${Date.now()}`;
      popupRef = window.open('', targetName, 'noopener');
      if (!popupRef) {
        targetName = '_self';
      }
    } else {
      targetName = popupRef.name || targetName;
    }
  } else if (popupRef) {
    targetName = popupRef.name || targetName || '_self';
  }
  if (!targetName) targetName = '_self';
  form.target = targetName;
  form.style.display = 'none';
  document.body.appendChild(form);
  form.submit();
  window.setTimeout(() => {
    form.remove();
  }, 0);
  if (popupRef && focus && typeof popupRef.focus === 'function') {
    popupRef.focus();
  }
  return popupRef !== null || targetName === '_self';
}

export function openCartUrl(rawUrl: string, options?: OpenCartOptions): boolean {
  const target = options?.target ?? '_blank';
  const popup = options?.popup && !options.popup.closed ? options.popup : null;
  const focus = options?.focus !== false;
  try {
    const parsed = new URL(rawUrl);
    if (normalizePathname(parsed.pathname) === CART_ADD_PATH) {
      const submitted = submitCartForm(parsed, target, popup, focus);
      if (submitted) return true;
    } else if (popup) {
      try {
        popup.location.href = rawUrl;
        if (focus && typeof popup.focus === 'function') popup.focus();
        return true;
      } catch (err) {
        // fall through to window.open
      }
    }
  } catch (err) {
    console.error('[openCartUrl] invalid url', err);
  }
  const features = target === '_blank' ? 'noopener' : undefined;
  const win = window.open(rawUrl, target, features);
  return !!win;
}
