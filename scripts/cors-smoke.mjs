const fetch = globalThis.fetch;
const ORIGIN = 'https://mgmgamers.store';

async function test() {
  const pre = await fetch('https://mgm-api.vercel.app/api/finalize-assets', {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type, authorization',
    },
  });
  console.log('OPTIONS', pre.status, pre.headers.get('access-control-allow-origin'));

  const post = await fetch('https://mgm-api.vercel.app/api/finalize-assets', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ping: true }),
  });
  console.log('POST', post.status, post.headers.get('access-control-allow-origin'));
  console.log('Body', await post.text());
}
test().catch(console.error);
