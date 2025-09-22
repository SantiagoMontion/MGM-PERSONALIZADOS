// src/lib/jobPayload.js

export const uploadsPrefix =
  "https://vxkewodclwozoennpqqv.supabase.co/storage/v1/object/uploads/";

export function makeJobId() {
  try {
    return crypto.randomUUID();
  } catch {
    return String(Date.now());
  }
}

export function canonicalizeSupabaseUploadsUrl(input) {
  if (!input) return "";
  try {
    const u = new URL(input);
    let p = u.pathname
      .replace(
        "/storage/v1/object/upload/sign/uploads/",
        "/storage/v1/object/uploads/",
      )
      .replace(
        "/storage/v1/object/sign/uploads/",
        "/storage/v1/object/uploads/",
      );
    return `${u.origin}${p}`;
  } catch {
    return input || "";
  }
}

export function buildUploadsUrlFromObjectKey(baseUrl, object_key) {
  const origin = baseUrl.replace(/\/$/, "");
  return `${origin}/storage/v1/object/uploads/${object_key}`;
}

function normalizeFit(mode) {
  return mode === "contain" || mode === "stretch" ? mode : "cover";
}

// NUEVO: devuelve la canónica según prioridad: canonical > (env/signed_url + object_key)
function resolveCanonicalUrl({ canonical, signed_url, object_key }) {
  if (canonical) {
    const c = canonicalizeSupabaseUploadsUrl(canonical);
    if (c.startsWith(uploadsPrefix)) return c;
  }
  const envBase = (import.meta?.env?.VITE_SUPABASE_URL || "").trim();
  if (object_key && envBase) {
    return buildUploadsUrlFromObjectKey(envBase, object_key);
  }
  if (object_key && signed_url) {
    const origin = new URL(signed_url).origin; // https://<project>.supabase.co
    return buildUploadsUrlFromObjectKey(origin, object_key);
  }
  return "";
}

/**
 * input = {
 *   job_id?, material, size:{w,h,bleed_mm?}, fit_mode, bg?, dpi,
 *   uploads:{ signed_url?, object_key?, canonical? },
 *   file_hash?, price:{amount?,currency?}?, customer:{email?,name?}?, notes?, source?
 * }
 */
export function buildSubmitJobBody(input) {
  const job_id = input.job_id || makeJobId();

  const w_cm = Number(input?.size?.w);
  const h_cm = Number(input?.size?.h);
  const bleed_mm = Number(input?.size?.bleed_mm ?? 3);
  const dpi = parseInt(String(input?.dpi ?? 300), 10);

  const lowQualityAckRaw =
    input?.low_quality_ack ?? input?.lowQualityAck ?? undefined;
  const lowQualityAck =
    lowQualityAckRaw === undefined
      ? undefined
      : typeof lowQualityAckRaw === 'boolean'
        ? lowQualityAckRaw
        : Boolean(lowQualityAckRaw);

  const up = input?.uploads || {};
  const file_original_url = resolveCanonicalUrl({
    canonical: up.canonical,
    signed_url: up.signed_url,
    object_key: up.object_key,
  });

  return {
    job_id,
    material: String(input.material),
    w_cm,
    h_cm,
    bleed_mm,
    fit_mode: normalizeFit(input.fit_mode),
    bg: String(input.bg || "#ffffff"),
    dpi,
    file_original_url,
    customer_email: input?.customer?.email || undefined,
    customer_name: input?.customer?.name || undefined,
    design_name: input?.design_name || undefined,
    file_hash: input?.file_hash || undefined,
    low_quality_ack: lowQualityAck,
    price_amount:
      input?.price?.amount != null ? Number(input.price.amount) : undefined,
    price_currency: input?.price?.currency || undefined,
    notes: input?.notes || "",
    source: input?.source || "front",
  };
}

export function prevalidateSubmitBody(body) {
  const problems = [];
  if (!body.job_id) problems.push("job_id missing");
  if (
    !body.file_original_url ||
    !body.file_original_url.startsWith(uploadsPrefix)
  ) {
    problems.push(`file_original_url must start with ${uploadsPrefix}`);
  }
  if (!Number.isFinite(body.w_cm)) problems.push("w_cm NaN");
  if (!Number.isFinite(body.h_cm)) problems.push("h_cm NaN");
  if (!Number.isFinite(body.bleed_mm)) problems.push("bleed_mm NaN");
  if (!Number.isFinite(body.dpi)) problems.push("dpi NaN");

  return { ok: problems.length === 0, problems };
}
