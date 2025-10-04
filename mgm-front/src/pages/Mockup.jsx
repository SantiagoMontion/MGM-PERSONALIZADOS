import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PDFDocument } from 'pdf-lib';
import Toast from '@/components/Toast.jsx';
import { useFlow } from '@/state/flow.js';
import { downloadBlob } from '@/lib/mockup.js';
import styles from './Mockup.module.css';
import { buildExportBaseName } from '@/lib/filename.ts';
import { apiFetch, getResolvedApiUrl } from '@/lib/api.ts';
import {
  createJobAndProduct,
  ONLINE_STORE_DISABLED_MESSAGE,
  ONLINE_STORE_MISSING_MESSAGE,
  pickCommerceTarget,
} from '@/lib/shopify.ts';
import logger from '../lib/logger';
import { trackEvent } from '@/lib/tracking';

/** NUEVO: imagen de la sección (reemplazá el path por el tuyo) */
const TESTIMONIAL_ICONS = [
  '/icons/testimonio1.png',
  '/icons/testimonio2.png',
  '/icons/testimonio3.png',
];
const COMMUNITY_HERO_IMAGE = '/icons/community-hero.png';
const CART_STATUS_LABELS = {
  idle: 'Agregar al carrito',
  creating: 'Creando producto…',
  opening: 'Abriendo producto…',
};

const SHOPIFY_DOMAIN = (() => {
  const fromImportMeta =
    typeof import.meta !== 'undefined'
    && import.meta?.env
    && typeof import.meta.env.VITE_SHOPIFY_DOMAIN === 'string'
      ? import.meta.env.VITE_SHOPIFY_DOMAIN
      : '';
  const fromProcess =
    typeof process !== 'undefined'
    && process?.env
    && typeof process.env.VITE_SHOPIFY_DOMAIN === 'string'
      ? process.env.VITE_SHOPIFY_DOMAIN
      : '';
  const raw = (fromImportMeta || fromProcess || '').trim();
  if (!raw) return '';
  return raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
})();

const SHOULD_LOG_COMMERCE = (() => {
  const fromImportMeta =
    typeof import.meta !== 'undefined'
    && import.meta?.env
    && typeof import.meta.env.VITE_LOG_COMMERCE === 'string'
      ? import.meta.env.VITE_LOG_COMMERCE
      : '';
  const fromProcess =
    typeof process !== 'undefined'
    && process?.env
    && typeof process.env.VITE_LOG_COMMERCE === 'string'
      ? process.env.VITE_LOG_COMMERCE
      : '';
  const normalized = (fromImportMeta || fromProcess || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized === '1'
    || normalized === 'true'
    || normalized === 'yes'
    || normalized === 'on';
})();

const BENEFITS = [
  {
    icon: '',
    title: '🎁 Regalos sorpresa en cada pedido',
    description: 'Cada compra merece un mimo extra <3',
  },
  {
    icon: '',
    title: '✅ Durabilidad y calidad garantizada',
    description: 'Materiales seleccionados, costuras reforzadas y tests reales. Tu pad está hecho para durar.',
  },
  {
    icon: '',
    title: '🎨 Un mousepad que se adapta perfecto a tu setup',
    description: 'Material, diseño y medida elegidos por vos.',
  },
];

function generateRidSuffix(length = 12) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const targetLength = Number.isFinite(length) && length > 0 ? Math.floor(length) : 12;
  let output = '';
  const cryptoObj =
    typeof window !== 'undefined'
    && window.crypto
    && typeof window.crypto.getRandomValues === 'function'
      ? window.crypto
      : null;
  if (cryptoObj) {
    const buffer = new Uint32Array(targetLength);
    cryptoObj.getRandomValues(buffer);
    for (const value of buffer) {
      output += alphabet[value % alphabet.length];
    }
    return output;
  }
  for (let i = 0; i < targetLength; i += 1) {
    const index = Math.floor(Math.random() * alphabet.length);
    output += alphabet[index];
  }
  return output;
}

export default function Mockup() {
  const flow = useFlow();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [cartStatus, setCartStatus] = useState('idle');
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
        logger.warn('[mockup-discount-storage-read]', storageErr);
        return '';
      }
    } catch (err) {
      logger.warn('[mockup-discount-parse]', err);
      return '';
    }
  }, [location.search]);

  const normalizeOptionalString = (value) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? trimmed : undefined;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return undefined;
  };

  const pickFirstString = (...values) => {
    for (const value of values) {
      const normalized = normalizeOptionalString(value);
      if (normalized) return normalized;
    }
    return undefined;
  };

  const rid =
    pickFirstString(
      flow?.uploadDiagId,
      flow?.editorState?.upload_diag_id,
      flow?.editorState?.diag_id,
      flow?.editorState?.job?.rid,
      flow?.editorState?.job?.diag_id,
      flow?.editorState?.job?.request_id,
    )
    || (typeof window !== 'undefined' ? ensureRid() : undefined);

  const designSlug = pickFirstString(
    flow?.editorState?.design?.slug,
    flow?.editorState?.design_slug,
    flow?.editorState?.designSlug,
    flow?.editorState?.job?.design_slug,
    flow?.editorState?.job?.slug,
    flow?.lastProduct?.productHandle,
  );

  const lastProduct = flow?.lastProduct || null;
  const lastProductId = pickFirstString(lastProduct?.productId, lastProduct?.id);
  const lastVariantId = pickFirstString(
    lastProduct?.variantId,
    lastProduct?.variant_id,
    lastProduct?.variantIdNumeric,
    lastProduct?.variantIdGid,
  );

  const mockupUrl = flow.mockupUrl;

  function ensureRid() {
    if (typeof window === 'undefined') {
      return null;
    }

    const globalRid = typeof window.__RID === 'string' ? window.__RID.trim() : '';
    if (globalRid) {
      return globalRid;
    }

    let storedRid = '';
    try {
      if (window.localStorage) {
        storedRid = window.localStorage.getItem('rid') || '';
      }
    } catch (storageErr) {
      logger.warn('[mockup-rid-storage-read]', storageErr);
    }
    const normalizedStored = typeof storedRid === 'string' ? storedRid.trim() : '';
    if (normalizedStored) {
      window.__RID = normalizedStored;
      return normalizedStored;
    }

    const suffixLength = 12 + Math.floor(Math.random() * 5);
    const generated = `mgad${generateRidSuffix(suffixLength)}`;
    window.__RID = generated;
    try {
      if (window.localStorage) {
        window.localStorage.setItem('rid', generated);
      }
    } catch (storageErr) {
      logger.warn('[mockup-rid-storage-write]', storageErr);
    }
    return generated;
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const resolvedRid = ensureRid();
    if (!resolvedRid) return;

    let storedFlag = '';
    try {
      if (window.sessionStorage) {
        storedFlag = window.sessionStorage.getItem('mockup_view_sent') || '';
      }
    } catch (storageErr) {
      logger.warn('[mockup-view-flag-read]', storageErr);
    }
    if (storedFlag === resolvedRid) {
      return;
    }

    trackEvent('mockup_view', {
      rid: resolvedRid,
      design_slug: designSlug,
    });
    try {
      if (window.sessionStorage) {
        window.sessionStorage.setItem('mockup_view_sent', resolvedRid);
      }
    } catch (storageErr) {
      logger.warn('[mockup-view-flag-write]', storageErr);
    }
  }, [designSlug, rid]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const resolvedRid = ensureRid() || rid;
    if (!resolvedRid) return;

    const purchaseOptionsVisible = Boolean(mockupUrl);
    if (!purchaseOptionsVisible) {
      return;
    }

    const flagKey = `view_opts_sent_${resolvedRid}`;
    let storedFlag = '';
    try {
      if (window.sessionStorage) {
        storedFlag = window.sessionStorage.getItem(flagKey) || '';
      }
    } catch (storageErr) {
      logger.warn('[mockup-view-options-flag-read]', storageErr);
    }
    if (storedFlag === '1') {
      return;
    }

    trackEvent('view_purchase_options', {
      rid: resolvedRid,
      design_slug: designSlug,
    });
    try {
      if (window.sessionStorage) {
        window.sessionStorage.setItem(flagKey, '1');
      }
    } catch (storageErr) {
      logger.warn('[mockup-view-options-flag-write]', storageErr);
    }
  }, [designSlug, mockupUrl, rid]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (discountCode) {
        window.sessionStorage.setItem('MGM_discountCode', discountCode);
      } else {
        window.sessionStorage.removeItem('MGM_discountCode');
      }
    } catch (err) {
      logger.warn('[mockup-discount-storage-write]', err);
    }
  }, [discountCode]);

  useEffect(() => {
    if (!toast?.persist) {
      setToast(null);
    }
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
        logger.warn('[buy-prompt-focus]', focusErr);
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
      logger.warn('[buy-prompt-return-focus]', focusErr);
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
            logger.warn('[buy-prompt-trap-focus]', focusErr);
          }
        }
      } else {
        if (active === last) {
          event.preventDefault();
          try {
            first.focus();
          } catch (focusErr) {
            logger.warn('[buy-prompt-trap-focus]', focusErr);
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
    logger.error('[mockup]', error);
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
    else if (reasonRaw === 'private_checkout_failed' || reasonRaw === 'draft_order_failed' || reasonRaw === 'draft_order_http_error' || reasonRaw === 'missing_invoice_url') {
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

  function finalizeCartSuccess(message, options = {}) {
    const {
      preserveLastProduct = false,
      lastProductOverride = null,
      skipNavigate = false,
    } = options;
    const lastProductToPreserve = preserveLastProduct
      ? lastProductOverride || flow.lastProduct || null
      : null;
    if (successToastTimeoutRef.current) {
      clearTimeout(successToastTimeoutRef.current);
      successToastTimeoutRef.current = null;
    }
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
    if (lastProductToPreserve) {
      flow.set({ lastProduct: lastProductToPreserve });
    }
    if (!skipNavigate) {
      try {
        navigate('/', { replace: true });
      } catch (navErr) {
        logger.warn('[mockup] cart_success_navigate_failed', navErr);
      }
    }
  }

  function openCommerceTarget(targetUrl) {
    if (typeof window === 'undefined') return false;
    if (!targetUrl || typeof targetUrl !== 'string') return false;
    const trimmed = targetUrl.trim();
    if (!trimmed) return false;
    try {
      const urlInstance = new URL(trimmed, window.location.href);
      const isSameOrigin = urlInstance.origin === window.location.origin;
      if (isSameOrigin) {
        const relative = `${urlInstance.pathname}${urlInstance.search}${urlInstance.hash}` || '/';
        try {
          navigate(relative, { replace: false });
        } catch (navErr) {
          logger.warn('[mockup] internal_navigation_failed', navErr);
          window.location.assign(urlInstance.toString());
        }
        return true;
      }
      const opened = window.open(urlInstance.toString(), '_blank');
      if (opened) {
        return true;
      }
      window.location.assign(urlInstance.toString());
      return true;
    } catch (navErr) {
      logger.warn('[mockup] commerce_navigation_failed', navErr);
      try {
        window.location.assign(trimmed);
        return true;
      } catch (assignErr) {
        logger.warn('[mockup] commerce_navigation_assign_failed', assignErr);
      }
    }
    return false;
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

  async function startCartFlow() {
    if (busy && cartStatus !== 'idle') return;
    setToast(null);
    setCartStatus('creating');
    setBusy(true);
    let didOpenTarget = false;
    try {
      const normalizedDiscountCode = discountCode || '';
      const creationCartOptions = normalizedDiscountCode ? { discountCode: normalizedDiscountCode } : {};
      const result = await createJobAndProduct('cart', flow, creationCartOptions);
      if (SHOULD_LOG_COMMERCE) {
        try {
          const jsonForLog = result && typeof result === 'object' ? result : null;
          logger.debug('[commerce]', {
            tag: 'startCartFlow:publish',
            json: jsonForLog,
            keys: jsonForLog ? Object.keys(jsonForLog) : [],
            busy,
            cartStatus,
          });
        } catch (logErr) {
          logger.warn('[mockup] cart_publish_log_failed', logErr);
        }
      }
      const warningMessages = extractWarningMessages(result?.warnings, result?.warningMessages);
      if (warningMessages.length) {
        try {
          logger.warn('[mockup] cart_flow_warnings', warningMessages);
        } catch (warnErr) {
          logger.debug('[mockup] cart_flow_warn_log_failed', warnErr);
        }
        setToast({ message: warningMessages.join(' ') });
      }

      const jsonCandidates = [];
      if (result && typeof result === 'object') {
        if (result.raw && typeof result.raw === 'object') {
          jsonCandidates.push(result.raw);
        }
        jsonCandidates.push(result);
      }
      let directTarget = '';
      for (const candidate of jsonCandidates) {
        if (!candidate || typeof candidate !== 'object') continue;
        for (const key of ['productUrl', 'checkoutUrl', 'url']) {
          const value = typeof candidate?.[key] === 'string' ? candidate[key].trim() : '';
          if (value) {
            directTarget = value;
            break;
          }
        }
        if (directTarget) {
          break;
        }
      }
      if (directTarget) {
        didOpenTarget = openCommerceTarget(directTarget) || didOpenTarget;
        setCartStatus('idle');
        return;
      }

      const SHOPIFY_DOMAIN = import.meta.env.VITE_SHOPIFY_DOMAIN || '';
      const tgt = pickCommerceTarget(result, SHOPIFY_DOMAIN);
      if (tgt) {
        const opened = openCommerceTarget(tgt);
        didOpenTarget = opened || didOpenTarget;
        if (opened) {
          setCartStatus('idle');
          return;
        }
      }

      const productUrlFromResult =
        typeof result?.productUrl === 'string' && result.productUrl.trim()
          ? result.productUrl.trim()
          : '';
      const checkoutUrlFromResult =
        typeof result?.checkoutUrl === 'string' && result.checkoutUrl.trim()
          ? result.checkoutUrl.trim()
          : '';
      const genericUrlFromResult =
        typeof result?.url === 'string' && result.url.trim()
          ? result.url.trim()
          : typeof result?.product?.url === 'string' && result.product.url.trim()
            ? result.product.url.trim()
            : '';
      const handleFromResult =
        typeof result?.productHandle === 'string' && result.productHandle.trim()
          ? result.productHandle.trim()
          : typeof result?.handle === 'string' && result.handle.trim()
            ? result.handle.trim()
            : typeof result?.product?.handle === 'string' && result.product.handle.trim()
              ? result.product.handle.trim()
              : '';

      const fallbackFromHandle =
        SHOPIFY_DOMAIN && handleFromResult
          ? `https://${SHOPIFY_DOMAIN}/products/${encodeURIComponent(handleFromResult)}`
          : null;

      const targetUrl =
        productUrlFromResult
        || checkoutUrlFromResult
        || genericUrlFromResult
        || fallbackFromHandle;

      if (!targetUrl) {
        const missingTargetError = new Error('Missing target url');
        missingTargetError.reason = 'missing_target_url';
        throw missingTargetError;
      }

      setCartStatus('opening');
      if (typeof window !== 'undefined') {
        const navigationPayload = {
          productUrl: productUrlFromResult || null,
          checkoutUrl: checkoutUrlFromResult || null,
          url: genericUrlFromResult || null,
          handle: handleFromResult || null,
          target: targetUrl,
        };
        console.debug('[publish/add-to-cart]', navigationPayload);
        const opened = openCommerceTarget(targetUrl);
        didOpenTarget = opened || didOpenTarget;
        if (!opened) {
          const navigationError = new Error('navigation_failed');
          navigationError.reason = 'navigation_failed';
          throw navigationError;
        }
      }

      finalizeCartSuccess('Abrimos la página del producto para que lo agregues al carrito.', {
        skipNavigate: didOpenTarget,
      });
      return;
    } catch (err) {
      setCartStatus('idle');
      if (err?.name === 'AbortError') return;
      showFriendlyError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handle(mode, options = {}) {
    if (mode !== 'checkout' && mode !== 'cart' && mode !== 'private') return;

    let privateStageCallback = null;

    if (mode === 'cart') {
      await startCartFlow();
      return;
    }

    if (busy) return;

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
        privateStageCallback = stageCallback;
        setToast({ message: 'Creando producto privado…' });
        jobOptions = { ...options, onPrivateStageChange: stageCallback, skipPrivateCheckout: true };
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
          logger.warn(`[${mode}-flow] warnings`, warningMessages);
        } catch (warnErr) {
          logger.debug('[handle] warn_log_failed', warnErr);
        }
        setToast({ message: warningMessages.join(' ') });
      }
      const jsonCandidates = [];
      if (result && typeof result === 'object') {
        if (result.raw && typeof result.raw === 'object') {
          jsonCandidates.push(result.raw);
        }
        jsonCandidates.push(result);
      }
      if (mode === 'checkout') {
        if (SHOULD_LOG_COMMERCE) {
          const checkoutJson = result && typeof result === 'object' ? result.publicCheckoutResponse : null;
          try {
            logger.debug('[commerce]', {
              tag: 'public-checkout',
              status: typeof result?.publicCheckoutStatus === 'number' ? result.publicCheckoutStatus : null,
              keys:
                checkoutJson && typeof checkoutJson === 'object'
                  ? Object.keys(checkoutJson)
                  : [],
              checkoutUrl:
                checkoutJson && typeof checkoutJson === 'object'
                  ? (typeof checkoutJson.checkoutUrl === 'string' && checkoutJson.checkoutUrl.trim()
                    ? checkoutJson.checkoutUrl.trim()
                    : typeof checkoutJson.url === 'string' && checkoutJson.url.trim()
                      ? checkoutJson.url.trim()
                      : null)
                  : null,
              diagId:
                checkoutJson && typeof checkoutJson.diagId === 'string' && checkoutJson.diagId
                  ? checkoutJson.diagId
                  : null,
            });
          } catch (logErr) {
            logger.warn('[checkout] public_log_failed', logErr);
          }
        }
        let checkoutTarget = '';
        let directUrlTarget = '';
        let productUrlCandidate = '';
        const handleCandidates = [];
        for (const candidate of jsonCandidates) {
          if (!candidate || typeof candidate !== 'object') continue;
          if (!checkoutTarget) {
            const checkoutUrlValue =
              typeof candidate?.checkoutUrl === 'string' && candidate.checkoutUrl.trim()
                ? candidate.checkoutUrl.trim()
                : '';
            if (checkoutUrlValue) {
              checkoutTarget = checkoutUrlValue;
            }
          }
          if (!directUrlTarget) {
            const urlValue = typeof candidate?.url === 'string' && candidate.url.trim() ? candidate.url.trim() : '';
            if (urlValue) {
              directUrlTarget = urlValue;
            }
          }
          if (!productUrlCandidate) {
            const productUrlValue =
              typeof candidate?.productUrl === 'string' && candidate.productUrl.trim()
                ? candidate.productUrl.trim()
                : '';
            if (productUrlValue) {
              productUrlCandidate = productUrlValue;
            }
          }
          const handleValue =
            typeof candidate?.productHandle === 'string' && candidate.productHandle.trim()
              ? candidate.productHandle.trim()
              : typeof candidate?.handle === 'string' && candidate.handle.trim()
                ? candidate.handle.trim()
                : '';
          if (handleValue) {
            handleCandidates.push(handleValue);
          }
        }
        if (typeof result?.productHandle === 'string' && result.productHandle.trim()) {
          handleCandidates.push(result.productHandle.trim());
        }
        const primaryTarget = checkoutTarget || directUrlTarget;
        if (primaryTarget) {
          if (typeof window !== 'undefined') {
            let popup = null;
            try {
              popup = window.open(primaryTarget, '_blank');
            } catch (openErr) {
              logger.warn('[checkout] popup_open_failed', openErr);
            }
            if (popup == null) {
              try {
                window.location.assign(primaryTarget);
                return finalizeCartSuccess('Listo. Abrimos tu checkout en otra pestaña.', {
                  skipNavigate: true,
                });
              } catch (assignErr) {
                logger.warn('[checkout] location_assign_failed', assignErr);
              }
            }
          }
          finalizeCartSuccess('Listo. Abrimos tu checkout en otra pestaña.', {
            skipNavigate: true,
          });
          return;
        }
        let fallbackTarget = productUrlCandidate;
        if (!fallbackTarget) {
          const handleCandidate = handleCandidates.find((entry) => typeof entry === 'string' && entry.trim());
          if (handleCandidate && SHOPIFY_DOMAIN) {
            const normalizedHandle = handleCandidate.trim().replace(/^\/+/, '').replace(/\/+$/, '');
            fallbackTarget = `https://${SHOPIFY_DOMAIN}/products/${normalizedHandle}`;
          }
        }
        if (!fallbackTarget) {
          fallbackTarget = pickCommerceTarget(result, SHOPIFY_DOMAIN)
            || pickCommerceTarget(flow?.lastProduct || {}, SHOPIFY_DOMAIN);
        }
        if (fallbackTarget) {
          const opened = openCommerceTarget(fallbackTarget);
          if (!opened) {
            const navigationError = new Error('checkout_navigation_failed');
            navigationError.reason = 'checkout_navigation_failed';
            throw navigationError;
          }
          finalizeCartSuccess('Listo. Abrimos tu checkout en otra pestaña.', {
            skipNavigate: true,
          });
          return;
        }
      }
      if (mode === 'private') {
        const variantIdForCheckout = typeof result?.variantId === 'string' ? result.variantId : '';
        if (!variantIdForCheckout) {
          throw new Error('missing_variant');
        }
        try {
          privateStageCallback?.('creating_checkout');
        } catch (stageErr) {
          logger.debug('[private-checkout] stage_callback_failed', stageErr);
        }
        const payloadFromResult = result?.privateCheckoutPayload && typeof result.privateCheckoutPayload === 'object'
          ? result.privateCheckoutPayload
          : {};
        const privatePayload = {
          quantity: 1,
          ...(result?.productId ? { productId: result.productId } : {}),
          ...payloadFromResult,
          variantId: payloadFromResult?.variantId || variantIdForCheckout,
        };
        if (!privatePayload.variantId) {
          privatePayload.variantId = variantIdForCheckout;
        }
        if (!privatePayload.quantity || Number(privatePayload.quantity) <= 0) {
          privatePayload.quantity = 1;
        }
        const emailCandidate = typeof submissionFlow.customerEmail === 'string'
          ? submissionFlow.customerEmail.trim()
          : '';
        if (emailCandidate && !privatePayload.email) {
          privatePayload.email = emailCandidate;
        }
        const privateEndpoint = '/api/private/checkout';
        let resolvedPrivateCheckoutUrl = '';
        try {
          resolvedPrivateCheckoutUrl = getResolvedApiUrl(privateEndpoint);
        } catch (resolveErr) {
          logger.warn('[private-checkout] resolve_failed', resolveErr);
        }
        let privateResp;
        try {
          privateResp = await apiFetch(privateEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(privatePayload),
          });
        } catch (requestErr) {
          const missingApiUrl = (requestErr?.code || requestErr?.cause?.code) === 'missing_api_url';
          if (missingApiUrl) {
            const err = new Error('private_checkout_missing_api_url');
            err.reason = 'private_checkout_missing_api_url';
            err.friendlyMessage = 'Configurá VITE_API_URL para conectar con la API.';
            throw err;
          }
          const err = new Error('private_checkout_network_error');
          err.reason = 'private_checkout_network_error';
          err.friendlyMessage = 'No pudimos generar el checkout privado. Probá de nuevo en unos segundos.';
          err.detail = requestErr?.message || null;
          throw err;
        }
        const contentType = (privateResp.headers?.get?.('content-type') || '').toLowerCase();
        const rawBody = await privateResp.text();
        let privateJson = null;
        if (contentType.includes('application/json')) {
          try {
            privateJson = rawBody ? JSON.parse(rawBody) : null;
          } catch (parseErr) {
            privateJson = null;
            logger.warn('[private-checkout] json_parse_failed', parseErr);
          }
        } else {
          logger.error('[private-checkout] non_json_response', {
            status: privateResp.status,
            contentType,
            bodyPreview: typeof rawBody === 'string' ? rawBody.slice(0, 200) : '',
            url: privateResp.url || resolvedPrivateCheckoutUrl || null,
          });
        }
        const logError = (label) => {
          try {
            logger.error(`[private-checkout] ${label}`, {
              status: privateResp.status,
              contentType,
              bodyPreview: typeof rawBody === 'string' ? rawBody.slice(0, 200) : '',
              url: privateResp.url || resolvedPrivateCheckoutUrl || null,
            });
          } catch (logErr) {
            logger.debug('[private-checkout] log_failed', logErr);
          }
        };
        const buildError = (reason) => {
          const err = new Error(reason);
          err.reason = reason;
          if (typeof privateResp.status === 'number') {
            err.status = privateResp.status;
          }
          if (privateJson && typeof privateJson === 'object') {
            if (Array.isArray(privateJson?.missing) && privateJson.missing.length) {
              err.missing = privateJson.missing;
            }
            if (Array.isArray(privateJson?.userErrors) && privateJson.userErrors.length) {
              err.userErrors = privateJson.userErrors;
            }
            if (privateJson?.detail) {
              err.detail = privateJson.detail;
            }
            if (typeof privateJson?.requestId === 'string') {
              err.requestId = privateJson.requestId;
            }
            if (Array.isArray(privateJson?.requestIds) && privateJson.requestIds.length) {
              err.requestIds = privateJson.requestIds;
            }
            const message = typeof privateJson?.message === 'string' ? privateJson.message.trim() : '';
            err.friendlyMessage = message || 'No pudimos generar el checkout privado, probá de nuevo.';
          } else {
            err.friendlyMessage = 'No pudimos generar el checkout privado, probá de nuevo.';
          }
          if (!err.detail && typeof rawBody === 'string' && rawBody) {
            err.detail = rawBody.slice(0, 200);
          }
          return err;
        };
        if (!privateResp.ok) {
          logError('http_error');
          const reason =
            privateJson?.reason && typeof privateJson.reason === 'string' && privateJson.reason.trim()
              ? privateJson.reason.trim()
              : 'private_checkout_failed';
          throw buildError(reason);
        }
        if (!privateJson || typeof privateJson !== 'object') {
          logError('non_json_payload');
          throw buildError('private_checkout_non_json');
        }
        const checkoutUrlFromResponse = typeof privateJson.url === 'string' && privateJson.url.trim()
          ? privateJson.url.trim()
          : typeof privateJson.invoiceUrl === 'string' && privateJson.invoiceUrl.trim()
            ? privateJson.invoiceUrl.trim()
            : typeof privateJson.checkoutUrl === 'string' && privateJson.checkoutUrl.trim()
              ? privateJson.checkoutUrl.trim()
              : '';
        if (privateJson.ok === true && checkoutUrlFromResponse) {
          result.checkoutUrl = checkoutUrlFromResponse;
          if (privateJson.draftOrderId) {
            result.draftOrderId = String(privateJson.draftOrderId);
          } else if (privateJson.draft_order_id) {
            result.draftOrderId = String(privateJson.draft_order_id);
          }
          if (privateJson.draftOrderName) {
            result.draftOrderName = String(privateJson.draftOrderName);
          } else if (privateJson.draft_order_name) {
            result.draftOrderName = String(privateJson.draft_order_name);
          }
          if (Array.isArray(privateJson.requestIds) && privateJson.requestIds.length) {
            try {
              logger.debug('[private-checkout] request_ids', privateJson.requestIds);
            } catch (infoErr) {
              logger.debug('[private-checkout] request_ids_log_failed', infoErr);
            }
          }
          const SHOPIFY_DOMAIN = import.meta.env.VITE_SHOPIFY_DOMAIN || '';
          const candidateKeys = ['checkoutUrl', 'url', 'productUrl'];
          let privateTarget = '';
          for (const candidate of [privateJson, result]) {
            if (!candidate || typeof candidate !== 'object') continue;
            for (const key of candidateKeys) {
              const value = typeof candidate?.[key] === 'string' ? candidate[key].trim() : '';
              if (value) {
                privateTarget = value;
                break;
              }
            }
            if (privateTarget) {
              break;
            }
          }
          if (!privateTarget) {
            privateTarget = pickCommerceTarget(privateJson, SHOPIFY_DOMAIN)
              || pickCommerceTarget(result, SHOPIFY_DOMAIN)
              || checkoutUrlFromResponse;
          }
          const opened = openCommerceTarget(privateTarget || checkoutUrlFromResponse);
          if (!opened) {
            const navigationError = new Error('private_checkout_navigation_failed');
            navigationError.reason = 'private_checkout_navigation_failed';
            throw navigationError;
          }
          const lastProductPayload = {
            ...(flow.lastProduct || {}),
            productId: result.productId,
            variantId: result.variantId,
            variantIdNumeric: result.variantIdNumeric,
            variantIdGid: result.variantIdGid,
            productUrl: result.productUrl,
            productHandle: result.productHandle,
            visibility: result.visibility,
            checkoutUrl: checkoutUrlFromResponse,
            ...(result.draftOrderId ? { draftOrderId: result.draftOrderId } : {}),
            ...(result.draftOrderName ? { draftOrderName: result.draftOrderName } : {}),
            ...(Array.isArray(result.warnings) && result.warnings.length ? { warnings: result.warnings } : {}),
            ...(Array.isArray(result.warningMessages) && result.warningMessages.length
              ? { warningMessages: result.warningMessages }
              : {}),
          };
          finalizeCartSuccess('Listo. Abrimos tu checkout privado en otra pestaña.', {
            preserveLastProduct: true,
            lastProductOverride: lastProductPayload,
            skipNavigate: true,
          });
          return;
        }
        logError('invalid_payload');
        const reason =
          typeof privateJson.reason === 'string' && privateJson.reason
            ? privateJson.reason
            : privateJson.ok === false
              ? 'private_checkout_failed'
              : 'private_checkout_invalid_payload';
        throw buildError(reason);
      }
      if (result.productUrl) {
        openCommerceTarget(result.productUrl);
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
        const userErrors = Array.isArray(error?.userErrors)
          ? error.userErrors
            .map((entry) => {
              if (!entry) return null;
              if (typeof entry === 'string') return entry;
              if (typeof entry?.message === 'string' && entry.message.trim()) return entry.message.trim();
              return null;
            })
            .filter(Boolean)
          : [];
        const baseMessage =
          typeof error?.friendlyMessage === 'string' && error.friendlyMessage
            ? error.friendlyMessage
            : 'No pudimos generar el checkout privado. Probá de nuevo en unos segundos.';
        const extraParts = [];
        if (userErrors.length) {
          extraParts.push(userErrors.join(' | '));
        }
        if (reason) {
          extraParts.push(`Motivo: ${reason}`);
        }
        const detail = typeof error?.detail === 'string' ? error.detail : '';
        if (detail && !extraParts.length) {
          extraParts.push(detail);
        }
        const message = extraParts.length ? `${baseMessage} ${extraParts.join(' | ')}` : baseMessage;
        try {
          logger.error('[private-checkout] toast_error', {
            reason: reason || null,
            status: typeof error?.status === 'number' ? error.status : null,
            userErrors,
          });
        } catch (logErr) {
          if (logErr) {
            // noop
          }
        }
        setToast({
          message,
          actionLabel: 'Reintentar',
          action: () => {
            setToast(null);
            handle('private', { reuseLastProduct: true });
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
    const preferredSource =
      typeof flow.fileOriginalUrl === 'string' && flow.fileOriginalUrl.trim()
        ? flow.fileOriginalUrl.trim()
        : null;
    const fallbackSource =
      typeof flow.printFullResDataUrl === 'string' && flow.printFullResDataUrl.trim()
        ? flow.printFullResDataUrl.trim()
        : null;
    const downloadSource = preferredSource || fallbackSource;
    if (!downloadSource) {
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
      const response = await fetch(downloadSource, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
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
      const rawMime = (imageBlob.type || '').toLowerCase();
      const inferredFromUrl = downloadSource.toLowerCase();
      const isPngSignature =
        imageBytes.length >= 8
        && imageBytes[0] === 0x89
        && imageBytes[1] === 0x50
        && imageBytes[2] === 0x4e
        && imageBytes[3] === 0x47
        && imageBytes[4] === 0x0d
        && imageBytes[5] === 0x0a
        && imageBytes[6] === 0x1a
        && imageBytes[7] === 0x0a;
      const isJpegSignature =
        imageBytes.length >= 2 && imageBytes[0] === 0xff && imageBytes[1] === 0xd8;
      const shouldUseJpg =
        isJpegSignature
        || (!isPngSignature
          && (rawMime.includes('jpeg')
            || rawMime.includes('jpg')
            || inferredFromUrl.endsWith('.jpg')
            || inferredFromUrl.endsWith('.jpeg')));
      const embedded = shouldUseJpg
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
      logger.error('[download-pdf]', error);
      alert('No se pudo generar el PDF.');
    } finally {
      setBusy(false);
    }
  }

  /** NUEVO: scroll-to-top suave para el botón “volver” de la sección */
  const scrollToTop = () => {
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      window.scrollTo(0, 0);
    }
  };

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
              Volver y cancelar
            </button>
            <p className={styles.ctaHint}>
              Volvé al editor para crear <br></br>nuevamente tu modelo ✏️
            </p>
          </div>
          <div className={styles.ctaCard}>
            <button
              type="button"
              disabled={busy}
              className={`${styles.ctaButton} ${styles.ctaButtonPrimary}`}
              onClick={() => {
                trackEvent('add_to_cart_click', {
                  rid,
                  design_slug: designSlug,
                  product_id: lastProductId,
                  variant_id: lastVariantId,
                });
                handle('cart');
              }}
            >
              {cartButtonLabel}
            </button>
            <p className={styles.ctaHint}>
              Arma un carrito con todo lo que te guste <br></br> y obtené envío gratis ❤️
            </p>
            
             
          </div>
          <div className={styles.ctaCard}>
            <button
              type="button"
              disabled={busy}
              
              className={`${styles.ctaButton} ${styles.ctaButtonPrimary1}`}
              ref={buyNowButtonRef}
              onClick={() => {
                if (busy) return;
                setBuyPromptOpen(true);
              }}
            >
              Comprar ahora
            </button>
            <p className={styles.ctaHint}>
              Finalizá tu compra para que tu creación <br></br>se haga realidad ✨
            </p>
          </div>
        </div>
        <section className={styles.communitySection}>
          <h2 className={styles.communityTitle}>
            Nos encantaría que formes parte de nuestra comunidad
          </h2>
          <p className={styles.communitySubtitle}>por eso vamos a convencerte<br></br>✨</p>
          <div className={styles.communityGrid}>
  {BENEFITS.map((item, i) => (
    <article key={i} className={styles.communityItem}>
      <figure className={styles.testimonialCard}>
        <div className={styles.testimonialImageWrapper}>
          <img
            src={TESTIMONIAL_ICONS[i]}
            alt={`Testimonio de cliente ${i + 1}`}
            className={styles.testimonialSvg}
            loading="lazy"
          />
        </div>
      </figure>

      <div className={styles.communityCopy}>
        {/* Reutilizo tus clases de tipografía */}
        <h3 className={styles.benefitTitle}>
          {item.icon && <span className={styles.benefitIcon}>{item.icon}</span>}
          {item.title}
        </h3>
        <p className={styles.benefitDescription}>{item.description}</p>
      </div>
    </article>
  ))}
</div>
          
        </section>
        <button
          type="button"
          disabled={busy}
          className={styles.hiddenButton}
          onClick={() => {
            trackEvent('checkout_private_click', {
              rid,
              design_slug: designSlug,
              product_id: lastProductId,
              variant_id: lastVariantId,
            });
            handle('private');
          }}
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

      <section className={styles.marketingSection}>
        <h2 className={styles.marketingTitle}>Nuestro mejor marketing</h2>
        <p className={styles.communitySubtitle}>nuestros clientes</p>
      </section>

     
      <section className={styles.showcaseSection}>
        <div className={styles.showcaseImageWrapper}>
          <img
            src={COMMUNITY_HERO_IMAGE}
            alt="Galería de setups de la comunidad MgM"
            className={styles.showcaseImage}
            loading="lazy"
          />
         <a href='https://www.instagram.com/stories/highlights/18057726377123944/' style={{ textDecoration: 'none' }} target='_blank'>
          <div className={styles.showcaseOverlay}>
            <p className={styles.showcaseOverlayText}>
              Conocé a los +2000 que ya lo hicieron
            </p>
          </div>
          </a>
        </div>

        <div className={styles.showcaseCta}>
         <button
  type="button"
  className={styles.backToTopBtn}
  onClick={scrollToTop}
  aria-label="Volver arriba"
>
  <span className={styles.backLabel}>Volver</span>
  <span className={styles.backArrow} aria-hidden="true">↑</span>
</button>
        </div>
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
              Elige cómo publicar tu diseño
            </h2>
            <p id={buyPromptDescriptionId} className={styles.modalDescription}>
              🔓 Público: visible en la tienda. <br></br><br></br>🔒 Privado: solo vos lo verás.
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                ref={firstActionButtonRef}
                disabled={busy}
                className={styles.modalPrimary}
                onClick={() => {
                  trackEvent('checkout_public_click', {
                    rid,
                    design_slug: designSlug,
                    product_id: lastProductId,
                    variant_id: lastVariantId,
                  });
                  setBuyPromptOpen(false);
                  handle('checkout');
                }}
              >
                Comprar público
              </button>
              <button
                type="button"
                disabled={busy}
                className={styles.modalSecondary}
                onClick={() => {
                  trackEvent('checkout_private_click', {
                    rid,
                    design_slug: designSlug,
                    product_id: lastProductId,
                    variant_id: lastVariantId,
                  });
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
