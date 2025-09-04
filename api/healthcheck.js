module.exports = (req, res) => {
  res.status(200).json({ ok: true, note: "serverless up", ts: Date.now() });
};
