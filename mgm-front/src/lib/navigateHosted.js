/**
 * Cuando mgm-front corre dentro de un iframe (ej. Theme app extension en Shopify),
 * navegar con window.location solo cambia el iframe. Checkout / tienda en notmid.ar
 * suelen mandar X-Frame-Options o CSP frame-ancestors y el navegador bloquea la vista.
 * En ese caso hay que navegar el contexto superior (window.top).
 */

export function assignLeavingHostedApp(url) {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed || typeof window === 'undefined') return false;
  try {
    if (window.self !== window.top) {
      window.top.location.href = trimmed;
      return true;
    }
  } catch {
    try {
      window.open(trimmed, '_top', 'noopener,noreferrer');
      return true;
    } catch {
      // fall through
    }
  }
  try {
    window.location.assign(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Abre URL externa en pestaña nueva sin navegar la pestaña actual.
 */
export function openExternalInNewTabOnly(url) {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed || typeof window === 'undefined') return false;
  try {
    const popup = window.open(trimmed, '_blank', 'noopener,noreferrer');
    return Boolean(popup);
  } catch {
    return false;
  }
}

/**
 * Flujo "Agregar al carrito": una sola pestaña al producto si es posible.
 * Si hace falta pestaña nueva, ejecuta onNewTabOpened en la pestaña del editor.
 * @returns {'same-tab' | 'new-tab' | null}
 */
export function navigateCommerceForCart(url, { onNewTabOpened } = {}) {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed || typeof window === 'undefined') return null;

  if (assignLeavingHostedApp(trimmed)) {
    return 'same-tab';
  }

  if (openExternalInNewTabOnly(trimmed)) {
    if (typeof onNewTabOpened === 'function') {
      onNewTabOpened();
    }
    return 'new-tab';
  }

  return null;
}

export function replaceLeavingHostedApp(url) {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed || typeof window === 'undefined') return false;
  try {
    if (window.self !== window.top) {
      window.top.location.replace(trimmed);
      return true;
    }
  } catch {
    try {
      window.open(trimmed, '_top', 'noopener,noreferrer');
      return true;
    } catch {
      // fall through
    }
  }
  try {
    window.location.replace(trimmed);
    return true;
  } catch {
    return false;
  }
}
