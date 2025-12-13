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
    const baseBytes = new Uint8Array(buffer);
    const lowerMime = (mime || '').toLowerCase();
    let embedded;
    if (lowerMime.includes('jpeg') || lowerMime.includes('jpg')) {
      embedded = await pdfDoc.embedJpg(baseBytes);
    } else if (lowerMime.includes('png')) {
      embedded = await pdfDoc.embedPng(baseBytes);
    } else {
      try {
        embedded = await pdfDoc.embedPng(baseBytes);
      } catch {
        embedded = await pdfDoc.embedJpg(baseBytes);
      }
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
  }
};
