import { z } from 'zod';
import logger from '../../_lib/logger.js';

let defaultClient;
async function getDefaultClient() {
  if (!defaultClient) {
    const mod = await import('../../supa.js');
    defaultClient = mod.supa;
  }
  return defaultClient;
}

const SearchSchema = z.object({
  term: z
    .string()
    .trim()
    .min(1, 'Term must be provided')
    .max(120, 'Term too long'),
});

/**
 * GET /api/search-assets → searchAssets
 * @param {{ query: Record<string,string> }} req
 * @param {{ supa?: any }} deps
 */
export async function searchAssets({ query }, { supa } = {}) {
  const parsed = SearchSchema.safeParse({ term: query?.term });
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: 'invalid_term',
        issues: parsed.error.flatten().fieldErrors,
      },
    };
  }
  try {
    const term = parsed.data.term.replace(/[%'"`]/g, '');
    if (!term) {
      return { status: 400, body: { error: 'missing_term' } };
    }
    const filters = [
      `design_name.ilike.%${term}%`,
      `material.ilike.%${term}%`,
      `job_id.ilike.%${term}%`,
      `customer_email.ilike.%${term}%`,
      `customer_name.ilike.%${term}%`,
    ].join(',');
    const client = supa || (await getDefaultClient());
    const { data, error } = await client
      .from('jobs')
      .select('job_id,design_name,material,w_cm,h_cm,file_original_url,print_jpg_url,pdf_url,preview_url,created_at,customer_email,customer_name')
      .or(filters)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    return { status: 200, body: { items: data } };
  } catch (e) {
    logger.error('search-assets', e);
    return { status: 500, body: { error: 'search_failed' } };
  }
}
