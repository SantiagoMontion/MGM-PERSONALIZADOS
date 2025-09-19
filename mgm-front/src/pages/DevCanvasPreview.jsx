import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PDFDocument } from 'pdf-lib';
import { buildExportBaseName } from '../lib/filename';
import { renderMockup1080, downloadBlob } from '../lib/mockup';
import { renderGlasspadPNG } from '../lib/renderGlasspadPNG';

export default function DevCanvasPreview() {
  const navigate = useNavigate();
  const location = useLocation();
  const jobId = location.state?.jobId || window.__previewData?.jobId;
  const render_v2 = window.__previewData?.render_v2;
  const padBlob = window.__previewData?.padBlob;
  const designName = window.__previewData?.designName || 'Diseño';
  const [imgUrl, setImgUrl] = useState(null);
  const [onlyPreview, setOnlyPreview] = useState(false);
  const [img, setImg] = useState(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [imgPos, setImgPos] = useState({ x: 0, y: 0 });
  const [centerH, setCenterH] = useState(true);
  const [centerW, setCenterW] = useState(true);
  const wasAutoCentered = useRef(false);
  const canvasW = render_v2?.canvas_px?.w || 0;
  const canvasH = render_v2?.canvas_px?.h || 0;
  const mode = render_v2?.material;
  const isGlasspad = mode === 'Glasspad';

  useEffect(() => {
    if (padBlob) {
      const url = handleUpload(padBlob);
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
    const dpi = 300;
    const out_w_px = Math.round((out_w_cm * dpi) / 2.54);
    const out_h_px = Math.round((out_h_cm * dpi) / 2.54);
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = out_w_px;
      canvas.height = out_h_px;
      const ctx = canvas.getContext('2d');
      if (!ctx || canvas.width <= 0 || canvas.height <= 0) return;
      ctx.clearRect(0, 0, out_w_px, out_h_px);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, out_w_px, out_h_px);
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
      console.log('[EXPORT LIENZO]', {
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
    const bitmap = await createImageBitmap(padBlob);
    const blob = await renderMockup1080({
      productType: material === 'Glasspad' ? 'glasspad' : 'mousepad',
      image: bitmap,
      width_cm: w_cm,
      height_cm: h_cm,
    });
    const widthLabel = Number(w_cm);
    const heightLabel = Number(h_cm);
    const safeWidth = Number.isFinite(widthLabel) ? widthLabel : 0;
    const safeHeight = Number.isFinite(heightLabel) ? heightLabel : 0;
    downloadBlob(blob, `mockup_1080_${safeWidth}x${safeHeight}.png`);
  }

  async function previewGlasspadPNG() {
    if (!padBlob) return;
    const bmp = await createImageBitmap(padBlob);
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = bmp.width;
    baseCanvas.height = bmp.height;
    baseCanvas.getContext('2d')?.drawImage(bmp, 0, 0);
    const canvas = renderGlasspadPNG(baseCanvas, {
      blurPx: 2,
      whiteA: 0.28,
      hiA: 0.14,
    });
    canvas.toBlob(b => {
      if (b) {
        const url = URL.createObjectURL(b);
        window.open(url, '_blank');
      }
    }, 'image/png', 1);
  }

  function handleUpload(file) {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const renderW = image.width;
      const renderH = image.height;
      setImg(image);
      setImgSize({ w: renderW, h: renderH });
    };
    setImgUrl(url);
    image.src = url;
    return url;
  }

  useEffect(() => {
    if (!img) return;
    setImgPos(prev => {
      let x = prev.x;
      let y = prev.y;
      if (centerW) x = Math.round((canvasW - imgSize.w) / 2);
      if (centerH) y = Math.round((canvasH - imgSize.h) / 2);
      return { x, y };
    });
  }, [img, imgSize.w, imgSize.h, canvasW, canvasH, centerW, centerH]);

  useEffect(() => {
    if (!img || wasAutoCentered.current) return;
    const tgt = render_v2?.pad_px ?? render_v2?.canvas_px;
    if (!tgt?.w || !tgt?.h || !imgSize?.w || !imgSize?.h) return;

    const x = Math.round((tgt.x ?? 0) + (tgt.w - imgSize.w) / 2);
    const y = Math.round((tgt.y ?? 0) + (tgt.h - imgSize.h) / 2);
    setImgPos(prev => ({ ...prev, x, y }));
    setCenterW(true);
    setCenterH(true);
    wasAutoCentered.current = true;
  }, [
    img,
    imgSize?.w,
    imgSize?.h,
    render_v2?.pad_px?.w,
    render_v2?.pad_px?.h,
    render_v2?.pad_px?.x,
    render_v2?.pad_px?.y,
    render_v2?.pad_px,
    render_v2?.canvas_px?.w,
    render_v2?.canvas_px?.h,
    render_v2?.canvas_px?.x,
    render_v2?.canvas_px?.y,
    render_v2?.canvas_px,
  ]);

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
        <div style={{ position: 'relative', width: canvasW, height: canvasH }}>
          <div
            style={{
              position: 'absolute',
              left: imgPos.x,
              top: imgPos.y,
              width: imgSize.w,
              height: imgSize.h,
            }}
          >
            <img
              src={imgUrl}
              alt="preview"
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
            {isGlasspad && (
              <>
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(255,255,255,0.26)',
                    backdropFilter: 'blur(2px) saturate(1.03)',
                    WebkitBackdropFilter: 'blur(2px) saturate(1.03)',
                    pointerEvents: 'none',
                  }}
                />
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background:
                      'linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.06) 55%, rgba(255,255,255,0) 100%)',
                    mixBlendMode: 'screen',
                    pointerEvents: 'none',
                  }}
                />
              </>
            )}
          </div>
          {isGlasspad && (
            <div><button onClick={previewGlasspadPNG}>Preview Glasspad PNG</button></div>
          )}
          <div><button onClick={downloadMockup}>Descargar PNG</button></div>
          <div style={{ marginTop: '10px' }}>
            <label style={{ marginRight: '10px' }}>
              <input
                type="checkbox"
                checked={centerW}
                onChange={e => setCenterW(e.target.checked)}
              />{' '}
              Centrar H
            </label>
            <label>
              <input
                type="checkbox"
                checked={centerH}
                onChange={e => setCenterH(e.target.checked)}
              />{' '}
              Centrar V
            </label>
          </div>
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
