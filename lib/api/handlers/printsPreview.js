import getSupabaseAdmin from '../../_lib/supabaseAdmin.js';

const OUTPUT_BUCKET = 'outputs';

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
  if (!isValidPreviewPath(rawPath)) {
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

  const lowerPath = rawPath.toLowerCase();
  const isPdf = lowerPath.endsWith('.pdf');

  const storage = supabase.storage.from(OUTPUT_BUCKET);
  const storagePath = resolveStoragePath(rawPath);

  if (!isPdf) {
    const EMPTY_BUFFER = Symbol('empty');

    const sendImageBuffer = (buffer, pathForType) => {
      const normalized = pathForType.toLowerCase();
      const contentType = normalized.endsWith('.png')
        ? 'image/png'
        : normalized.endsWith('.webp')
          ? 'image/webp'
          : normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')
            ? 'image/jpeg'
            : 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=300, immutable');
      res.status(200).end(buffer);
    };

    const attemptDownload = async (path) => {
      const { data, error } = await storage.download(path);
      if (error || !data) {
        if (error && error.message && error.statusCode !== 404) {
          console.info('[prints-preview] preview_unavailable', { path, message: error.message });
        }
        return null;
      }

      const buffer = await toBuffer(data);
      if (!buffer.length) {
        return EMPTY_BUFFER;
      }
      return buffer;
    };

    let buffer = await attemptDownload(storagePath);

    if (!buffer) {
      const basePath = storagePath.replace(/\.[^./]+$/, '');
      const originalExt = storagePath.slice(basePath.length);
      const candidates = ['.webp', '.png', '.jpg', '.jpeg'];
      for (const ext of candidates) {
        if (ext === originalExt) continue;
        buffer = await attemptDownload(`${basePath}${ext}`);
        if (buffer && buffer !== EMPTY_BUFFER) {
          sendImageBuffer(buffer, `${basePath}${ext}`);
          return;
        }
        if (buffer === EMPTY_BUFFER) {
          res.status(500).json({ ok: false, reason: 'empty_file', message: 'El archivo descargado está vacío.' });
          return;
        }
      }
    } else if (buffer === EMPTY_BUFFER) {
      res.status(500).json({ ok: false, reason: 'empty_file', message: 'El archivo descargado está vacío.' });
      return;
    } else {
      sendImageBuffer(buffer, storagePath);
      return;
    }

    if (!buffer) {
      res.status(404).json({ ok: false, reason: 'preview_not_found', message: 'No se encontró el archivo solicitado.' });
      return;
    }

    // If we got here, "buffer" equals the EMPTY_BUFFER sentinel.
    res.status(500).json({ ok: false, reason: 'empty_file', message: 'El archivo descargado está vacío.' });
    return;
  }

  const previewBasePath = (() => {
    const withoutExt = storagePath.replace(/\.pdf$/i, '');
    if (/^preview\//i.test(withoutExt)) return withoutExt;
    if (/^pdf\//i.test(withoutExt)) return `preview/${withoutExt.slice(4)}`;
    const parts = withoutExt.split('/');
    if (parts.length <= 1) return `preview/${withoutExt}`;
    return `preview/${parts.slice(1).join('/')}`;
  })();

  const previewCandidates = ['.jpg', '.jpeg', '.png', '.webp'].map((ext) => `${previewBasePath}${ext}`);

  try {
    for (const candidate of previewCandidates) {
      const { data: previewData, error: previewError } = await storage.download(candidate);
      if (!previewError && previewData) {
        const previewBuffer = await toBuffer(previewData);
        if (previewBuffer.length) {
          const lower = candidate.toLowerCase();
          const contentType = lower.endsWith('.png')
            ? 'image/png'
            : lower.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg';
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=300, immutable');
          res.status(200).end(previewBuffer);
          return;
        }
      } else if (previewError && previewError.message && previewError.statusCode !== 404) {
        console.info('[prints-preview] preview_unavailable', { path: candidate, message: previewError.message });
      }
    }
  } catch (err) {
    console.warn('[prints-preview] preview_fetch_failed', { path: previewBasePath, message: err?.message || err });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(404).json({ ok: false, reason: 'preview_unavailable', message: 'No hay una vista previa disponible.' });
}
