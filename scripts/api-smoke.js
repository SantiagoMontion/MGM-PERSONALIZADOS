import assert from 'node:assert/strict';

const base = process.env.API_BASE || 'http://localhost:3000/api';

async function check(path) {
  const res = await fetch(base + path);
  const ct = res.headers.get('content-type') || '';
  let body = null;
  if (ct.includes('application/json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }
  console.log(path, res.status, body);
  assert.equal(res.status, 200);
}

await check('/env-check');
await check('/search-assets?term=test');
