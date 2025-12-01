import { PDFDocument } from 'pdf-lib';

const MM_TO_PT = 72 / 25.4;
const mmToPt = (mm) => (Number.isFinite(mm) ? mm * MM_TO_PT : 0);

async function embedImage(pdfDoc, bytes) {
  try {
    return await pdfDoc.embedPng(bytes);
  } catch {
    return await pdfDoc.embedJpg(bytes);
  }
}

async function blobFromBuffer(buffer, mime) {
  try {
    return new Blob([buffer], { type: mime || 'image/png' });
  } catch {
    return new Blob([buffer]);
  }
}

async function blobToJpegBytes(buffer, mime, quality) {
  const blob = await blobFromBuffer(buffer, mime);
  if (typeof createImageBitmap !== 'function') {
    throw new Error('createImageBitmap_unavailable');
  }
  const bitmap = await createImageBitmap(blob);
  try {
    const width = bitmap?.naturalWidth || bitmap?.width || 0;
    const height = bitmap?.naturalHeight || bitmap?.height || 0;
    if (!width || !height) {
      throw new Error('invalid_image_dimensions');
    }
    const canvas = typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : null;
    if (!canvas) {
      throw new Error('offscreen_canvas_unavailable');
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('canvas_context_unavailable');
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return new Uint8Array(await jpegBlob.arrayBuffer());
  } finally {
    if (typeof bitmap.close === 'function') {
      bitmap.close();
    }
  }
}

self.onmessage = async (event) => {
  const { cmd, buffer, options } = event.data || {};
  if (cmd !== 'build_pdf' || !buffer) {
    self.postMessage({ ok: false, type: 'build_pdf', error: 'bad_args' });
    return;
  }

  try {
    const {
      bleedMm = 20,
      widthPx,
      heightPx,
      widthMm,
      heightMm,
      maxBytes = Infinity,
      dpi = 300,
      mime,
    } = options || {};

    const pdfDoc = await PDFDocument.create();
    const baseBytes = new Uint8Array(buffer);
    const embedded = await embedImage(pdfDoc, baseBytes);

    const intrinsicWidth = embedded.width;
    const intrinsicHeight = embedded.height;
    const resolvedWidthPx = Number.isFinite(widthPx) && widthPx > 0 ? Math.round(widthPx) : intrinsicWidth;
    const resolvedHeightPx = Number.isFinite(heightPx) && heightPx > 0 ? Math.round(heightPx) : intrinsicHeight;
    const safeDpi = Number.isFinite(dpi) && dpi > 0 ? dpi : 300;
    const pxToMm = (px) => (px / safeDpi) * 25.4;
    const resolvedWidthMm = Number.isFinite(widthMm) && widthMm > 0
      ? widthMm
      : pxToMm(resolvedWidthPx);
    const resolvedHeightMm = Number.isFinite(heightMm) && heightMm > 0
      ? heightMm
      : pxToMm(resolvedHeightPx);

    const bleedTotalMm = Math.max(0, Number(bleedMm) || 0);
    const bleedEachMm = bleedTotalMm / 2;

    const pageWidthPt = mmToPt(resolvedWidthMm + bleedEachMm * 2);
    const pageHeightPt = mmToPt(resolvedHeightMm + bleedEachMm * 2);
    const imageWidthPt = pageWidthPt;
    const imageHeightPt = pageHeightPt;

    const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: imageWidthPt,
      height: imageHeightPt,
    });

    let pdfBytes = await pdfDoc.save({ useObjectStreams: true });
    if (!(Number.isFinite(maxBytes) && maxBytes > 0) || pdfBytes.length <= maxBytes) {
      const out = pdfBytes.byteOffset === 0 && pdfBytes.byteLength === pdfBytes.buffer.byteLength
        ? pdfBytes.buffer
        : pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);
      self.postMessage({ ok: true, type: 'build_pdf', buffer: out }, [out]);
      return;
    }

    const qualities = [0.92, 0.85];
    for (const quality of qualities) {
    try {
      const jpegBytes = await blobToJpegBytes(buffer, mime, quality);
      const jpegDoc = await PDFDocument.create();
      const jpegImage = await jpegDoc.embedJpg(jpegBytes);
      const jpegPage = jpegDoc.addPage([pageWidthPt, pageHeightPt]);
      jpegPage.drawImage(jpegImage, {
        x: 0,
        y: 0,
        width: imageWidthPt,
        height: imageHeightPt,
      });
      pdfBytes = await jpegDoc.save({ useObjectStreams: true });
      if (pdfBytes.length <= maxBytes) {
        const out = pdfBytes.byteOffset === 0 && pdfBytes.byteLength === pdfBytes.buffer.byteLength
          ? pdfBytes.buffer
          : pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);
        self.postMessage({ ok: true, type: 'build_pdf', buffer: out }, [out]);
        return;
      }
    } catch (jpegErr) {
      console.warn?.('[pdf.worker] jpeg_fallback_failed', jpegErr);
      break;
    }
  }

  const out = pdfBytes.byteOffset === 0 && pdfBytes.byteLength === pdfBytes.buffer.byteLength
    ? pdfBytes.buffer
    : pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);
  self.postMessage({ ok: true, type: 'build_pdf', buffer: out }, [out]);
  } catch (err) {
    self.postMessage({ ok: false, type: 'build_pdf', error: String(err && err.message ? err.message : err) });
  }
};
