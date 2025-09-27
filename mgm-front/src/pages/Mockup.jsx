import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PDFDocument } from 'pdf-lib';
import Toast from '@/components/Toast.jsx';
import { useFlow } from '@/state/flow.js';
import { downloadBlob } from '@/lib/mockup.js';
import styles from './Mockup.module.css';
import { buildExportBaseName } from '@/lib/filename.ts';
import { apiFetch } from '@/lib/api.ts';
import {
  createJobAndProduct,
  ONLINE_STORE_DISABLED_MESSAGE,
  ONLINE_STORE_MISSING_MESSAGE,
  normalizeVariantNumericId,
} from '@/lib/shopify.ts';

const CART_STATUS_LABELS = {
  idle: 'Agregar al carrito',
  creating: 'Creando producto…',
  adding: 'Agregando al carrito…',
  opening: 'Abriendo carrito…',
};

const CART_DEFAULT_QUANTITY = 1;
const IS_DEV = Boolean(import.meta?.env?.DEV);

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
  const successToastTimeoutRef = useRef(null);

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
    if (!toast?.persist) {
      setToast(null);
    }
    setPendingCart(null);
    setCartStatus('idle');
    setBusy(false);
    setBuyPromptOpen(false);
    wasModalOpenedRef.current = false;
  }, [flow.mockupUrl, toast?.persist]);

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

  useEffect(() => {
    return () => {
      if (successToastTimeoutRef.current) {
        clearTimeout(successToastTimeoutRef.current);
        successToastTimeoutRef.current = null;
      }
    };
  }, []);

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
    else if (reasonRaw === 'missing_product_handle') friendly = 'No pudimos confirmar la URL del producto en Shopify.';
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
      if (Array.isArray(error?.userErrors) && error.userErrors.length) {
        friendly = `Shopify rechazó el carrito generado: ${error.userErrors.join(' | ')}`;
      } else if (messageRaw && messageRaw !== 'Error') {
        friendly = messageRaw;
      } else {
        friendly = 'Shopify rechazó el carrito generado. Intentá nuevamente en unos segundos.';
      }
    }
    alert(friendly);
  }

  function openCartTab(url) {
    if (typeof window === 'undefined' || !url) return false;
    try {
      const popup = window.open(url, '_blank', 'noopener,noreferrer');
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

  function showCartFailureToast(url, options = {}) {
    const fallbackUrl = typeof options.fallbackUrl === 'string' ? options.fallbackUrl : '';
    const hasPrimary = typeof url === 'string' && url.trim().length > 0;
    const hasFallback = typeof fallbackUrl === 'string' && fallbackUrl.trim().length > 0;
    if (!hasPrimary && !hasFallback) {
      setToast({ message: 'No pudimos agregarlo al carrito. Probá de nuevo.' });
      return;
    }
    const nextUrl = hasFallback && (!hasPrimary || fallbackUrl !== url) ? fallbackUrl : url;
    const useFallback = hasFallback && nextUrl === fallbackUrl && fallbackUrl !== url;
    setToast({
      message: 'No pudimos agregarlo al carrito. Probá de nuevo.',
      actionLabel: 'Reintentar',
      action: () => attemptOpenCart(nextUrl, { useFallback }),
    });
  }

  function finalizeCartSuccess(message) {
    if (successToastTimeoutRef.current) {
      clearTimeout(successToastTimeoutRef.current);
      successToastTimeoutRef.current = null;
    }
    setPendingCart(null);
    if (message) {
      setToast({ message, persist: true, tone: 'success' });
      successToastTimeoutRef.current = setTimeout(() => {
        setToast((currentToast) => (currentToast?.persist ? null : currentToast));
        successToastTimeoutRef.current = null;
      }, 4000);
    } else {
      setToast(null);
    }
    setCartStatus('idle');
    setBusy(false);
    flow.reset();
    try {
      navigate('/', { replace: true });
    } catch (navErr) {
      console.warn('[cart-success-navigate]', navErr);
    }
  }

  function openCartAndFinalize(url, context = {}) {
    if (!url) return false;
    setBusy(true);
    setCartStatus('opening');
    if (IS_DEV) {
      try {
        console.info('[cart-flow] open_cart_link', {
          variantNumericId: context?.variantNumericId || null,
          openUrl: url,
        });
      } catch (logErr) {
        console.debug?.('[cart-flow] open_cart_link_log_failed', logErr);
      }
    }
    const opened = openCartTab(url);
    if (opened) {
      try {
        console.info('[cart-flow] cart_opened', { url });
      } catch (logErr) {
        console.debug?.('[cart-flow] cart_opened_log_failed', logErr);
      }
      finalizeCartSuccess(context?.successMessage || 'Producto agregado. Abrimos tu carrito.');
      return true;
    }
    try {
      console.warn('[cart-flow] cart_error', { reason: 'popup_blocked', url });
    } catch (logErr) {
      console.debug?.('[cart-flow] cart_error_log_failed', logErr);
    }
    setCartStatus('idle');
    setBusy(false);
    const fallbackUrl = typeof context?.fallbackUrl === 'string' ? context.fallbackUrl : '';
    showCartFailureToast(url, { fallbackUrl });
    return false;
  }

  function attemptOpenCart(url, options = {}) {
    const cart = pendingCart;
    if (!cart) return;
    const useFallback = Boolean(options.useFallback);
    let link = url;
    if (!link) {
      link = useFallback ? cart.fallbackUrl : cart.webUrl;
    }
    if (!link) return;
    const fallbackUrl = useFallback
      ? undefined
      : cart.fallbackUrl && cart.fallbackUrl !== link
        ? cart.fallbackUrl
        : undefined;
    if (!link) return;
    openCartAndFinalize(link, {
      variantNumericId: cart?.variantNumericId || null,
      fallbackUrl,
    });
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
    if (busy && cartStatus !== 'idle' && !skipCreation) return;
    setToast(null);
    let current = pendingCart;
    if (current?.variantId && (!current.variantIdNumeric || !current.variantIdGid)) {
      const ensuredNumeric = normalizeVariantNumericId(current.variantIdNumeric || current.variantId);
      const ensuredGid = ensuredNumeric ? `gid://shopify/ProductVariant/${ensuredNumeric}` : '';
      current = {
        ...current,
        ...(ensuredNumeric ? { variantIdNumeric: ensuredNumeric } : {}),
        ...(ensuredGid ? { variantIdGid: ensuredGid } : {}),
      };
      setPendingCart(current);
    }
    const normalizedDiscountCode = discountCode || '';
    const creationCartOptions = normalizedDiscountCode ? { discountCode: normalizedDiscountCode } : {};
    try {
      setBusy(true);
      if (!skipCreation || !current) {
        setCartStatus('creating');
        const result = await createJobAndProduct(
          'cart',
          flow,
          skipCreation
            ? { reuseLastProduct: true, ...(normalizedDiscountCode ? { discountCode: normalizedDiscountCode } : {}) }
            : creationCartOptions,
        );
        if (!result?.variantId) throw new Error('missing_variant');
        const warningMessages = extractWarningMessages(result?.warnings, result?.warningMessages);
        if (warningMessages.length) {
          if (IS_DEV) {
            try {
              console.warn('[cart-flow] warnings', warningMessages);
            } catch (warnErr) {
              console.debug?.('[cart-flow] warn_log_failed', warnErr);
            }
          }
          setToast({ message: warningMessages.join(' ') });
        }
        current = {
          productId: result.productId,
          variantId: result.variantId,
          variantIdNumeric: result.variantIdNumeric
            || normalizeVariantNumericId(result.variantId),
          variantIdGid:
            result.variantIdGid
            || (result.variantIdNumeric
              ? `gid://shopify/ProductVariant/${result.variantIdNumeric}`
              : ''),
          quantity: CART_DEFAULT_QUANTITY,
          ...(result?.productHandle ? { productHandle: result.productHandle } : {}),
        };
        setPendingCart(current);
      }
      if (!current?.variantId) throw new Error('missing_variant');

      const startLogVariantNumeric = current.variantIdNumeric
        || normalizeVariantNumericId(current.variantId);
      const startLogVariantGid = current.variantIdGid
        || (startLogVariantNumeric ? `gid://shopify/ProductVariant/${startLogVariantNumeric}` : '');
      try {
        console.info('[cart-flow] cart_flow_start', {
          productId: current.productId || null,
          variantIdNumeric: startLogVariantNumeric || null,
          variantIdGid: startLogVariantGid || null,
          handle: current.productHandle || null,
        });
      } catch (logErr) {
        console.debug?.('[cart-flow] cart_flow_start_log_failed', logErr);
      }

      setCartStatus('adding');

      const desiredQuantity = current.quantity || CART_DEFAULT_QUANTITY;
      const variantNumericId = current.variantIdNumeric || normalizeVariantNumericId(current.variantId);
      if (!variantNumericId) {
        setCartStatus('idle');
        setBusy(false);
        showCartFailureToast('', { fallbackUrl: current?.fallbackUrl });
        return;
      }
      const variantGidForCart = current.variantIdGid
        || (variantNumericId ? `gid://shopify/ProductVariant/${variantNumericId}` : '');
      if (!variantGidForCart) {
        setCartStatus('idle');
        setBusy(false);
        showCartFailureToast('', { fallbackUrl: current?.fallbackUrl });
        return;
      }

      const productHandle = typeof current.productHandle === 'string' ? current.productHandle : '';
      let fallbackProductUrl = typeof current.fallbackUrl === 'string' ? current.fallbackUrl : '';
      if (!fallbackProductUrl && productHandle) {
        const variantSuffix = variantNumericId ? `?variant=${variantNumericId}` : '';
        fallbackProductUrl = `https://www.mgmgamers.store/products/${productHandle}${variantSuffix}`;
      }

      const payload = current.cartId
        ? { cartId: current.cartId, variantGid: variantGidForCart, quantity: desiredQuantity }
        : { variantGid: variantGidForCart, quantity: desiredQuantity };
      const endpoint = current.cartId ? '/api/cart/add' : '/api/cart/start';

      let resp;
      try {
        resp = await apiFetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (networkErr) {
        console.error('[cart-flow] cart_request_failed', networkErr);
        setCartStatus('idle');
        setBusy(false);
        showCartFailureToast('', { fallbackUrl: fallbackProductUrl });
        return;
      }

      let json = null;
      try {
        json = await resp.json();
      } catch (parseErr) {
        console.warn('[cart-flow] cart_response_parse_failed', parseErr);
      }

      const cartWebUrl = json?.cartWebUrl && typeof json.cartWebUrl === 'string'
        ? json.cartWebUrl
        : '';
      const fallbackUrlFromServer = json?.fallbackUrl && typeof json.fallbackUrl === 'string'
        ? json.fallbackUrl
        : '';

      if (resp.ok && json?.ok) {
        const nextState = {
          ...current,
          variantNumericId,
          variantIdNumeric: variantNumericId,
          variantIdGid: variantGidForCart,
          ...(cartWebUrl ? { webUrl: cartWebUrl } : {}),
          ...(json?.cartId ? { cartId: json.cartId } : {}),
          ...(fallbackProductUrl ? { fallbackUrl: fallbackProductUrl } : {}),
        };
        setPendingCart(nextState);
        const successMessage = 'Producto agregado. Abrimos tu carrito.';
        const opened = openCartAndFinalize(cartWebUrl || 'https://www.mgmgamers.store/cart', {
          variantNumericId,
          fallbackUrl: fallbackProductUrl || undefined,
          successMessage,
        });
        if (opened) {
          return;
        }
        if (fallbackUrlFromServer) {
          const fallbackOpened = openCartAndFinalize(fallbackUrlFromServer, {
            variantNumericId,
            fallbackUrl: fallbackProductUrl || undefined,
            successMessage,
          });
          if (fallbackOpened) {
            return;
          }
        }
        setCartStatus('idle');
        setBusy(false);
        showCartFailureToast('', { fallbackUrl: fallbackProductUrl });
        return;
      }

      if (fallbackUrlFromServer) {
        const fallbackOpened = openCartAndFinalize(fallbackUrlFromServer, {
          variantNumericId,
          fallbackUrl: fallbackProductUrl || undefined,
        });
        if (fallbackOpened) {
          return;
        }
      }

      setCartStatus('idle');
      setBusy(false);
      showCartFailureToast('', { fallbackUrl: fallbackProductUrl });
      return;
    } catch (err) {
      setCartStatus('idle');
      setBusy(false);
      if (err?.name === 'AbortError') return;
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
