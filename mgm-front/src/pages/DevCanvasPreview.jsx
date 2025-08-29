import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PDFDocument } from 'pdf-lib';
import { buildExportBaseName } from '../lib/filename';
import { renderMockup1080, downloadBlob } from '../lib/mockup';
import { dlog } from '../lib/debug';
import { PX_PER_CM } from '@/lib/export-consts';

console.assert(Number.isFinite(PX_PER_CM), '[export] PX_PER_CM inválido', PX_PER_CM);

export default function DevCanvasPreview() {
  const navigate = useNavigate();
  const location = useLocation();
  const jobId = location.state?.jobId || window.__previewData?.jobId;
  const render_v2 = window.__previewData?.render_v2;
  const padBlob = window.__previewData?.padBlob;
  const designName = window.__previewData?.designName || 'Diseño';
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
    const baseName = buildExportBaseName(designName, w_cm, h_cm);
    const out_w_px = Math.round(out_w_cm * PX_PER_CM);
    const out_h_px = Math.round(out_h_cm * PX_PER_CM);
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = out_w_px;
      canvas.height = out_h_px;
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width <= 0 || canvas.height <= 0) return;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.filter = 'none';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (render_v2.fit_mode === 'contain') {
        ctx.fillStyle = render_v2.bg_hex || '#ffffff';
      } else {
        ctx.fillStyle = '#ffffff';
      }
      ctx.fillRect(0, 0, out_w_px, out_h_px);
      ctx.drawImage(img, 0, 0, out_w_px, out_h_px);
      ctx.restore();
      const blob = await new Promise(resolve =>
        canvas.toBlob(resolve, 'image/jpeg', 0.88)
      );
      if (!blob) return;
      const jpegBytes = new Uint8Array(await blob.arrayBuffer());
      const pdfDoc = await PDFDocument.create();
      const page_w_pt = (out_w_cm / 2.54) * 72;
      const page_h_pt = (out_h_cm / 2.54) * 72;
      const page = pdfDoc.addPage([page_w_pt, page_h_pt]);
      const jpg = await pdfDoc.embedJpg(jpegBytes);
      page.drawImage(jpg, { x: 0, y: 0, width: page_w_pt, height: page_h_pt });
      dlog('[EXPORT LIENZO]', {
        out_px: { w: canvas.width, h: canvas.height },
        baseName,
      });
      const pdfBytes = await pdfDoc.save();
      downloadBlob(new Blob([pdfBytes], { type: 'application/pdf' }), `${baseName}.pdf`);
    };
    img.crossOrigin = 'anonymous';
    img.src = URL.createObjectURL(padBlob);
  }

  async function downloadMockup() {
    if (!padBlob || !render_v2) return;
    const { w_cm, h_cm, material } = render_v2;
    const baseName = buildExportBaseName(designName, w_cm, h_cm);
    const bitmap = await createImageBitmap(padBlob);
    const canvas = document.createElement("canvas");
    await renderMockup1080(canvas, bitmap, w_cm, h_cm, material);
    canvas.toBlob(b => {
      if (b) downloadBlob(b, `${baseName}.png`);
    }, "image/png");
  }

  function continueFlow() {
    navigate(`/creating/${jobId}`, { state: { render_v2, skipFinalize: onlyPreview } });
  }

  dlog('[PREVIEW DEBUG]', {
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
