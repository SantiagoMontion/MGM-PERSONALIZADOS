import crypto from "node:crypto";
import { buildCorsHeaders, preflight, applyCorsToResponse } from '../lib/cors';
import getSupabaseAdmin from "./_lib/supabaseAdmin";
import composeImage from "./_lib/composeImage";

function err(res, status, { diag_id, stage, message, debug = {} }) {
  return res.status(status).json({ ok: false, diag_id, stage, message, debug });
}

function parseUploadsObjectKey(url = "") {
  const idx = url.indexOf("/uploads/");
  return idx >= 0 ? url.slice(idx + "/uploads/".length) : "";
}

export default async function handler(req, res) {
  const diagId = crypto.randomUUID?.() ?? crypto.randomUUID();
  res.setHeader("X-Diag-Id", String(diagId));
  const origin = req.headers.origin || null;
  const cors = buildCorsHeaders(origin);
  if (req.method === 'OPTIONS') {
    if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
    Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(204).end();
  }
  if (!cors) return res.status(403).json({ error: 'origin_not_allowed' });
  Object.entries(cors).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return err(res, 405, {
      diag_id: diagId,
      stage: "method",
      message: "method_not_allowed",
    });
  }

  let body;
  try {
    body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};
  } catch (err) {
    return err(res, 400, {
      diag_id: diagId,
      stage: "parse",
      message: "bad_json",
    });
  }
  const { render_v2, file_original_url, file_data } = body;
  if (!render_v2 || (!file_original_url && !file_data)) {
    return err(res, 400, {
      diag_id: diagId,
      stage: "validate",
      message: "missing_fields",
    });
  }

  let srcBuf;
  if (file_data) {
    try {
      srcBuf = Buffer.from(file_data, "base64");
    } catch (err) {
      return err(res, 400, {
        diag_id: diagId,
        stage: "validate",
        message: "bad_file_data",
      });
    }
  } else {
    const objectKey = parseUploadsObjectKey(file_original_url);
    const supa = getSupabaseAdmin();
    const { data, error } = await supa.storage
      .from("uploads")
      .download(objectKey);
    if (error) {
      return err(res, 502, {
        diag_id: diagId,
        stage: "download_src",
        message: "download_failed",
        debug: { objectKey, error: error.message },
      });
    }
    srcBuf = Buffer.from(await data.arrayBuffer());
  }

  try {
    const { innerBuf, printBuf, debug } = await composeImage({
      render_v2,
      srcBuf,
    });
    const inner = `data:image/png;base64,${innerBuf.toString("base64")}`;
    const print = `data:image/jpeg;base64,${printBuf.toString("base64")}`;
    return res.status(200).json({ ok: true, inner, print, debug });
  } catch (e) {
    if (e?.message === "invalid_bbox") {
      return err(res, 400, {
        diag_id: diagId,
        stage: "compose",
        message: "invalid_bbox",
        debug: e.debug || {},
      });
    }
    return err(res, 500, {
      diag_id: diagId,
      stage: "compose",
      message: "compose_failed",
      debug: { error: e.message },
    });
  }
}
