import { Buffer } from 'node:buffer';
import { performance } from 'node:perf_hooks';

import { searchPrintsHandler } from '../lib/api/handlers/printsSearch.js';

const expiresAt = Date.now() + 60_000;
const tokenPayload = Buffer.from(
  JSON.stringify({ password: process.env.PRINTS_SEARCH_PASSWORD || 'Spesia666', expiresAt }),
).toString('base64');

process.env.SUPABASE_URL ||= 'https://supabase.mock';
process.env.SUPABASE_SERVICE_ROLE ||= 'service-role-key';

const rows = Array.from({ length: 25 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  job_key: `job-${index + 1}`,
  bucket: 'outputs',
  file_path: `pdf/test-${index + 1}.pdf`,
  file_name: `test-${index + 1}.pdf`,
  slug: `test-${index + 1}`,
  width_cm: 30,
  height_cm: 40,
  material: 'matte',
  design_name: `Design ${index + 1}`,
  bg_color: '#ffffff',
  job_id: `JOB-${index + 1}`,
  file_size_bytes: 1024,
  created_at: new Date(Date.now() - index * 1000).toISOString(),
  preview_url: `preview/test-${index + 1}.jpg`,
}));

globalThis.fetch = async (url) => {
  const responseUrl = new URL(url);
  if (responseUrl.pathname.includes('/rpc/search_prints')) {
    const headers = new Headers({ 'content-type': 'application/json' });
    return new Response(JSON.stringify(rows.slice(0, 5)), { status: 200, headers });
  }
  if (responseUrl.pathname.startsWith('/storage/v1/object/sign/outputs/')) {
    const headers = new Headers({ 'content-type': 'application/json' });
    return new Response(
      JSON.stringify({ signedUrl: `https://signed.example/${responseUrl.pathname.split('/').pop()}` }),
      { status: 200, headers },
    );
  }
  throw new Error(`Unexpected fetch URL: ${url}`);
};

const start = performance.now();
const response = await searchPrintsHandler({
  query: { query: 'spider   man', limit: '25' },
  headers: { 'x-prints-gate': tokenPayload },
});
const durationMs = Math.round(performance.now() - start);

console.log(
  JSON.stringify({
    status: response.status,
    total: response.body?.total,
    returned: response.body?.items?.length,
    hasMore: response.body?.hasMore,
    durationMs,
  }),
);
