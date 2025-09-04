module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  // TODO: validar HMAC de Shopify (X-Shopify-Hmac-Sha256) antes de procesar
  // Por ahora, responder 200 para confirmar recepción
  return res.status(200).json({ ok: true, received: true, ts: Date.now() });
};
