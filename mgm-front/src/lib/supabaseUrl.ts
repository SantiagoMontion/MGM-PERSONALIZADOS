/** URLs públicas: `{origin}/storage/v1/object/public/{bucket}/path/to/object` */
export function parseSupabasePublicStorageUrl(
  url: string | null | undefined,
): { bucket: string; path: string } | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('blob:')) return null;
  try {
    const u = new URL(trimmed);
    const marker = '/storage/v1/object/public/';
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    const rest = u.pathname.slice(idx + marker.length);
    const parts = rest.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const bucket = parts[0];
    const path = parts.slice(1).map((seg) => decodeURIComponent(seg)).join('/');
    if (!bucket || !path) return null;
    return { bucket, path };
  } catch {
    return null;
  }
}

export function canonicalizeSupabaseUploadsUrl(input: string): string {
  if (!input) return input;
  try {
    const u = new URL(input);
    // normalizar /sign y /upload/sign → /uploads
    let p = u.pathname
      .replace(
        "/storage/v1/object/upload/sign/uploads/",
        "/storage/v1/object/public/uploads/",
      )
      .replace(
        "/storage/v1/object/sign/uploads/",
        "/storage/v1/object/public/uploads/",
      )
      .replace(
        "/storage/v1/object/uploads/",
        "/storage/v1/object/public/uploads/",
      );
    // eliminar query (?token=...)
    return `${u.origin}${p}`;
  } catch (err) {
    return input;
  }
}

/** Construye la canónica con host de Supabase + object_key (preferido) */
export function buildUploadsUrlFromObjectKey(
  signed_url: string,
  object_key: string,
): string {
  const origin = new URL(signed_url).origin; // https://<project>.supabase.co
  return `${origin}/storage/v1/object/public/uploads/${object_key}`;
}
