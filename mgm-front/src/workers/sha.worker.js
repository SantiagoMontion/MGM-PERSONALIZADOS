// Calcula SHA-256 en Worker usando WebCrypto
// Entrada: { cmd:'sha256', buffer:ArrayBuffer }
// Salida:  { ok:true, type:'sha256', hex:string }

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

self.onmessage = async (event) => {
  const { cmd, buffer } = event.data || {};
  if (cmd !== 'sha256' || !buffer) {
    self.postMessage({ ok: false, type: 'sha256' });
    return;
  }
  try {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    self.postMessage({ ok: true, type: 'sha256', hex: toHex(digest) });
  } catch (err) {
    self.postMessage({ ok: false, type: 'sha256', error: String(err) });
  }
};
