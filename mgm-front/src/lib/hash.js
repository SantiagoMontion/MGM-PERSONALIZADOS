// src/lib/hash.js
export async function sha256Hex(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}
