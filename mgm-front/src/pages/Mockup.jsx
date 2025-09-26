import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PDFDocument } from 'pdf-lib';
import Toast from '@/components/Toast.jsx';
import { useFlow } from '@/state/flow.js';
import { downloadBlob } from '@/lib/mockup.js';
import styles from './Mockup.module.css';
import { buildExportBaseName } from '@/lib/filename.ts';
import {
  buildCartPermalink,
  createJobAndProduct,
  ONLINE_STORE_DISABLED_MESSAGE,
  ONLINE_STORE_MISSING_MESSAGE,
  ensureProductPublication,
} from '@/lib/shopify.ts';

const CART_STATUS_LABELS = {
  idle: 'Agregar al carrito',
  creating: 'Creando producto…',
  adding: 'Agregando al carrito…',
  opening: 'Abriendo carrito…',
};

const CART_DEFAULT_QUANTITY = 1;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRIVATE_EMAIL_ERROR_MESSAGE = 'Ingresá un correo electrónico válido para comprar en privado.';

export default function Mockup() {
  const flow = useFlow();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [cartStatus, setCartStatus] = useState('idle');
  const [pendingCart, setPendingCart] = useState(null);
  const [toast, setToast] = useState(null);
  const [isBuyPromptOpen, setBuyPromptOpen] = useState(false);
  const [isPrivateEmailModalOpen, setPrivateEmailModalOpen] = useState(false);
  const [privateEmailValue, setPrivateEmailValue] = useState('');
  const [privateEmailError, setPrivateEmailError] = useState('');
  const [discountCode, setDiscountCode] = useState('');
  const buyNowButtonRef = useRef(null);
  const modalRef = useRef(null);
  const privateModalRef = useRef(null);
  const privateEmailInputRef = useRef(null);
  const privateModalPrimaryButtonRef = useRef(null);
  const firstActionButtonRef = useRef(null);
  const wasModalOpenedRef = useRef(false);
  const pendingPrivateOptionsRef = useRef(null);
  const lastPrivateTriggerRef = useRef(null);

  const cartButtonLabel = CART_STATUS_LABELS[cartStatus] || CART_STATUS_LABELS.idle;
  const buyPromptTitleId = 'buy-choice-title';
  const buyPromptDescriptionId = 'buy-choice-description';
  const privateEmailTitleId = 'private-email-title';
  const privateEmailDescriptionId = 'private-email-description';
  const normalizedDiscountCode = typeof discountCode === 'string' ? discountCode.trim() : '';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(location.search);
      const code = params.get('discount');
      if (typeof code === 'string' && code.trim()) {
        const trimmed = code.trim();
        setDiscountCode((prev) => (prev === trimmed ? prev : trimmed));
        return;
      }
      let storedCode = '';
      try {
        const stored = window.sessionStorage.getItem('MGM_discountCode');
        storedCode = typeof stored === 'string' ? stored.trim() : '';
      } catch (storageErr) {
        console.warn('[mockup-discount-storage-read]', storageErr);
      }
      setDiscountCode((prev) => (prev === storedCode ? prev : storedCode));
    } catch (err) {
      console.warn('[mockup-discount-parse]', err);
      setDiscountCode((prev) => (prev ? '' : prev));
    }
  }, [location.search]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (normalizedDiscountCode) {
        window.sessionStorage.setItem('MGM_discountCode', normalizedDiscountCode);
      } else {
        window.sessionStorage.removeItem('MGM_discountCode');
      }
    } catch (err) {
      console.warn('[mockup-discount-storage-write]', err);
    }
  }, [normalizedDiscountCode]);

  useEffect(() => {
    setToast(null);
    setPendingCart(null);
    setCartStatus('idle');
    setBusy(false);
    setBuyPromptOpen(false);
    setPrivateEmailModalOpen(false);
    setPrivateEmailError('');
    setPrivateEmailValue('');
    wasModalOpenedRef.current = false;
    pendingPrivateOptionsRef.current = null;
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
    if (!isPrivateEmailModalOpen) return;
    const timer = setTimeout(() => {
      try {
        (privateEmailInputRef.current || privateModalPrimaryButtonRef.current)?.focus?.();
      } catch (focusErr) {
        console.warn('[private-email-focus]', focusErr);
      }
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [isPrivateEmailModalOpen]);

  useEffect(() => {
    if (!isPrivateEmailModalOpen) return;
    function handleKeyDown(event) {
      if (event.key === 'Escape' || event.key === 'Esc') {
        if (busy) return;
        event.preventDefault();
        setPrivateEmailError('');
        pendingPrivateOptionsRef.current = null;
        setPrivateEmailModalOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const container = privateModalRef.current;
      if (!container) return;
      const focusable = Array.from(
        container.querySelectorAll('input:not([disabled]), button:not([disabled])'),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !container.contains(active)) {
          event.preventDefault();
          try {
            last.focus();
          } catch (focusErr) {
            console.warn('[private-email-trap-focus]', focusErr);
          }
        }
      } else if (active === last) {
        event.preventDefault();
        try {
          first.focus();
        } catch (focusErr) {
          console.warn('[private-email-trap-focus]', focusErr);
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPrivateEmailModalOpen, busy]);

  useEffect(() => {
    if (isPrivateEmailModalOpen) return;
    if (!lastPrivateTriggerRef.current) return;
    const element = lastPrivateTriggerRef.current;
    lastPrivateTriggerRef.current = null;
    try {
      element.focus?.();
    } catch (focusErr) {
      console.warn('[private-email-return-focus]', focusErr);
    }
  }, [isPrivateEmailModalOpen]);

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
        window.focus?.();
        setTimeout(() => {
          try {
            window.focus?.();
          } catch (focusErr) {
            console.warn('[cart-popup-refocus]', focusErr);
          }
        }, 200);
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
          await ensureProductPublication(current.productId);
        } catch (err) {
          console.warn('[cart-flow] ensure publication failed', err);
        }
      }

      let cartUrl = latestCartUrl || current?.webUrl || '';
      if (!cartUrl) {
        cartUrl = buildCartPermalink(
          current.variantId,
          current.quantity || CART_DEFAULT_QUANTITY,
          normalizedDiscountCode ? { discountCode: normalizedDiscountCode } : undefined,
        );
      }

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
      const emailRaw = typeof flow.customerEmail === 'string' ? flow.customerEmail.trim() : '';
      if (!EMAIL_PATTERN.test(emailRaw)) {
        if (typeof window === 'undefined') {
          alert(PRIVATE_EMAIL_ERROR_MESSAGE);
          return;
        }
        try {
          const active = document?.activeElement;
          if (active && typeof active.focus === 'function') {
            lastPrivateTriggerRef.current = active;
          }
        } catch (focusErr) {
          console.warn('[private-email-store-focus]', focusErr);
          lastPrivateTriggerRef.current = null;
        }
        pendingPrivateOptionsRef.current = { options };
        setPrivateEmailValue(emailRaw);
        setPrivateEmailError('');
        setPrivateEmailModalOpen(true);
        return;
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
        let didOpen = openCartTab(result.checkoutUrl);
        if (!didOpen) {
          try {
            const manualPopup = window.open(result.checkoutUrl, '_blank', 'noopener');
            if (manualPopup) {
              try {
                manualPopup.opener = null;
              } catch (popupErr) {
                console.warn('[private-checkout-popup-opener]', popupErr);
              }
              didOpen = true;
            }
          } catch (tabErr) {
            console.warn('[private-checkout-open]', tabErr);
          }
        }
        if (didOpen) {
          setCartStatus('idle');
          setPendingCart(null);
          setToast(null);
          try {
            flow.reset();
          } catch (resetErr) {
            console.warn('[private-checkout-reset]', resetErr);
          }
          try {
            navigate('/', { replace: true });
          } catch (navErr) {
            console.warn('[private-checkout-navigate]', navErr);
          }
        } else {
          setToast({
            message: 'No pudimos abrir el checkout privado automáticamente. Revisá los permisos de ventanas emergentes e intentá nuevamente.',
            actionLabel: 'Reintentar',
            action: () => handle('private', options),
          });
        }
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

  function handlePrivateEmailChange(event) {
    const value = typeof event?.target?.value === 'string' ? event.target.value : '';
    setPrivateEmailValue(value);
    if (privateEmailError) {
      setPrivateEmailError('');
    }
  }

  function handlePrivateEmailCancel(event) {
    if (event) {
      event.preventDefault?.();
      event.stopPropagation?.();
    }
    if (busy) return;
    setPrivateEmailModalOpen(false);
    setPrivateEmailError('');
    pendingPrivateOptionsRef.current = null;
  }

  function submitPrivateEmail(event) {
    if (event) {
      event.preventDefault?.();
      event.stopPropagation?.();
    }
    if (busy) return;
    const normalized = typeof privateEmailValue === 'string' ? privateEmailValue.trim() : '';
    if (!EMAIL_PATTERN.test(normalized)) {
      setPrivateEmailError(PRIVATE_EMAIL_ERROR_MESSAGE);
      try {
        privateEmailInputRef.current?.focus?.();
      } catch (focusErr) {
        console.warn('[private-email-invalid-focus]', focusErr);
      }
      return;
    }
    if (normalized !== privateEmailValue) {
      setPrivateEmailValue(normalized);
    }
    if (normalized !== flow.customerEmail) {
      flow.set({ customerEmail: normalized });
    }
    setPrivateEmailModalOpen(false);
    setPrivateEmailError('');
    const pending = pendingPrivateOptionsRef.current;
    pendingPrivateOptionsRef.current = null;
    const pendingOptions = pending && typeof pending === 'object' ? pending.options || {} : {};
    setTimeout(() => {
      handle('private', pendingOptions);
    }, 0);
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
        <div className={styles.discountContainer}>
          <label htmlFor="discount-code" className={styles.discountLabel}>
            Cupón de descuento (Shopify)
          </label>
          <div className={styles.discountInputRow}>
            <input
              id="discount-code"
              type="text"
              autoComplete="off"
              placeholder="Escribí tu cupón si tenés uno"
              className={styles.discountInput}
              value={discountCode}
              onChange={(event) => setDiscountCode(event.target.value)}
              onBlur={() =>
                setDiscountCode((prev) => (typeof prev === 'string' ? prev.trim() : ''))
              }
              disabled={busy}
            />
            {normalizedDiscountCode ? (
              <button
                type="button"
                className={styles.discountClear}
                onClick={() => setDiscountCode('')}
                disabled={busy}
              >
                Limpiar
              </button>
            ) : null}
          </div>
          <p className={styles.discountHint}>
            Si tenés un cupón ingresalo acá y lo aplicamos automáticamente en Shopify.
          </p>
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
      {isPrivateEmailModalOpen ? (
        <div
          role="presentation"
          className={styles.modalBackdrop}
          onClick={handlePrivateEmailCancel}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby={privateEmailTitleId}
            aria-describedby={privateEmailDescriptionId}
            ref={privateModalRef}
            className={`${styles.modalCard} ${styles.modalForm}`}
            onClick={(event) => event.stopPropagation()}
            onSubmit={submitPrivateEmail}
          >
            <button
              type="button"
              onClick={handlePrivateEmailCancel}
              disabled={busy}
              aria-label="Cerrar"
              className={styles.modalClose}
            >
              ×
            </button>
            <h2 id={privateEmailTitleId} className={styles.modalTitle}>
              Comprar en privado
            </h2>
            <p id={privateEmailDescriptionId} className={styles.modalDescription}>
              Ingresá tu correo electrónico para continuar con la compra privada:
            </p>
            <div className={styles.modalField}>
              <label htmlFor="private-email" className={styles.modalLabel}>
                Correo electrónico
              </label>
              <input
                id="private-email"
                ref={privateEmailInputRef}
                type="email"
                className={`${styles.modalInput} ${privateEmailError ? styles.modalInputError : ''}`}
                value={privateEmailValue}
                onChange={handlePrivateEmailChange}
                autoComplete="email"
                disabled={busy}
                placeholder="nombre@ejemplo.com"
              />
              {privateEmailError ? (
                <p className={styles.modalError}>{privateEmailError}</p>
              ) : null}
            </div>
            <div className={styles.modalButtonRow}>
              <button
                type="submit"
                ref={privateModalPrimaryButtonRef}
                className={styles.modalPrimary}
                disabled={busy}
              >
                Aceptar
              </button>
              <button
                type="button"
                className={styles.modalSecondary}
                onClick={handlePrivateEmailCancel}
                disabled={busy}
              >
                Cancelar
              </button>
            </div>
          </form>
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
