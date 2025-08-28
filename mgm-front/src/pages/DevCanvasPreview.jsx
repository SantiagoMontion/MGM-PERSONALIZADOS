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
    const REF = { Classic: { w: 120, h: 60 }, PRO: { w: 120, h: 60 }, Glasspad: { w: 50, h: 40 } };
    const mockMargin = 40;
    const W = 1080;
    const H = 1080;
    const avail = W - 2 * mockMargin;
    const ref = REF[material] || { w: w_cm, h: h_cm };
    const k = Math.min(avail / ref.w, avail / ref.h);
    const target_w = Math.round(w_cm * k);
    const target_h = Math.round(h_cm * k);
    const drawX = Math.round((W - target_w) / 2);
    const drawY = Math.round((H - target_h) / 2);
    const r = Math.max(12, Math.min(Math.min(target_w, target_h) * 0.02, 28));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

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
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 3;
      ctx.stroke();

      const inset = 5;
      const innerR = Math.max(0, r - inset);
      roundRectPath(drawX + inset, drawY + inset, target_w - 2 * inset, target_h - 2 * inset, innerR);
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 2;
      ctx.save();
      ctx.translate(1, 1);
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.stroke();
      ctx.setLineDash([]);

      const imgData = ctx.getImageData(0, 0, W, H);
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        data[i] &= 0xe0;
        data[i + 1] &= 0xe0;
        data[i + 2] &= 0xc0;
      }
      ctx.putImageData(imgData, 0, 0);

      canvas.toBlob(b => {
        if (!b) return;
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mock-1080.png';
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/png');
    };
    img.src = URL.createObjectURL(padBlob);
    console.log('[MOCKUP 1080 DEBUG]', {
      material,
      w_cm,
      h_cm,
      ref_w_cm: ref.w,
      ref_h_cm: ref.h,
      mockMargin,
      avail,
      k,
      target_w,
      target_h,
      drawX,
      drawY,
      radius: r,
      quantizer: 'bitmask',
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
