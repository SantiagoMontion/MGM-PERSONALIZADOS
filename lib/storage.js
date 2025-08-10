export function parseSupabaseObject(url){
  const m = url.match(/\/storage\/v1\/object\/(private|public)\/([^/]+)\/(.+)$/);
  if (!m) throw new Error('invalid_supabase_storage_url');
  return { visibility: m[1], bucket: m[2], key: m[3] };
}
