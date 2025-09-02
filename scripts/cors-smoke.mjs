import assert from 'node:assert';

const base = 'https://mgm-api.vercel.app/api/finalize-assets';

async function run() {
  const pre = await fetch(base, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://mgmgamers.store',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type, authorization',
    },
  });
  assert.equal(pre.status, 204, 'preflight should return 204');
  assert(pre.headers.get('Access-Control-Allow-Origin'));

  const res = await fetch(base, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      origin: 'https://mgmgamers.store',
    },
    body: JSON.stringify({ ping: true }),
  });
  assert(res.headers.get('Access-Control-Allow-Origin'));
  console.log('Preflight status', pre.status);
  console.log('POST status', res.status);
  console.log('ACAO', res.headers.get('Access-Control-Allow-Origin'));
}

run().catch(err => {
  console.error('cors smoke failed', err);
  process.exit(1);
});
