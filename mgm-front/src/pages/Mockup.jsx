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
import { diag, warn, error } from '@/lib/log';
import { bytesToMB, formatHeavyImageToastMessage } from '@/lib/imageLimits.js';
import { MAX_IMAGE_MB, MAX_IMAGE_BYTES } from '../lib/imageSizeLimit.js';

const safeStr = (v) => (typeof v === 'string' ? v : '').trim();

const isHttpUrl = (u) => !!u && typeof u === 'string' && u.startsWith('https://');
const isBlobUrl = (u) => !!u && typeof u === 'string' && u.startsWith('blob:');
const withV = (u, v) => (u ? (u.includes('?') ? `${u}&v=${encodeURIComponent(v || '')}` : `${u}?v=${encodeURIComponent(v || '')}`) : u);

const normalizeMaterialLabel = (raw) => {
  const s = safeStr(raw).toLowerCase();
  if (s.includes('glass')) return 'Glasspad';
  if (s.includes('pro')) return 'PRO';
  if (s.includes('classic')) return 'Classic';
  return '';
};

// NO mezclar material con productType.
// productType = mousepad/glasspad (tipo de producto).
// material = Classic/PRO/Glasspad (tarifa/título).
const extractFlowBasics = (flow) => {
  const productTypeRaw = safeStr(flow?.productType) || safeStr(flow?.options?.productType) || 'mousepad';
  const productType = productTypeRaw.toLowerCase().includes('glass') ? 'glasspad' : 'mousepad';
  const mat =
    normalizeMaterialLabel(flow?.material)
    || normalizeMaterialLabel(flow?.options?.material)
    || normalizeMaterialLabel(flow?.editorState?.material)
    || normalizeMaterialLabel(flow?.editorState?.options?.material)
    || normalizeMaterialLabel(flow?.editorState?.productType)
    || (productType === 'glasspad' ? 'Glasspad' : 'Classic');

  const resolveNumber = (...values) => {
    for (const value of values) {
      const num = Number(value);
      if (Number.isFinite(num) && num > 0) {
        return Math.round(num);
      }
    }
    return NaN;
  };

  let widthCm = resolveNumber(
    flow?.widthCm,
    flow?.composition?.widthCm,
    flow?.editorState?.widthCm,
    flow?.editorState?.size_cm?.w,
    flow?.editorState?.composition?.widthCm,
    flow?.masterWidthMm ? Number(flow.masterWidthMm) / 10 : undefined,
  );
  let heightCm = resolveNumber(
    flow?.heightCm,
    flow?.composition?.heightCm,
    flow?.editorState?.heightCm,
    flow?.editorState?.size_cm?.h,
    flow?.editorState?.composition?.heightCm,
    flow?.masterHeightMm ? Number(flow.masterHeightMm) / 10 : undefined,
  );

  if (mat === 'Glasspad') {
    widthCm = 49;
    heightCm = 42;
  }

  const designName = safeStr(flow?.designName)
    || safeStr(flow?.editorState?.designName)
    || 'Personalizado';

  return {
    productType,
    mat,
    widthCm: Number.isFinite(widthCm) && widthCm > 0 ? widthCm : NaN,
    heightCm: Number.isFinite(heightCm) && heightCm > 0 ? heightCm : NaN,
    designName,
  };
};

const buildTitle = ({ productType, mat, widthCm, heightCm, designName }) => {
  if (mat === 'Glasspad') {
    return `Glasspad ${designName} 49x42 | PERSONALIZADO`;
  }
  const prefix = productType.toLowerCase().includes('mouse') ? 'Mousepad' : 'Mousepad';
  const w = Number(widthCm);
  const h = Number(heightCm);
  const parts = [prefix, designName];
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    parts.push(`${w}x${h}`);
  }
  parts.push(mat, '|', 'PERSONALIZADO');
  return parts.join(' ');
};

function parseQueryOverrides() {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') {
    return {
      name: null,
      widthCm: null,
      heightCm: null,
      material: null,
    };
  }
  const sp = new URLSearchParams(window.location.search);
  const name = sp.get('name')?.trim();
  const w = Number(sp.get('w'));
  const h = Number(sp.get('h'));
  const matRaw = (sp.get('mat') || '').toLowerCase();
  let mat = null;
  if (matRaw.includes('glass')) mat = 'Glasspad';
  else if (matRaw.includes('pro')) mat = 'PRO';
  else if (matRaw.includes('classic')) mat = 'Classic';
  return {
    name: name || null,
    widthCm: Number.isFinite(w) && w > 0 ? w : null,
    heightCm: Number.isFinite(h) && h > 0 ? h : null,
    material: mat,
  };
}

import { ensureTrackingRid, trackEvent } from '@/lib/tracking';

const PUBLISH_MAX_PAYLOAD_KB = Number(import.meta.env?.VITE_PUBLISH_MAX_PAYLOAD_KB) || 200;
const FLOW_STORAGE_KEY = 'mgm_flow_v1';
const dlog = (...args) => { diag('[buy]', ...args); };
const derr = (...args) => { error('[buy]', ...args); };
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
// Si algún handler viejo lo usa como identificador global, lo definimos aquí
// para evitar ReferenceError sin alterar la lógica actual.
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

const asStr = (value, fallback = '') => {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  try {
    return String(value);
  } catch {
    return fallback;
  }
};

const safeReplace = (value, pattern, replacement) => asStr(value).replace(pattern, replacement);

function generateBridgeRid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `bridge_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function bridgeStorageKey(rid) {
  return `bridge:${rid}`;
}

function publishBridgeUrl(rid, url) {
  if (!rid || !url) return;
  try {
    localStorage.setItem(bridgeStorageKey(rid), JSON.stringify({ url, ts: Date.now() }));
  } catch (err) {
    diag('[bridge] storage_failed', err);
  }
}

function clearBridgeKey(rid) {
  if (!rid) return;
  try {
    localStorage.removeItem(bridgeStorageKey(rid));
  } catch (_) {
    // noop
  }
}

function openInNewTabSafe(url) {
  if (!isHttpUrl(url)) return false;
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener,noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch (err) {
    diag('[mockup] open_tab_failed', err);
  }
  return false;
}

function loadPersistedFlow() {
  if (typeof window === 'undefined') return null;
  const keys = ['mgm:flow', FLOW_STORAGE_KEY];
  for (const key of keys) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') continue;
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
      // continue to next key
    }
  }
  return null;
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
    error('[preview] api upload failed', {
      status: response.status,
      json,
      objectKey,
    });
    throw new Error('preview_upload_failed');
  }
  try {
    diag('[preview] uploaded', {
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
  const bytes = state?.masterBytes;
  if (bytes && bytes > MAX_IMAGE_BYTES) {
    const actualMb = bytesToMB(bytes);
    console.warn('[guard:file_too_heavy]', { maxMB: MAX_IMAGE_MB, actualMB: actualMb });
    window?.toast?.error?.(formatHeavyImageToastMessage(actualMb, MAX_IMAGE_MB), { duration: 6000 });
    const err = new Error('image_too_heavy');
    err.reason = 'image_too_heavy';
    throw err;
  }
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
  const basics = extractFlowBasics(state);
  const { productType, mat, widthCm, heightCm, designName } = basics;
  const widthRounded = Number.isFinite(widthCm) && widthCm > 0 ? Math.round(widthCm) : undefined;
  const heightRounded = Number.isFinite(heightCm) && heightCm > 0 ? Math.round(heightCm) : undefined;
  const title = buildTitle({ productType, mat, widthCm: widthRounded, heightCm: heightRounded, designName });
  const composition = {
    widthPx: Number(state?.masterWidthPx ?? input?.widthPx ?? image.naturalWidth ?? image.width ?? 0),
    heightPx: Number(state?.masterHeightPx ?? input?.heightPx ?? image.naturalHeight ?? image.height ?? 0),
    widthMm: Number(input?.widthMm ?? state?.masterWidthMm ?? 0) || undefined,
    heightMm: Number(input?.heightMm ?? state?.masterHeightMm ?? 0) || undefined,
    dpi,
    material: mat,
  };
  const designHash = safeStr(state?.designHash ?? state?.designHashState ?? input?.designHash);
  const hash8 = (designHash && designHash.slice(0, 8)) || '00000000';
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  let objectKeyTitle = safeReplace(title, /\s+/g, ' ').trim();
  if (typeof objectKeyTitle.normalize === 'function') {
    objectKeyTitle = objectKeyTitle.normalize('NFKD');
  }
  objectKeyTitle = objectKeyTitle
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const objectKey = `mockups-${yyyy}-${mm}/${objectKeyTitle || 'Personalizado'} ${hash8}.png`;
  const mockupBlob = await renderMockup1080(image, {
    material: mat,
    approxDpi: dpi,
    composition,
  });
  let publicUrl = null;
  try {
    diag('[preview] about_to_upload', {
      objectKey,
      mat,
      w: Number.isFinite(widthRounded) ? widthRounded : null,
      h: Number.isFinite(heightRounded) ? heightRounded : null,
    });
    publicUrl = await uploadPreviewViaApi(objectKey, mockupBlob);
  } catch (uploadErr) {
    diag('[mockup] preview_upload_failed', uploadErr);
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
          widthCm: Number.isFinite(widthRounded) ? widthRounded : nextState?.widthCm ?? null,
          heightCm: Number.isFinite(heightRounded) ? heightRounded : nextState?.heightCm ?? null,
          material: mat,
          designName,
          title,
          productType,
          options: { ...(nextState?.options || {}), material: mat, productType },
          mockupDataUrl: null,
        });
        flow?.setMockupVersion?.(String(Date.now()));
      }
    } catch (stateErr) {
      diag('[mockup] state_update_failed', stateErr);
    }
    try {
      diag('[audit:flow:persist]', {
        designName,
        material: mat,
        widthCm: Number.isFinite(widthRounded) ? widthRounded : null,
        heightCm: Number.isFinite(heightRounded) ? heightRounded : null,
      });
    } catch (_) {
      // noop
    }
    diag('[diag] mockup ensured', publicUrl);
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
      diag('[mockup] blob_url_failed', blobErr);
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
      flow?.setMockupVersion?.(String(Date.now()));
    } catch (stateErr) {
      diag('[mockup] fallback_state_failed', stateErr);
    }
  }

  if (fallbackUrl) {
    return fallbackUrl;
  }

  const err = new Error('missing_mockup_url');
  err.reason = 'missing_mockup_url';
  throw err;
}

async function waitUrlReady(url, tries = 8, delayMs = 350, flowForFallback = null) {
  if (!url || typeof url !== 'string') {
    return { ready: false };
  }

  if (isBlobUrl(url)) {
    let fallbackHeadUrl = null;
    let fallbackLogUrl = null;
    try {
      const flowState =
        flowForFallback && typeof flowForFallback?.get === 'function'
          ? flowForFallback.get()
          : flowForFallback || null;
      if (flowState && isHttpUrl(flowState?.mockupPublicUrl)) {
        const version = typeof flowState?.mockupV === 'string' ? flowState.mockupV : '';
        const base = withV(flowState.mockupPublicUrl, version) || flowState.mockupPublicUrl;
        fallbackLogUrl = flowState.mockupPublicUrl;
        fallbackHeadUrl = base
          ? `${base}${base.includes('?') ? '&' : '?'}cb=${Date.now()}`
          : null;
      }
    } catch (_) {
      // noop
    }
    try {
      diag('[mockup] mockup_head_skip_blob', {
        hasFallback: Boolean(fallbackHeadUrl),
      });
    } catch (_) {
      // noop
    }
    if (fallbackHeadUrl) {
      return waitUrlReady(fallbackHeadUrl, tries, delayMs);
    }
    return { ready: false, skipped: true, fallbackTried: Boolean(fallbackLogUrl) };
  }

  for (let i = 0; i < tries; i += 1) {
    try {
      const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (response.ok) {
        return { ready: true };
      }
    } catch (_) {
      // noop
    }
    await new Promise((resolve) => {
      setTimeout(resolve, delayMs * (1 + i * 0.2));
    });
  }
  return { ready: false };
}

export async function ensureMockupPublicReady(flow) {
  const resolveState = () => {
    try {
      return (typeof flow?.get === 'function' ? flow.get() : flow) || {};
    } catch {
      return flow || {};
    }
  };

  let ensuredUrl = null;
  try {
    const candidate = await ensureMockupUrlInFlow(flow);
    ensuredUrl = isHttpUrl(candidate) ? candidate : null;
  } catch (_) {
    ensuredUrl = null;
  }

  const state = resolveState();
  const base = ensuredUrl
    || (isHttpUrl(state?.mockupPublicUrl) ? state.mockupPublicUrl : null)
    || (isHttpUrl(state?.mockupUrl) ? state.mockupUrl : null);

  if (!isHttpUrl(base)) {
    return null;
  }

  const v = state?.mockupV || '';
  const baseWithV = withV(base, v);
  const urlForHead = baseWithV
    ? `${baseWithV}${base.includes('?') ? '&' : '?'}cb=${Date.now()}`
    : baseWithV;

  if (urlForHead) {
    try {
      await waitUrlReady(urlForHead, 8, 350, flow);
    } catch {
      // Mantener comportamiento actual: ignorar errores de HEAD.
    }
  }

  return baseWithV;
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

function buildShopifyPayload(flowState, mode) {
  const source = typeof flowState?.get === 'function' ? flowState.get() : flowState || {};
  const basics = extractFlowBasics(source);
  let { productType, mat, widthCm, heightCm, designName } = basics;
  if (!designName) {
    const designNameRaw = (source?.designName ?? '').toString();
    designName = designNameRaw.trim();
  }
  if (!Number.isFinite(widthCm) || widthCm <= 0 || !Number.isFinite(heightCm) || heightCm <= 0) {
    const dims = buildDimsFromFlowState(source);
    widthCm = Number.isFinite(widthCm) && widthCm > 0 ? widthCm : dims.widthCm;
    heightCm = Number.isFinite(heightCm) && heightCm > 0 ? heightCm : dims.heightCm;
  }
  if (!Number.isFinite(widthCm) || widthCm <= 0 || !Number.isFinite(heightCm) || heightCm <= 0) {
    widthCm = Number(source?.composition?.widthCm);
    heightCm = Number(source?.composition?.heightCm);
  }
  if (!Number.isFinite(widthCm) || widthCm <= 0 || !Number.isFinite(heightCm) || heightCm <= 0) {
    widthCm = Number(source?.widthCm);
    heightCm = Number(source?.heightCm);
  }
  if (!Number.isFinite(widthCm) || widthCm <= 0 || !Number.isFinite(heightCm) || heightCm <= 0) {
    widthCm = undefined;
    heightCm = undefined;
  }
  if (mat === 'Glasspad') {
    widthCm = 49;
    heightCm = 42;
  }
  const roundedWidth = Number.isFinite(widthCm) && widthCm > 0 ? Math.round(widthCm) : undefined;
  const roundedHeight = Number.isFinite(heightCm) && heightCm > 0 ? Math.round(heightCm) : undefined;
  const title = buildTitle({ productType, mat, widthCm: roundedWidth, heightCm: roundedHeight, designName });
  const priceTransfer = Number(source?.priceTransfer ?? 0);
  const priceNormal = Number(source?.priceNormal ?? 0);
  const currency = source?.priceCurrency;
  const v = source?.mockupV || '';
  const httpUrl = source?.mockupPublicUrl;
  const mockupSrcForShopify = isHttpUrl(httpUrl) ? withV(httpUrl, v) : undefined;
  const payload = {
    mode,
    designName,
    widthCm: roundedWidth,
    heightCm: roundedHeight,
    options: { ...(source?.options || {}), material: mat, productType },
    material: mat,
    materialResolved: mat,
    title,
    priceTransfer,
    priceNormal,
    currency,
    productType,
    ...(mockupSrcForShopify ? { mockupUrl: mockupSrcForShopify } : {}),
    pdfPublicUrl: source?.pdfPublicUrl,
    masterPublicUrl: source?.masterPublicUrl || null,
    designHash: source?.designHash,
    masterWidthPx: source?.masterWidthPx,
    masterHeightPx: source?.masterHeightPx,
    ...(mode === 'private' ? { isPrivate: true } : {}),
  };
  if (mode === 'private') {
    const existingMetafields = Array.isArray(payload.metafields) ? payload.metafields : [];
    const filteredMetafields = existingMetafields.filter(
      (entry) => !entry || typeof entry !== 'object'
        ? false
        : entry.namespace !== 'custom' || entry.key !== 'private',
    );
    payload.private = true;
    payload.metafields = [
      ...filteredMetafields,
      { namespace: 'custom', key: 'private', type: 'boolean', value: 'true' },
    ];
    diag('[audit:private-override]', { mode: payload.mode, private: payload.private === true });
  }
  return payload;
}


function toastErr(msg) {
  try {
    window?.toast?.error?.(msg);
  } catch (err) {
    diag('[mockup] toast_error_failed', err);
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
    toastErr('Falta el PDF. Volvé al editor y tocá "Continuar" para generarlo.');
    return;
  }
  if (code === 'missing_mockup_url') {
    toastErr('Falta la imagen de mockup. Reintentá "Continuar" o recargá la vista.');
    return;
  }
  if (code === 'missing_print_fullres_dataurl') {
    toastErr('No encontramos la composición final para generar el mockup. Volvé al editor y tocá "Continuar".');
    return;
  }
  toastErr('No se puede continuar: recursos incompletos.');
}

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

  const loadingLabel = typeof busyLabel !== 'undefined' ? busyLabel : 'Procesando…';

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
    title: '✅ Durabilidad y calidad garantizada',
    description: 'Materiales seleccionados, costuras reforzadas y tests reales. Tu pad está hecho para durar.',
  },
  {
    icon: '',
    title: 'ðŸŽ¨ Un mousepad que se adapta perfecto a tu setup',
    description: 'Material, diseño y medida elegidos por vos.',
  },
];

export default function Mockup() {
  const flow = useFlow();
  const location = useLocation();
  const navigate = useNavigate();

  function jumpHomeAndClean(currentFlow) {
    try {
      const hash = currentFlow?.designHash || currentFlow?.designHashState;
      if (hash && typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(`mgm:flow:${hash}`);
      }
    } catch {}
    try {
      currentFlow?.reset?.();
    } catch (resetErr) {
      warn('[cart] flow_reset_failed', resetErr);
    }
    navigate('/', { replace: true });
  }

  const queryOverridesRef = useRef(parseQueryOverrides());
  const canvasWrapRef = useRef(null); // MOBILE-ONLY: wrapper for touch interactions
  const mobileContainerRef = useRef(null); // MOBILE-ONLY: track current stage container element
  const preservedFlowSnapshotRef = useRef({
    widthCm: null,
    heightCm: null,
    material: null,
    designName: null,
  });
  const [flowReady, setFlowReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setFlowReady(true);
      return;
    }
    const q = queryOverridesRef.current || {};
    const persisted = loadPersistedFlow() || {};
    const current = (typeof flow?.get === 'function' ? flow.get() : flow) || {};
    const currentOptions = (current?.options && typeof current.options === 'object') ? current.options : {};
    const persistedOptions = (persisted?.options && typeof persisted.options === 'object') ? persisted.options : {};
    const mergedOptions = { ...persistedOptions, ...currentOptions };
    const patch = {};

    const designNamePersisted = safeStr(persisted.designName);
    const designNameCurrent = safeStr(current.designName);
    if (!designNameCurrent && designNamePersisted) {
      patch.designName = designNamePersisted;
    }

    const materialPersisted = safeStr(
      persisted.material
        ?? persisted.materialResolved
        ?? persistedOptions.material,
    );
    const materialCurrent = safeStr(
      current.material
        ?? current.materialResolved
        ?? currentOptions.material,
    );
    const resolvedMaterial = materialCurrent || materialPersisted || null;
    if (!materialCurrent && materialPersisted) {
      const mat = materialPersisted;
      patch.material = mat;
      patch.materialResolved = persisted.materialResolved ?? mat;
    }

    const optionMaterial = materialCurrent
      || materialPersisted
      || mergedOptions.material;
    if (optionMaterial) {
      mergedOptions.material = optionMaterial;
    }
    const mergedOptionsString = JSON.stringify(mergedOptions || {});
    const currentOptionsString = JSON.stringify(currentOptions || {});
    if (mergedOptionsString !== currentOptionsString) {
      patch.options = mergedOptions;
    }

    const currentWidth = Number(current.widthCm);
    const persistedWidth = Number(persisted.widthCm);
    if (!(Number.isFinite(currentWidth) && currentWidth > 0)) {
      const widthCandidate = Number.isFinite(persistedWidth) && persistedWidth > 0 ? persistedWidth : null;
      if (Number.isFinite(widthCandidate) && widthCandidate > 0) {
        patch.widthCm = Math.round(widthCandidate);
      }
    }

    const currentHeight = Number(current.heightCm);
    const persistedHeight = Number(persisted.heightCm);
    if (!(Number.isFinite(currentHeight) && currentHeight > 0)) {
      const heightCandidate = Number.isFinite(persistedHeight) && persistedHeight > 0 ? persistedHeight : null;
      if (Number.isFinite(heightCandidate) && heightCandidate > 0) {
        patch.heightCm = Math.round(heightCandidate);
      }
    }

    const finalWidth = Number.isFinite(Number(patch.widthCm)) ? Number(patch.widthCm) : Number(current.widthCm);
    const finalHeight = Number.isFinite(Number(patch.heightCm)) ? Number(patch.heightCm) : Number(current.heightCm);
    if (resolvedMaterial === 'Glasspad') {
      if (!(Number.isFinite(finalWidth) && finalWidth > 0)) {
        patch.widthCm = 49;
      }
      if (!(Number.isFinite(finalHeight) && finalHeight > 0)) {
        patch.heightCm = 42;
      }
    }

    const mockupPersisted = safeStr(persisted.mockupPublicUrl || persisted.mockupUrl);
    if (!safeStr(current.mockupPublicUrl) && mockupPersisted) {
      patch.mockupPublicUrl = mockupPersisted;
    }
    const mockupUrlPersisted = safeStr(persisted.mockupUrl || persisted.mockupPublicUrl);
    if (!safeStr(current.mockupUrl) && mockupUrlPersisted) {
      patch.mockupUrl = mockupUrlPersisted;
    }
    if (!safeStr(current.productType) && safeStr(persisted.productType)) {
      patch.productType = safeStr(persisted.productType);
    }
    if (!current.approxDpi && Number.isFinite(Number(persisted.approxDpi))) {
      patch.approxDpi = Number(persisted.approxDpi);
    }
    if (!current.masterWidthPx && Number.isFinite(Number(persisted.masterWidthPx))) {
      patch.masterWidthPx = Number(persisted.masterWidthPx);
    }
    if (!current.masterHeightPx && Number.isFinite(Number(persisted.masterHeightPx))) {
      patch.masterHeightPx = Number(persisted.masterHeightPx);
    }

    if (typeof flow?.set === 'function' && Object.keys(patch).length > 0) {
      const baseForPersist = {
        ...(current || {}),
        ...patch,
      };
      if (patch.options) {
        baseForPersist.options = patch.options;
      }
      flow.set(baseForPersist);
    }

    const afterPersist = (typeof flow?.get === 'function' ? flow.get() : flow) || current || {};
    const queryPatch = {};
    if (q.name) {
      queryPatch.designName = q.name;
    }
    if (q.material) {
      queryPatch.material = q.material;
      queryPatch.materialResolved = q.material;
      const baseOptions = (afterPersist?.options && typeof afterPersist.options === 'object')
        ? afterPersist.options
        : {};
      queryPatch.options = {
        ...baseOptions,
        material: q.material,
      };
    }
    if (Number.isFinite(q.widthCm) && q.widthCm > 0) {
      queryPatch.widthCm = q.widthCm;
    }
    if (Number.isFinite(q.heightCm) && q.heightCm > 0) {
      queryPatch.heightCm = q.heightCm;
    }
    const finalMaterial = queryPatch.material || queryPatch.materialResolved || resolvedMaterial;
    if (finalMaterial === 'Glasspad') {
      queryPatch.widthCm = 49;
      queryPatch.heightCm = 42;
    }

    if (typeof flow?.set === 'function' && Object.keys(queryPatch).length > 0) {
      const base = (typeof flow?.get === 'function' ? flow.get() : afterPersist) || {};
      const merged = {
        ...base,
        ...queryPatch,
      };
      if (queryPatch.options) {
        merged.options = queryPatch.options;
      }
      flow.set(merged);
      diag('[mockup] merged query overrides', queryPatch);
    }

    try {
      const mergedFlow = (typeof flow?.get === 'function' ? flow.get() : flow) || {};
      const optionsForLog = {
        ...(persistedOptions || {}),
        ...(currentOptions || {}),
        ...(mergedFlow.options || {}),
      };
      const mergedForLog = {
        ...persisted,
        ...current,
        ...patch,
        ...mergedFlow,
        ...queryPatch,
        options: {
          ...optionsForLog,
        },
      };
      const matForLog = safeStr(
        mergedForLog.material
          ?? mergedForLog.materialResolved
          ?? mergedForLog.options?.material
          ?? q.material,
      ) || null;
      const widthForLog = Number.isFinite(Number(mergedForLog.widthCm)) && Number(mergedForLog.widthCm) > 0
        ? Math.round(Number(mergedForLog.widthCm))
        : null;
      const heightForLog = Number.isFinite(Number(mergedForLog.heightCm)) && Number(mergedForLog.heightCm) > 0
        ? Math.round(Number(mergedForLog.heightCm))
        : null;
      const titleForLog = buildTitle({
        ...extractFlowBasics(mergedForLog),
        designName: safeStr(mergedForLog.designName || q.name || 'Personalizado') || 'Personalizado',
        widthCm: widthForLog || undefined,
        heightCm: heightForLog || undefined,
      });
      diag('[audit:flow:rehydrated]', {
        material: matForLog,
        optionsMaterial: mergedForLog.options?.material ?? null,
        widthCm: widthForLog,
        heightCm: heightForLog,
        title: titleForLog,
        mockupPublicUrl: mergedForLog.mockupPublicUrl ?? null,
      });
    } catch (_) {
      // noop
    }

    setFlowReady(true);
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
  const frontTitle = useMemo(() => {
    const queryOverrides = queryOverridesRef.current || {};
    const designNameRaw = typeof flow?.designName === 'string' ? flow.designName : '';
    const designNameValue = designNameRaw.trim() || 'Personalizado';
    const materialLabel = safeStr(
      flow?.material
        ?? flow?.materialResolved
        ?? flow?.options?.material
        ?? queryOverrides.material,
    );
    const isGlass = materialLabel === 'Glasspad';
    const baseCategory = isGlass ? 'Glasspad' : 'Mousepad';
    const widthCandidate = Number(
      flow?.editorState?.size_cm?.w
        ?? flow?.widthCm
        ?? queryOverrides.widthCm,
    );
    const heightCandidate = Number(
      flow?.editorState?.size_cm?.h
        ?? flow?.heightCm
        ?? queryOverrides.heightCm,
    );
    const widthCm = Number.isFinite(widthCandidate) && widthCandidate > 0 ? Math.round(widthCandidate) : null;
    const heightCm = Number.isFinite(heightCandidate) && heightCandidate > 0 ? Math.round(heightCandidate) : null;
    const hasDims = widthCm != null && heightCm != null;
    if (isGlass) {
      return hasDims
        ? `${baseCategory} ${designNameValue} ${widthCm}x${heightCm} | PERSONALIZADO`
        : `${baseCategory} ${designNameValue} | PERSONALIZADO`;
    }
    const matPart = materialLabel ? ` ${materialLabel}` : '';
    return hasDims
      ? `${baseCategory} ${designNameValue} ${widthCm}x${heightCm}${matPart} | PERSONALIZADO`
      : `${baseCategory} ${designNameValue}${matPart} | PERSONALIZADO`;
  }, [flow]);

  useEffect(() => {
    const mat = safeStr(
      flow?.material
        ?? flow?.materialResolved
        ?? flow?.options?.material,
    );
    const width = Number(flow?.widthCm);
    const height = Number(flow?.heightCm);
    if (!flowReady) return;
    if (!mat || !(Number.isFinite(width) && width > 0) || !(Number.isFinite(height) && height > 0)) {
      return;
    }
    ensureMockupUrlInFlow(flow).catch((error) => {
      diag('[mockup] ensure_mockup_url_initial_failed', err);
    });
  }, [
    flowReady,
    flow?.material,
    flow?.materialResolved,
    flow?.options?.material,
    flow?.widthCm,
    flow?.heightCm,
  ]);
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

  /* ==== [MOBILE TEMP DISABLED] Versión móvil en camino (comentado para pruebas reales) ====
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    if (typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia('(pointer: coarse)');
    const coarseMatchesRef = { current: Boolean(mediaQuery?.matches) };
    const TOUCH_DEBUG_ENABLED = (() => {
      try {
        if (typeof import.meta !== 'undefined' && import.meta.env && 'DEV' in import.meta.env) {
          return Boolean(import.meta.env.DEV);
        }
      } catch (_) {}
      try {
        if (typeof process !== 'undefined' && process?.env?.NODE_ENV) {
          return process.env.NODE_ENV !== 'production';
        }
      } catch (_) {}
      return false;
    })();
    const debugTouch = (...args) => {
      if (!TOUCH_DEBUG_ENABLED) return;
      try {
        console.debug('[touch-mobile]', ...args);
      } catch (_) {
        // ignore logging failures
      }
    };
    const isMobileActive = () => coarseMatchesRef.current === true;

    debugTouch('effect:init', { coarseInitial: coarseMatchesRef.current });

    const DEBUG_MOBILE_HITS = false;

    let bgHitStageRef = null;

    const cleanupBgHitRect = (stage) => {
      if (!stage) return;
      try {
        const bg = stage.findOne?.('.__bgHit');
        if (bg) {
          try {
            if (bg._ro?.disconnect) {
              bg._ro.disconnect();
            }
          } catch (_) {}
          try {
            bg.off('tap click pointerdown');
          } catch (_) {}
          try {
            bg.destroy();
          } catch (_) {}
        }
      } catch (_) {}
      try {
        stage.batchDraw?.();
      } catch (_) {}
    };

    const ensureBgHitRect = (stage, onEmptyTap) => {
      if (!stage) return;
      const layer = stage.getLayers?.()?.[0];
      if (!layer) return;

      let bg = stage.findOne?.('.__bgHit');
      if (!bg) {
        bg = new window.Konva.Rect({
          name: '__bgHit',
          x: 0,
          y: 0,
          width: stage.width(),
          height: stage.height(),
          fill: 'rgba(0,0,0,0.0001)',
          listening: true,
        });
        layer.add(bg);
        try {
          bg.moveToBottom?.();
        } catch (_) {}
        layer.batchDraw?.();

        const handler = (e) => {
          e.cancelBubble = true;
          try {
            onEmptyTap?.();
          } catch (_) {}
          try {
            stage.batchDraw?.();
          } catch (_) {}
        };
        bg.on('tap click pointerdown', handler);

        try {
          const ro = new ResizeObserver(() => {
            try {
              bg.size({ width: stage.width(), height: stage.height() });
            } catch (_) {}
            try {
              layer.batchDraw?.();
            } catch (_) {}
          });
          const container = stage.container?.();
          if (container) {
            ro.observe(container);
            bg._ro = ro;
          }
        } catch (_) {}
      } else {
        try {
          bg.size({ width: stage.width(), height: stage.height() });
        } catch (_) {}
        layer.batchDraw?.();
      }

      bgHitStageRef = stage;
    };

    const isSelectableKonvaNode = (node) => {
      if (!node || typeof node !== 'object') {
        return false;
      }
      const Konva = window?.Konva;
      if (!Konva || typeof Konva.Shape !== 'function') {
        return false;
      }
      if (!(node instanceof Konva.Shape)) {
        return false;
      }
      try {
        if (typeof node.visible === 'function' && !node.visible()) {
          return false;
        }
      } catch (_) {
        return false;
      }
      try {
        if (typeof node.listening === 'function' && !node.listening()) {
          return false;
        }
      } catch (_) {
        return false;
      }

      let isDraggable = false;
      try {
        if (typeof node.draggable === 'function') {
          isDraggable = Boolean(node.draggable());
        }
      } catch (_) {
        isDraggable = false;
      }

      let hasSelectableAttr = false;
      try {
        if (typeof node.getAttr === 'function') {
          const mgmSelectable = node.getAttr('mgmSelectable');
          const selectable = node.getAttr('selectable');
          hasSelectableAttr = Boolean(mgmSelectable ?? selectable);
        }
      } catch (_) {
        hasSelectableAttr = false;
      }

      const selectableNames = ['image', 'text', 'rect', 'group'];
      let hasSelectableName = false;
      try {
        if (typeof node.hasName === 'function') {
          hasSelectableName = selectableNames.some((name) => {
            try {
              return node.hasName(name);
            } catch (_) {
              return false;
            }
          });
        } else if (typeof node.name === 'function') {
          const rawName = node.name();
          if (typeof rawName === 'string' && rawName.trim()) {
            const parts = rawName.split(/\s+/g);
            hasSelectableName = parts.some((part) => selectableNames.includes(part));
          }
        } else if (typeof node?.attrs?.name === 'string') {
          const parts = node.attrs.name.split(/\s+/g);
          hasSelectableName = parts.some((part) => selectableNames.includes(part));
        }
      } catch (_) {
        hasSelectableName = false;
      }

      return Boolean(isDraggable || hasSelectableAttr || hasSelectableName);
    };

    const toSelectable = (node) => {
      if (!node || typeof node !== 'object') {
        return null;
      }
      try {
        const ancestor = node.findAncestor?.((n) => isSelectableKonvaNode(n), true);
        if (ancestor && isSelectableKonvaNode(ancestor)) {
          return ancestor;
        }
      } catch (_) {
        // ignore ancestor lookup errors
      }
      return isSelectableKonvaNode(node) ? node : null;
    };

    const tryGetSelectableNode = (value) => {
      if (!value) return null;
      const direct = toSelectable(value);
      if (direct) return direct;
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = tryGetSelectableNode(item);
          if (found) {
            return found;
          }
        }
        return null;
      }
      if (typeof value === 'object') {
        const keysToCheck = [
          'node',
          'target',
          'shape',
          'shapeRef',
          'value',
          'item',
          'group',
          'container',
          'nodes',
          'targets',
          'children',
          'handle',
        ];
        for (const key of keysToCheck) {
          if (!(key in value)) continue;
          const maybe = tryGetSelectableNode(value[key]);
          if (maybe) {
            return maybe;
          }
        }
      }
      return null;
    };

    const getCanvasPoint = (event, container) => {
      if (!container) {
        return { x: 0, y: 0 };
      }
      const rect = container.getBoundingClientRect();
      const cx = event.clientX ?? event.touches?.[0]?.clientX ?? event.changedTouches?.[0]?.clientX;
      const cy = event.clientY ?? event.touches?.[0]?.clientY ?? event.changedTouches?.[0]?.clientY;
      const resolvedCx = typeof cx === 'number' ? cx : rect.left;
      const resolvedCy = typeof cy === 'number' ? cy : rect.top;
      const x = Math.max(0, Math.min(rect.width, resolvedCx - rect.left));
      const y = Math.max(0, Math.min(rect.height, resolvedCy - rect.top));
      return { x, y };
    };

    const getCanvasPointFromEvent = (event) => {
      return getCanvasPoint(event, mobileContainerRef.current);
    };

    const nowMs = () => {
      if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
      }
      return Date.now();
    };

    const resolveEditorApi = () => {
      if (typeof window === 'undefined') return null;
      const candidates = [];
      const pushCandidate = (value) => {
        if (!value || typeof value !== 'object') return;
        candidates.push(value);
        if (value.bridge && typeof value.bridge === 'object') {
          candidates.push(value.bridge);
        }
        if (value.api && typeof value.api === 'object') {
          candidates.push(value.api);
        }
      };

      pushCandidate(window.__MGM_EDITOR__);
      pushCandidate(window.__MGM_CANVAS__);
      pushCandidate(window.__EDITOR__);
      pushCandidate(window.__CANVAS__);
      pushCandidate(window.editorBridge);
      pushCandidate(window.editor);
      pushCandidate(window.mockupEditor);

      const flowMaybe = (() => {
        try {
          return window.__MGM_FLOW__ || window.__FLOW__ || null;
        } catch (_) {
          return null;
        }
      })();
      pushCandidate(flowMaybe?.editor);
      pushCandidate(flowMaybe?.bridge);

      for (const candidate of candidates) {
        if (!candidate || typeof candidate !== 'object') continue;
        const hasHit = ['hitTest', 'hitTestPoint', 'hitTestHandles', 'pickAt', 'pickPoint']
          .some((key) => typeof candidate[key] === 'function');
        const hasClear = ['clearSelection', 'deselectAll', 'selectNone', 'resetSelection']
          .some((key) => typeof candidate[key] === 'function');
        const hasStage =
          candidate.stage || candidate.stageRef || candidate.getStage || candidate.stageNode;
        if (hasHit || hasClear || hasStage) {
          return candidate;
        }
      }
      return null;
    };

    const interpretHitResult = (value) => {
      if (!value) return false;
      if (tryGetSelectableNode(value)) {
        return true;
      }
      if (typeof value === 'boolean') return value;
      if (Array.isArray(value)) {
        return value.some((item) => interpretHitResult(item));
      }
      return false;
    };

    const resolveStageFromApi = (api) => {
      if (!api || typeof api !== 'object') return null;
      const stageCandidates = [];
      if (api.stage && typeof api.stage === 'object') stageCandidates.push(api.stage);
      if (api.stageRef?.current) stageCandidates.push(api.stageRef.current);
      if (api.stageNode && typeof api.stageNode === 'object') stageCandidates.push(api.stageNode);
      if (typeof api.getStage === 'function') {
        try {
          const stage = api.getStage();
          if (stage) stageCandidates.push(stage);
        } catch (_) {}
      }
      if (typeof window !== 'undefined') {
        try {
          const konvaStages = window.Konva?.stages;
          if (Array.isArray(konvaStages)) {
            stageCandidates.push(...konvaStages);
          }
        } catch (_) {
          // ignore
        }
      }
      for (const stage of stageCandidates) {
        if (stage && typeof stage.getIntersection === 'function') {
          return stage;
        }
      }
      return null;
    };

    const didHitAtPoint = (point) => {
      const api = resolveEditorApi();
      if (!api) {
        return null;
      }

      const candidates = [];
      const pushFn = (fn) => {
        if (typeof fn === 'function') {
          candidates.push(fn);
        }
      };

      pushFn(api.hitTest);
      pushFn(api.hitTestPoint);
      pushFn(api.hitTestHandles);
      pushFn(api.hitTestHandle);
      pushFn(api.hitTestNode);
      pushFn(api.pickAt);
      pushFn(api.pickPoint);
      pushFn(api.pickHandleAt);
      pushFn(api.pickNodeAt);

      for (const fn of candidates) {
        try {
          const result = fn.call(api, point);
          if (interpretHitResult(result)) {
            return true;
          }
        } catch (_) {
          // ignore individual hit-test errors
        }
      }

      const stage = resolveStageFromApi(api);
      if (stage) {
        try {
          const raw = stage.getIntersection(point);
          const selectable = toSelectable(raw);
          if (selectable) {
            return true;
          }
        } catch (_) {
          // ignore stage hit-test errors
        }
      }

      return false;
    };

    const clearEditorSelection = () => {
      const api = resolveEditorApi();
      if (!api) {
        return false;
      }

      const commands = [];
      const pushCommand = (fn, ctx = api) => {
        if (typeof fn === 'function') {
          commands.push(() => {
            try {
              fn.call(ctx);
              return true;
            } catch (_) {
              return false;
            }
          });
        }
      };

      pushCommand(api.clearSelection);
      pushCommand(api.deselectAll);
      pushCommand(api.selectNone);
      pushCommand(api.resetSelection);
      if (typeof api.setSelection === 'function') {
        commands.push(() => {
          try {
            api.setSelection(null);
            return true;
          } catch (_) {
            return false;
          }
        });
      }
      if (api.selection && typeof api.selection.clear === 'function') {
        commands.push(() => {
          try {
            api.selection.clear();
            return true;
          } catch (_) {
            return false;
          }
        });
      }

      for (const run of commands) {
        if (run()) {
          if (typeof api.render === 'function') {
            try {
              api.render();
            } catch (_) {}
          }
          if (typeof api.draw === 'function') {
            try {
              api.draw();
            } catch (_) {}
          }
          if (typeof api.requestRender === 'function') {
            try {
              api.requestRender();
            } catch (_) {}
          }
          return true;
        }
      }

      return false;
    };

    const isInteractiveTarget = (target) => {
      if (!target || typeof target.closest !== 'function') return false;
      return Boolean(target.closest('[data-interactive="true"]'));
    };

    // MOBILE-ONLY: ensure high-DPR devices keep pointer precision aligned
    const dprScaleIfMobile = (container) => {
      if (!container || typeof container.querySelector !== 'function') return;
      const canvas = container.querySelector('canvas');
      if (!canvas) return;
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    };

    const wrap = canvasWrapRef.current;
    if (!wrap) {
      return undefined;
    }

    let cleanupListeners = null;
    let activeStage = null;
    let pendingAttachFrame = null;
    let pendingAttachTimeout = null;

    const cancelPendingAttach = () => {
      if (pendingAttachFrame != null && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(pendingAttachFrame);
      }
      if (pendingAttachTimeout != null) {
        window.clearTimeout(pendingAttachTimeout);
      }
      pendingAttachFrame = null;
      pendingAttachTimeout = null;
    };

    const cleanupActiveListeners = (reason) => {
      if (!cleanupListeners) {
        return;
      }
      const fn = cleanupListeners;
      cleanupListeners = null;
      debugTouch('listeners:cleanup', { reason });
      try {
        fn();
      } catch (err) {
        debugTouch('listeners:cleanup:error', err);
      }
    };

    const attachToContainer = (containerNode, stage, reason = 'attach') => {
      if (!containerNode) {
        return;
      }
      let stageNode = stage;
      if (!stageNode) {
        try {
          const editor = resolveEditorApi();
          stageNode = resolveStageFromApi(editor);
        } catch (_) {
          stageNode = null;
        }
      }
      const target = stageNode?.container?.() ?? containerNode;
      if (!target) {
        return;
      }
      if (mobileContainerRef.current === target && activeStage === stageNode) {
        debugTouch('listeners:attach:noop', { reason, reuse: true });
        return;
      }
      cleanupActiveListeners('rebind');
      debugTouch('listeners:attach', {
        reason,
        hasStage: Boolean(stageNode),
        containerTag: target?.tagName ?? null,
        pointerEvents: target?.style?.pointerEvents ?? null,
      });
      cancelPendingAttach();
      mobileContainerRef.current = target;
      activeStage = stageNode || null;
      dprScaleIfMobile(target);

      ensureBgHitRect(stageNode, () => {
        clearEditorSelection();
      });

      const previousTouchAction = (() => {
        try {
          return target.style.touchAction;
        } catch (_) {
          return '';
        }
      })();
      const previousWebkitUserSelect = (() => {
        try {
          return target.style.webkitUserSelect;
        } catch (_) {
          return '';
        }
      })();
      const previousPointerEvents = (() => {
        try {
          return target.style.pointerEvents;
        } catch (_) {
          return '';
        }
      })();

      try {
        target.style.touchAction = 'none';
      } catch (_) {}
      try {
        target.style.webkitUserSelect = 'none';
      } catch (_) {}
      try {
        target.style.pointerEvents = 'auto';
      } catch (_) {}

      const state = {
        tapStart: null,
        tapMaxDistance: 0,
        tapHadMulti: false,
      };
      let isPanning = false;
      let isPinching = false;
      let lastPanPos = null;
      let lastPinchCenter = null;
      let lastPinchDist = 0;
      let baseScale = 1;

      const clamp = (value, min, max) => {
        return Math.min(Math.max(value, min), max);
      };

      const logMobileDebug = (...args) => {
        if (!TOUCH_DEBUG_ENABLED) return;
        try {
          console.debug(...args);
        } catch (_) {}
      };

      const getStagePointer = (stage) => {
        if (!stage) return null;
        try {
          const pos = stage.getPointerPosition?.();
          if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
            return { x: pos.x, y: pos.y };
          }
        } catch (_) {}
        return null;
      };

      const getEventPoints = (event, useChanged = false) => {
        if (!event) return [];
        const touchList = useChanged ? event.changedTouches : event.touches;
        if (!touchList || touchList.length === 0) {
          return [];
        }
        const containerNode = stageNode?.container?.() ?? target;
        const rect = containerNode?.getBoundingClientRect?.();
        if (!rect) {
          return [];
        }
        const points = [];
        for (let i = 0; i < touchList.length; i += 1) {
          const touch = touchList[i];
          const x = touch.clientX - rect.left;
          const y = touch.clientY - rect.top;
          points.push({ x, y });
        }
        return points;
      };

      const getGestureCenter = (points) => {
        if (!points || points.length === 0) return null;
        if (points.length === 1) {
          return { x: points[0].x, y: points[0].y };
        }
        const [first, second] = points;
        return {
          x: (first.x + second.x) / 2,
          y: (first.y + second.y) / 2,
        };
      };

      const getGestureDistance = (points) => {
        if (!points || points.length < 2) return 0;
        const [first, second] = points;
        return Math.hypot(second.x - first.x, second.y - first.y);
      };

      const resolveSelectedNode = () => {
        const editor = resolveEditorApi();
        if (!editor) return null;
        const candidates = [
          editor.selection,
          editor.selection?.node,
          editor.selection?.nodes,
          editor.selectedNode,
          editor.selectedNodes,
          editor.activeNode,
          editor.activeNodes,
          editor.currentSelection,
        ];
        for (const candidate of candidates) {
          const node = tryGetSelectableNode(candidate);
          if (node) {
            return node;
          }
        }
        return null;
      };

      const isBackgroundNode = (node, stage) => {
        if (!node) return false;
        if (stage && node === stage) return true;
        let rawName = '';
        try {
          if (typeof node.name === 'function') {
            rawName = node.name() || '';
          } else if (typeof node?.attrs?.name === 'string') {
            rawName = node.attrs.name;
          }
        } catch (_) {
          rawName = '';
        }
        if (!rawName) return false;
        const parts = rawName.split(/\s+/g);
        return parts.some((part) => part === 'background' || part === '__bgHit');
      };

      const readStagePosition = (stage) => {
        if (!stage) return { x: 0, y: 0 };
        let x = 0;
        let y = 0;
        try {
          if (typeof stage.x === 'function') {
            const value = stage.x();
            if (Number.isFinite(value)) {
              x = value;
            }
          }
        } catch (_) {}
        try {
          if (typeof stage.y === 'function') {
            const value = stage.y();
            if (Number.isFinite(value)) {
              y = value;
            }
          }
        } catch (_) {}
        return { x, y };
      };

      const readStageScale = (stage) => {
        if (!stage) return 1;
        try {
          if (typeof stage.scaleX === 'function') {
            const scaleX = stage.scaleX();
            if (Number.isFinite(scaleX)) {
              return scaleX;
            }
          }
        } catch (_) {}
        try {
          if (typeof stage.scale === 'function') {
            const scaleObj = stage.scale();
            if (scaleObj && Number.isFinite(scaleObj.x)) {
              return scaleObj.x;
            }
          }
        } catch (_) {}
        return 1;
      };

      const onTouchStart = (event) => {
        if (!isMobileActive()) return;
        if (!event) return;
        if (event.evt?.preventDefault) {
          event.evt.preventDefault();
        }
        if (isInteractiveTarget(event.evt?.target)) {
          return;
        }
        const stage = stageNode;
        if (!stage) return;

        const touches = event.evt?.touches;
        if (!touches) {
          return;
        }

        if (touches.length === 2) {
          isPinching = true;
          state.tapHadMulti = true;
          state.tapStart = null;
          isPanning = false;
          lastPanPos = null;
          const points = getEventPoints(event.evt);
          lastPinchCenter = getGestureCenter(points);
          lastPinchDist = getGestureDistance(points) || 1;
          baseScale = readStageScale(stage);
        } else if (touches.length === 1) {
          isPinching = false;
          state.tapHadMulti = false;
          const pointer = getStagePointer(stage);
          if (pointer) {
            state.tapStart = {
              x: pointer.x,
              y: pointer.y,
              time: nowMs(),
              target: event.target,
            };
            state.tapMaxDistance = 0;
          } else {
            state.tapStart = null;
          }

          const selectedNode = resolveSelectedNode();
          const selectableTarget = tryGetSelectableNode(event.target);
          if (selectableTarget && selectedNode && selectableTarget === selectedNode) {
            isPanning = false;
            lastPanPos = null;
          } else if (isBackgroundNode(event.target, stage)) {
            isPanning = true;
            lastPanPos = pointer ? { ...pointer } : null;
          } else {
            isPanning = false;
            lastPanPos = pointer ? { ...pointer } : null;
          }
        } else {
          state.tapStart = null;
          state.tapHadMulti = touches.length > 0;
          isPinching = touches.length >= 2;
          isPanning = false;
          lastPanPos = null;
        }
      };

      const onTouchMove = (event) => {
        if (!isMobileActive()) return;
        if (!event) return;
        if (event.evt?.preventDefault) {
          event.evt.preventDefault();
        }
        if (isInteractiveTarget(event.evt?.target)) {
          return;
        }
        const stage = stageNode;
        if (!stage) return;

        const touches = event.evt?.touches;
        if (!touches) {
          return;
        }

        if (touches.length >= 2 && isPinching) {
          const points = getEventPoints(event.evt);
          if (points.length >= 2 && lastPinchDist > 0) {
            const center = getGestureCenter(points);
            const dist = getGestureDistance(points);
            const oldScale = readStageScale(stage) || 1;
            let nextScale = baseScale;
            if (lastPinchDist > 0) {
              nextScale = clamp(baseScale * (dist / lastPinchDist), 0.5, 4);
            }
            const stagePos = readStagePosition(stage);
            if (center) {
              const pointerTo = {
                x: (center.x - stagePos.x) / oldScale,
                y: (center.y - stagePos.y) / oldScale,
              };
              stage.scale({ x: nextScale, y: nextScale });
              stage.position({
                x: center.x - pointerTo.x * nextScale,
                y: center.y - pointerTo.y * nextScale,
              });
              stage.batchDraw?.();
              logMobileDebug('[mobile:pinch]', nextScale);
              lastPinchCenter = center;
            }
          }
          state.tapHadMulti = true;
        } else if (touches.length === 1) {
          const pointer = getStagePointer(stage);
          if (state.tapStart && pointer) {
            const dist = Math.hypot(pointer.x - state.tapStart.x, pointer.y - state.tapStart.y);
            if (dist > state.tapMaxDistance) {
              state.tapMaxDistance = dist;
            }
          }
          if (isPanning && pointer) {
            if (!lastPanPos) {
              lastPanPos = { ...pointer };
            } else {
              const dx = pointer.x - lastPanPos.x;
              const dy = pointer.y - lastPanPos.y;
              if (dx !== 0 || dy !== 0) {
                const stagePos = readStagePosition(stage);
                stage.position({ x: stagePos.x + dx, y: stagePos.y + dy });
                stage.batchDraw?.();
                logMobileDebug('[mobile:pan]', dx, dy);
              }
              lastPanPos = { ...pointer };
            }
          }
        }
      };

      const onTouchEnd = (event) => {
        if (!isMobileActive()) return;
        if (!event) return;
        if (event.evt?.preventDefault) {
          event.evt.preventDefault();
        }
        if (isInteractiveTarget(event.evt?.target)) {
          return;
        }
        const stage = stageNode;
        if (!stage) return;

        const touches = event.evt?.touches || [];

        if (touches.length === 0) {
          const tapStart = state.tapStart;
          const pointerPos = (() => {
            const fromStage = getStagePointer(stage);
            if (fromStage) return fromStage;
            const changed = getEventPoints(event.evt, true);
            if (changed.length > 0) {
              return changed[changed.length - 1];
            }
            if (tapStart) {
              return { x: tapStart.x, y: tapStart.y };
            }
            return null;
          })();
          const duration = tapStart ? nowMs() - tapStart.time : null;
          const totalDist = tapStart && pointerPos
            ? Math.hypot(pointerPos.x - tapStart.x, pointerPos.y - tapStart.y)
            : 0;
          const maxDist = Math.max(totalDist || 0, state.tapMaxDistance || 0);
          const tapTarget = tapStart?.target;
          const stageTap = tapTarget ? isBackgroundNode(tapTarget, stage) : false;
          const finalStageTap = isBackgroundNode(event.target, stage);
          let emptyHit = false;
          if (pointerPos) {
            try {
              const intersection = stage.getIntersection?.(pointerPos);
              const selectable = tryGetSelectableNode(intersection);
              emptyHit = !selectable;
            } catch (_) {
              emptyHit = false;
            }
          }
          if (
            tapStart &&
            duration != null &&
            duration < 300 &&
            maxDist < 6 &&
            pointerPos &&
            (stageTap || finalStageTap || emptyHit)
          ) {
            clearEditorSelection();
            logMobileDebug('[mobile:tap-empty]');
            try {
              stage.batchDraw?.();
            } catch (_) {}
          }
          state.tapStart = null;
          state.tapMaxDistance = 0;
          state.tapHadMulti = false;
          isPanning = false;
          lastPanPos = null;
          isPinching = false;
          lastPinchCenter = null;
          lastPinchDist = 0;
          baseScale = readStageScale(stage);
        } else if (touches.length === 1) {
          const pointer = getStagePointer(stage);
          lastPanPos = pointer ? { ...pointer } : null;
          isPinching = false;
          state.tapHadMulti = false;
          baseScale = readStageScale(stage);
        } else {
          isPinching = touches.length >= 2;
          state.tapHadMulti = true;
        }
      };

      if (stageNode) {
        try {
          stageNode.on('touchstart', onTouchStart);
          stageNode.on('touchmove', onTouchMove);
          stageNode.on('touchend touchcancel', onTouchEnd);
        } catch (_) {}
      }

      let resizeTimeout = null;
      const onResize = () => {
        if (resizeTimeout != null) {
          window.clearTimeout(resizeTimeout);
        }
        resizeTimeout = window.setTimeout(() => {
          resizeTimeout = null;
          dprScaleIfMobile(target);
        }, 150);
      };

      window.addEventListener('resize', onResize);

      const stageTapHandler = stageNode
        ? (e) => {
          if (!isMobileActive()) return;
          if (!e || !e.evt) return;
          if (!didHitAtPoint(getCanvasPointFromEvent(e.evt))) {
            clearEditorSelection();
          }
          try {
            stageNode?.batchDraw?.();
          } catch (_) {}
        }
        : null;

      if (stageTapHandler) {
        try {
          stageNode.on('contentTap contentClick', stageTapHandler);
        } catch (_) {}
      }

      cleanupListeners = () => {
        if (stageNode) {
          try {
            stageNode.off('touchstart', onTouchStart);
          } catch (_) {}
          try {
            stageNode.off('touchmove', onTouchMove);
          } catch (_) {}
          try {
            stageNode.off('touchend touchcancel', onTouchEnd);
          } catch (_) {}
          if (stageTapHandler) {
            try {
              stageNode.off('contentTap contentClick', stageTapHandler);
            } catch (_) {}
          }
        }
        window.removeEventListener('resize', onResize);
        if (resizeTimeout != null) {
          window.clearTimeout(resizeTimeout);
          resizeTimeout = null;
        }
        if (stageNode) {
          cleanupBgHitRect(stageNode);
          if (bgHitStageRef === stageNode) {
            bgHitStageRef = null;
          }
        }
        state.tapStart = null;
        state.tapMaxDistance = 0;
        state.tapHadMulti = false;
        isPanning = false;
        isPinching = false;
        lastPanPos = null;
        lastPinchCenter = null;
        lastPinchDist = 0;
        baseScale = 1;
        if (mobileContainerRef.current === target) {
          mobileContainerRef.current = null;
        }
        if (activeStage === stageNode) {
          activeStage = null;
        }
        try {
          target.style.touchAction = previousTouchAction || '';
        } catch (_) {}
        try {
          target.style.webkitUserSelect = previousWebkitUserSelect || '';
        } catch (_) {}
        try {
          target.style.pointerEvents = previousPointerEvents || '';
        } catch (_) {}
      };
      debugTouch('listeners:attached', {
        reason,
        stageId: stageNode?._id ?? null,
        pointerEvents: target?.style?.pointerEvents ?? null,
      });
    };

    const detachIfGone = () => {
      if (mobileContainerRef.current && !wrap.contains(mobileContainerRef.current)) {
        cleanupActiveListeners('detached-from-dom');
      }
    };

    const tryAttach = (reason = 'manual') => {
      detachIfGone();
      if (!isMobileActive()) {
        debugTouch('attach:skip', { reason, coarse: false });
        cleanupActiveListeners('coarse-off');
        return;
      }
      let stage = null;
      try {
        stage = window?.Konva?.stages?.[0] ?? window?.__MGM_CANVAS__?.stage ?? null;
      } catch (_) {
        stage = null;
      }
      const container = stage?.container?.() || wrap.querySelector('.konvajs-content');
      if (container) {
        attachToContainer(container, stage, reason);
      } else {
        debugTouch('attach:pending', { reason, hasStage: Boolean(stage) });
      }
    };

    const scheduleAttach = (reason) => {
      if (!isMobileActive()) {
        debugTouch('schedule:skip', { reason, coarse: false });
        cleanupActiveListeners('schedule-coarse-off');
        cancelPendingAttach();
        return;
      }
      if (pendingAttachFrame != null || pendingAttachTimeout != null) {
        return;
      }
      debugTouch('schedule', { reason });
      if (typeof window.requestAnimationFrame === 'function') {
        pendingAttachFrame = window.requestAnimationFrame(() => {
          pendingAttachFrame = null;
          tryAttach(reason);
        });
      } else {
        pendingAttachTimeout = window.setTimeout(() => {
          pendingAttachTimeout = null;
          tryAttach(reason);
        }, 0);
      }
    };

    scheduleAttach('init');

    const observer = typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
        scheduleAttach('mutation');
      })
      : null;

    if (observer) {
      observer.observe(wrap, { childList: true, subtree: true });
    }

    let visibilityListenerAttached = false;
    const handleVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible') return;
      scheduleAttach('visibilitychange');
    };
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', handleVisibility);
      visibilityListenerAttached = true;
    }

    const handleResize = () => scheduleAttach('resize');
    const handleOrientation = () => scheduleAttach('orientationchange');

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientation);

    const mediaChangeHandler = (event) => {
      const matches = Boolean(event?.matches);
      coarseMatchesRef.current = matches;
      debugTouch('media:change', { matches });
      if (matches) {
        scheduleAttach('media-enter');
      } else {
        cleanupActiveListeners('media-exit');
        cancelPendingAttach();
      }
    };

    let mediaCleanup = null;
    try {
      if (mediaQuery) {
        if (typeof mediaQuery.addEventListener === 'function') {
          mediaQuery.addEventListener('change', mediaChangeHandler);
          mediaCleanup = () => {
            mediaQuery.removeEventListener('change', mediaChangeHandler);
          };
        } else if (typeof mediaQuery.addListener === 'function') {
          mediaQuery.addListener(mediaChangeHandler);
          mediaCleanup = () => {
            mediaQuery.removeListener(mediaChangeHandler);
          };
        }
      }
    } catch (_) {
      mediaCleanup = null;
    }

    return () => {
      debugTouch('effect:cleanup');
      observer?.disconnect();
      if (visibilityListenerAttached && typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientation);
      cancelPendingAttach();
      mediaCleanup?.();
      cleanupActiveListeners('effect-cleanup');
      if (bgHitStageRef) {
        cleanupBgHitRect(bgHitStageRef);
        bgHitStageRef = null;
      }
      mobileContainerRef.current = null;
      activeStage = null;
    };
  }, []);
  ==== [MOBILE TEMP DISABLED END] ==== */



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
      diag('[mockup] title_update_failed', err);
    }
  }, [frontTitle]);

  /* ==== [MOBILE TEMP DISABLED] Flow restore para coarse pointer (comentado para pruebas reales) ====
  useEffect(() => {
    if (!flowReady) return;
    if (typeof window === 'undefined') return;
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(pointer: coarse)');
    if (!media?.matches) return;

    const state = (typeof flow?.get === 'function' ? flow.get() : flow) || {};
    if (!state || typeof state !== 'object') return;

    const snapshot = preservedFlowSnapshotRef.current || {};
    const normalizeDim = (value) => {
      const num = Number(value);
      return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
    };

    const widthValue = normalizeDim(state.widthCm);
    const heightValue = normalizeDim(state.heightCm);
    const materialValue = safeStr(
      state.material
        ?? state.materialResolved
        ?? state.options?.material,
    ) || null;
    const designValue = safeStr(state.designName) || null;

    if (widthValue != null) {
      snapshot.widthCm = widthValue;
    }
    if (heightValue != null) {
      snapshot.heightCm = heightValue;
    }
    if (materialValue) {
      snapshot.material = materialValue;
    }
    if (designValue) {
      snapshot.designName = designValue;
    }
    preservedFlowSnapshotRef.current = snapshot;

    if (typeof flow?.set !== 'function') {
      return;
    }

    const restorePayload = {};
    if (snapshot.widthCm != null && widthValue == null) {
      restorePayload.widthCm = snapshot.widthCm;
    }
    if (snapshot.heightCm != null && heightValue == null) {
      restorePayload.heightCm = snapshot.heightCm;
    }
    if (snapshot.material && !materialValue) {
      restorePayload.material = snapshot.material;
      restorePayload.materialResolved = snapshot.material;
      const currentOptions = state?.options && typeof state.options === 'object'
        ? state.options
        : {};
      if (safeStr(currentOptions.material) !== snapshot.material) {
        restorePayload.options = { ...currentOptions, material: snapshot.material };
      }
    }
    if (snapshot.designName && !designValue) {
      restorePayload.designName = snapshot.designName;
    }

    if (Object.keys(restorePayload).length > 0) {
      try {
        flow.set(restorePayload);
        diag('[mockup] flow_mobile_restore', restorePayload);
      } catch (restoreErr) {
        diag('[mockup] flow_mobile_restore_failed', restoreErr);
      }
    }
  }, [
    flowReady,
    flow?.widthCm,
    flow?.heightCm,
    flow?.material,
    flow?.materialResolved,
    flow?.options?.material,
    flow?.designName,
    flow,
  ]);
  ==== [MOBILE TEMP DISABLED END] ==== */

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
        warn('[mockup-discount-storage-read]', storageErr);
        return '';
      }
    } catch (err) {
      warn('[mockup-discount-parse]', err);
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
      diag('[track:fire]', { event: eventName, rid: ridValue });
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
      warn('[mockup-view-flag-read]', storageErr);
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
      warn('[mockup-view-flag-write]', storageErr);
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
      warn('[mockup-view-options-flag-read]', storageErr);
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
      warn('[mockup-view-options-flag-write]', storageErr);
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
      warn('[mockup-discount-storage-write]', err);
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
        warn('[buy-prompt-focus]', focusErr);
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
      warn('[buy-prompt-return-focus]', focusErr);
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
            warn('[buy-prompt-trap-focus]', focusErr);
          }
        }
      } else {
        if (active === last) {
          event.preventDefault();
          try {
            first.focus();
          } catch (focusErr) {
            warn('[buy-prompt-trap-focus]', focusErr);
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
    error(`[${scope}]`, err);
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
      warn('[mockup] cart_success_navigate_failed', navErr);
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
          warn('[mockup] internal_navigation_failed', navErr);
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
      warn('[mockup] commerce_navigation_failed', navErr);
      try {
        window.location.assign(trimmed);
        return true;
      } catch (assignErr) {
        warn('[mockup] commerce_navigation_assign_failed', assignErr);
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

  function partitionWarnings(messages) {
    const suppressed = [];
    const remaining = [];
    const list = Array.isArray(messages) ? messages : [];
    for (const raw of list) {
      const trimmed = safeStr(raw);
      if (!trimmed) continue;
      if (trimmed.includes('No se pudo subir la imagen')) {
        suppressed.push(trimmed);
      } else {
        remaining.push(trimmed);
      }
    }
    if (suppressed.length) {
      try {
        console.debug('[mockup] suppressed_warnings', suppressed);
      } catch (err) {
        diag('[mockup] debug_log_failed', err);
      }
    }
    return { suppressed, remaining };
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
      diag('[cart-flow] create_job_and_product_start');
      const result = await runPublish('cart', flow, baseOptions);
      diag('[cart-flow] create_job_and_product_success', {
        keys: result && typeof result === 'object' ? Object.keys(result) : null,
      });
      if (SHOULD_LOG_COMMERCE) {
        try {
          const jsonForLog = result && typeof result === 'object' ? result : null;
          diag('[commerce]', {
            tag: 'startCartFlow:publish',
            json: jsonForLog,
            keys: jsonForLog ? Object.keys(jsonForLog) : [],
            busy,
            cartStatus,
          });
        } catch (logErr) {
          warn('[mockup] cart_publish_log_failed', logErr);
        }
      }
      const warningMessages = extractWarningMessages(result?.warnings, result?.warningMessages);
      const { remaining: cartVisibleWarnings } = partitionWarnings(warningMessages);
      if (cartVisibleWarnings.length) {
        try {
          warn('[mockup] cart_flow_warnings', cartVisibleWarnings);
        } catch (warnErr) {
          diag('[mockup] cart_flow_warn_log_failed', warnErr);
        }
        setToast({ message: cartVisibleWarnings.join(' ') });
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
        diag('[publish/add-to-cart]', navigationPayload);
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
      error('[cart-flow] create_job_and_product_failed', err);
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
            setToast({ message: 'Creando producto privado…' });
          } else if (stage === 'creating_checkout') {
            setToast({ message: 'Generando checkout privado…' });
          }
        };
        privateStageCallback = stageCallback;
        setToast({ message: 'Creando producto privado…' });
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
      diag(`[${mode}-flow] create_job_and_product_start`);
      const result = await runPublish(mode, submissionFlow, jobOptionsWithDiscount);
      diag(`[${mode}-flow] create_job_and_product_success`, {
        keys: result && typeof result === 'object' ? Object.keys(result) : null,
      });
      const warningMessages = extractWarningMessages(result?.warnings, result?.warningMessages);
      const { remaining: flowVisibleWarnings } = partitionWarnings(warningMessages);
      if (flowVisibleWarnings.length) {
        try {
          warn(`[${mode}-flow] warnings`, flowVisibleWarnings);
        } catch (warnErr) {
          diag('[handle] warn_log_failed', warnErr);
        }
        setToast({ message: flowVisibleWarnings.join(' ') });
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
            diag('[commerce]', {
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
            warn('[checkout] public_log_failed', logErr);
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
              warn('[checkout] popup_open_failed', openErr);
            }
            if (popup == null) {
              try {
                window.location.assign(primaryTarget);
                return finalizeCartSuccess('Listo. Abrimos tu checkout en otra pestaña.', {
                  skipNavigate: true,
                });
              } catch (assignErr) {
                warn('[checkout] location_assign_failed', assignErr);
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
          diag('[private-checkout] stage_callback_failed', stageErr);
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
          warn('[private-checkout] resolve_failed', resolveErr);
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
            err.friendlyMessage = 'Configurá VITE_API_BASE para conectar con la API.';
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
            warn('[private-checkout] json_parse_failed', parseErr);
          }
        } else {
          error('[private-checkout] non_json_response', {
            status: privateResp.status,
            contentType,
            bodyPreview: typeof rawBody === 'string' ? rawBody.slice(0, 200) : '',
            url: privateResp.url || resolvedPrivateCheckoutUrl || null,
          });
        }
        const logError = (label) => {
          try {
            error(`[private-checkout] ${label}`, {
              status: privateResp.status,
              contentType,
              bodyPreview: typeof rawBody === 'string' ? rawBody.slice(0, 200) : '',
              url: privateResp.url || resolvedPrivateCheckoutUrl || null,
            });
          } catch (logErr) {
            diag('[private-checkout] log_failed', logErr);
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
              diag('[private-checkout] request_ids', privateJson.requestIds);
            } catch (infoErr) {
              diag('[private-checkout] request_ids_log_failed', infoErr);
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
    } catch (err) {
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
          error('[private-checkout] toast_error', {
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
      error(`[${mode}-flow] create_job_and_product_failed`, err);
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
    const queryOverrides = parseQueryOverrides();
    const flowState = (typeof flow?.get === 'function' && flow.get()) || flow || {};
    const flowOptions = (flowState?.options && typeof flowState.options === 'object') ? flowState.options : {};
    const mergedState = {
      ...flowState,
      ...(queryOverrides.name ? { designName: queryOverrides.name } : {}),
      ...(Number.isFinite(queryOverrides.widthCm) && queryOverrides.widthCm > 0
        ? { widthCm: queryOverrides.widthCm }
        : {}),
      ...(Number.isFinite(queryOverrides.heightCm) && queryOverrides.heightCm > 0
        ? { heightCm: queryOverrides.heightCm }
        : {}),
      ...(queryOverrides.material
        ? { material: queryOverrides.material, materialResolved: queryOverrides.material }
        : {}),
      options: {
        ...flowOptions,
        ...(queryOverrides.material ? { material: queryOverrides.material } : {}),
      },
    };
    const basics = extractFlowBasics(mergedState);
    let { productType, mat, widthCm, heightCm, designName } = basics;
    if (!mat) {
      mat = 'Classic';
    }

    const pickSize = (...values) => {
      for (const value of values) {
        const num = Number(value);
        if (Number.isFinite(num) && num > 0) {
          return Math.round(num);
        }
      }
      return null;
    };

    let width = pickSize(
      queryOverrides.widthCm,
      widthCm,
      flowState?.widthCm,
      flowState?.editorState?.widthCm,
      flowState?.editorState?.size_cm?.w,
    );
    let height = pickSize(
      queryOverrides.heightCm,
      heightCm,
      flowState?.heightCm,
      flowState?.editorState?.heightCm,
      flowState?.editorState?.size_cm?.h,
    );

    if (mat === 'Glasspad') {
      width = 49;
      height = 42;
    }

    const resolvedDesignName = queryOverrides.name
      || designName
      || 'Personalizado';
    const title = buildTitle({
      productType,
      mat,
      widthCm: width ?? undefined,
      heightCm: height ?? undefined,
      designName: resolvedDesignName,
    });

    const priceTransferRaw = Number(flowState?.priceTransfer ?? 0);
    const price = Number.isFinite(priceTransferRaw) ? priceTransferRaw : 0;

    const mockupPublic = isHttpUrl(flowState?.mockupPublicUrl)
      ? flowState.mockupPublicUrl
      : undefined;
    const baseOverrides = {
      material: mat,
      materialResolved: mat,
      options: {
        ...flowOptions,
        material: mat,
        ...(productType ? { productType } : {}),
      },
      widthCm: width ?? undefined,
      heightCm: height ?? undefined,
      designName: resolvedDesignName,
      title,
      mockupPublicUrl: mockupPublic,
      mockupUrl: mockupPublic,
      pdfPublicUrl: flowState?.pdfPublicUrl || undefined,
      productType,
      price,
      priceTransfer: price,
    };
    if (_mode === 'private') {
      const existingMetafields = Array.isArray(baseOverrides.metafields) ? baseOverrides.metafields : [];
      const filteredMetafields = existingMetafields.filter(
        (entry) => !entry || typeof entry !== 'object'
          ? false
          : entry.namespace !== 'custom' || entry.key !== 'private',
      );
      return {
        ...baseOverrides,
        private: true,
        mode: 'private',
        checkoutType: 'private',
        metafields: [
          ...filteredMetafields,
          { namespace: 'custom', key: 'private', type: 'boolean', value: 'true' },
        ],
      };
    }
    return baseOverrides;
  }

  async function onCartClick() {
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

    setToast(null);
    const bridgeRid = generateBridgeRid();
    clearBridgeKey(bridgeRid);
    window.open(`/bridge?rid=${encodeURIComponent(bridgeRid)}`, '_blank', 'noopener');
    setCartStatus('creating');
    try {
      await ensureMockupUrlInFlow(flow);
      const overrides = { ...buildOverridesFromUi('cart'), private: false };
      const result = await buyDirect('cart', overrides, { autoOpen: false });
      const outcome = finalizePurchase(result, flow, bridgeRid, 'No se pudo abrir el producto. Intenta de nuevo.');
      return outcome;
    } catch (err) {
      warn('[cart] error', err);
      clearBridgeKey(bridgeRid);
      const fallbackMessage = 'Ocurrió un error al agregar al carrito.';
      toastErr(fallbackMessage);
      setToast({ message: fallbackMessage });
    } finally {
      setCartStatus('idle');
    }
  }

  function pickOpenUrl(out) {
    if (out?.url) return out.url;
    if (out?.checkoutUrl) return out.checkoutUrl;
    if (out?.productUrl) return out.productUrl;
    if (out?.cartUrl) return out.cartUrl;
    if (out?.privateCheckoutUrl) return out.privateCheckoutUrl;
    return null;
  }

  function finalizePurchase(result, flowRef, bridgeRid, fallbackMessage = 'No se pudo abrir el producto. Intenta de nuevo.') {
    if (!result) {
      if (bridgeRid) {
        clearBridgeKey(bridgeRid);
      }
      return { ok: false };
    }
    const targetUrl = pickOpenUrl(result);
    if (isHttpUrl(targetUrl)) {
      if (bridgeRid) {
        publishBridgeUrl(bridgeRid, targetUrl);
      } else if (!openInNewTabSafe(targetUrl)) {
        try {
          window.location.assign(targetUrl);
        } catch (assignErr) {
          warn('[mockup] finalize_navigation_failed', assignErr);
        }
      }
      const flowStateForJump = typeof flowRef?.get === 'function' ? flowRef.get() : flowRef;
      jumpHomeAndClean(flowStateForJump || flowRef);
      return { ok: true, url: targetUrl };
    }
    if (bridgeRid) {
      clearBridgeKey(bridgeRid);
    }
    toastErr(fallbackMessage);
    setToast({ message: fallbackMessage });
    return { ok: false };
  }

  // ---- Compra directa: evitar wrappers que cortan en silencio ----
  async function buyDirect(mode, overridesOverride, options = {}) {
    const normalizedOptions = options && typeof options === 'object' ? options : {};
    const skipEnsure = Boolean(normalizedOptions.skipEnsure);
    const autoOpen = normalizedOptions.autoOpen !== false;
    try {
      dlog('direct:start', { mode });
      if (!skipEnsure) {
        try {
          await ensureMockupPublicReady(flow);
        } catch (mockupErr) {
          diag('[mockup] ensure_mockup_public_ready_failed', mockupErr);
        }
      }
      const stateForLog = (typeof flow?.get === 'function' ? flow.get() : flow) || {};
      const basics = extractFlowBasics(stateForLog);
      const { productType, mat, widthCm, heightCm, designName } = basics;
      const widthRounded = Number.isFinite(widthCm) && widthCm > 0 ? Math.round(widthCm) : undefined;
      const heightRounded = Number.isFinite(heightCm) && heightCm > 0 ? Math.round(heightCm) : undefined;
      const titleForFlowLog = buildTitle({
        productType,
        mat,
        widthCm: widthRounded,
        heightCm: heightRounded,
        designName,
      });
      try {
        diag('[buy] direct:flow', {
          materialRaw: stateForLog?.material ?? null,
          optionsMaterial: stateForLog?.options?.material ?? null,
          mat,
          widthCm: widthRounded ?? null,
          heightCm: heightRounded ?? null,
          title: titleForFlowLog,
        });
      } catch (_) {
        // noop
      }
      if (!Number.isFinite(widthRounded) || widthRounded <= 0
        || !Number.isFinite(heightRounded) || heightRounded <= 0) {
        setToast({ message: 'Faltan medidas del diseño. Volvé y tocá "Continuar" para guardarlas.' });
        return;
      }
      const baseOverrides = overridesOverride || buildOverridesFromUi(mode) || {};
      const overrides = {
        ...baseOverrides,
        options: {
          ...(typeof baseOverrides.options === 'object' && baseOverrides.options ? baseOverrides.options : {}),
        },
      };
      try {
        diag('[buy] direct:payload', {
          mode,
          material: overrides?.material ?? mat,
          width: overrides?.widthCm ?? widthRounded,
          height: overrides?.heightCm ?? heightRounded,
          title: overrides?.title ?? titleForFlowLog,
        });
      } catch (_) {
        // noop
      }
      const result = await createJobAndProduct(mode, flow, {
        payloadOverrides: overrides,
        discountCode: discountCode || undefined,
      });
      const openUrl = pickOpenUrl(result);
      if (openUrl && result && typeof result === 'object' && !result.url) {
        try {
          result.url = openUrl;
        } catch (assignErr) {
          diag('[buy] direct:url_assign_failed', assignErr);
        }
      }
      diag('[buy] direct:done', {
        mode,
        ok: result?.ok ?? true,
        url: openUrl,
        reason: result?.reason,
        material: overrides?.material,
        w: overrides?.widthCm ?? null,
        h: overrides?.heightCm ?? null,
      });
      if (autoOpen && openUrl) {
        try {
          window.open(openUrl, '_blank', 'noopener');
        } catch (assignErr) {
          warn('[mockup] direct_navigation_failed', assignErr);
        }
      }
      return result;
    } catch (err) {
      error('[buy] direct:error', mode, err);
      setToast((prev) => (prev ? prev : { message: 'No se pudo crear el producto.' }));
      throw err;
    }
  }

  async function onCheckoutPublicClick() {
    if (busy || buyBtnBusy || publicBusy) return null;

    setBuyBtnBusy(true);
    setPublicBusy(true);
    setBusy(true);

    const bridgeRid = generateBridgeRid();
    clearBridgeKey(bridgeRid);
    window.open(`/bridge?rid=${encodeURIComponent(bridgeRid)}`, '_blank', 'noopener');

    try {
      setBuyPromptOpen(false);
      await ensureMockupPublicReady(flow);
      await ensureMockupUrlInFlow(flow);
      const baseOverrides = buildOverridesFromUi('checkout') || {};
      const overrides = {
        ...baseOverrides,
        options: {
          ...(typeof baseOverrides.options === 'object' && baseOverrides.options ? baseOverrides.options : {}),
        },
        visibility: 'public',
      };
      const result = await buyDirect('checkout', { ...overrides, private: false }, { skipEnsure: true, autoOpen: false });
      return finalizePurchase(result, flow, bridgeRid, 'No se pudo abrir el checkout. Intenta nuevamente.');
    } catch (err) {
      error('[checkout-public-flow]', err);
      clearBridgeKey(bridgeRid);
      setToast({ message: 'Ocurrió un error al procesar el checkout.' });
      return null;
    } finally {
      setPublicBusy(false);
      setBusy(false);
      setBuyBtnBusy(false);
    }
  }

  async function onCheckoutPrivateClick() {
    if (busy || buyBtnBusy || privateBusy) return null;

    setBuyBtnBusy(true);
    setPrivateBusy(true);
    setBusy(true);

    const bridgeRid = generateBridgeRid();
    clearBridgeKey(bridgeRid);
    window.open(`/bridge?rid=${encodeURIComponent(bridgeRid)}`, '_blank', 'noopener');

    try {
      setBuyPromptOpen(false);
      await ensureMockupPublicReady(flow);
      await ensureMockupUrlInFlow(flow);
      const baseOverrides = buildOverridesFromUi('private') || {};
      const overrides = {
        ...baseOverrides,
        options: {
          ...(typeof baseOverrides.options === 'object' && baseOverrides.options ? baseOverrides.options : {}),
        },
        visibility: 'private',
      };
      const result = await buyDirect(
        'checkout',
        { ...overrides, private: true, mode: 'private', checkoutType: 'private' },
        { skipEnsure: true, autoOpen: false },
      );
      return finalizePurchase(result, flow, bridgeRid, 'No se pudo abrir el checkout privado. Proba de nuevo.');
    } catch (err) {
      error('[checkout-private-flow]', err);
      clearBridgeKey(bridgeRid);
      setToast({ message: 'Ocurrió un error al procesar el checkout privado.' });
      return null;
    } finally {
      setPrivateBusy(false);
      setBusy(false);
      setBuyBtnBusy(false);
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
    } catch (err) {
      error('[download-pdf]', err);
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
              ¿Te gustó cómo quedó?
            </h1>
            <div className="canvas-wrap" ref={canvasWrapRef}>
              {hasMockupImage ? (
                <img
                  src={mockupImageSrc}
                  className={styles.mockupImage}
                  alt="Vista previa de tu mousepad personalizado"
                />
              ) : null}
            </div>

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
              Volvé al editor para crear <br></br>nuevamente tu modelo ✏️
            </p>
          </div>
          <div className={styles.ctaCard}>
            <CtaButton
              className={`${styles.ctaButton} ${styles.ctaButtonPrimary}`}
              label={CART_STATUS_LABELS.idle}
              busyLabel={cartButtonLabel}
              isBusy={cartInteractionBusy}
              disabled={busy || cartInteractionBusy}
              onClick={withCartBtnSpin(onCartClick)}
            />
            <p className={styles.ctaHint}>
              Arma un carrito con todo lo que te guste <br></br> y obtené envío gratis ❤️
            </p>
            
             
          </div>
          <div className={styles.ctaCard}>
            <CtaButton
              className={`${styles.ctaButton} ${styles.ctaButtonPrimary1}`}
              type="button"
              label="Comprar ahora"
              busyLabel="Procesando…"
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
            debugTrackFire('cta_click_private', rid);
            trackEvent('cta_click_private', {
              rid,
              design_slug: designSlug,
              product_id: lastProductId,
              variant_id: lastVariantId,
              cta_type: 'private',
              product_handle: lastProduct?.productHandle,
            });
            onCheckoutPrivateClick();
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
              Elegí cómo publicar tu diseño
            </h2>
            <p id={buyPromptDescriptionId} className={styles.modalDescription}>
              📣 Público: visible en la tienda. <br></br><br></br>🔒 Privado: solo vos lo verás.
            </p>
            <div className={styles.modalActions}>
              <CtaButton
                buttonRef={firstActionButtonRef}
                className={styles.modalPrimary}
                label="Comprar público"
                busyLabel="Procesando…"
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
                  return onCheckoutPublicClick();
                })}
              />
              <CtaButton
                className={styles.modalSecondary}
                label="Comprar en privado"
                busyLabel="Procesando…"
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
                  return onCheckoutPrivateClick();
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





