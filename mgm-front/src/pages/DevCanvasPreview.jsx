import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

export default function DevCanvasPreview() {
  const navigate = useNavigate();
  const location = useLocation();
  const jobId = location.state?.jobId || window.__previewData?.jobId;
  const render_v2 = window.__previewData?.render_v2;
  const [imgUrl, setImgUrl] = useState(null);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [onlyPreview, setOnlyPreview] = useState(false);

  async function exportDoc() {
    const fn = window.__previewData?.exportPadDocument;
    if (!fn) return;
    const res = await fn();
    if (res?.jpegBlob) {
      setImgUrl(URL.createObjectURL(res.jpegBlob));
    }
    if (res?.pdfBlob) {
      setPdfUrl(URL.createObjectURL(res.pdfBlob));
    }
  }

  useEffect(() => {
    exportDoc();
  }, []);

  function downloadPdf() {
    if (!pdfUrl) return;
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = 'canvas.pdf';
    a.click();
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
      <button onClick={exportDoc}>Exportar lienzo (PNG/PDF)</button>
      {imgUrl && (
        <div>
          <img src={imgUrl} alt="preview" style={{ maxWidth: '100%' }} />
        </div>
      )}
      {pdfUrl && (
        <div><button onClick={downloadPdf}>Descargar PDF</button></div>
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
