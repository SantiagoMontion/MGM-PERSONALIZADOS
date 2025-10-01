import sharp from 'sharp';
import getSupabaseAdmin from '../../_lib/supabaseAdmin.js';

const OUTPUT_BUCKET = 'outputs';
const DEFAULT_PREVIEW_WIDTH = 600;
const DEFAULT_PREVIEW_DENSITY = 180;

function normalizePath(input) {
  if (typeof input !== 'string') return '';
  try {
    return decodeURIComponent(input.trim());
  } catch {
    return input.trim();
  }
}

function isValidPreviewPath(path) {
  if (!path || typeof path !== 'string') return false;
  if (path.includes('..') || path.includes('\\')) return false;
  const lower = path.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return /^pdf\//.test(path) || /^outputs\//.test(path) || /^print\//.test(path);
  }
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp')) {
    return /^preview\//.test(path) || /^outputs\//.test(path) || /^pdf\//.test(path);
  }
  return false;
}

function resolveStoragePath(path) {
  return path.replace(/^outputs\//, '');
}

async function toBuffer(data) {
  if (!data) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (typeof data.arrayBuffer === 'function') {
    const ab = await data.arrayBuffer();
    return Buffer.from(ab);
  }
  if (typeof data === 'string') return Buffer.from(data);
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data.getReader === 'function') {
    const reader = data.getReader();
    const chunks = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  return Buffer.from([]);
}

export default async function printsPreviewHandler(req, res) {
  const rawPath = normalizePath(req.query?.path);
  if (!rawPath) {
    res.status(400).json({ ok: false, reason: 'missing_path', message: 'Falta el parámetro "path".' });
    return;
  }
  if (!isValidPdfPath(rawPath)) {
    res.status(400).json({ ok: false, reason: 'invalid_path', message: 'Formato de path inválido.' });
    return;
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    const message = err?.message || 'supabase_init_failed';
    res.status(502).json({ ok: false, reason: 'supabase_init_failed', message });
    return;
  }

  const storagePath = resolveStoragePath(rawPath);
  const { data, error } = await supabase.storage.from(OUTPUT_BUCKET).download(storagePath);
  if (error || !data) {
    res.status(404).json({ ok: false, reason: 'pdf_not_found', message: 'No se encontró el PDF solicitado.' });
    return;
  }

  const pdfBuffer = await toBuffer(data);
  if (!pdfBuffer.length) {
    res.status(500).json({ ok: false, reason: 'empty_pdf', message: 'El PDF descargado está vacío.' });
    return;
  }

  try {
    const image = await sharp(pdfBuffer, { density: DEFAULT_PREVIEW_DENSITY })
      .resize({ width: DEFAULT_PREVIEW_WIDTH, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 8, adaptiveFiltering: true })
      .toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=300, immutable');
    res.status(200).end(image);
  } catch (err) {
    console.error('[prints-preview] generate_failed', err);
    res.status(500).json({ ok: false, reason: 'preview_generation_failed', message: 'No se pudo generar el preview.' });
  }
}
