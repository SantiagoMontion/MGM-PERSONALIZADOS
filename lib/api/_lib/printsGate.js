const PASSWORD = process.env.PRINTS_SEARCH_PASSWORD || 'Spesia666';
const DURATION_MS = 24 * 60 * 60 * 1000;

function decodeToken(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  let decoded = null;
  try {
    decoded = Buffer.from(trimmed, 'base64').toString('utf8');
  } catch {
    decoded = trimmed;
  }
  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

export function verifyPrintsGate({ headers = {}, diagId }) {
  const value = headers['x-prints-gate'] || headers['X-Prints-Gate'];
  const rawToken = Array.isArray(value) ? value[0] : value;
  const payload = decodeToken(rawToken);
  const now = Date.now();

  let status = 'invalid';
  let reason = 'missing_token';
  let expiresAt = null;

  if (payload && typeof payload === 'object') {
    const receivedPassword = typeof payload.password === 'string'
      ? payload.password
      : typeof payload.pass === 'string'
        ? payload.pass
        : typeof payload.token === 'string'
          ? payload.token
          : '';
    const expiry = Number(payload.expiresAt ?? payload.expiry ?? payload.exp);
    expiresAt = Number.isFinite(expiry) ? expiry : null;

    if (!expiresAt) {
      status = 'invalid';
      reason = 'invalid_expiry';
    } else if (expiresAt < now) {
      status = 'expired';
      reason = 'expired';
    } else if (expiresAt - now > DURATION_MS + 60_000) {
      status = 'invalid';
      reason = 'expiry_out_of_range';
    } else if (receivedPassword !== PASSWORD) {
      status = 'invalid';
      reason = 'invalid_password';
    } else {
      status = 'valid';
      reason = null;
    }
  }

  try {
    console.info('auth_gate_checked', {
      diagId,
      status,
      reason,
      expiresAt,
      now,
    });
  } catch (err) {
    if (err) {
      // noop
    }
  }

  return {
    ok: status === 'valid',
    reason: reason || undefined,
    expiresAt,
  };
}

export default verifyPrintsGate;
