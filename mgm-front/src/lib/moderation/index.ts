import { MODERATION } from './config';

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '');

export async function quickPass(file: File, meta: { filename?: string } = {}): Promise<{ escalate: boolean; reason?: string; signals?: any }> {
  const { quick, deep, debug } = MODERATION;
  if (!quick.enable) return { escalate: false };
  const start = performance.now();
  let url = '';
  try {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return { escalate: true, reason: 'unsupported_type' };
    }
    url = URL.createObjectURL(file);
    const img = document.createElement('img');
    await new Promise((resolve, reject) => {
      img.onload = () => resolve(null);
      img.onerror = reject;
      img.src = url;
    });
    const maxSide = Math.max(img.width, img.height);
    if (maxSide < quick.minSizePx) return { escalate: false, signals: { risk: 0 } };
    const name = meta.filename || '';
    for (const re of quick.allowFranchises) {
      if (re.test(name)) return { escalate: false, signals: { risk: 0 } };
    }
    let risk = 0;
    if (/nude|sex|xxx|porn|swastika|nazi|hitler/i.test(name)) risk = 0.9;
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 32, 32);
    const { data } = ctx.getImageData(0, 0, 32, 32);
    const colors = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
    const isDrawing = colors.size < 1000;
    if (!isDrawing) risk = Math.max(risk, 0.5);
    const escalate = risk >= deep.escalateIfRisk;
    if (debug) console.log('[quickPass]', { risk, escalate, isDrawing, name, elapsed: performance.now() - start });
    return { escalate, signals: { risk, isDrawing } };
  } catch (e) {
    if (debug) console.log('[quickPass] error', e);
    return { escalate: true, reason: 'quick_error' };
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

export async function deepPass(file: File, signal: AbortSignal): Promise<{ allow: boolean; reason?: string; scores?: any }> {
  const { deep, debug } = MODERATION;
  if (!deep.enable) return { allow: true };
  try {
    const thumb = await createThumbnail(file);
    const form = new FormData();
    form.append('image', thumb, 'thumb.jpg');
    const res = await fetch(`${API_BASE}/api/moderate-image`, { method: 'POST', body: form, signal });
    const json = await res.json().catch(() => ({}));
    if (debug) console.log('[deepPass]', json);
    if (!res.ok) return { allow: true, reason: 'provider_error' };
    if (typeof json.allow === 'boolean') return json;
    return { allow: true, reason: 'indeterminate' };
  } catch (e) {
    if (debug) console.log('[deepPass] error', e);
    return { allow: true, reason: 'error' };
  }
}

async function createThumbnail(file: File): Promise<Blob> {
  const img = document.createElement('img');
  const url = URL.createObjectURL(file);
  await new Promise((resolve, reject) => {
    img.onload = () => resolve(null);
    img.onerror = reject;
    img.src = url;
  });
  const maxSide = Math.max(img.width, img.height);
  const scale = Math.min(1, 512 / maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return await new Promise((resolve) => {
    canvas.toBlob((b) => {
      URL.revokeObjectURL(url);
      resolve(b as Blob);
    }, 'image/jpeg', 0.8);
  });
}

export { MODERATION };
