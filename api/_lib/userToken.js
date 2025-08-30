import { createHmac, timingSafeEqual } from 'node:crypto';

const TTL_MS = 15 * 60 * 1000; // 15 minutes
const SECRET = process.env.USER_JWT_SECRET || 'dev-secret';

export function createUserToken(email) {
  const ts = Date.now().toString();
  const h = createHmac('sha256', SECRET).update(`${email}.${ts}`).digest('hex');
  return `${ts}.${h}`;
}

export function verifyUserToken(email, token) {
  try {
    const [ts, sig] = String(token || '').split('.');
    if (!ts || !sig) return false;
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) return false;
    if (Date.now() - tsNum > TTL_MS) return false;
    const h = createHmac('sha256', SECRET).update(`${email}.${ts}`).digest('hex');
    return timingSafeEqual(Buffer.from(h), Buffer.from(sig));
  } catch {
    return false;
  }
}
