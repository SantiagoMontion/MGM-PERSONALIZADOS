let defaultClient;
async function getDefaultClient() {
  if (!defaultClient) {
    const mod = await import('../../supa.js');
    defaultClient = mod.supa;
  }
  return defaultClient;
}

/**
 * GET /api/search-assets → searchAssets
 * @param {{ query: Record<string,string> }} req
 * @param {{ supa?: any }} deps
 */
export async function searchAssets({ query }, { supa } = {}) {
  const termRaw = String(query?.term || '').trim();
  if (!termRaw) {
    return { status: 400, body: { error: 'missing_term' } };
  }
  try {
    const term = termRaw.replace(/%/g, '');
    const client = supa || (await getDefaultClient());
    const { data, error } = await client
      .from('jobs')
      .select('job_id,design_name,material,w_cm,h_cm,file_original_url,print_jpg_url,pdf_url,preview_url,created_at')
      .or(`design_name.ilike.%${term}%,material.ilike.%${term}%`)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    return { status: 200, body: { items: data } };
  } catch (e) {
    console.error('search-assets', e);
    return { status: 500, body: { error: 'search_failed' } };
  }
}
