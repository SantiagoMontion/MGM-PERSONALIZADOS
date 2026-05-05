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
