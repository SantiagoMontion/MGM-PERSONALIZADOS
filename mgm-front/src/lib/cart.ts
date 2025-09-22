export interface OpenCartOptions {
  target?: string;
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

function submitCartForm(url: URL, target: string) {
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

  // Ensure return_to defaults to cart when missing
  if (!params.has('return_to')) {
    form.appendChild(buildHiddenInput('return_to', '/cart'));
  }

  let targetName = target;
  let popup: Window | null = null;
  if (target === '_blank') {
    targetName = `mgm_cart_${Date.now()}`;
    popup = window.open('', targetName, 'noopener');
    if (!popup) {
      targetName = '_self';
    }
  }
  form.target = targetName;
  form.style.display = 'none';
  document.body.appendChild(form);
  form.submit();
  window.setTimeout(() => {
    form.remove();
  }, 0);
  if (target === '_blank' && popup && typeof popup.focus === 'function') {
    popup.focus();
  }
  return popup !== null || targetName === '_self';
}

export function openCartUrl(rawUrl: string, options?: OpenCartOptions) {
  const target = options?.target ?? '_blank';
  try {
    const parsed = new URL(rawUrl);
    if (normalizePathname(parsed.pathname) === CART_ADD_PATH) {
      const submitted = submitCartForm(parsed, target);
      if (submitted) return;
    }
  } catch (err) {
    console.warn('[openCartUrl] invalid url', err);
  }
  const features = target === '_blank' ? 'noopener' : undefined;
  window.open(rawUrl, target, features);
}
