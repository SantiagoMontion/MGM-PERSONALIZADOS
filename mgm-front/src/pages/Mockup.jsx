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
} from '@/lib/shopify.ts';
import Testimonio1 from "../icons/testimonio1.png";
import Testimonio2 from "../icons/testimonio2.png";
import Testimonio3 from "../icons/testimonio3.png";

/** NUEVO: imagen de la sección (reemplazá el path por el tuyo) */
import CommunityHero from "../icons/community-hero.png";

const TESTIMONIAL_ICONS = [Testimonio1, Testimonio2, Testimonio3];
const CART_STATUS_LABELS = {
  idle: 'Agregar al carrito',
  creating: 'Creando producto…',
  opening: 'Abriendo producto…',
};

const BENEFITS = [
  {
    icon: '',
    title: '🎁 Regalos sorpresa en cada pedido',
    description: 'Cada compra merece un mimo extra <3',
  },
  {
    icon: '',
    title: '✅ Durabilidad y calidad garantizada',
    description: 'Materiales seleccionaos, costuras reforzadas y tests reales. Tu pad está hecho para durar..',
  },
  {
    icon: '',
    title: '🎨 Un mousepad que se adapta perfecto a tu setup',
    description: 'Material, diseño y medida elegidos por vos.',
  },
];

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
    try {
      navigate('/', { replace: true });
    } catch (navErr) {
      console.warn('[mockup] cart_success_navigate_failed', navErr);
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

  async function startCartFlow() {
    if (busy && cartStatus !== 'idle') return;
    setToast(null);
    setCartStatus('creating');
    setBusy(true);
    try {
      const normalizedDiscountCode = discountCode || '';
      const creationCartOptions = normalizedDiscountCode ? { discountCode: normalizedDiscountCode } : {};
      const result = await createJobAndProduct('cart', flow, creationCartOptions);
      const warningMessages = extractWarningMessages(result?.warnings, result?.warningMessages);
      if (warningMessages.length) {
        try {
          console.warn('[mockup] cart_flow_warnings', warningMessages);
        } catch (warnErr) {
          console.debug?.('[mockup] cart_flow_warn_log_failed', warnErr);
        }
        setToast({ message: warningMessages.join(' ') });
      }

      const handleFromResult =
        typeof result?.productHandle === 'string' && result.productHandle.trim()
          ? result.productHandle.trim()
          : typeof result?.product?.handle === 'string' && result.product.handle.trim()
            ? result.product.handle.trim()
            : '';
      if (!handleFromResult) {
        const missingHandleError = new Error('missing_product_handle');
        missingHandleError.reason = 'missing_product_handle';
        throw missingHandleError;
      }

      setCartStatus('opening');
      const productUrl = `https://www.mgmgamers.store/products/${encodeURIComponent(handleFromResult)}`;
      if (typeof window !== 'undefined') {
        let opened = false;
        try {
          const popup = window.open(productUrl, '_blank', 'noopener');
          opened = true;
          if (popup) {
            try {
              popup.opener = null;
            } catch (openerErr) {
              console.debug?.('[mockup] product_tab_opener_clear_failed', openerErr);
            }
          }
        } catch (openErr) {
          console.warn('[mockup] product_page_open_failed', openErr);

          try {
            window.open(productUrl, '_blank');
            opened = true;
          } catch (fallbackErr) {
            console.warn('[mockup] product_page_fallback_open_failed', fallbackErr);
          }
        }

        if (!opened) {
          try {
            window.location.assign(productUrl);
          } catch (navErr) {
            console.warn('[mockup] product_page_navigation_failed', navErr);
          }
        }
      }

      finalizeCartSuccess('Abrimos la página del producto para que lo agregues al carrito.');
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

    let privateStageCallback = null;

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
          console.warn(`[${mode}-flow] warnings`, warningMessages);
        } catch (warnErr) {
          console.debug?.('[handle] warn_log_failed', warnErr);
        }
        setToast({ message: warningMessages.join(' ') });
      }
      if (mode === 'checkout' && result.checkoutUrl) {
        const checkoutUrl = result.checkoutUrl;
        let opened = false;
        try {
          const checkoutTab = window.open(checkoutUrl, '_blank', 'noopener');
          opened = Boolean(checkoutTab);
          if (!opened) {
            console.warn('[checkout-open] popup_blocked', { url: checkoutUrl });
          }
        } catch (openErr) {
          console.warn('[checkout-open]', openErr);
        }
        if (!opened) {
          window.location.assign(checkoutUrl);
          return;
        }
        finalizeCartSuccess('Listo. Abrimos tu checkout en otra pestaña.');
        return;
      }
      if (mode === 'private') {
        const variantIdForCheckout = typeof result?.variantId === 'string' ? result.variantId : '';
        if (!variantIdForCheckout) {
          throw new Error('missing_variant');
        }
        try {
          privateStageCallback?.('creating_checkout');
        } catch (stageErr) {
          console.debug?.('[private-checkout] stage_callback_failed', stageErr);
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
          console.warn('[private-checkout] resolve_failed', resolveErr);
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
            console.warn('[private-checkout] json_parse_failed', parseErr);
          }
        } else {
          console.error('[private-checkout] non_json_response', {
            status: privateResp.status,
            contentType,
            bodyPreview: typeof rawBody === 'string' ? rawBody.slice(0, 200) : '',
            url: privateResp.url || resolvedPrivateCheckoutUrl || null,
          });
        }
        const logError = (label) => {
          try {
            console.error(`[private-checkout] ${label}`, {
              status: privateResp.status,
              contentType,
              bodyPreview: typeof rawBody === 'string' ? rawBody.slice(0, 200) : '',
              url: privateResp.url || resolvedPrivateCheckoutUrl || null,
            });
          } catch (logErr) {
            console.debug?.('[private-checkout] log_failed', logErr);
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
              console.info('[private-checkout] request_ids', privateJson.requestIds);
            } catch (infoErr) {
              console.debug?.('[private-checkout] request_ids_log_failed', infoErr);
            }
          }
          try {
            const opened = window.open(checkoutUrlFromResponse, '_blank', 'noopener');
            if (!opened) {
              console.warn('[private-checkout-open] popup_blocked', { url: checkoutUrlFromResponse });
            }
          } catch (tabErr) {
            console.warn('[private-checkout-open]', tabErr);
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
          console.error('[private-checkout] toast_error', {
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

  /** NUEVO: scroll-to-top suave para el botón “volver” de la sección */
  const scrollToTop = () => {
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      window.scrollTo(0, 0);
    }
  };

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
              Volvé al editor para hacer los <br></br>cambios que quieras ✏️
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

      <section className={styles.marketingSection}>
        <h2 className={styles.marketingTitle}>Nuestro mejor marketing</h2>
        <p className={styles.communitySubtitle}>nuestros clientes</p>
      </section>

     
      <section className={styles.showcaseSection}>
        <div className={styles.showcaseImageWrapper}>
          <img
            src={CommunityHero}
            alt="Galería de setups de la comunidad MgM"
            className={styles.showcaseImage}
            loading="lazy"
          />
         
          <div className={styles.showcaseOverlay}>
            <p className={styles.showcaseOverlayText}>
              Conocé a los +2000 que ya lo hicieron
            </p>
          </div>
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
