import test from 'node:test';
import assert from 'node:assert/strict';
import { envCheck } from '../lib/api/handlers/system.js';
import { searchAssets } from '../lib/api/handlers/assets.js';

test('envCheck returns env vars', async () => {
  process.env.SUPABASE_URL = 'http://example';
  process.env.SUPABASE_SERVICE_ROLE = 'secret';
  const res = await envCheck();
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert(res.body.env.SUPABASE_URL);
});

test('searchAssets missing term', async () => {
  const res = await searchAssets({ query: {} });
  assert.equal(res.status, 400);
});

test('searchAssets returns data', async () => {
  const fakeSupa = {
    from: () => ({
      select: () => ({
        or: () => ({
          order: () => ({
            limit: () => ({ data: [{ id: 1 }], error: null })
          })
        })
      })
    })
  };
  const res = await searchAssets({ query: { term: 'foo' } }, { supa: fakeSupa });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items, [{ id: 1 }]);
});
