import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { useFlow } from '@/state/flow.js';
import { apiFetch } from '@/lib/api.js';
import { blobToDataURL } from '@/lib/blob.js';
import { downloadBlob } from '@/lib/mockup.js';
import { buildExportBaseName } from '@/lib/filename.ts';

export default function Mockup() {
  const flow = useFlow();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  if (!flow.mockupUrl) {
    return (
      <div style={{ padding: 32 }}>
        <p>No hay imagen para mostrar.</p>
        <button onClick={() => navigate('/')}>Volver</button>
      </div>
    );
  }

  async function handle(mode) {
    if (mode !== 'checkout' && mode !== 'cart') return;
    try {
      setBusy(true);
      const mockupDataUrl = await blobToDataURL(flow.mockupBlob);
      const pub = await apiFetch('/api/publish-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mockupDataUrl,
          productType: flow.productType || 'mousepad',
          title: 'Mousepad personalizado',
        }),
      }).then((r) => r.json()).catch(() => null);

      if (!pub || !pub.ok) {
        alert('No se pudo publicar el producto');
        return;
      }

      if (mode === 'checkout') {
        const ck = await apiFetch('/api/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variantId: pub.variantId, quantity: 1 }),
        }).then((r) => r.json()).catch(() => null);
        if (ck?.url) window.location.assign(ck.url);
        return;
      }

      if (mode === 'cart') {
        const cl = await apiFetch('/api/create-cart-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variantId: pub.variantId, quantity: 1 }),
        }).then((r) => r.json()).catch(() => null);
        if (cl?.url) {
          window.open(cl.url, '_blank', 'noopener,noreferrer');
          flow.reset();
          navigate('/');
        }
      }
    } catch (e) {
      alert(e?.message || 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadPdf() {
    if (!flow.printFullResDataUrl) {
      alert('No se encontraron datos para generar el PDF.');
      return;
    }
    const widthCmRaw = Number(flow.editorState?.size_cm?.w);
    const heightCmRaw = Number(flow.editorState?.size_cm?.h);
    if (!Number.isFinite(widthCmRaw) || !Number.isFinite(heightCmRaw) || widthCmRaw <= 0 || heightCmRaw <= 0) {
      alert('No se pudieron obtener las dimensiones del diseño.');
      return;
    }
    try {
      setBusy(true);
      const response = await fetch(flow.printFullResDataUrl);
      const imageBlob = await response.blob();
      const imageBytes = new Uint8Array(await imageBlob.arrayBuffer());
      const pdfDoc = await PDFDocument.create();
      const enlargementCm = 2;
      const targetWidthCm = widthCmRaw + enlargementCm;
      const targetHeightCm = heightCmRaw + enlargementCm;
      const cmToPt = (cm) => (cm / 2.54) * 72;
      const pageWidthPt = cmToPt(targetWidthCm);
      const pageHeightPt = cmToPt(targetHeightCm);
      const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
      const embedded =
        imageBlob.type === 'image/jpeg' || imageBlob.type === 'image/jpg'
          ? await pdfDoc.embedJpg(imageBytes)
          : await pdfDoc.embedPng(imageBytes);
      page.drawImage(embedded, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });
      const pdfBytes = await pdfDoc.save();
      const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      const baseName = buildExportBaseName(flow.designName || '', targetWidthCm, targetHeightCm);
      downloadBlob(pdfBlob, `${baseName}.pdf`);
    } catch (error) {
      console.error('[download-pdf]', error);
      alert('No se pudo generar el PDF.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 32, textAlign: 'center' }}>
      <img
        src={flow.mockupUrl}
        width={540}
        height={540}
        style={{ maxWidth: '100%', height: 'auto' }}
        alt="Mockup"
      />
      <div style={{ marginTop: 16, display: 'flex', gap: 12, justifyContent: 'center' }}>
        <button disabled={busy} onClick={() => { flow.reset(); navigate('/'); }}>Cancelar y volver</button>
        <button disabled={busy} onClick={handleDownloadPdf}>Descargar PDF</button>
        <button disabled={busy} onClick={() => handle('cart')}>Agregar al carrito y seguir creando</button>
        <button disabled={busy} onClick={() => handle('checkout')}>Comprar ahora</button>
      </div>
    </div>
  );
}

