import { PDFDocument } from 'pdf-lib';

const MM_TO_PT = 72 / 25.4;
const mmToPt = (mm) => (Number.isFinite(mm) ? mm * MM_TO_PT : 0);

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
      dpi = 300,
      mime,
    } = options || {};

    const pdfDoc = await PDFDocument.create();
    const baseBytes = buffer instanceof ArrayBuffer ? buffer : buffer?.buffer;
    let typedBytes = baseBytes ? new Uint8Array(baseBytes) : null;
    if (!typedBytes?.byteLength) {
      throw new Error('empty_buffer');
    }

    const sniffedMime = (() => {
      const lowerMime = (mime || '').toLowerCase();
      if (lowerMime.includes('jpeg') || lowerMime.includes('jpg')) return 'image/jpeg';
      if (lowerMime.includes('png')) return 'image/png';
      if (typedBytes[0] === 0xff && typedBytes[1] === 0xd8) return 'image/jpeg';
      if (
        typedBytes[0] === 0x89 &&
        typedBytes[1] === 0x50 &&
        typedBytes[2] === 0x4e &&
        typedBytes[3] === 0x47
      ) {
        return 'image/png';
      }
      return null;
    })();

    let embedded;
    if (sniffedMime === 'image/png') {
      embedded = await pdfDoc.embedPng(typedBytes);
    } else if (sniffedMime === 'image/jpeg') {
      embedded = await pdfDoc.embedJpg(typedBytes);
    } else {
      throw new Error('unsupported_image_format');
    }

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

    const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
    const out = pdfBytes.byteOffset === 0 && pdfBytes.byteLength === pdfBytes.buffer.byteLength
      ? pdfBytes.buffer
      : pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength);
    self.postMessage({ ok: true, type: 'build_pdf', buffer: out }, [out]);
  } catch (err) {
    self.postMessage({ ok: false, type: 'build_pdf', error: String(err && err.message ? err.message : err) });
  } finally {
    try {
      // Drop strong references to previous buffers to avoid re-use in subsequent jobs
      typedBytes = null;
      if (globalThis.gc) gc();
    } catch {}
  }
};
