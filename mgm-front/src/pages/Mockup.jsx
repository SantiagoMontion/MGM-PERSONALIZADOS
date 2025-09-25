import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PDFDocument } from 'pdf-lib';
import Toast from '@/components/Toast.jsx';
import { useFlow } from '@/state/flow.js';
import { downloadBlob } from '@/lib/mockup.js';
import { buildExportBaseName } from '@/lib/filename.ts';
import {
  buildCartPermalink,
  createJobAndProduct,
  ONLINE_STORE_DISABLED_MESSAGE,
  ONLINE_STORE_MISSING_MESSAGE,
  ensureProductPublication,
  waitForVariantAvailability,
} from '@/lib/shopify.ts';

const CART_STATUS_LABELS = {
  idle: 'Agregar al carrito y seguir creando',
  creating: 'Creando producto…',
  publishing: 'Publicando producto…',
  waiting: 'Preparando carrito…',
  adding: 'Abriendo carrito…',
};

const CART_DEFAULT_QUANTITY = 1;

export default function Mockup() {
  const flow = useFlow();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [cartStatus, setCartStatus] = useState('idle');
  const [pendingCart, setPendingCart] = useState(null);
  const [toast, setToast] = useState(null);
  const [isBuyPromptOpen, setBuyPromptOpen] = useState(false);
  const buyNowButtonRef = useRef(null);
  const modalRef = useRef(null);
  const firstActionButtonRef = useRef(null);
  const wasModalOpenedRef = useRef(false);

  if (!flow.mockupUrl) {
    return (
      <div style={{ padding: 32 }}>
        <p>No hay imagen para mostrar.</p>
        <button onClick={() => navigate('/')}>Volver</button>
      </div>
    );
  }

  const cartButtonLabel = CART_STATUS_LABELS[cartStatus] || CART_STATUS_LABELS.idle;
  const buyPromptTitleId = 'buy-choice-title';
  const buyPromptDescriptionId = 'buy-choice-description';

  useEffect(() => {
    if (!isBuyPromptOpen) return;
    wasModalOpenedRef.current = true;
    const timer = setTimeout(() => {
      try {
        firstActionButtonRef.current?.focus?.();
      } catch (focusErr) {
        console.warn('[buy-prompt-focus]', focusErr);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [isBuyPromptOpen]);

  useEffect(() => {
    if (isBuyPromptOpen) return;
    if (!wasModalOpenedRef.current) return;
    try {
      buyNowButtonRef.current?.focus?.();
    } catch (focusErr) {
      console.warn('[buy-prompt-return-focus]', focusErr);
    }
  }, [isBuyPromptOpen]);

  useEffect(() => {
    if (!isBuyPromptOpen) return;
    function handleKeyDown(event) {
      if (event.key === 'Escape' || event.key === 'Esc') {
        if (busy) return;
        event.preventDefault();
        setBuyPromptOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const container = modalRef.current;
      if (!container) return;
      const focusable = Array.from(container.querySelectorAll('button:not([disabled])'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          try {
            last.focus();
          } catch (focusErr) {
            console.warn('[buy-prompt-trap-focus]', focusErr);
          }
        }
      } else {
        if (active === last) {
          event.preventDefault();
          try {
            first.focus();
          } catch (focusErr) {
            console.warn('[buy-prompt-trap-focus]', focusErr);
          }
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isBuyPromptOpen, busy]);

  function showFriendlyError(error) {
    console.error('[mockup]', error);
    const reasonRaw = typeof error?.reason === 'string' && error.reason
      ? error.reason
      : typeof error?.message === 'string' && error.message
        ? error.message
        : 'Error';
    const messageRaw = typeof error?.friendlyMessage === 'string' && error.friendlyMessage
      ? error.friendlyMessage
      : String(error?.message || 'Error');
    let friendly = messageRaw;
    if (reasonRaw === 'missing_mockup') friendly = 'No se encontró el mockup para publicar.';
    else if (reasonRaw === 'missing_variant') friendly = 'No se pudo obtener la variante del producto creado en Shopify.';
    else if (reasonRaw === 'cart_link_failed') friendly = 'No se pudo generar el enlace del carrito. Revisá la configuración de Shopify.';
    else if (reasonRaw === 'checkout_link_failed') friendly = 'No se pudo generar el enlace de compra.';
    else if (reasonRaw === 'missing_customer_email' || reasonRaw === 'missing_email') friendly = 'Completá un correo electrónico válido para comprar en privado.';
    else if (reasonRaw.startsWith('publish_failed')) friendly = 'Shopify rechazó la creación del producto. Revisá los datos enviados.';
    else if (reasonRaw === 'shopify_error') friendly = 'Shopify devolvió un error al crear el producto.';
    else if (reasonRaw === 'product_not_active') friendly = 'El producto quedó como borrador en Shopify. Verificá la visibilidad y reintentá.';
    else if (reasonRaw === 'product_missing_variant') friendly = 'Shopify no devolvió variantes para el producto creado.';
    else if (reasonRaw === 'shopify_env_missing') {
      const missing = Array.isArray(error?.missing) && error.missing.length
        ? error.missing.join(', ')
        : 'SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN';
      friendly = `La integración con Shopify no está configurada. Faltan las variables: ${missing}.`;
    } else if (reasonRaw === 'shopify_storefront_env_missing') {
      const missing = Array.isArray(error?.missing) && error.missing.length
        ? error.missing.join(', ')
        : 'SHOPIFY_STOREFRONT_TOKEN, SHOPIFY_STOREFRONT_DOMAIN';
      friendly = `La API Storefront de Shopify no está configurada. Faltan las variables: ${missing}.`;
    } else if (reasonRaw === 'shopify_cart_user_error') {
      friendly = 'Shopify rechazó el carrito generado. Intentá nuevamente en unos segundos.';
    }
    alert(friendly);
  }

  function openCartWindow(permalink) {
    if (typeof window === 'undefined' || !permalink) return false;
    try {
      const popup = window.open(permalink, '_blank', 'noopener');
      if (popup) {
        try { popup.focus?.(); } catch (focusErr) { console.warn('[cart-popup-focus]', focusErr); }
        return true;
      }
      window.location.assign(permalink);
      return true;
    } catch (err) {
      console.error('[openCartWindow]', err);
      return false;
    }
  }

  function finalizeCartSuccess() {
    setPendingCart(null);
    setToast(null);
    setCartStatus('idle');
    setBusy(false);
    flow.reset();
    try {
      navigate('/', { replace: true });
    } catch (navErr) {
      console.warn('[cart-success-navigate]', navErr);
    }
  }

  function attemptCartRedirect(permalink) {
    const link = permalink
      || pendingCart?.permalink
      || (pendingCart?.variantId
        ? buildCartPermalink(
          pendingCart.variantId,
          pendingCart.quantity || CART_DEFAULT_QUANTITY,
          { returnTo: '/cart' },
        )
        : '');
    if (!link) return;
    const opened = openCartWindow(link);
    if (opened) {
      finalizeCartSuccess();
    } else {
      setToast({
        message: 'No pudimos agregar tu producto al carrito',
        actionLabel: 'Reintentar',
        action: () => attemptCartRedirect(link),
      });
    }
  }

  function extractWarningMessages(warnings, warningMessages) {
    if (Array.isArray(warningMessages) && warningMessages.length) {
      return warningMessages
        .map((msg) => (typeof msg === 'string' ? msg.trim() : ''))
        .filter((msg) => Boolean(msg));
    }
    if (Array.isArray(warnings) && warnings.length) {
      return warnings
        .map((entry) => {
          if (!entry) return '';
          if (typeof entry === 'string') return entry;
          if (typeof entry.message === 'string') return entry.message;
          return '';
        })
        .filter((msg) => Boolean(msg));
    }
    return [];
  }

  async function startCartFlow(options = {}) {
    const skipCreation = Boolean(options.skipCreation);
    const skipPublication = Boolean(options.skipPublication);
    if (busy && cartStatus !== 'idle' && !skipCreation) return;
    setToast(null);
    let current = pendingCart;
    try {
      setBusy(true);
      if (!skipCreation || !current) {
        setCartStatus('creating');
        const result = await createJobAndProduct('cart', flow, skipCreation ? { reuseLastProduct: true, skipPublication } : {});
        if (!result?.variantId) throw new Error('missing_variant');
        const warningMessages = extractWarningMessages(result?.warnings, result?.warningMessages);
        if (warningMessages.length) {
          try {
            console.warn('[cart-flow] warnings', warningMessages);
          } catch (warnErr) {
            console.debug?.('[cart-flow] warn_log_failed', warnErr);
          }
          setToast({ message: warningMessages.join(' ') });
        }
        current = {
          productId: result.productId,
          variantId: result.variantId,
          quantity: CART_DEFAULT_QUANTITY,
        };
        setPendingCart(current);
      }
      if (!current?.variantId) throw new Error('missing_variant');

      setCartStatus('publishing');
      if (!skipPublication && current.productId) {
        try {
          await ensureProductPublication(current.productId);
        } catch (err) {
          console.warn('[cart-flow] ensure publication failed', err);
        }
      }

      setCartStatus('waiting');
      const waitResult = await waitForVariantAvailability(current.variantId, current.productId);
      if (!waitResult.ready) {
        setCartStatus('idle');
        setBusy(false);
        setToast({
          message: 'Tu producto se está creando, probá de nuevo',
          actionLabel: 'Reintentar',
          action: () => startCartFlow({ skipCreation: true }),
        });
        return;
      }

      const permalink = buildCartPermalink(current.variantId, current.quantity, { returnTo: '/cart' });
      if (!permalink) {
        throw new Error('invalid_cart_permalink');
      }
      setPendingCart({ ...current, permalink });
      if (typeof console !== 'undefined' && typeof console.info === 'function') {
        console.info('[cart-flow] permalink listo', permalink);
      }

      setCartStatus('adding');
      const opened = openCartWindow(permalink);
      if (!opened) {
        setCartStatus('idle');
        setBusy(false);
        setToast({
          message: 'No pudimos agregar tu producto al carrito',
          actionLabel: 'Reintentar',
          action: () => attemptCartRedirect(permalink),
        });
        return;
      }

      finalizeCartSuccess();
    } catch (err) {
      setCartStatus('idle');
      setBusy(false);
      if (err?.name === 'AbortError') return;
      const reason = typeof err?.reason === 'string' ? err.reason : '';
      if (reason === 'online_store_publication_missing' || reason === 'online_store_publication_empty') {
        const friendly = typeof err?.friendlyMessage === 'string' && err.friendlyMessage
          ? err.friendlyMessage
          : reason === 'online_store_publication_empty'
            ? ONLINE_STORE_DISABLED_MESSAGE
            : ONLINE_STORE_MISSING_MESSAGE;
        setToast({
          message: friendly,
          actionLabel: 'Reintentar',
          action: () => {
            setToast(null);
            startCartFlow({ skipCreation: true });
          },
          secondaryActionLabel: 'Omitir publicación (avanzado)',
          secondaryAction: () => {
            setToast(null);
            startCartFlow({ skipCreation: true, skipPublication: true });
          },
        });
        return;
      }
      if (err?.message === 'invalid_cart_permalink') {
        setToast({
          message: 'No pudimos agregar tu producto al carrito',
          actionLabel: 'Reintentar',
          action: () => startCartFlow({ skipCreation: true }),
        });
        return;
      }
      showFriendlyError(err);
    }
  }

  async function handle(mode, options = {}) {
    if (mode !== 'checkout' && mode !== 'cart' && mode !== 'private') return;

    if (mode === 'cart') {
      await startCartFlow();
      return;
    }

    let submissionFlow = flow;

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
      const result = await createJobAndProduct(mode, submissionFlow, options);
      const warningMessages = extractWarningMessages(result?.warnings, result?.warningMessages);
      if (warningMessages.length) {
        try {
          console.warn(`[${mode}-flow] warnings`, warningMessages);
        } catch (warnErr) {
          console.debug?.('[handle] warn_log_failed', warnErr);
        }
        setToast({ message: warningMessages.join(' ') });
      }
      if (mode === 'checkout' && result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (mode === 'private' && result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      if (result.productUrl) {
        window.open(result.productUrl, '_blank', 'noopener');
        return;
      }
      alert('El producto se creó pero no se pudo obtener un enlace.');
    } catch (error) {
      const reason = typeof error?.reason === 'string' ? error.reason : '';
      if (reason === 'online_store_publication_missing' || reason === 'online_store_publication_empty') {
        const friendly = typeof error?.friendlyMessage === 'string' && error.friendlyMessage
          ? error.friendlyMessage
          : reason === 'online_store_publication_empty'
            ? ONLINE_STORE_DISABLED_MESSAGE
            : ONLINE_STORE_MISSING_MESSAGE;
        setToast({
          message: friendly,
          actionLabel: 'Reintentar',
          action: () => {
            setToast(null);
            handle(mode, { reuseLastProduct: true });
          },
          secondaryActionLabel: 'Omitir publicación (avanzado)',
          secondaryAction: () => {
            setToast(null);
            handle(mode, { reuseLastProduct: true, skipPublication: true });
          },
        });
        return;
      }
      showFriendlyError(error);
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
        <button disabled={busy} onClick={() => handle('cart')}>{cartButtonLabel}</button>
        <button
          disabled={busy}
          ref={buyNowButtonRef}
          onClick={() => {
            if (busy) return;
            setBuyPromptOpen(true);
          }}
        >
          Comprar ahora
        </button>
        <button
          disabled={busy}
          onClick={() => handle('private')}
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
        >
          Comprar en privado
        </button>
        <button disabled={busy} onClick={handleDownloadPdf} style={{ display: 'none' }}>Descargar PDF</button>
      </div>
      {isBuyPromptOpen ? (
        <div
          role="presentation"
          onClick={() => {
            if (busy) return;
            setBuyPromptOpen(false);
          }}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={buyPromptTitleId}
            aria-describedby={buyPromptDescriptionId}
            ref={modalRef}
            onClick={(event) => event.stopPropagation()}
            style={{
              position: 'relative',
              background: '#fff',
              borderRadius: 12,
              width: '100%',
              maxWidth: 520,
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)',
              padding: 24,
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (busy) return;
                setBuyPromptOpen(false);
              }}
              disabled={busy}
              aria-label="Cerrar"
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                border: 'none',
                background: 'transparent',
                cursor: busy ? 'default' : 'pointer',
                fontSize: 20,
                lineHeight: 1,
              }}
            >
              ×
            </button>
            <h2 id={buyPromptTitleId} style={{ margin: '0 0 12px 0', fontSize: 22 }}>
              ¿Quieres comprarlo en privado o público?
            </h2>
            <p id={buyPromptDescriptionId} style={{ margin: '0 0 20px 0', fontSize: 14, color: '#555' }}>
              Público: tu diseño será visible en la tienda. Privado: solo vos verás el producto.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                ref={firstActionButtonRef}
                disabled={busy}
                onClick={() => {
                  setBuyPromptOpen(false);
                  handle('checkout');
                }}
                style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: '#0070f3',
                  color: '#fff',
                  fontSize: 16,
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                Comprar ahora (público)
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setBuyPromptOpen(false);
                  handle('private');
                }}
                style={{
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: '1px solid #0070f3',
                  backgroundColor: '#fff',
                  color: '#0070f3',
                  fontSize: 16,
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                Comprar en privado
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {toast ? (
        <Toast
          message={toast.message}
          actionLabel={toast.actionLabel}
          onAction={toast.action}
          secondaryActionLabel={toast.secondaryActionLabel}
          onSecondaryAction={toast.secondaryAction}
          onClose={() => setToast(null)}
        />
      ) : null}
    </div>
  );
}
