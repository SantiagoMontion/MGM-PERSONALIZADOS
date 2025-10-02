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
  id: index + 1,
  job_key: `job-${index + 1}`,
  bucket: 'outputs',
  file_path: `pdf/test-${index + 1}.pdf`,
  file_name: `test-${index + 1}.pdf`,
  slug: `test-${index + 1}`,
  width_cm: 30,
  height_cm: 40,
  material: 'matte',
  bg_color: '#ffffff',
  job_id: `JOB-${index + 1}`,
  file_size_bytes: 1024,
  created_at: new Date().toISOString(),
  preview_url: `preview/test-${index + 1}.jpg`,
}));

const totalRows = 10342;

globalThis.fetch = async (url) => {
  const responseUrl = new URL(url);
  if (responseUrl.pathname.startsWith('/rest/v1/prints')) {
    const headers = new Headers({
      'content-type': 'application/json',
      'content-range': `0-${rows.length - 1}/${totalRows}`,
    });
    return new Response(JSON.stringify(rows), { status: 200, headers });
  }
  if (responseUrl.pathname.startsWith('/storage/v1/object/sign/outputs/')) {
    const headers = new Headers({ 'content-type': 'application/json' });
    return new Response(
      JSON.stringify({ signedURL: `https://signed.example/${responseUrl.pathname.split('/').pop()}` }),
      { status: 200, headers },
    );
  }
  throw new Error(`Unexpected fetch URL: ${url}`);
};

const start = performance.now();
const response = await searchPrintsHandler({
  query: { query: 'spider   man', limit: '60', offset: '0' },
  headers: { 'x-prints-gate': tokenPayload },
});
const durationMs = Math.round(performance.now() - start);

console.log(
  JSON.stringify({
    status: response.status,
    total: response.body?.total,
    returned: response.body?.items?.length,
    durationMs,
  }),
);
