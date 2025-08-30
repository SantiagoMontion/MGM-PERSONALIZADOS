export function parseSupabaseObject(url){
  // 1) Soporte signed: /object/sign/... ?token=...  (extrae el "url" interno del token si está)
  const mSign = url.match(/\/storage\/v1\/object\/sign\/(.+?)\?token=.+/);
  if (mSign) {
    // Supabase firma el path real en el JWT; pero más simple: convertir /sign/ -> /private/
    // porque tu bucket 'uploads' es privado.
    return { visibility: 'private', bucket: mSign[1].split('/')[0], key: mSign[1].split('/').slice(1).join('/') };
  }
  // 2) Rutas normales private/public
  const m = url.match(/\/storage\/v1\/object\/(private|public)\/([^/]+)\/(.+)$/);
  if (!m) throw new Error('invalid_supabase_storage_url');
  return { visibility: m[1], bucket: m[2], key: m[3] };
}

// Extrae bucket y path de una URL de Supabase Storage. Soporta
// variantes firmadas como /object/sign/ y /object/upload/sign/ y las
// normaliza a /object/.
export function parseSupabasePath(url) {
  const normalized = url
    .replace('/object/sign/', '/object/')
    .replace('/object/upload/sign/', '/object/');
  const m = normalized.match(/\/storage\/v1\/object\/([^/]+)\/(.+)$/);
  if (!m) throw new Error('invalid_supabase_storage_url');
  return { bucket: m[1], path: m[2] };
}