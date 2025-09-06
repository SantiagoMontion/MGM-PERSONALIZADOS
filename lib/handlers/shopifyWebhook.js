export default async function shopifyWebhook(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  return res.status(200).json({ ok: true, received: true, ts: Date.now() });
}

