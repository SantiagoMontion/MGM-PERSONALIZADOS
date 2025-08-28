import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PDFDocument } from 'pdf-lib';
// import jsPDF from 'jspdf';

export default function DevCanvasPreview() {
  const navigate = useNavigate();
  const location = useLocation();
  const jobId = location.state?.jobId || window.__previewData?.jobId;
  const render_v2 = window.__previewData?.render_v2;
  const padBlob = window.__previewData?.padBlob;
  const [imgUrl, setImgUrl] = useState(null);
  const [onlyPreview, setOnlyPreview] = useState(false);

  useEffect(() => {
    if (padBlob) {
      const url = URL.createObjectURL(padBlob);
      setImgUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [padBlob]);

  async function exportPadDocument() {
    if (!padBlob || !render_v2) return;
    const w_cm = render_v2.w_cm;
    const h_cm = render_v2.h_cm;
    const out_w_cm = w_cm + 2;
    const out_h_cm = h_cm + 2;
    const dpi = 300;
    const inner_w_px = Math.round((w_cm * dpi) / 2.54);
    const inner_h_px = Math.round((h_cm * dpi) / 2.54);
    const out_w_px = Math.round((out_w_cm * dpi) / 2.54);
    const out_h_px = Math.round((out_h_cm * dpi) / 2.54);
    const scaleX = out_w_px / inner_w_px;
    const scaleY = out_h_px / inner_h_px;
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = out_w_px;
      canvas.height = out_h_px;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, out_w_px, out_h_px);
      const blob = await new Promise(resolve =>
        canvas.toBlob(resolve, 'image/jpeg', 0.88)
      );
      if (!blob) return;
      // const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.88);
      // const doc = new jsPDF({ unit: 'cm', format: [out_w_cm, out_h_cm] });
      // doc.addImage(jpegDataUrl, 'JPEG', 0, 0, out_w_cm, out_h_cm);
      // doc.save(`print-${out_w_cm}x${out_h_cm}.pdf`);
      const jpegBytes = new Uint8Array(await blob.arrayBuffer());
      const pdfDoc = await PDFDocument.create();
      const page_w_pt = (out_w_cm / 2.54) * 72;
      const page_h_pt = (out_h_cm / 2.54) * 72;
      const page = pdfDoc.addPage([page_w_pt, page_h_pt]);
      const jpg = await pdfDoc.embedJpg(jpegBytes);
      page.drawImage(jpg, { x: 0, y: 0, width: page_w_pt, height: page_h_pt });
      console.log('[EXPORT LIENZO DEBUG]', {
        w_cm,
        h_cm,
        out_w_cm,
        out_h_cm,
        inner_w_px,
        inner_h_px,
        out_w_px,
        out_h_px,
        scaleX,
        scaleY,
        pdf_engine: 'pdf-lib',
        page_w_unit: 'pt',
        page_w: page_w_pt,
        page_h: page_h_pt,
      });
      const pdfBytes = await pdfDoc.save();
      const url = URL.createObjectURL(
        new Blob([pdfBytes], { type: 'application/pdf' })
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `print-${out_w_cm}x${out_h_cm}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    };
    img.src = URL.createObjectURL(padBlob);
  }

  async function downloadMockup() {
    if (!padBlob || !render_v2) return;
    const { w_cm, h_cm, material } = render_v2;
    const REF_MAX = {
      Classic: { w: 140, h: 100 },
      PRO: { w: 140, h: 100 },
      Glasspad: { w: 50, h: 40 },
    };
    const MIN_MARGIN = 100;
    const MAX_MARGIN = 220;
    const W = 1080;
    const H = 1080;
    const ref = REF_MAX[material] || { w: w_cm, h: h_cm };
    const rel = Math.min(
      Math.max(Math.max(w_cm / ref.w, h_cm / ref.h), 0),
      1
    );
    const margin = Math.round(
      MAX_MARGIN - (MAX_MARGIN - MIN_MARGIN) * rel
    );
    const avail = W - 2 * margin;
    const k = Math.min(avail / w_cm, avail / h_cm);
    const target_w = Math.round(w_cm * k);
    const target_h = Math.round(h_cm * k);
    const drawX = Math.round((W - target_w) / 2);
    const drawY = Math.round((H - target_h) / 2);
    const r = Math.max(12, Math.min(Math.min(target_w, target_h) * 0.02, 20));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, W, H);

      function roundRectPath(x, y, w, h, rad) {
        const rr = Math.min(rad, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + rr, y);
        ctx.lineTo(x + w - rr, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
        ctx.lineTo(x + w, y + h - rr);
        ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
        ctx.lineTo(x + rr, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
        ctx.lineTo(x, y + rr);
        ctx.quadraticCurveTo(x, y, x + rr, y);
        ctx.closePath();
      }

      roundRectPath(drawX, drawY, target_w, target_h, r);
      ctx.save();
      ctx.clip();
      ctx.drawImage(img, drawX, drawY, target_w, target_h);
      ctx.restore();

      roundRectPath(drawX, drawY, target_w, target_h, r);
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.restore();

      const inset = 4;
      const seamR = Math.max(0, r - inset);
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.setLineDash([3, 3]);
      roundRectPath(
        drawX + inset,
        drawY + inset,
        target_w - 2 * inset,
        target_h - 2 * inset,
        seamR
      );
      ctx.stroke();
      ctx.restore();

      const inset2 = 2;
      const innerR2 = Math.max(0, r - inset2);
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.setLineDash([]);
      roundRectPath(
        drawX + inset2,
        drawY + inset2,
        target_w - 2 * inset2,
        target_h - 2 * inset2,
        innerR2
      );
      ctx.stroke();
      ctx.restore();

      canvas.toBlob(
        b => {
          if (!b) return;
          const url = URL.createObjectURL(b);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'mock-1080.png';
          a.click();
          URL.revokeObjectURL(url);
        },
        { type: 'image/png' }
      );
    };
    img.src = URL.createObjectURL(padBlob);
    console.log('[MOCKUP 1080 FINAL]', {
      material,
      w_cm,
      h_cm,
      REF_MAX_W_CM: ref.w,
      REF_MAX_H_CM: ref.h,
      rel,
      margin,
      avail,
      k,
      target_w,
      target_h,
      drawX,
      drawY,
      r,
      seam: { lineDash: [3, 3], lw1: 2, lw2: 1.5, lw3: 1 },
    });
  }

  function continueFlow() {
    navigate(`/creating/${jobId}`, { state: { render_v2, skipFinalize: onlyPreview } });
  }

  console.log('[PREVIEW DEBUG]', {
    render_v2,
    canvas_px: render_v2?.canvas_px,
    pad_px: render_v2?.pad_px,
    place_px: render_v2?.place_px,
    place_rel: render_v2?.place_px && render_v2?.pad_px ? {
      x: render_v2.place_px.x - render_v2.pad_px.x,
      y: render_v2.place_px.y - render_v2.pad_px.y,
    } : undefined,
    rotate_deg: render_v2?.rotate_deg,
    w_cm: render_v2?.w_cm,
    h_cm: render_v2?.h_cm,
    bleed_mm: render_v2?.bleed_mm,
  });

  return (
    <div style={{ padding: '10px' }}>
      <h3>Canvas Preview</h3>
      <button onClick={exportPadDocument}>Exportar lienzo</button>
      {imgUrl && (
        <div>
          <img src={imgUrl} alt="preview" style={{ maxWidth: '100%' }} />
          <div><button onClick={downloadMockup}>Descargar PNG</button></div>
        </div>
      )}
      {render_v2 && (
        <div style={{ display: 'flex', gap: '20px', marginTop: '10px' }}>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(render_v2, null, 2)}
          </pre>
          <div>
            <p>{`canvas_px: ${JSON.stringify(render_v2.canvas_px)}`}</p>
            <p>{`pad_px: ${JSON.stringify(render_v2.pad_px)}`}</p>
            <p>{`place_px: ${JSON.stringify(render_v2.place_px)}`}</p>
            <p>{`place_rel: ${JSON.stringify({ x: render_v2.place_px.x - render_v2.pad_px.x, y: render_v2.place_px.y - render_v2.pad_px.y })}`}</p>
            <p>{`rotate_deg: ${render_v2.rotate_deg}`}</p>
            <p>{`w_cm: ${render_v2.w_cm}`}</p>
            <p>{`h_cm: ${render_v2.h_cm}`}</p>
            <p>{`bleed_mm: ${render_v2.bleed_mm}`}</p>
          </div>
        </div>
      )}
      <label style={{ display: 'block', marginTop: '10px' }}>
        <input type="checkbox" checked={onlyPreview} onChange={e => setOnlyPreview(e.target.checked)} />{' '}
        Sólo visualizar (no llamar API)
      </label>
      <div style={{ marginTop: '10px' }}>
        <button onClick={continueFlow}>Continuar (llamar finalize-assets)</button>
      </div>
    </div>
  );
}
