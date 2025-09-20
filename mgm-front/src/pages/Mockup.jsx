import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { useFlow } from '@/state/flow.js';
import { downloadBlob } from '@/lib/mockup.js';
import { buildExportBaseName } from '@/lib/filename.ts';
import { createJobAndProduct } from '@/lib/shopify.ts';

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
      const result = await createJobAndProduct(mode, flow);
      if (mode === 'checkout' && result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (mode === 'cart' && result.cartUrl) {
        window.open(result.cartUrl, '_blank', 'noopener,noreferrer');
        flow.reset();
        navigate('/');
        return;
      }
      if (result.productUrl) {
        window.open(result.productUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      alert('El producto se creó pero no se pudo obtener un enlace.');
    } catch (e) {
      console.error('[mockup-handle]', e);
      const message = String(e?.message || 'Error');
      let friendly = message;
      if (message === 'missing_mockup') friendly = 'No se encontró el mockup para publicar.';
      else if (message === 'missing_variant') friendly = 'No se pudo obtener la variante del producto creado en Shopify.';
      else if (message === 'cart_link_failed') friendly = 'No se pudo generar el enlace del carrito. Revisá la configuración de Shopify.';
      else if (message === 'checkout_link_failed') friendly = 'No se pudo generar el enlace de compra.';
      else if (message.startsWith('publish_failed')) friendly = 'Shopify rechazó la creación del producto. Revisá los datos enviados.';
      else if (message === 'shopify_error') friendly = 'Shopify devolvió un error al crear el producto.';
      alert(friendly);
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
      const widthCm = widthCmRaw;
      const heightCm = heightCmRaw;
      const extraBleedCm = 2;
      const marginCm = extraBleedCm / 2;
      const pageWidthCm = widthCm + extraBleedCm;
      const pageHeightCm = heightCm + extraBleedCm;
      const cmToPt = (cm) => (cm / 2.54) * 72;
      const pageWidthPt = cmToPt(pageWidthCm);
      const pageHeightPt = cmToPt(pageHeightCm);
      const innerWidthPt = cmToPt(widthCm);
      const innerHeightPt = cmToPt(heightCm);
      const marginPt = cmToPt(marginCm);
      const page = pdfDoc.addPage([pageWidthPt, pageHeightPt]);
      const embedded =
        imageBlob.type === 'image/jpeg' || imageBlob.type === 'image/jpg'
          ? await pdfDoc.embedJpg(imageBytes)
          : await pdfDoc.embedPng(imageBytes);
      page.drawImage(embedded, { x: 0, y: 0, width: pageWidthPt, height: pageHeightPt });
      page.drawImage(embedded, { x: marginPt, y: marginPt, width: innerWidthPt, height: innerHeightPt });
      const pdfBytes = await pdfDoc.save();
      const pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
      const baseName = buildExportBaseName(flow.designName || '', pageWidthCm, pageHeightCm);
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

