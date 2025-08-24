export function canonicalizeSupabaseUploadsUrl(input: string): string {
  if (!input) return input;
  try {
    const u = new URL(input);
    // normalizar /sign y /upload/sign → /uploads
    let p = u.pathname
      .replace('/storage/v1/object/upload/sign/uploads/', '/storage/v1/object/uploads/')
      .replace('/storage/v1/object/sign/uploads/', '/storage/v1/object/uploads/');
    // eliminar query (?token=...)
    return `${u.origin}${p}`;
  } catch {
    return input;
  }
}

/** Construye la canónica con host de Supabase + object_key (preferido) */
export function buildUploadsUrlFromObjectKey(signed_url: string, object_key: string): string {
  const origin = new URL(signed_url).origin; // https://<project>.supabase.co
  return `${origin}/storage/v1/object/uploads/${object_key}`;
}
