import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PDFDocument } from 'pdf-lib';
import Toast from '@/components/Toast.jsx';
import { useFlow } from '@/state/flow.js';
import { downloadBlob } from '@/lib/mockup.js';
import styles from './Mockup.module.css';
import { buildExportBaseName } from '@/lib/filename.ts';
import {
  buildCartAddUrl,
  buildCartPermalink,
  createJobAndProduct,
  ONLINE_STORE_DISABLED_MESSAGE,
  ONLINE_STORE_MISSING_MESSAGE,
  ensureProductPublication,
  verifyProductPublicationStatus,
  waitForVariantAvailability,
} from '@/lib/shopify.ts';

const CART_STATUS_LABELS = {
  idle: 'Agregar al carrito',
  creating: 'Creando producto…',
  adding: 'Agregando al carrito…',
  opening: 'Abriendo carrito…',
};

const CART_DEFAULT_QUANTITY = 1;

export default function Mockup() {
  const flow = useFlow();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [cartStatus, setCartStatus] = useState('idle');
  const [pendingCart, setPendingCart] = useState(null);
  const [toast, setToast] = useState(null);
  const [isBuyPromptOpen, setBuyPromptOpen] = useState(false);
  const buyNowButtonRef = useRef(null);
  const modalRef = useRef(null);
  const firstActionButtonRef = useRef(null);
  const wasModalOpenedRef = useRef(false);

  const cartButtonLabel = CART_STATUS_LABELS[cartStatus] || CART_STATUS_LABELS.idle;
  const buyPromptTitleId = 'buy-choice-title';
  const buyPromptDescriptionId = 'buy-choice-description';
  const discountCode = useMemo(() => {
    if (typeof window === 'undefined') return '';
    try {
      const params = new URLSearchParams(location.search);
      const code = params.get('discount');
      if (typeof code === 'string' && code.trim()) {
        return code.trim();
      }
      try {
        const stored = window.sessionStorage.getItem('MGM_discountCode');
        return typeof stored === 'string' ? stored.trim() : '';
      } catch (storageErr) {
        console.warn('[mockup-discount-storage-read]', storageErr);
        return '';
      }
    } catch (err) {
      console.warn('[mockup-discount-parse]', err);
      return '';
    }
  }, [location.search]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (discountCode) {
        window.sessionStorage.setItem('MGM_discountCode', discountCode);
      } else {
        window.sessionStorage.removeItem('MGM_discountCode');
      }
    } catch (err) {
      console.warn('[mockup-discount-storage-write]', err);
    }
  }, [discountCode]);

  useEffect(() => {
    setToast(null);
    setPendingCart(null);
    setCartStatus('idle');
    setBusy(false);
    setBuyPromptOpen(false);
    wasModalOpenedRef.current = false;
  }, [flow.mockupUrl]);

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
    else if (reasonRaw === 'private_checkout_failed') friendly = 'No pudimos generar el checkout privado, probá de nuevo.';
    else if (reasonRaw === 'draft_order_failed' || reasonRaw === 'draft_order_http_error' || reasonRaw === 'missing_invoice_url') {
      friendly = 'No pudimos generar el checkout privado, probá de nuevo.';
    }
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
    } else if (reasonRaw === 'shopify_scope_missing') {
      const missing = Array.isArray(error?.missing) && error.missing.length
        ? error.missing.join(', ')
        : 'write_products';
      friendly = `La app de Shopify no tiene permisos suficientes. Reinstalá la app concediendo los scopes: ${missing}.`;
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

  function openCartTab(url) {
    if (typeof window === 'undefined' || !url) return false;
    try {
      const popup = window.open(url, '_blank', 'noopener');
      if (!popup) {
        return false;
      }
      try {
        popup.opener = null;
        popup.focus?.();
      } catch (focusErr) {
        console.warn('[cart-popup-focus]', focusErr);
      }
      return true;
    } catch (err) {
      console.error('[openCartTab]', err);
      return false;
    }
  }

  function showCartFailureToast(url) {
    if (!url) {
      setToast({ message: 'No pudimos agregarlo al carrito. Probá de nuevo.' });
      return;
    }
    setToast({
      message: 'No pudimos agregarlo al carrito. Probá de nuevo.',
      actionLabel: 'Reintentar',
      action: () => attemptOpenCart(url),
    });
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

  function openCartAndFinalize(url) {
    if (!url) return;
    setBusy(true);
    setCartStatus('opening');
    const opened = openCartTab(url);
    if (opened) {
      finalizeCartSuccess();
    } else {
      setCartStatus('idle');
      setBusy(false);
      showCartFailureToast(url);
    }
  }

  function attemptOpenCart(url) {
    const link = url || pendingCart?.webUrl;
    if (!link) return;
    openCartAndFinalize(link);
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
    const normalizedDiscountCode = discountCode || '';
    const baseCartOptions = normalizedDiscountCode ? { discountCode: normalizedDiscountCode } : {};
    try {
      setBusy(true);
      let latestCartUrl = '';
      if (!skipCreation || !current) {
        setCartStatus('creating');
        const result = await createJobAndProduct(
          'cart',
          flow,
          skipCreation
            ? { reuseLastProduct: true, skipPublication, ...(normalizedDiscountCode ? { discountCode: normalizedDiscountCode } : {}) }
            : baseCartOptions,
        );
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
        latestCartUrl = typeof result?.cartUrl === 'string' ? result.cartUrl : '';
        current = {
          productId: result.productId,
          variantId: result.variantId,
          quantity: CART_DEFAULT_QUANTITY,
          ...(latestCartUrl ? { webUrl: latestCartUrl } : {}),
          ...(result?.cartId ? { cartId: result.cartId } : {}),
          ...(result?.cartToken ? { cartToken: result.cartToken } : {}),
        };
        setPendingCart(current);
      }
      if (!current?.variantId) throw new Error('missing_variant');

      setCartStatus('adding');
      if (!skipPublication && current.productId) {
        try {
          const ensureResult = await ensureProductPublication(current.productId);
          if (ensureResult?.publicationId && ensureResult.publicationId !== current.publicationId) {
            current = {
              ...current,
              publicationId: ensureResult.publicationId,
            };
            setPendingCart(current);
          }
        } catch (err) {
          console.warn('[cart-flow] ensure publication failed', err);
        }
      }

      if (current.productId && current.variantId) {
        try {
          console.info('[cart-flow] wait_variant_start', {
            productId: current.productId,
            variantId: current.variantId,
          });
        } catch (logErr) {
          console.debug?.('[cart-flow] wait_variant_start_log_failed', logErr);
        }
        try {
          const verifyPublication = () => verifyProductPublicationStatus(current.productId);
          const pollResult = await waitForVariantAvailability(
            current.variantId,
            current.productId,
            {
              verifyProductPublication: verifyPublication,
            },
          );
          try {
            console.info('[cart-flow] wait_variant_result', {
              productId: current.productId,
              variantId: current.variantId,
              ready: Boolean(pollResult?.ready),
              available: pollResult?.available !== false,
              timedOut: Boolean(pollResult?.timedOut),
              attempts: Number.isFinite(pollResult?.attempts)
                ? pollResult.attempts
                : null,
              variantPresent: typeof pollResult?.variantPresent === 'boolean' ? pollResult.variantPresent : null,
              availableForSale: typeof pollResult?.availableForSale === 'boolean' ? pollResult.availableForSale : null,
            });
          } catch (logErr) {
            console.debug?.('[cart-flow] wait_variant_result_log_failed', logErr);
          }
          if (!pollResult?.ready || pollResult?.available === false) {
            setCartStatus('idle');
            setBusy(false);
            showCartFailureToast('');
            return;
          }
        } catch (pollErr) {
          console.error('[cart-flow] wait_variant_failed', pollErr);
          setCartStatus('idle');
          setBusy(false);
          showCartFailureToast('');
          return;
        }
      }
      if (!current.productId || !current.variantId) {
        try {
          console.warn('[cart-flow] skip_variant_poll_missing_ids', {
            productId: current.productId || null,
            variantId: current.variantId || null,
          });
        } catch (logErr) {
          console.debug?.('[cart-flow] skip_variant_poll_log_failed', logErr);
        }
      }

      const desiredQuantity = current.quantity || CART_DEFAULT_QUANTITY;
      const addToCartUrl = buildCartAddUrl(
        current.variantId,
        desiredQuantity,
        normalizedDiscountCode ? { discountCode: normalizedDiscountCode } : undefined,
      );
      let cartUrl = addToCartUrl
        || latestCartUrl
        || current?.webUrl
        || buildCartPermalink(
          current.variantId,
          desiredQuantity,
          normalizedDiscountCode ? { discountCode: normalizedDiscountCode } : undefined,
        );

      if (!cartUrl) {
        setCartStatus('idle');
        setBusy(false);
        showCartFailureToast('');
        return;
      }

      if (!current?.webUrl || current.webUrl !== cartUrl) {
        current = {
          ...current,
          webUrl: cartUrl,
        };
        setPendingCart(current);
      }

      try {
        console.info('[cart-flow] open_cart_url', {
          productId: current.productId || null,
          variantId: current.variantId || null,
          url: cartUrl,
        });
      } catch (logErr) {
        console.debug?.('[cart-flow] open_cart_url_log_failed', logErr);
      }

      openCartAndFinalize(cartUrl);
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
      let jobOptions = options;
      if (mode === 'private') {
        const stageCallback = (stage) => {
          if (stage === 'creating_product') {
            setToast({ message: 'Creando producto privado…' });
          } else if (stage === 'creating_checkout') {
            setToast({ message: 'Generando checkout privado…' });
          }
        };
        setToast({ message: 'Creando producto privado…' });
        jobOptions = { ...options, onPrivateStageChange: stageCallback };
      }
      const normalizedDiscountCode = discountCode || '';
      const jobOptionsWithDiscount =
        mode === 'private' || !normalizedDiscountCode
          ? jobOptions
          : { ...jobOptions, discountCode: normalizedDiscountCode };
      const result = await createJobAndProduct(mode, submissionFlow, jobOptionsWithDiscount);
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
        const opened = openCartTab(result.checkoutUrl);
        if (!opened) {
          try {
            window.open(result.checkoutUrl, '_blank', 'noopener');
          } catch (tabErr) {
            console.warn('[private-checkout-open]', tabErr);
          }
        }
        setToast({ message: 'Listo. Abrimos tu checkout privado en otra pestaña.' });
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
      if (mode === 'private') {
        setToast(null);
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

  const mockupUrl = flow.mockupUrl;
  const hasMockupImage =
    typeof mockupUrl === 'string' ? mockupUrl.trim().length > 0 : Boolean(mockupUrl);

  return (
    <div id="mockup-review" className={styles.review}>
      <main className={styles.main}>

        <div
          className={`${styles.previewWrapper} ${
            hasMockupImage ? styles.previewWithImage : ''
          }`}
        >
          <h1
            className={`${styles.previewTitle} ${
              hasMockupImage ? styles.previewTitleOverlay : ''
            }`}
          >
            ¿Te gustó cómo quedó?
          </h1>
          {hasMockupImage ? (
            <img
              src={mockupUrl}
              className={styles.mockupImage}
              alt="Vista previa de tu mousepad personalizado"
            />
          ) : null}

        </div>
        <div className={styles.ctaRow}>
          <div className={styles.ctaCard}>
            <button
              type="button"
              disabled={busy}
              className={`${styles.ctaButton} ${styles.ctaButtonSecondary}`}
              onClick={() => {
                if (busy) return;
                flow.reset();
                navigate('/');
              }}
            >
              Volver
            </button>
            <p className={styles.ctaHint}>
              Volvé al editor para hacer los cambios que quieras ✏️
            </p>
          </div>
          <div className={styles.ctaCard}>
            <button
              type="button"
              disabled={busy}
              className={`${styles.ctaButton} ${styles.ctaButtonPrimary}`}
              onClick={() => handle('cart')}
            >
              {cartButtonLabel}
            </button>
            <p className={styles.ctaHint}>
              Arma un carrito con todo lo que te guste y obtené envío gratis ❤️
            </p>
          </div>
          <div className={styles.ctaCard}>
            <button
              type="button"
              disabled={busy}
              className={`${styles.ctaButton} ${styles.ctaButtonPrimary}`}
              ref={buyNowButtonRef}
              onClick={() => {
                if (busy) return;
                setBuyPromptOpen(true);
              }}
            >
              Comprar ahora
            </button>
            <p className={styles.ctaHint}>
              Finalizá tu compra para que tu creación se haga realidad ✨
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          className={styles.hiddenButton}
          onClick={() => handle('private')}
          aria-hidden="true"
          tabIndex={-1}
        >
          Comprar en privado
        </button>
        <button
          type="button"
          disabled={busy}
          className={styles.hiddenButton}
          onClick={handleDownloadPdf}
        >
          Descargar PDF
        </button>
      </main>
      <section className={styles.footerSection}>
        <p className={styles.footerMessage}>
          Nos encantaría que seas parte nuestra comunidad y por eso quiero convencerte 😎
        </p>
      </section>
      {isBuyPromptOpen ? (
        <div
          role="presentation"
          className={styles.modalBackdrop}
          onClick={() => {
            if (busy) return;
            setBuyPromptOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={buyPromptTitleId}
            aria-describedby={buyPromptDescriptionId}
            ref={modalRef}
            className={styles.modalCard}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                if (busy) return;
                setBuyPromptOpen(false);
              }}
              disabled={busy}
              aria-label="Cerrar"
              className={styles.modalClose}
            >
              ×
            </button>
            <h2 id={buyPromptTitleId} className={styles.modalTitle}>
              ¿Quieres comprarlo en privado o público?
            </h2>
            <p id={buyPromptDescriptionId} className={styles.modalDescription}>
              Público: tu diseño será visible en la tienda. Privado: solo vos verás el producto.
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                ref={firstActionButtonRef}
                disabled={busy}
                className={styles.modalPrimary}
                onClick={() => {
                  setBuyPromptOpen(false);
                  handle('checkout');
                }}
              >
                Comprar ahora (público)
              </button>
              <button
                type="button"
                disabled={busy}
                className={styles.modalSecondary}
                onClick={() => {
                  setBuyPromptOpen(false);
                  handle('private');
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
