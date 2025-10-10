import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PDFDocument } from 'pdf-lib';
import Toast from '@/components/Toast.jsx';
import { useFlow } from '@/state/flow.js';
import { downloadBlob, renderMockup1080 } from '@/lib/mockup.js';
import styles from './Mockup.module.css';
import { buildExportBaseName } from '@/lib/filename.ts';
import { apiFetch, getResolvedApiUrl } from '@/lib/api.js';
import {
  createJobAndProduct,
  ONLINE_STORE_DISABLED_MESSAGE,
  ONLINE_STORE_MISSING_MESSAGE,
  pickCommerceTarget,
} from '@/lib/shopify.ts';
import logger from '../lib/logger';
import { normalizeMaterialLabel } from '../lib/material.js';
import { ensureTrackingRid, trackEvent } from '@/lib/tracking';

const PUBLISH_MAX_PAYLOAD_KB = Number(import.meta.env?.VITE_PUBLISH_MAX_PAYLOAD_KB) || 200;
const FLOW_STORAGE_KEY = 'mgm_flow_v1';
const BUY_DEBUG = true;
const dlog = (...args) => { if (BUY_DEBUG) console.log('[buy]', ...args); };
const derr = (...args) => { console.error('[buy]', ...args); };
try {
  if (typeof window !== 'undefined' && !window.__BUY_DEBUG_WIRED__) {
    window.__BUY_DEBUG_WIRED__ = true;
    window.addEventListener('unhandledrejection', (event) => derr('unhandledrejection', event?.reason));
    window.addEventListener('error', (event) => derr('window.onerror', event?.error || event?.message));
  }
} catch (_) {
  // no-op
}
// Guard legacy: mapear preservedCustom al designName actual si existe
// --- Guardia contra referencias sueltas a "preservedCustom" ---
// Si algÃºn handler viejo lo usa como identificador global, lo definimos aquÃ­
// para evitar ReferenceError sin alterar la lÃ³gica actual.
try {
  if (typeof window !== 'undefined' && typeof window.preservedCustom === 'undefined') {
    window.preservedCustom = null;
  }
} catch (_) {
  // no-op
}

let preservedCustom = (() => {
  try {
    const maybeFlow = typeof globalThis !== 'undefined'
      ? globalThis.__MGM_FLOW__ || globalThis.__FLOW__ || null
      : null;
    const state = typeof maybeFlow?.get === 'function' ? maybeFlow.get() : maybeFlow;
    const name = state?.designName;
    return name != null ? name.toString() || null : null;
  } catch {
    return null;
  }
})();

try {
  if (typeof window !== 'undefined') {
    if (window.preservedCustom != null) {
      preservedCustom = window.preservedCustom;
    } else {
      window.preservedCustom = preservedCustom;
    }
  }
} catch (_) {
  // no-op
}
// Volvemos a mostrar el wrapper legacy para recuperar su TEXTO,
// pero ocultamos SOLO su <img/> con CSS (ver estilo inyectado abajo).
const SHOW_LEGACY_PREVIEW = true;
const HIDE_LEGACY_IMG_CSS =
  `[class*="previewWrapper"][class*="previewWithImage"] img{display:none!important}`;

function isDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:');
}

async function imgFromDataUrl(dataUrl) {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = (event) => reject(event instanceof ErrorEvent ? event.error ?? event : event || new Error('mockup_image_load_failed'));
    image.src = dataUrl;
  });
}

function safeName(value) {
  const cleaned = safeReplace(asStr(value), /[\/\\:*?"<>|]+/g, '');
  const trimmed = cleaned.trim();
  return trimmed || 'Design';
}

function cmFromPx(px, dpi) {
  return Math.max(1, Math.round((Number(px) || 0) / (Number(dpi) || 300) * 2.54));
}

function matLabelOf(material) {
  const text = String(material || '').toLowerCase();
  if (text.includes('glass')) {
    return 'Glasspad';
  }
  if (text.includes('pro')) {
    return 'PRO';
  }
  if (text.includes('classic')) {
    return 'Classic';
  }
  return (String(material || '').trim() || 'Classic');
}

const asStr = (value, fallback = '') => {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
};

function safeStr(value, fallback = '') {
  const str = asStr(value);
  const trimmed = str.trim();
  return trimmed || fallback;
}

const safeReplace = (value, pattern, replacement) => asStr(value).replace(pattern, replacement);

function loadPersistedFlow() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FLOW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const result = { ...parsed };
    if ('widthCm' in result) {
      const num = Number(result.widthCm);
      if (Number.isFinite(num) && num > 0) {
        result.widthCm = Math.round(num);
      } else {
        delete result.widthCm;
      }
    }
    if ('heightCm' in result) {
      const num = Number(result.heightCm);
      if (Number.isFinite(num) && num > 0) {
        result.heightCm = Math.round(num);
      } else {
        delete result.heightCm;
      }
    }
    if (result.options && typeof result.options !== 'object') {
      delete result.options;
    }
    return result;
  } catch {
    return null;
  }
}

function normalizeMaterialLabelSafe(flow) {
  const candidates = [
    safeStr(flow?.material),
    safeStr(flow?.options?.material),
    safeStr(flow?.productType),
  ];
  const raw = candidates.find(Boolean)?.toLowerCase() || '';
  if (raw.includes('glass')) return 'Glasspad';
  if (raw.includes('pro')) return 'PRO';
  if (raw.includes('classic')) return 'Classic';
  return candidates.find(Boolean) || null;
}

function extractFlowBasics(flowLike = {}) {
  let name = safeStr(flowLike?.designName, 'Personalizado');
  let material = normalizeMaterialLabelSafe(flowLike);
  let width = Number(flowLike?.widthCm);
  let height = Number(flowLike?.heightCm);

  if ((!Number.isFinite(width) || width <= 0) && flowLike?.composition) {
    const compWidth = Number(flowLike?.composition?.widthCm);
    if (Number.isFinite(compWidth) && compWidth > 0) {
      width = compWidth;
    }
  }
  if ((!Number.isFinite(height) || height <= 0) && flowLike?.composition) {
    const compHeight = Number(flowLike?.composition?.heightCm);
    if (Number.isFinite(compHeight) && compHeight > 0) {
      height = compHeight;
    }
  }
  if ((!Number.isFinite(width) || width <= 0) && flowLike?.editorState) {
    const editorWidth = Number(
      flowLike.editorState?.widthCm
        ?? flowLike.editorState?.size_cm?.w
        ?? flowLike.editorState?.composition?.widthCm,
    );
    if (Number.isFinite(editorWidth) && editorWidth > 0) {
      width = editorWidth;
    }
  }
  if ((!Number.isFinite(height) || height <= 0) && flowLike?.editorState) {
    const editorHeight = Number(
      flowLike.editorState?.heightCm
        ?? flowLike.editorState?.size_cm?.h
        ?? flowLike.editorState?.composition?.heightCm,
    );
    if (Number.isFinite(editorHeight) && editorHeight > 0) {
      height = editorHeight;
    }
  }
  if (!material || material === 'Classic') {
    const editorMaterial = safeStr(
      flowLike?.editorState?.material
        ?? flowLike?.editorState?.options?.material
        ?? flowLike?.editorState?.productType,
    );
    if (editorMaterial) {
      const lower = editorMaterial.toLowerCase();
      if (lower.includes('glass')) material = 'Glasspad';
      else if (lower.includes('pro')) material = 'PRO';
    }
  }
  if (!name || name === 'Personalizado') {
    const editorName = safeStr(flowLike?.editorState?.designName);
    if (editorName) {
      name = editorName;
    }
  }
  if (material === 'Glasspad') {
    if (!Number.isFinite(width) || width <= 0) width = 49;
    if (!Number.isFinite(height) || height <= 0) height = 42;
  }
  const validatedWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : null;
  const validatedHeight = Number.isFinite(height) && height > 0 ? Math.round(height) : null;
  const title = buildTitle(name, validatedWidth, validatedHeight, material);
  const designHash = safeStr(flowLike?.designHash ?? flowLike?.designHashState);
  const hash8 = designHash.slice(0, 8) || '00000000';
  const keyStem = safeReplace(title, /[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, ' ').trim();
  let slug = asStr(keyStem || title || name || 'Personalizado');
  if (typeof slug.normalize === 'function') {
    slug = slug.normalize('NFKD');
  }
  slug = slug
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const objectKeyBase = safeReplace(`${slug || 'Personalizado'} ${hash8}`, /\s+/g, ' ').trim();
  const objectKey = `mockups-${ym}/${objectKeyBase || 'preview-listado'}.png`;
  return {
    name,
    mat: material,
    width: validatedWidth,
    height: validatedHeight,
    title,
    objectKey,
    hash8,
  };
}

async function blobToDataUrl(blob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result);
      } else {
        reject(new Error('dataurl_conversion_failed'));
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(blob);
  });
}

async function uploadPreviewViaApi(objectKey, blob) {
  if (!objectKey || !blob) throw new Error('preview_upload_missing_data');
  const dataUrl = await blobToDataUrl(blob);
  const response = await fetch(getResolvedApiUrl('/api/preview/upload'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      objectKey,
      dataUrl,
      contentType: blob.type || 'image/png',
    }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok || !json?.publicUrl) {
    console.error('[preview] api upload failed', {
      status: response.status,
      json,
      objectKey,
    });
    throw new Error('preview_upload_failed');
  }
  try {
    console.log('[preview] uploaded', {
      objectKey,
      skip: Boolean(json.skipUpload),
    });
  } catch (_) {
    // noop
  }
  return String(json.publicUrl);
}

export async function ensureMockupUrlInFlow(flow, input) {
  const state = typeof flow?.get === 'function' ? flow.get() : flow;
  if (typeof state?.mockupPublicUrl === 'string' && state.mockupPublicUrl) {
    return state.mockupPublicUrl;
  }
  if (typeof state?.mockupUrl === 'string' && state.mockupUrl && !state.mockupUrl.startsWith('blob:')) {
    return state.mockupUrl;
  }
  const payloadLimitBytes = PUBLISH_MAX_PAYLOAD_KB * 1024;
  if (isDataUrl(state?.mockupDataUrl) && state.mockupDataUrl.length <= payloadLimitBytes) {
    return state.mockupDataUrl;
  }
  const sourceDataUrl = isDataUrl(state?.printFullResDataUrl)
    ? state.printFullResDataUrl
    : (input?.dataUrl && isDataUrl(input.dataUrl) ? input.dataUrl : null);
  if (!isDataUrl(sourceDataUrl)) {
    const err = new Error('missing_print_fullres_dataurl');
    err.reason = 'missing_print_fullres_dataurl';
    throw err;
  }
  const image = await imgFromDataUrl(sourceDataUrl);
  const dpi = Number(state?.approxDpi ?? input?.dpi ?? 300);
  const composition = {
    widthPx: Number(state?.masterWidthPx ?? input?.widthPx ?? image.naturalWidth ?? image.width ?? 0),
    heightPx: Number(state?.masterHeightPx ?? input?.heightPx ?? image.naturalHeight ?? image.height ?? 0),
    widthMm: Number(input?.widthMm ?? state?.masterWidthMm ?? 0) || undefined,
    heightMm: Number(input?.heightMm ?? state?.masterHeightMm ?? 0) || undefined,
    dpi,
    material: state?.material ?? input?.material,
  };
  const basics = extractFlowBasics(state);
  const materialLabel = basics.mat;
  const widthCmValue = basics.width;
  const heightCmValue = basics.height;
  const mockupBlob = await renderMockup1080(image, {
    material: materialLabel,
    approxDpi: dpi,
    composition,
  });
  let publicUrl = null;
  try {
    console.log('[preview] about_to_upload', {
      objectKey: basics.objectKey,
      mat: basics.mat,
      w: basics.width,
      h: basics.height,
    });
    publicUrl = await uploadPreviewViaApi(basics.objectKey, mockupBlob);
  } catch (uploadErr) {
    logger.debug?.('[mockup] preview_upload_failed', uploadErr);
    publicUrl = null;
  }
  if (publicUrl) {
    publicUrl = String(publicUrl);
  }

  const nextState = typeof flow?.get === 'function' ? flow.get() : state;

  if (publicUrl) {
    try {
      if (typeof flow?.set === 'function') {
        flow.set({
          ...nextState,
          mockupBlob,
          mockupPublicUrl: publicUrl,
          mockupUrl: publicUrl,
          widthCm: basics.width,
          heightCm: basics.height,
          material: basics.mat,
          designName: basics.name,
          title: basics.title ?? nextState?.title,
          options: { ...(nextState?.options || {}), material: basics.mat },
          mockupDataUrl: null,
        });
      }
    } catch (stateErr) {
      logger.debug?.('[mockup] state_update_failed', stateErr);
    }
    console.log('[diag] mockup ensured', publicUrl);
    return publicUrl;
  }

  const fallbackUrl = (() => {
    if (typeof nextState?.mockupPublicUrl === 'string' && nextState.mockupPublicUrl) {
      return nextState.mockupPublicUrl;
    }
    if (typeof nextState?.mockupUrl === 'string' && nextState.mockupUrl) {
      return nextState.mockupUrl;
    }
    if (isDataUrl(nextState?.mockupDataUrl)) {
      return nextState.mockupDataUrl;
    }
    try {
      if (typeof URL !== 'undefined') {
        return URL.createObjectURL(mockupBlob);
      }
    } catch (blobErr) {
      logger.debug?.('[mockup] blob_url_failed', blobErr);
    }
    return null;
  })();

  if (fallbackUrl && typeof flow?.set === 'function') {
    try {
      flow.set({
        ...nextState,
        mockupBlob,
        mockupPublicUrl: nextState?.mockupPublicUrl || null,
        mockupUrl: fallbackUrl,
      });
    } catch (stateErr) {
      logger.debug?.('[mockup] fallback_state_failed', stateErr);
    }
  }

  if (fallbackUrl) {
    return fallbackUrl;
  }

  const err = new Error('missing_mockup_url');
  err.reason = 'missing_mockup_url';
  throw err;
}

async function waitUrlReady(url, tries = 8, delayMs = 350) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  for (let i = 0; i < tries; i += 1) {
    try {
      const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (response.ok) {
        return true;
      }
    } catch (_) {
      // noop
    }
    await new Promise((resolve) => {
      setTimeout(resolve, delayMs * (1 + i * 0.2));
    });
  }
  return false;
}

async function ensureMockupPublicReady(flowState) {
  const resolveState = () => (typeof flowState?.get === 'function' ? flowState.get() : flowState);
  let state = resolveState();
  if (!state?.mockupPublicUrl && !state?.mockupUrl) {
    try {
      await ensureMockupUrlInFlow(flowState);
    } catch (err) {
      logger.debug?.('[mockup] ensure_mockup_url_in_flow_failed', err);
    }
    state = resolveState();
  }
  const url = state?.mockupPublicUrl || state?.mockupUrl;
  if (!url) {
    return;
  }
  try {
    const ready = await waitUrlReady(url, 3, 250);
    if (!ready) {
      logger.debug?.('[mockup] mockup_head_unconfirmed', { url });
    }
  } catch (headErr) {
    logger.debug?.('[mockup] mockup_head_failed', headErr);
  }
}

function buildDimsFromFlowState(flowState) {
  const dpi = Number(flowState?.approxDpi ?? 300);
  const pxToCm = (px) => {
    const num = Number(px);
    if (!Number.isFinite(num) || num <= 0 || !Number.isFinite(dpi) || dpi <= 0) return undefined;
    return Math.round((num / dpi) * 2.54);
  };
  const widthCmCandidate = Number(flowState?.widthCm);
  const heightCmCandidate = Number(flowState?.heightCm);
  const widthCm = Number.isFinite(widthCmCandidate) && widthCmCandidate > 0
    ? widthCmCandidate
    : flowState?.masterWidthMm
      ? Math.round(Number(flowState.masterWidthMm) / 10)
      : pxToCm(flowState?.masterWidthPx);
  const heightCm = Number.isFinite(heightCmCandidate) && heightCmCandidate > 0
    ? heightCmCandidate
    : flowState?.masterHeightMm
      ? Math.round(Number(flowState.masterHeightMm) / 10)
      : pxToCm(flowState?.masterHeightPx);
  return {
    widthCm: Number.isFinite(widthCm) && widthCm > 0 ? widthCm : undefined,
    heightCm: Number.isFinite(heightCm) && heightCm > 0 ? heightCm : undefined,
  };
}

function buildTitle(designName, widthCm, heightCm, materialLabel) {
  const isGlass = materialLabel === 'Glasspad';
  const base = isGlass ? 'Glasspad' : 'Mousepad';
  const hasDims = Number.isFinite(widthCm) && Number.isFinite(heightCm) && widthCm > 0 && heightCm > 0;
  if (isGlass) {
    return hasDims
      ? `${base} ${designName} ${widthCm}x${heightCm} | PERSONALIZADO`
      : `${base} ${designName} | PERSONALIZADO`;
  }
  return hasDims
    ? `${base} ${designName} ${widthCm}x${heightCm} ${materialLabel} | PERSONALIZADO`
    : `${base} ${designName} ${materialLabel} | PERSONALIZADO`;
}

function buildShopifyPayload(flowState, mode) {
  const source = typeof flowState?.get === 'function' ? flowState.get() : flowState || {};
  const designNameRaw = (source?.designName ?? '').toString();
  const designName = designNameRaw.trim();
  // *** FUENTE ÃšNICA DE VERDAD: lo que guardamos al â€œContinuarâ€ ***
  let widthCm = Number(source?.widthCm);
  let heightCm = Number(source?.heightCm);
  if (!Number.isFinite(widthCm) || widthCm <= 0 || !Number.isFinite(heightCm) || heightCm <= 0) {
    widthCm = Number(source?.composition?.widthCm);
    heightCm = Number(source?.composition?.heightCm);
  }
  if (!Number.isFinite(widthCm) || widthCm <= 0 || !Number.isFinite(heightCm) || heightCm <= 0) {
    // Fallback (no debe pasar, pero evitamos valores raros)
    const dims = buildDimsFromFlowState(source);
    widthCm = dims.widthCm;
    heightCm = dims.heightCm;
  }
  // MATERIAL: tomar SIEMPRE lo que el usuario eligiÃ³ en el editor/opciones
  const materialLabel = normalizeMaterialLabel(source?.material ?? source?.options?.material);
  // Glasspad SIEMPRE 49x42 cm (independiente del canvas)
  if (materialLabel === 'Glasspad') {
    widthCm = 49;
    heightCm = 42;
  }
  widthCm = Math.round(Number(widthCm));
  heightCm = Math.round(Number(heightCm));
  const title = buildTitle(designName, widthCm, heightCm, materialLabel);
  // Precios de la calculadora del front (transferencia manda)
  const priceTransfer = Number(source?.priceTransfer ?? 0);
  const priceNormal = Number(source?.priceNormal ?? 0);
  const currency = source?.priceCurrency;
  // Enviar SIEMPRE URL pÃºblica del mockup (nunca dataURL) para que REST lo adjunte
  const mockupUrl = source?.mockupPublicUrl || source?.mockupUrl || null;
  const payload = {
    mode,
    designName,
    widthCm,
    heightCm, // â† viajan en cm tal cual eligiÃ³ el cliente
    // Mandar material en los 3 campos para que jamÃ¡s se pierda en merges intermedios
    options: { ...(source?.options || {}), material: materialLabel, productType: source?.productType },
    material: materialLabel,
    materialResolved: materialLabel,
    title,
    priceTransfer,
    priceNormal,
    currency,
    productType: source?.productType,
    mockupUrl,
    pdfPublicUrl: source?.pdfPublicUrl,
    masterPublicUrl: source?.masterPublicUrl || null,
    designHash: source?.designHash,
    masterWidthPx: source?.masterWidthPx,
    masterHeightPx: source?.masterHeightPx,
    ...(mode === 'private' ? { isPrivate: true } : {}),
  };
  return payload;
}

function toastErr(msg) {
  try {
    window?.toast?.error?.(msg);
  } catch (err) {
    logger.debug('[mockup] toast_error_failed', err);
  }
}

async function ensureAssetsForPublish(flowState) {
  const state = typeof flowState?.get === 'function' ? flowState.get() : flowState;
  if (!state?.pdfPublicUrl) {
    throw new Error('missing_pdf_public_url');
  }
  const flowLike = typeof flowState?.set === 'function' ? flowState : state;
  await ensureMockupUrlInFlow(flowLike);
}

function notifyMissingAssetsError(error) {
  const code = String(error?.message || error?.reason || '').trim();
  if (code === 'missing_pdf_public_url') {
    toastErr('Falta el PDF. VolvÃ© al editor y tocÃ¡ "Continuar" para generarlo.');
    return;
  }
  if (code === 'missing_mockup_url') {
    toastErr('Falta la imagen de mockup. ReintentÃ¡ "Continuar" o recargÃ¡ la vista.');
    return;
  }
  if (code === 'missing_print_fullres_dataurl') {
    toastErr('No encontramos la composiciÃ³n final para generar el mockup. VolvÃ© al editor y tocÃ¡ "Continuar".');
    return;
  }
  toastErr('No se puede continuar: recursos incompletos.');
}

/** NUEVO: imagen de la secciÃ³n (reemplazÃ¡ el path por el tuyo) */
const TESTIMONIAL_ICONS = [
  '/icons/testimonio1.png',
  '/icons/testimonio2.png',
  '/icons/testimonio3.png',
];
const COMMUNITY_HERO_IMAGE = '/icons/community-hero.png';
const CART_STATUS_LABELS = {
  idle: 'Agregar al carrito',
  creating: 'Creando productoâ€¦',
  opening: 'Abriendo productoâ€¦',
};

const CTA_BUTTON_CONTENT_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  minHeight: '1em',
};

const CTA_BUTTON_SPINNER_STYLE = {
  width: '18px',
  height: '18px',
};

function CtaButton({
  label,
  busyLabel,
  isBusy,
  className,
  disabled = false,
  onClick,
  type = 'button',
  buttonRef,
  ariaLabel,
  title,
}) {
  const handleClick = (event) => {
    if (disabled || isBusy) {
      event.preventDefault();
      return;
    }
    if (onClick) {
      onClick(event);
    }
  };

  const loadingLabel = typeof busyLabel !== 'undefined' ? busyLabel : 'Procesandoâ€¦';

  return (
    <button
      type={type}
      ref={buttonRef}
      className={className}
      disabled={disabled || isBusy}
      aria-disabled={disabled || isBusy ? 'true' : undefined}
      aria-busy={isBusy ? 'true' : undefined}
      onClick={handleClick}
      aria-label={ariaLabel}
      title={title}
    >
      <span style={CTA_BUTTON_CONTENT_STYLE}>
        {isBusy ? (
          <>
            <span
              className="spinner"
              aria-hidden="true"
              style={CTA_BUTTON_SPINNER_STYLE}
            />
            <span>{loadingLabel}</span>
          </>
        ) : (
          label
        )}
      </span>
    </button>
  );
}

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
  let sanitized = safeReplace(raw, /^https?:\/\//i, '');
  sanitized = safeReplace(sanitized, /\/+$/, '');
  return sanitized;
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
    title: 'ðŸŽ Regalos sorpresa en cada pedido',
    description: 'Cada compra merece un mimo extra <3',
  },
  {
    icon: '',
    title: 'âœ… Durabilidad y calidad garantizada',
    description: 'Materiales seleccionados, costuras reforzadas y tests reales. Tu pad estÃ¡ hecho para durar.',
  },
  {
    icon: '',
    title: 'ðŸŽ¨ Un mousepad que se adapta perfecto a tu setup',
    description: 'Material, diseÃ±o y medida elegidos por vos.',
  },
];

export default function Mockup() {
  const flow = useFlow();
  useEffect(() => {
    const persisted = loadPersistedFlow();
    const currentOptions = (flow?.options && typeof flow.options === 'object') ? flow.options : {};
    const logBasics = (source) => {
      try {
        const basics = extractFlowBasics(source || {});
        console.log('[audit:flow:rehydrated]', {
          material: basics.mat,
          optionsMaterial: source?.options?.material,
          widthCm: basics.width,
          heightCm: basics.height,
          title: basics.title,
          mockupPublicUrl: source?.mockupPublicUrl || null,
        });
      } catch (_) {
        // noop
      }
    };
    if (!persisted) {
      logBasics(flow);
      return;
    }
    if (!flow?.set) {
      logBasics({ ...flow, ...persisted });
      return;
    }
    const patch = {};
    if (!safeStr(flow?.designName) && safeStr(persisted.designName)) {
      patch.designName = safeStr(persisted.designName);
    }
    const persistedMaterial = safeStr(
      persisted.material
        ?? persisted.materialResolved
        ?? persisted.options?.material,
    );
    const existingMaterial = safeStr(
      flow?.material
        ?? flow?.materialResolved
        ?? currentOptions?.material,
    );
    const mergedOptions = { ...currentOptions };
    let optionsChanged = false;
    if (persisted.options && typeof persisted.options === 'object') {
      Object.entries(persisted.options).forEach(([key, value]) => {
        if (mergedOptions[key] !== value) {
          mergedOptions[key] = value;
          optionsChanged = true;
        }
      });
    }
    if (!existingMaterial && persistedMaterial) {
      patch.material = persistedMaterial;
      patch.materialResolved = persisted.materialResolved ?? persistedMaterial;
      if (mergedOptions.material !== (persisted.options?.material ?? persistedMaterial)) {
        mergedOptions.material = persisted.options?.material ?? persistedMaterial;
        optionsChanged = true;
      }
    } else if (persistedMaterial && !mergedOptions.material) {
      mergedOptions.material = persistedMaterial;
      optionsChanged = true;
    }
    if (optionsChanged) {
      patch.options = mergedOptions;
    }
    const existingWidth = Number(flow?.widthCm);
    const persistedWidth = Number(persisted.widthCm);
    if (!(Number.isFinite(existingWidth) && existingWidth > 0) && Number.isFinite(persistedWidth) && persistedWidth > 0) {
      patch.widthCm = Math.round(persistedWidth);
    }
    const existingHeight = Number(flow?.heightCm);
    const persistedHeight = Number(persisted.heightCm);
    if (!(Number.isFinite(existingHeight) && existingHeight > 0) && Number.isFinite(persistedHeight) && persistedHeight > 0) {
      patch.heightCm = Math.round(persistedHeight);
    }
    if (!safeStr(flow?.mockupPublicUrl) && safeStr(persisted.mockupPublicUrl || persisted.mockupUrl)) {
      patch.mockupPublicUrl = safeStr(persisted.mockupPublicUrl || persisted.mockupUrl);
    }
    if (!safeStr(flow?.mockupUrl) && safeStr(persisted.mockupUrl || persisted.mockupPublicUrl)) {
      patch.mockupUrl = safeStr(persisted.mockupUrl || persisted.mockupPublicUrl);
    }
    if (!safeStr(flow?.productType) && safeStr(persisted.productType)) {
      patch.productType = safeStr(persisted.productType);
    }
    if (persisted.approxDpi && !flow?.approxDpi) {
      patch.approxDpi = persisted.approxDpi;
    }
    if (persisted.masterWidthPx && !flow?.masterWidthPx) {
      patch.masterWidthPx = persisted.masterWidthPx;
    }
    if (persisted.masterHeightPx && !flow?.masterHeightPx) {
      patch.masterHeightPx = persisted.masterHeightPx;
    }
    if (Object.keys(patch).length > 0) {
      flow.set(patch);
      const merged = { ...flow, ...patch };
      merged.options = patch.options || merged.options;
      logBasics(merged);
    } else {
      logBasics(flow);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const flowState = typeof flow?.get === 'function' ? flow.get() : flow;
  const f = (typeof flow?.get === 'function' && flow.get()) || flowState || {};
  const designName = (f?.designName ?? '').toString();
  // Sincronizar el nombre con la guardia global, para que cualquier referencia legacy lo encuentre.
  try {
    if (typeof window !== 'undefined') {
      window.preservedCustom = designName || null;
      preservedCustom = window.preservedCustom;
    }
  } catch (_) {
    // no-op
  }
  const navigate = useNavigate();
  const location = useLocation();
  const frontTitle = useMemo(() => {
    const designNameRaw = typeof flow?.designName === 'string' ? flow.designName : '';
    const designName = designNameRaw.trim() || 'Personalizado';
    const materialLabel = String(flow?.material || 'Classic');
    const isGlass = materialLabel.toLowerCase().includes('glass');
    const baseCategory = isGlass ? 'Glasspad' : 'Mousepad';
    const widthCandidate = Number(flow?.editorState?.size_cm?.w ?? flow?.widthCm);
    const heightCandidate = Number(flow?.editorState?.size_cm?.h ?? flow?.heightCm);
    const widthCm = Number.isFinite(widthCandidate) && widthCandidate > 0 ? Math.round(widthCandidate) : null;
    const heightCm = Number.isFinite(heightCandidate) && heightCandidate > 0 ? Math.round(heightCandidate) : null;
    const hasDims = widthCm != null && heightCm != null;
    if (isGlass) {
      return hasDims
        ? `${baseCategory} ${designName} ${widthCm}x${heightCm} | PERSONALIZADO`
        : `${baseCategory} ${designName} | PERSONALIZADO`;
    }
    return hasDims
      ? `${baseCategory} ${designName} ${widthCm}x${heightCm} ${materialLabel} | PERSONALIZADO`
      : `${baseCategory} ${designName} ${materialLabel} | PERSONALIZADO`;
  }, [flow]);
  const [busy, setBusy] = useState(false);
  const [cartStatus, setCartStatus] = useState('idle');
  const [publicBusy, setPublicBusy] = useState(false);
  const [privateBusy, setPrivateBusy] = useState(false);
  const [buyBtnBusy, setBuyBtnBusy] = useState(false);
  const [cartBtnBusy, setCartBtnBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [isBuyPromptOpen, setBuyPromptOpen] = useState(false);
  const buyNowButtonRef = useRef(null);
  const modalRef = useRef(null);
  const firstActionButtonRef = useRef(null);
  const wasModalOpenedRef = useRef(false);
  const successToastTimeoutRef = useRef(null);

  const withBuyBtnSpin = useCallback((fn) => {
    return async (...args) => {
      setBuyBtnBusy(true);
      try {
        return await fn(...args);
      } finally {
        setBuyBtnBusy(false);
      }
    };
  }, []);

  const withCartBtnSpin = useCallback((fn) => {
    return async (...args) => {
      if (cartBtnBusy) {
        return;
      }
      setCartBtnBusy(true);
      try {
        return await fn(...args);
      } finally {
        setCartBtnBusy(false);
      }
    };
  }, [cartBtnBusy]);

  const cartButtonLabel = CART_STATUS_LABELS[cartStatus] || CART_STATUS_LABELS.idle;
  const cartBusy = cartStatus !== 'idle';
  const cartInteractionBusy = cartBtnBusy || cartBusy;
  const buyPromptTitleId = 'buy-choice-title';
  const buyPromptDescriptionId = 'buy-choice-description';
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!frontTitle) return;
    try {
      document.title = frontTitle;
    } catch (err) {
      logger.debug?.('[mockup] title_update_failed', err);
    }
  }, [frontTitle]);

  const mockupSrc = useMemo(() => {
    const state = flowState && typeof flowState === 'object' ? flowState : {};
    if (typeof state.mockupPublicUrl === 'string' && state.mockupPublicUrl) {
      return state.mockupPublicUrl;
    }
    if (typeof state.mockupUrl === 'string' && state.mockupUrl) {
      return state.mockupUrl;
    }
    if (isDataUrl(state.mockupDataUrl)) {
      return state.mockupDataUrl;
    }
    return null;
  }, [flowState]);
  const mockupUrl = mockupSrc;
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
    || (typeof window !== 'undefined' ? ensureTrackingRid() ?? undefined : undefined);

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

  const mockupImageSrc = useMemo(() => {
    const state = typeof flow?.get === 'function' ? flow.get() : flow;
    if (state?.mockupPublicUrl) return state.mockupPublicUrl;
    if (state?.mockupUrl) return state.mockupUrl;
    return isDataUrl(state?.mockupDataUrl) ? state.mockupDataUrl : null;
  }, [flow]);

  function debugTrackFire(eventName, ridValue) {
    if (typeof window === 'undefined') return;
    if ((window).__TRACK_DEBUG__ === true) {
      console.debug('[track:fire]', { event: eventName, rid: ridValue });
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const resolvedRid = ensureTrackingRid();
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

    debugTrackFire('mockup_view', resolvedRid);
    trackEvent('mockup_view', {
      rid: resolvedRid,
      design_slug: designSlug,
      product_handle: lastProduct?.productHandle,
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
    const resolvedRid = ensureTrackingRid() || rid;
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

    debugTrackFire('view_purchase_options', resolvedRid);
    trackEvent('view_purchase_options', {
      rid: resolvedRid,
      design_slug: designSlug,
      product_handle: lastProduct?.productHandle,
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

  function showFriendlyError(error, options = {}) {
    const { scope = 'mockup' } = options || {};
    logger.error(`[${scope}]`, error);
    const reasonRaw = typeof error?.reason === 'string' && error.reason
      ? error.reason
      : typeof error?.message === 'string' && error.message
        ? error.message
        : 'Error';
    const messageRaw = typeof error?.friendlyMessage === 'string' && error.friendlyMessage
      ? error.friendlyMessage
      : String(error?.message || 'Error');
    let friendly = messageRaw;
    if (reasonRaw === 'missing_mockup') friendly = 'No se encontrÃ³ el mockup para publicar.';
    else if (reasonRaw === 'missing_variant') friendly = 'No se pudo obtener la variante del producto creado en Shopify.';
    else if (reasonRaw === 'cart_link_failed') friendly = 'No se pudo generar el enlace del carrito. RevisÃ¡ la configuraciÃ³n de Shopify.';
    else if (reasonRaw === 'checkout_link_failed') friendly = 'No se pudo generar el enlace de compra.';
    else if (reasonRaw === 'private_checkout_failed' || reasonRaw === 'draft_order_failed' || reasonRaw === 'draft_order_http_error' || reasonRaw === 'missing_invoice_url') {
      friendly = 'No pudimos generar el checkout privado, probÃ¡ de nuevo.';
    }
    else if (reasonRaw === 'missing_customer_email' || reasonRaw === 'missing_email') friendly = 'CompletÃ¡ un correo electrÃ³nico vÃ¡lido para comprar en privado.';
    else if (reasonRaw.startsWith('publish_failed')) friendly = 'Shopify rechazÃ³ la creaciÃ³n del producto. RevisÃ¡ los datos enviados.';
    else if (reasonRaw === 'shopify_error') friendly = 'Shopify devolviÃ³ un error al crear el producto.';
    else if (reasonRaw === 'product_not_active') friendly = 'El producto quedÃ³ como borrador en Shopify. VerificÃ¡ la visibilidad y reintentÃ¡.';
    else if (reasonRaw === 'product_missing_variant') friendly = 'Shopify no devolviÃ³ variantes para el producto creado.';
    else if (reasonRaw === 'missing_product_handle') friendly = 'No pudimos confirmar la URL del producto en Shopify.';
    else if (reasonRaw === 'shopify_env_missing') {
      const missing = Array.isArray(error?.missing) && error.missing.length
        ? error.missing.join(', ')
        : 'SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN';
      friendly = `La integraciÃ³n con Shopify no estÃ¡ configurada. Faltan las variables: ${missing}.`;
    } else if (reasonRaw === 'shopify_scope_missing') {
      const missing = Array.isArray(error?.missing) && error.missing.length
        ? error.missing.join(', ')
        : 'write_products';
      friendly = `La app de Shopify no tiene permisos suficientes. ReinstalÃ¡ la app concediendo los scopes: ${missing}.`;
    } else if (reasonRaw === 'shopify_storefront_env_missing') {
      const missing = Array.isArray(error?.missing) && error.missing.length
        ? error.missing.join(', ')
        : 'SHOPIFY_STOREFRONT_TOKEN, SHOPIFY_STOREFRONT_DOMAIN';
      friendly = `La API Storefront de Shopify no estÃ¡ configurada. Faltan las variables: ${missing}.`;
    } else if (reasonRaw === 'shopify_cart_user_error') {
      if (Array.isArray(error?.userErrors) && error.userErrors.length) {
        friendly = `Shopify rechazÃ³ el carrito generado: ${error.userErrors.join(' | ')}`;
      } else if (messageRaw && messageRaw !== 'Error') {
        friendly = messageRaw;
      } else {
        friendly = 'Shopify rechazÃ³ el carrito generado. IntentÃ¡ nuevamente en unos segundos.';
      }
    }
    setToast({ message: friendly, tone: 'error', persist: true });
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
      logger.warn('[mockup] cart_success_navigate_failed', navErr);
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

  // === Reactivar CTAs de compra: ejecutar SIEMPRE createJobAndProduct con await ===
  async function runPublish(mode, flowState, options) {
    try {
      dlog('start', { mode });
      const payloadForTrace = (() => {
        try {
          return buildShopifyPayload(flowState, mode);
        } catch (err) {
          derr('payload_failed', mode, err);
          return null;
        }
      })();
      if (payloadForTrace) {
        dlog('payload', {
          mode,
          title: payloadForTrace?.title,
          material: payloadForTrace?.material ?? payloadForTrace?.materialResolved,
          widthCm: payloadForTrace?.widthCm,
          heightCm: payloadForTrace?.heightCm,
          hasPdf: Boolean(payloadForTrace?.pdfPublicUrl),
          hasMockup: Boolean(payloadForTrace?.mockupUrl),
          price: payloadForTrace?.priceTransfer ?? payloadForTrace?.price ?? null,
        });
      }
      const result = await createJobAndProduct(mode, flowState, options);
      const resultUrl = typeof result?.checkoutUrl === 'string' && result.checkoutUrl
        ? result.checkoutUrl
        : typeof result?.productUrl === 'string' && result.productUrl
          ? result.productUrl
          : typeof result?.url === 'string' && result.url
            ? result.url
            : null;
      dlog('done', { mode, ok: result?.ok ?? true, url: resultUrl, reason: result?.reason });
      return result;
    } catch (err) {
      derr('error', mode, err);
      throw err;
    }
  }

  async function startCartFlow(extraOptions = {}) {
    if (busy && cartStatus !== 'idle') return;
    setToast(null);
    try {
      await ensureAssetsForPublish(flow);
    } catch (assetErr) {
      notifyMissingAssetsError(assetErr);
      return;
    }
    setCartStatus('creating');
    setBusy(true);
    let didOpenTarget = false;
    try {
      const normalizedDiscountCode = discountCode || '';
      const baseOptions =
        extraOptions && typeof extraOptions === 'object' ? { ...extraOptions } : {};
      if (normalizedDiscountCode) {
        baseOptions.discountCode = normalizedDiscountCode;
      }
      logger.info('[cart-flow] create_job_and_product_start');
      const result = await runPublish('cart', flow, baseOptions);
      logger.info('[cart-flow] create_job_and_product_success', {
        keys: result && typeof result === 'object' ? Object.keys(result) : null,
      });
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

      finalizeCartSuccess('Abrimos la pÃ¡gina del producto para que lo agregues al carrito.', {
        skipNavigate: didOpenTarget,
      });
      return;
    } catch (err) {
      logger.error('[cart-flow] create_job_and_product_failed', err);
      setCartStatus('idle');
      if (err?.name === 'AbortError') return;
      showFriendlyError(err, { scope: 'cart-flow' });
    } finally {
      setBusy(false);
    }
  }

  async function handle(mode, options = {}) {
    if (mode !== 'checkout' && mode !== 'cart' && mode !== 'private') return;

    let privateStageCallback = null;

    if (mode === 'cart') {
      await startCartFlow(options);
      return;
    }

    if (busy) return;

    setToast(null);
    try {
      await ensureAssetsForPublish(flow);
    } catch (assetErr) {
      notifyMissingAssetsError(assetErr);
      return;
    }

    let submissionFlow = flow;

    if (mode === 'private') {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      let emailRaw = typeof flow.customerEmail === 'string' ? flow.customerEmail.trim() : '';
      if (!emailPattern.test(emailRaw)) {
        if (typeof window === 'undefined') {
          alert('IngresÃ¡ un correo electrÃ³nico vÃ¡lido para comprar en privado.');
          return;
        }
        const promptDefault = typeof flow.customerEmail === 'string' ? flow.customerEmail : '';
        const provided = window.prompt(
          'IngresÃ¡ tu correo electrÃ³nico para continuar con la compra privada:',
          promptDefault,
        );
        if (provided == null) {
          return;
        }
        const normalized = provided.trim();
        if (!emailPattern.test(normalized)) {
          alert('IngresÃ¡ un correo electrÃ³nico vÃ¡lido para comprar en privado.');
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
      if (mode === 'checkout') {
        setPublicBusy(true);
      } else if (mode === 'private') {
        setPrivateBusy(true);
      }
      setBusy(true);
      let jobOptions = options && typeof options === 'object' ? { ...options } : {};
      if (mode === 'private') {
        const stageCallback = (stage) => {
          if (stage === 'creating_product') {
            setToast({ message: 'Creando producto privadoâ€¦' });
          } else if (stage === 'creating_checkout') {
            setToast({ message: 'Generando checkout privadoâ€¦' });
          }
        };
        privateStageCallback = stageCallback;
        setToast({ message: 'Creando producto privadoâ€¦' });
        jobOptions = {
          ...jobOptions,
          onPrivateStageChange: stageCallback,
          skipPrivateCheckout: true,
        };
      }
      const normalizedDiscountCode = discountCode || '';
      const jobOptionsWithDiscount =
        mode === 'private' || !normalizedDiscountCode
          ? jobOptions
          : { ...jobOptions, discountCode: normalizedDiscountCode };
      logger.info(`[${mode}-flow] create_job_and_product_start`);
      const result = await runPublish(mode, submissionFlow, jobOptionsWithDiscount);
      logger.info(`[${mode}-flow] create_job_and_product_success`, {
        keys: result && typeof result === 'object' ? Object.keys(result) : null,
      });
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
                return finalizeCartSuccess('Listo. Abrimos tu checkout en otra pestaÃ±a.', {
                  skipNavigate: true,
                });
              } catch (assignErr) {
                logger.warn('[checkout] location_assign_failed', assignErr);
              }
            }
          }
          finalizeCartSuccess('Listo. Abrimos tu checkout en otra pestaÃ±a.', {
            skipNavigate: true,
          });
          return;
        }
        let fallbackTarget = productUrlCandidate;
        if (!fallbackTarget) {
          const handleCandidate = handleCandidates.find((entry) => typeof entry === 'string' && entry.trim());
          if (handleCandidate && SHOPIFY_DOMAIN) {
            const trimmedHandle = safeStr(handleCandidate);
            let normalizedHandle = trimmedHandle.trim();
            normalizedHandle = safeReplace(normalizedHandle, /^\/+/, '');
            normalizedHandle = safeReplace(normalizedHandle, /\/+$/, '');
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
          finalizeCartSuccess('Listo. Abrimos tu checkout en otra pestaÃ±a.', {
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
            err.friendlyMessage = 'ConfigurÃ¡ VITE_API_BASE para conectar con la API.';
            throw err;
          }
          const err = new Error('private_checkout_network_error');
          err.reason = 'private_checkout_network_error';
          err.friendlyMessage = 'No pudimos generar el checkout privado. ProbÃ¡ de nuevo en unos segundos.';
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
            err.friendlyMessage = message || 'No pudimos generar el checkout privado, probÃ¡ de nuevo.';
          } else {
            err.friendlyMessage = 'No pudimos generar el checkout privado, probÃ¡ de nuevo.';
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
          finalizeCartSuccess('Listo. Abrimos tu checkout privado en otra pestaÃ±a.', {
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
      alert('El producto se creÃ³ pero no se pudo obtener un enlace.');
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
          secondaryActionLabel: 'Omitir publicaciÃ³n (avanzado)',
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
            : 'No pudimos generar el checkout privado. ProbÃ¡ de nuevo en unos segundos.';
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
            handle('private', {
              reuseLastProduct: true,
              payloadOverrides: buildShopifyPayload(flow, 'private'),
            });
          },
        });
        return;
      }
      logger.error(`[${mode}-flow] create_job_and_product_failed`, error);
      showFriendlyError(error, { scope: `${mode}-flow` });
    } finally {
      if (mode === 'checkout') {
        setPublicBusy(false);
      } else if (mode === 'private') {
        setPrivateBusy(false);
      }
      setBusy(false);
    }
  }

  function buildOverridesFromUi(_mode) {
    const flowLike = (typeof flow?.get === 'function' && flow.get()) || flow || {};
    const basics = extractFlowBasics(flowLike);
    const name = basics.name || 'Personalizado';
    const material = basics.mat || 'Classic';
    const width = basics.width;
    const height = basics.height;
    const title = basics.title;
    const overrides = {
      material,
      materialResolved: material,
      options: { ...(flowLike?.options || {}), material },
      productType: material === 'Glasspad' ? 'glasspad' : 'mousepad',
      title,
      designName: name,
      mockupUrl: safeStr(flowLike?.mockupPublicUrl) || safeStr(flowLike?.mockupUrl),
    };
    if (Number.isFinite(width) && width > 0) {
      overrides.widthCm = Math.round(width);
    }
    if (Number.isFinite(height) && height > 0) {
      overrides.heightCm = Math.round(height);
    }
    return overrides;
  }

  function pickOpenUrl(out) {
    if (out?.url) return out.url;
    if (out?.checkoutUrl) return out.checkoutUrl;
    if (out?.productUrl) return out.productUrl;
    if (out?.cartUrl) return out.cartUrl;
    return null;
  }

  // ---- Compra directa: evitar wrappers que cortan en silencio ----
  async function buyDirect(mode) {
    try {
      console.log('[buy] direct:start', { mode });
      try {
        await ensureMockupPublicReady(flow);
      } catch (mockupErr) {
        logger.debug?.('[mockup] ensure_mockup_public_ready_failed', mockupErr);
      }
      const stateForLog = (typeof flow?.get === 'function' ? flow.get() : flow) || {};
      const basicsForLog = extractFlowBasics(stateForLog);
      try {
        console.log('[buy] direct:flow', {
          materialRaw: stateForLog?.material,
          optionsMaterial: stateForLog?.options?.material,
          mat: basicsForLog.mat,
          widthCm: basicsForLog.width,
          heightCm: basicsForLog.height,
          title: basicsForLog.title,
        });
      } catch (_) {
        // noop
      }
      if (!Number.isFinite(basicsForLog.width) || basicsForLog.width <= 0
        || !Number.isFinite(basicsForLog.height) || basicsForLog.height <= 0) {
        setToast({ message: 'Faltan medidas del diseño. Volvé y tocá "Continuar" para guardarlas.' });
        return;
      }
      const overrides = buildOverridesFromUi(mode);
      try {
        console.log('[buy] direct:payload', {
          mode,
          material: overrides?.material ?? basicsForLog.mat,
          width: overrides?.widthCm ?? basicsForLog.width,
          height: overrides?.heightCm ?? basicsForLog.height,
          title: overrides?.title ?? basicsForLog.title,
        });
      } catch (_) {
        // noop
      }
      const result = await createJobAndProduct(mode, flow, {
        payloadOverrides: overrides,
        discountCode: discountCode || undefined,
      });
      const openUrl = pickOpenUrl(result);
      console.log('[buy] direct:done', {
        mode,
        ok: result?.ok ?? true,
        url: openUrl,
        reason: result?.reason,
        material: overrides?.material,
        w: overrides?.widthCm ?? null,
        h: overrides?.heightCm ?? null,
      });
      if (result?.ok && openUrl) {
        try {
          window.location.assign(openUrl);
        } catch (assignErr) {
          logger.warn?.('[mockup] direct_navigation_failed', assignErr);
        }
      }
      return result;
    } catch (error) {
      console.error('[buy] direct:error', mode, error);
      setToast((prev) => (prev ? prev : { message: 'No se pudo crear el producto.' }));
      throw error;
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
      alert('No se pudieron obtener las dimensiones del diseÃ±o.');
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

  /** NUEVO: scroll-to-top suave para el botÃ³n â€œvolverâ€ de la secciÃ³n */
  const scrollToTop = () => {
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      window.scrollTo(0, 0);
    }
  };

  const hasMockupImage =
    typeof mockupImageSrc === 'string'
      ? mockupImageSrc.trim().length > 0
      : Boolean(mockupImageSrc);

  return (
    <div id="mockup-review" className={styles.review}>
      <main className={styles.main}>

        {SHOW_LEGACY_PREVIEW ? (
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
              Â¿Te gustÃ³ cÃ³mo quedÃ³?
            </h1>
            {hasMockupImage ? (
              <img
                src={mockupImageSrc}
                className={styles.mockupImage}
                alt="Vista previa de tu mousepad personalizado"
              />
            ) : null}

          </div>
        ) : null}
        
        

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
              VolvÃ© al editor para crear <br></br>nuevamente tu modelo âœï¸
            </p>
          </div>
          <div className={styles.ctaCard}>
            <CtaButton
              className={`${styles.ctaButton} ${styles.ctaButtonPrimary}`}
              label={CART_STATUS_LABELS.idle}
              busyLabel={cartButtonLabel}
              isBusy={cartInteractionBusy}
              disabled={busy || cartInteractionBusy}
              onClick={withCartBtnSpin(async () => {
                if (busy || cartInteractionBusy) return;
                debugTrackFire('cta_click_cart', rid);
                trackEvent('cta_click_cart', {
                  rid,
                  design_slug: designSlug,
                  product_id: lastProductId,
                  variant_id: lastVariantId,
                  cta_type: 'cart',
                  product_handle: lastProduct?.productHandle,
                });
                return buyDirect('cart');
              })}
            />
            <p className={styles.ctaHint}>
              Arma un carrito con todo lo que te guste <br></br> y obtenÃ© envÃ­o gratis â¤ï¸
            </p>
            
             
          </div>
          <div className={styles.ctaCard}>
            <CtaButton
              className={`${styles.ctaButton} ${styles.ctaButtonPrimary1}`}
              type="button"
              label="Comprar ahora"
              busyLabel="Procesandoâ€¦"
              isBusy={buyBtnBusy}
              disabled={busy || buyBtnBusy}
              buttonRef={buyNowButtonRef}
              ariaLabel="Comprar ahora"
              onClick={() => {
                if (busy || buyBtnBusy) return;
                setBuyPromptOpen(true);
              }}
            />
            <p className={styles.ctaHint}>
              FinalizÃ¡ tu compra para que tu creaciÃ³n <br></br>se haga realidad âœ¨
            </p>
          </div>
        </div>
        <section className={styles.communitySection}>
          <h2 className={styles.communityTitle}>
            Nos encantarÃ­a que formes parte de nuestra comunidad
          </h2>
          <p className={styles.communitySubtitle}>por eso vamos a convencerte<br></br>âœ¨</p>
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
        {/* Reutilizo tus clases de tipografÃ­a */}
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
            debugTrackFire('cta_click_private', rid);
            trackEvent('cta_click_private', {
              rid,
              design_slug: designSlug,
              product_id: lastProductId,
              variant_id: lastVariantId,
              cta_type: 'private',
              product_handle: lastProduct?.productHandle,
            });
            buyDirect('private');
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
            alt="GalerÃ­a de setups de la comunidad MgM"
            className={styles.showcaseImage}
            loading="lazy"
          />
         <a href='https://www.instagram.com/stories/highlights/18057726377123944/' style={{ textDecoration: 'none' }} target='_blank'>
          <div className={styles.showcaseOverlay}>
            <p className={styles.showcaseOverlayText}>
              ConocÃ© a los +2000 que ya lo hicieron
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
  <span className={styles.backArrow} aria-hidden="true">â†‘</span>
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
              Ã—
            </button>
            <h2 id={buyPromptTitleId} className={styles.modalTitle}>
              Elige cÃ³mo publicar tu diseÃ±o
            </h2>
            <p id={buyPromptDescriptionId} className={styles.modalDescription}>
              ðŸ”“ PÃºblico: visible en la tienda. <br></br><br></br>ðŸ”’ Privado: solo vos lo verÃ¡s.
            </p>
            <div className={styles.modalActions}>
              <CtaButton
                buttonRef={firstActionButtonRef}
                className={styles.modalPrimary}
                label="Comprar pÃºblico"
                busyLabel="Procesandoâ€¦"
                isBusy={publicBusy}
                disabled={busy || buyBtnBusy}
                onClick={withBuyBtnSpin(async () => {
                  if (busy || publicBusy || buyBtnBusy) return;
                  debugTrackFire('cta_click_public', rid);
                  trackEvent('cta_click_public', {
                    rid,
                    design_slug: designSlug,
                    product_id: lastProductId,
                    variant_id: lastVariantId,
                    cta_type: 'public',
                    product_handle: lastProduct?.productHandle,
                  });
                  setBuyPromptOpen(false);
                  return buyDirect('checkout');
                })}
              />
              <CtaButton
                className={styles.modalSecondary}
                label="Comprar en privado"
                busyLabel="Procesandoâ€¦"
                isBusy={privateBusy}
                disabled={busy || buyBtnBusy}
                onClick={withBuyBtnSpin(async () => {
                  if (busy || privateBusy || buyBtnBusy) return;
                  debugTrackFire('cta_click_private', rid);
                  trackEvent('cta_click_private', {
                    rid,
                    design_slug: designSlug,
                    product_id: lastProductId,
                    variant_id: lastVariantId,
                    cta_type: 'private',
                    product_handle: lastProduct?.productHandle,
                  });
                  setBuyPromptOpen(false);
                  return buyDirect('private');
              })}
            />
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
      {/* Sin overlay en compra */}
    </div>
  );
}


