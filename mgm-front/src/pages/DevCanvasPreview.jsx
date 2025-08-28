import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

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
    const margin_px = Math.round((1 * dpi) / 2.54);
    const pad_px = render_v2.pad_px;
    const pixelRatioX = inner_w_px / pad_px.w;
    const pixelRatioY = inner_h_px / pad_px.h;
    const pixelRatio = Math.min(pixelRatioX, pixelRatioY);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = out_w_px;
      canvas.height = out_h_px;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out_w_px, out_h_px);
      ctx.drawImage(img, margin_px, margin_px, inner_w_px, inner_h_px);
      const debug = {
        w_cm, h_cm, out_w_cm, out_h_cm,
        inner_w_px, inner_h_px, out_w_px, out_h_px,
        pad_px, pixelRatioX, pixelRatioY, pixelRatio, margin_px,
      };
      console.log('[EXPORT DOC DEBUG]', debug);
      canvas.toBlob((b) => {
        if (!b) return;
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url;
        a.download = `print-${out_w_cm}x${out_h_cm}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
      }, 'image/jpeg', 0.99);
    };
    img.src = URL.createObjectURL(padBlob);
  }

  async function downloadMockup() {
    if (!padBlob) return;
    const img = new Image();
    img.onload = () => {
      const sourceBitmap = { w: img.width, h: img.height };
      const target = { w: 1080, h: 1080 };
      const scale = Math.min(target.w / sourceBitmap.w, target.h / sourceBitmap.h);
      const drawW = Math.round(sourceBitmap.w * scale);
      const drawH = Math.round(sourceBitmap.h * scale);
      const drawX = Math.round((target.w - drawW) / 2);
      const drawY = Math.round((target.h - drawH) / 2);
      const canvas = document.createElement('canvas');
      canvas.width = target.w;
      canvas.height = target.h;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, target.w, target.h);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      console.log('[MOCKUP DEBUG]', {
        sourceBitmap,
        target,
        scale,
        drawX,
        drawY,
      });
      canvas.toBlob((b) => {
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
