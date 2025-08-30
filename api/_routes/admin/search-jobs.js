import crypto from 'node:crypto';
import { supa } from '../../../lib/supa.js';
import { parseSupabasePath } from '../../../lib/storage.js';

export default async function handler(req, res) {
  const diagId = crypto.randomUUID?.() ?? require('node:crypto').randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));


  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed', diag_id: diagId });
  }

  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token !== process.env.WORKER_TOKEN) {
    return res.status(401).json({ error: 'unauthorized', diag_id: diagId });
  }

  const {
    q = '',
    status,
    date_from,
    date_to,
    page = '1',
    page_size = '25',
    has_pdf,
  } = req.query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const pageSize = Math.min(100, parseInt(page_size, 10) || 25);
  const offset = (pageNum - 1) * pageSize;

  const term = String(q).replace(/%/g, '').trim();

  function applyFilters(qb) {
    if (term) {
      qb = qb.or(
        `job_id.ilike.%${term}%,design_name.ilike.%${term}%,customer_email.ilike.%${term}%,file_hash.ilike.%${term}%`
      );
    }
    if (status) qb = qb.eq('status', status);
    if (date_from) qb = qb.gte('created_at', date_from);
    if (date_to) qb = qb.lte('created_at', date_to);
    if (has_pdf === 'true') qb = qb.not('pdf_url', 'is', null);
    return qb;
  }

  try {
    const listQuery = applyFilters(
      supa
        .from('jobs')
        .select(
          'id,created_at,job_id,design_name,material,w_cm,h_cm,customer_email,status,pdf_url,print_jpg_url,preview_url,shopify_product_url'
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1)
    );
    const { data, error } = await listQuery;
    if (error) throw error;

    const countQuery = applyFilters(
      supa.from('jobs').select('id', { count: 'exact', head: true })
    );
    const { count, error: countError } = await countQuery;
    if (countError) throw countError;

    const results = await Promise.all(
      data.map(async row => {
        const out = {
          id: row.id,
          created_at: row.created_at,
          job_id: row.job_id,
          design_name: row.design_name,
          material: row.material,
          w_cm: row.w_cm,
          h_cm: row.h_cm,
          customer_email: row.customer_email,
          status: row.status,
          preview_url: row.preview_url,
          shopify_product_url: row.shopify_product_url,
        };

        async function maybeSigned(original, targetKey) {
          if (!original) return;
          try {
            const { bucket, path } = parseSupabasePath(original);
            if (bucket === 'uploads') {
              const { data: signed, error: signErr } = await supa.storage
                .from(bucket)
                .createSignedUrl(path, 300);
              if (signErr) throw signErr;
              out[targetKey] = signed.signedUrl;
            } else {
              out[targetKey] = original;
            }
          } catch {
            out[targetKey] = original;
          }
        }

        await Promise.all([
          maybeSigned(row.pdf_url, 'pdf_download_url'),
          maybeSigned(row.print_jpg_url, 'print_jpg_download_url'),
        ]);

        return out;
      })
    );

    console.log(JSON.stringify({ stage: 'admin_search', diag_id: diagId, page: pageNum, term, status }));

    return res.status(200).json({
      ok: true,
      diag_id: diagId,
      page: pageNum,
      page_size: pageSize,
      total: count || 0,
      results,
    });
  } catch (e) {
    console.error('admin_search', diagId, e);
    return res.status(500).json({ error: 'search_failed', diag_id: diagId });
  }
}
