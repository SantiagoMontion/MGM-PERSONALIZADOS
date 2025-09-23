import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PDFDocument } from 'pdf-lib';
import { useFlow } from '@/state/flow.js';
import { downloadBlob } from '@/lib/mockup.js';
import { buildExportBaseName } from '@/lib/filename.ts';
import { openCartUrl } from '@/lib/cart.ts';
import { createJobAndProduct } from '@/lib/shopify.ts';

const safeClosePopup = (popup) => {
  if (popup && !popup.closed) {
    try {
      popup.close();
    } catch (closeErr) {
      console.warn('No se pudo cerrar la ventana emergente', closeErr);
    }
  }
};

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

    if (mode !== 'checkout' && mode !== 'cart' && mode !== 'private') return;


    let submissionFlow = flow;
    let cartTarget;
    let cartPopup;

    if (mode === 'private') {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      let emailRaw = typeof flow.customerEmail === 'string' ? flow.customerEmail.trim() : '';
      if (!emailPattern.test(emailRaw)) {
        if (typeof window === 'undefined') {
          alert('Ingresá un correo electrónico válido para comprar en privado.');
          return;
        }
        const promptDefault = typeof flow.customerEmail === 'string' ? flow.customerEmail : '';
        const provided = window.prompt(
          'Ingresá tu correo electrónico para continuar con la compra privada:',
          promptDefault,
        );
        if (provided == null) {
          return;
        }
        const normalized = provided.trim();
        if (!emailPattern.test(normalized)) {
          alert('Ingresá un correo electrónico válido para comprar en privado.');
          return;
        }
        emailRaw = normalized;
      }
      if (emailRaw !== flow.customerEmail) {
        flow.set({ customerEmail: emailRaw });
      }
      submissionFlow = { ...flow, customerEmail: emailRaw };
    }


    try {
      setBusy(true);
      if (mode === 'cart' && typeof window !== 'undefined') {
        cartTarget = `mgm_cart_${Date.now()}`;
        cartPopup = window.open('https://www.mgmgamers.store/', cartTarget, 'noopener');
      }
      const result = await createJobAndProduct(mode, submissionFlow);
      if (mode === 'checkout' && result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (mode === 'private' && result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (mode === 'cart' && result.cartUrl) {
        openCartUrl(result.cartUrl, { target: cartTarget, popup: cartPopup });
        flow.reset();
        navigate('/', { replace: true });
        return;
      }

      if (result.productUrl) {
        safeClosePopup(cartPopup);
        window.open(result.productUrl, '_blank', 'noopener');
        return;
      }
      safeClosePopup(cartPopup);
      alert('El producto se creó pero no se pudo obtener un enlace.');
    } catch (e) {
      console.error('[mockup-handle]', e);
      safeClosePopup(cartPopup);
      const reasonRaw = typeof e?.reason === 'string' && e.reason ? e.reason : String(e?.message || 'Error');
      const messageRaw = typeof e?.friendlyMessage === 'string' && e.friendlyMessage
        ? e.friendlyMessage
        : String(e?.message || 'Error');
      let friendly = messageRaw;
      if (reasonRaw === 'missing_mockup') friendly = 'No se encontró el mockup para publicar.';
      else if (reasonRaw === 'missing_variant') friendly = 'No se pudo obtener la variante del producto creado en Shopify.';
      else if (reasonRaw === 'cart_link_failed') friendly = 'No se pudo generar el enlace del carrito. Revisá la configuración de Shopify.';
      else if (reasonRaw === 'checkout_link_failed') friendly = 'No se pudo generar el enlace de compra.';
      else if (reasonRaw === 'missing_customer_email' || reasonRaw === 'missing_email') friendly = 'Completá un correo electrónico válido para comprar en privado.';
      else if (reasonRaw.startsWith('publish_failed')) friendly = 'Shopify rechazó la creación del producto. Revisá los datos enviados.';
      else if (reasonRaw === 'shopify_error') friendly = 'Shopify devolvió un error al crear el producto.';
      else if (reasonRaw === 'shopify_env_missing') {
        const missing = Array.isArray(e?.missing) && e.missing.length
          ? e.missing.join(', ')
          : 'SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN';
        friendly = `La integración con Shopify no está configurada. Faltan las variables: ${missing}.`;
      } else if (reasonRaw === 'shopify_storefront_env_missing') {
        const missing = Array.isArray(e?.missing) && e.missing.length
          ? e.missing.join(', ')
          : 'SHOPIFY_STOREFRONT_TOKEN, SHOPIFY_STOREFRONT_DOMAIN';
        friendly = `La API Storefront de Shopify no está configurada. Faltan las variables: ${missing}.`;
      } else if (reasonRaw === 'shopify_cart_user_error') {
        friendly = 'Shopify rechazó el carrito generado. Intentá nuevamente en unos segundos.';
      }
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
      const baseName = buildExportBaseName(
        flow.designName || '',
        widthCmRaw,
        heightCmRaw,
        flow.material,
      );
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
        <button disabled={busy} onClick={() => handle('cart')}>Agregar al carrito y seguir creando</button>
        <button disabled={busy} onClick={() => handle('checkout')}>Comprar ahora</button>
        <button disabled={busy} onClick={() => handle('private')}>Comprar en privado</button>
        <button disabled={busy} onClick={handleDownloadPdf} style={{ display: 'none' }}>Descargar PDF</button>
      </div>
    </div>
  );
}

