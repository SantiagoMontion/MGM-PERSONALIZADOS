import { diag, warn, error } from '@/lib/log';
// src/pages/Home.jsx
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useId,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import SeoJsonLd from '../components/SeoJsonLd';

import UploadStep from '../components/UploadStep';
import Calculadora from '../components/Calculadora.jsx';
import EditorCanvas from '../components/EditorCanvas';
import SizeControls from '../components/SizeControls';
import LoadingOverlay from '../components/LoadingOverlay';

import {
  LIMITS,
  STANDARD,
  GLASSPAD_SIZE_CM,
  DEFAULT_SIZE_CM,
  MIN_DIMENSION_CM_BY_MATERIAL,
} from '../lib/material.js';

import {
  dpiLevel,
  DPI_WARN_THRESHOLD,
  DPI_LOW_THRESHOLD,
} from '../lib/dpi';
import styles from './Home.module.css';
import { renderMockup1080 } from '../lib/mockup.js';
import { buildPdfFromMaster } from '../lib/buildPdf.js';
import { ensureMockupUrlInFlow } from './Mockup.jsx';
import { quickHateSymbolCheck } from '@/lib/moderation.ts';
import { scanNudityClient } from '@/lib/moderation/nsfw.client.js';
import { useFlow } from '@/state/flow.js';
import { getMaxImageMb, bytesToMB } from '@/lib/imageLimits.js';

const asStr = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const safeStr = (value, fallback = '') => {
  const str = asStr(value).trim();
  return str || fallback;
};
const safeReplace = (value, pattern, repl) => asStr(value).replace(pattern, repl);
const normalizeMaterialLabelSafe = (value) => {
  const normalized = safeStr(value).toLowerCase();
  if (normalized.includes('glass')) return 'Glasspad';
  if (normalized.includes('pro')) return 'PRO';
  return 'Classic';
};
import { apiFetch, postJSON, getResolvedApiUrl } from '@/lib/api.js';
import { resolveIconAsset } from '@/lib/iconRegistry.js';
import { sha256Hex } from '@/lib/hash.js';
import { trackEvent } from '@/lib/tracking';

const CONFIG_ICON_SRC = resolveIconAsset('wheel.svg');
const CONFIG_ARROW_ICON_SRC = resolveIconAsset('down.svg');
const TUTORIAL_ICON_SRC = resolveIconAsset('play.svg');


const DISABLE_UPLOAD_ORIGINAL = (import.meta.env?.VITE_DISABLE_UPLOAD_ORIGINAL ?? '1') === '1';
const KEEP_MASTER = (import.meta.env?.VITE_KEEP_MASTER ?? '0') === '1';
const DELETE_MASTER_AFTER_PDF = (import.meta.env?.VITE_DELETE_MASTER_AFTER_PDF ?? '1') === '1';
const CANVAS_MAX_WIDTH = 1280;
const DEFAULT_SIZE = { w: 90, h: 40 };
const ACK_LOW_ERROR_MESSAGE = 'Confirmá que aceptás imprimir en baja calidad.';
const MODERATION_REASON_MESSAGES = {
  real_nudity: 'Bloqueado por moderación: contenido adulto explícito detectado.',
  extremism_nazi: 'Bloqueado por moderación: contenido extremista nazi detectado.',
  extremism_nazi_text: 'Bloqueado por moderación: texto extremista nazi detectado.',
  invalid_body: 'No se pudo analizar la imagen enviada. Probá de nuevo.',
  server_error: 'Error del servidor de moderación. Intentá nuevamente más tarde.',
  blocked: 'Bloqueado por moderación.',
};

const MOD_PREVIEW_LIMIT_BYTES = 800_000;
const MOD_PREVIEW_THRESHOLD_BYTES = -1;
const MOD_PREVIEW_DEFAULT_MAX_DIMENSION = 1280;
const MOD_PREVIEW_DEFAULT_QUALITY = 0.85;
const MOD_PREVIEW_FALLBACK_FORMATS = ['image/jpeg'];
const MOD_PREVIEW_RETRY_QUALITIES = [0.8, 0.7, 0.6];
const MOD_PREVIEW_RETRY_DIMENSIONS = [1024, 896, 768, 640];

const LOADING_MESSAGES = [
  '¡Un Mishi ya está trabajando en tu pedido!',
  'Haciendo magia… no toques nada.',
  'Ya casi… el gato aprobó tu diseño.', // este queda fijo
];
const SKIP_MASTER_UPLOAD = String(import.meta.env?.VITE_SKIP_MASTER_UPLOAD || '0') === '1';
const MOCKUP_BUCKET = String(import.meta.env?.VITE_MOCKUP_UPLOAD_BUCKET || 'preview');

async function nextPaint(hops = 2) {
  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb) => setTimeout(cb, 16);
  for (let i = 0; i < hops; i += 1) {
    await new Promise((resolve) => raf(() => resolve()));
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function tnow() {
  return typeof performance?.now === 'function' ? performance.now() : Date.now();
}

function diagTime(label, t0) {
  try {
    const seconds = (tnow() - t0) / 1000;
    diag(`[perf] ${label}: ${seconds.toFixed(2)}s`);
  } catch (_) {
    // noop
  }
}

async function probeRemoteImageSizeMb(url, timeoutMs = 3000) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (!/^https?:/i.test(trimmed)) return null;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timeoutId = null;
  try {
    if (controller) {
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }
    const response = await fetch(trimmed, {
      method: 'HEAD',
      signal: controller?.signal,
    });
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (!response.ok) return null;
    const lengthHeader = response.headers?.get?.('content-length');
    if (!lengthHeader) return null;
    const bytes = Number(lengthHeader);
    if (!Number.isFinite(bytes) || bytes <= 0) return null;
    return bytesToMB(bytes);
  } catch (_) {
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ====== Workers (lazy) para offthread ======
let mockupWorker = null;
let shaWorker = null;
let pdfWorker = null;
function getMockupWorker() {
  try {
    if (!mockupWorker) {
      mockupWorker = new Worker(new URL('../workers/mockup.worker.js', import.meta.url), { type: 'module' });
    }
    return mockupWorker;
  } catch {
    return null;
  }
}
function getShaWorker() {
  try {
    if (!shaWorker) {
      shaWorker = new Worker(new URL('../workers/sha.worker.js', import.meta.url), { type: 'module' });
    }
    return shaWorker;
  } catch {
    return null;
  }
}
function getPdfWorker() {
  try {
    if (!pdfWorker) {
      pdfWorker = new Worker(new URL('../workers/pdf.worker.js', import.meta.url), { type: 'module' });
    }
    return pdfWorker;
  } catch {
    return null;
  }
}

async function generateMockupOffthread(imageBlob, opts) {
  const worker = getMockupWorker();
  if (!worker || !imageBlob) return null;
  const arrBuf = await imageBlob.arrayBuffer();
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(null), 12000);
    const onMessage = (event) => {
      clearTimeout(timeoutId);
      worker.removeEventListener('message', onMessage);
      const data = event.data || {};
      if (data.ok && data.type === 'mockup' && data.buffer) {
        resolve(new Blob([data.buffer], { type: 'image/png' }));
      } else {
        resolve(null);
      }
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ cmd: 'mockup', buffer: arrBuf, opts }, [arrBuf]);
  });
}

async function sha256Offthread(blob) {
  const worker = getShaWorker();
  if (!worker || !blob) return null;
  const arrBuf = await blob.arrayBuffer();
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(null), 8000);
    const onMessage = (event) => {
      clearTimeout(timeoutId);
      worker.removeEventListener('message', onMessage);
      const data = event.data || {};
      if (data.ok && data.type === 'sha256' && typeof data.hex === 'string') {
        resolve(data.hex);
      } else {
        resolve(null);
      }
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ cmd: 'sha256', buffer: arrBuf }, [arrBuf]);
  });
}

async function buildPdfOffthread(masterBlob, opts) {
  const worker = getPdfWorker();
  if (!worker || !masterBlob) return null;
  const buffer = await masterBlob.arrayBuffer();
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      worker.removeEventListener('message', onMessage);
      resolve(null);
    }, 15000);
    const onMessage = (event) => {
      const data = event.data || {};
      if (data?.type !== 'build_pdf') return;
      clearTimeout(timeoutId);
      worker.removeEventListener('message', onMessage);
      if (data.ok && data.buffer) {
        resolve(data.buffer);
      } else {
        resolve(null);
      }
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ cmd: 'build_pdf', buffer, options: opts }, [buffer]);
  });
}

function moderationReasonMessage(reason) {
  if (typeof reason === 'string' && MODERATION_REASON_MESSAGES[reason]) {
    return MODERATION_REASON_MESSAGES[reason];
  }
  if (typeof reason === 'string' && reason) {
    return `Bloqueado por moderación (código: ${reason}).`;
  }
  return 'Bloqueado por moderación.';
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('No se pudo leer el blob.'));
      }
    };
    reader.onerror = () => {
      reject(reader.error || new Error('Error leyendo el blob.'));
    };
    reader.readAsDataURL(blob);
  });
}

async function createPreviewFromImage(image, options = {}) {
  const width = image?.naturalWidth || image?.width || 0;
  const height = image?.naturalHeight || image?.height || 0;
  if (!width || !height) {
    throw new Error('La imagen no tiene dimensiones válidas.');
  }
  const {
    maxDimension = MOD_PREVIEW_DEFAULT_MAX_DIMENSION,
    quality = MOD_PREVIEW_DEFAULT_QUALITY,
    format = 'image/jpeg',
    fallbackFormats = MOD_PREVIEW_FALLBACK_FORMATS,
  } = options || {};

  const largest = Math.max(width, height);
  const appliedMaxDimension = typeof maxDimension === 'number' && maxDimension > 0
    ? Math.min(maxDimension, largest)
    : largest;
  const scale = largest > 0 ? Math.min(1, appliedMaxDimension / largest) : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.width = 0;
    canvas.height = 0;
    throw new Error('No se pudo crear el contexto para la previsualización.');
  }
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  const formatCandidates = [];
  if (typeof format === 'string' && format) {
    formatCandidates.push(format);
  }
  if (Array.isArray(fallbackFormats)) {
    for (const candidate of fallbackFormats) {
      if (typeof candidate === 'string' && candidate && !formatCandidates.includes(candidate)) {
        formatCandidates.push(candidate);
      }
    }
  }

  const toBlob = (type) => new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, type, quality);
    } catch (err) {
      resolve(null);
    }
  });

  let blob = null;
  for (const candidate of formatCandidates) {
    blob = await toBlob(candidate);
    if (blob) break;
  }
  if (!blob) {
    canvas.width = 0;
    canvas.height = 0;
    throw new Error('No se pudo generar la previsualización.');
  }
  const dataUrl = await blobToDataUrl(blob);
  canvas.width = 0;
  canvas.height = 0;
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
    return {
      blob,
      base64,
      dataUrl,
      mime: blob.type || 'image/jpeg',
    width: targetWidth,
    height: targetHeight,
    bytes: blob.size,
    options: {
        format: blob.type || formatCandidates[0] || 'image/jpeg',
      quality,
      maxDimension: appliedMaxDimension,
    },
  };
}


export default function Home() {

  // archivo subido
  const [uploaded, setUploaded] = useState(null);
  // crear ObjectURL una sola vez
  const [imageUrl, setImageUrl] = useState(null);
  const [configOpen, setConfigOpen] = useState(false);
  useEffect(() => {
    if (uploaded?.localUrl) {
      setImageUrl(uploaded.localUrl);
      return () => URL.revokeObjectURL(uploaded.localUrl);
    } else {
      setImageUrl(null);
    }
  }, [uploaded?.localUrl]);

  // No se ejecutan filtros rápidos al subir imagen

  // medidas y material (source of truth)
  const [material, setMaterial] = useState('Classic');
  const [mode, setMode] = useState('standard');

  const [size, setSize] = useState(() => ({ ...DEFAULT_SIZE_CM.Classic }));
  const sizeCm = useMemo(() => ({ w: Number(size.w) || 90, h: Number(size.h) || 40 }), [size.w, size.h]);

  const isGlasspad = material === 'Glasspad';
  const activeWcm = isGlasspad ? GLASSPAD_SIZE_CM.w : sizeCm.w;
  const activeHcm = isGlasspad ? GLASSPAD_SIZE_CM.h : sizeCm.h;
  const activeSizeCm = useMemo(() => ({ w: activeWcm, h: activeHcm }), [activeWcm, activeHcm]);
  const lastSize = useRef({});

  const glasspadInitRef = useRef(false);
  useEffect(() => {
    if (material !== 'Glasspad') {
      glasspadInitRef.current = false;
      return;
    }
    if (glasspadInitRef.current) return;
    setSize({ w: GLASSPAD_SIZE_CM.w, h: GLASSPAD_SIZE_CM.h });
    glasspadInitRef.current = true;
  }, [material]);

  const [priceAmount, setPriceAmount] = useState(0);
  const PRICE_CURRENCY = 'ARS';

  // layout del canvas
  const [layout, setLayout] = useState(null);
  const [designName, setDesignName] = useState('');
  const [designNameError, setDesignNameError] = useState('');
  const [ackLow, setAckLow] = useState(false);
  const [ackLowError, setAckLowError] = useState(false);
  const ackCheckboxRef = useRef(null);
  const ackLowErrorDescriptionId = useId();
  const [err, setErr] = useState('');
  const [moderationNotice, setModerationNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [msgIndex, setMsgIndex] = useState(0);
  const [masterPublicUrl, setMasterPublicUrl] = useState(null);
  const [masterWidthPx, setMasterWidthPx] = useState(null);
  const [masterHeightPx, setMasterHeightPx] = useState(null);
  const [designHashState, setDesignHashState] = useState(null);
  const [pdfPublicUrl, setPdfPublicUrl] = useState(null);
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const designNameInputRef = useRef(null);
  const pageRef = useRef(null);
  const sectionOneRef = useRef(null);
  const sectionOneInnerRef = useRef(null);
  const headingRef = useRef(null);
  const lienzoCardRef = useRef(null);
  const configDropdownRef = useRef(null);
  const configTriggerButtonRef = useRef(null);
  const configPanelRef = useRef(null);
  const [configPanelStyle, setConfigPanelStyle] = useState({});
  const wasConfigOpenRef = useRef(false);
  const [canvasFit, setCanvasFit] = useState({ height: null, maxWidth: null, sectionOneMinHeight: null });
  const flow = useFlow();

  useEffect(() => {
    if (!busy) {
      setMsgIndex(0);
      return undefined;
    }
    setMsgIndex(0);
    const t1 = setTimeout(() => setMsgIndex(1), 12000);
    const t2 = setTimeout(() => setMsgIndex(2), 24000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [busy]);

  const handleClearImage = useCallback(() => {
    setUploaded(null);
    setLayout(null);
    setAckLowError(false);
    setDesignName('');
    setDesignNameError('');
    setAckLow(false);
    setErr('');
    setModerationNotice('');
    setPriceAmount(0);
  }, []);

  const effDpi = useMemo(() => {
    if (!layout) return null;
    return Math.round(
      Math.min(
        layout.dpi / Math.max(1e-6, layout.transform.scaleX),
        layout.dpi / Math.max(1e-6, layout.transform.scaleY)
      )
    );
  }, [layout]);
  const level = useMemo(
    () => (effDpi ? dpiLevel(effDpi, DPI_WARN_THRESHOLD, DPI_LOW_THRESHOLD) : null),
    [effDpi],
  );
  const trimmedDesignName = useMemo(() => (designName || '').trim(), [designName]);

  function handleSizeChange(next) {
    if (next.material && next.material !== material) {
      if (material !== 'Glasspad') {
        lastSize.current[material] = { ...size };
      }
      if (next.material === 'Glasspad') {
        setMaterial('Glasspad');
        setMode('standard');
        setSize({ w: GLASSPAD_SIZE_CM.w, h: GLASSPAD_SIZE_CM.h });
        return;
      }
      const lim = LIMITS[next.material];
      const stored = lastSize.current[next.material];

      const shouldUseDefaultSize = !stored && material === 'Glasspad';
      const defaultSize = DEFAULT_SIZE_CM[next.material];
      const prev = shouldUseDefaultSize
        ? defaultSize || size
        : (mode === 'custom' || !stored ? size : stored);
      const clamped = {
        w: Math.min(
          Math.max(prev.w, MIN_DIMENSION_CM_BY_MATERIAL[next.material]?.w ?? 1),
          lim.maxW,
        ),
        h: Math.min(
          Math.max(prev.h, MIN_DIMENSION_CM_BY_MATERIAL[next.material]?.h ?? 1),
          lim.maxH,
        ),

      };

      setMaterial(next.material);
      setSize(clamped);

      let nextModeValue = 'custom';
      if (!preservedCustom) {
        const isStd = (STANDARD[next.material] || []).some(
          opt => Number(opt.w) === Number(clamped.w) && Number(opt.h) === Number(clamped.h)
        );
        nextModeValue = isStd ? 'standard' : 'custom';
      }

      setMode(nextModeValue);

      if (!stored || stored.w !== clamped.w || stored.h !== clamped.h) {
        lastSize.current[next.material] = clamped;
      }
      return;
    }
    if (next.mode && next.mode !== mode) {
      setMode(next.mode);
      if (next.mode === 'standard' && typeof next.w === 'number' && typeof next.h === 'number') {
        setSize({ w: next.w, h: next.h });
        if (material !== 'Glasspad') {
          lastSize.current[material] = { w: next.w, h: next.h };
        }
      }
    }
    if (typeof next.w === 'number' || typeof next.h === 'number') {
      const nextSize = {
        w: typeof next.w === 'number' ? next.w : size.w,
        h: typeof next.h === 'number' ? next.h : size.h,
      };
      setSize(nextSize);
      if (material !== 'Glasspad') {
        lastSize.current[material] = nextSize;
      }
    }
  }


  function handleDesignNameChange(event) {
    const { value } = event.target;
    setDesignName(value);
    if (designNameError && value.trim().length >= 2) {
      setDesignNameError('');
    }
  }

  async function uploadOriginal(payload) {
    const { file, ...rest } = payload || {};
    let response;

    const isBlob = typeof Blob !== 'undefined' && file instanceof Blob;
    if (isBlob) {
      const formData = new FormData();
      const filename = typeof file.name === 'string' && file.name ? file.name : 'upload.bin';
      formData.append('file', file, filename);
      for (const [key, value] of Object.entries(rest)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const entry of value) {
            if (entry === undefined || entry === null) continue;
            formData.append(key, typeof entry === 'string' ? entry : String(entry));
          }
          continue;
        }
        formData.append(key, typeof value === 'string' ? value : String(value));
      }
      response = await apiFetch('POST', '/api/upload-original', formData);
    } else {
      response = await apiFetch('POST', '/api/upload-original', rest);
    }

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!response.ok) {
      const message = typeof json?.error === 'string' && json.error ? json.error : text;
      const error = new Error(`HTTP ${response.status}${message ? ` ${message}` : ''}`.trim());
      error.status = response.status;
      error.bodyText = text;
      error.json = json;
      throw error;
    }

    const publicUrl = json?.publicUrl ?? json?.url ?? json?.supabase?.publicUrl ?? null;
    if (!publicUrl) {
      const error = new Error('upload-original: missing publicUrl');
      error.status = response.status;
      error.bodyText = text;
      error.json = json;
      throw error;
    }

    return { publicUrl, json: json ?? {} };
  }

  async function handleContinue() {
    const ridCandidate =
      uploaded?.upload_diag_id
      || flow?.uploadDiagId
      || flow?.editorState?.diag_id
      || flow?.editorState?.upload_diag_id
      || flow?.editorState?.job?.rid
      || flow?.editorState?.job?.diag_id
      || undefined;
    const designSlugCandidate =
      layout?.design?.slug
      || layout?.design_slug
      || flow?.editorState?.design?.slug
      || flow?.editorState?.design_slug
      || flow?.editorState?.designSlug
      || undefined;
    try {
      trackEvent && trackEvent('continue_design', {
        rid: ridCandidate,
        design_slug: designSlugCandidate,
      });
    } catch {}
    setErr('');
    if (!layout?.image || !canvasRef.current) {
      setErr('Falta imagen o layout');
      return;
    }
    if (trimmedDesignName.length < 2) {
      setDesignNameError('Ingresa un nombre para tu modelo antes de continuar');
      setConfigOpen(true);
      designNameInputRef.current?.focus?.();
      return;
    }
    setDesignNameError('');
    if (requiresLowAck && !ackLow) {
      setAckLowError(true);
      setErr(ACK_LOW_ERROR_MESSAGE);
      ackCheckboxRef.current?.focus?.({ preventScroll: true });
      return;
    }
    try {
      setModerationNotice('');
      setBusy(true);
      const flowState = (typeof flow?.get === 'function' ? flow.get() : flow) || {};
      const maxImageMb = getMaxImageMb();
      const notifyTooHeavy = (actualMB) => {
        console.warn('[guard:file_too_heavy]', { maxMB: maxImageMb, actualMB });
        const toast = window?.toast;
        toast?.error?.(
          `La imagen supera el peso máximo permitido (Máx: ${maxImageMb} MB, tu imagen: ${actualMB} MB).\n`
            + 'Elegí una imagen más liviana y volvé a intentar.',
        );
        setBusy(false);
      };
      const masterFile = uploaded?.file || flowState?.masterFile || null;
      if (masterFile?.size) {
        const masterSizeMb = bytesToMB(masterFile.size);
        if (masterSizeMb > maxImageMb) {
          notifyTooHeavy(masterSizeMb);
          return;
        }
      } else {
        const remoteUrlCandidates = [
          typeof masterPublicUrl === 'string' ? masterPublicUrl : null,
          typeof flowState?.masterPublicUrl === 'string' ? flowState.masterPublicUrl : null,
          typeof flowState?.fileOriginalUrl === 'string' ? flowState.fileOriginalUrl : null,
        ].filter(Boolean);
        let remoteImageSizeMb = null;
        for (const candidate of remoteUrlCandidates) {
          const probed = await probeRemoteImageSizeMb(candidate, 3000);
          if (probed != null) {
            remoteImageSizeMb = probed;
            break;
          }
        }
        if (remoteImageSizeMb != null && remoteImageSizeMb > maxImageMb) {
          notifyTooHeavy(remoteImageSizeMb);
          return;
        }
      }
      await nextPaint(2);
      const designBlob = await canvasRef.current.exportPadAsBlob?.();
      if (!designBlob || !designBlob.size) {
        setErr('No se pudo generar la imagen');
        return;
      }
      const designShaPromise = (async () => {
        const workerHash = await sha256Offthread(designBlob);
        if (workerHash) return workerHash;
        return sha256Hex(designBlob);
      })();
      const masterDataUrl = await blobToDataUrl(designBlob);
      await nextPaint(1);

      // client-side gate: filename keywords
      const metaForCheck = [uploaded?.file?.name, trimmedDesignName].filter(Boolean).join(' ');
      if (quickHateSymbolCheck(metaForCheck)) {
        setErr('Contenido no permitido (odio nazi detectado)');
        return;
      }

      // client-side gate: NSFW scan in browser (no server TFJS)
      try {
        const res = await scanNudityClient(masterDataUrl);
        if (res?.blocked) {
          let message = 'Contenido adulto detectado.';
          if (res.reason === 'client_real_nudity') {
            message = 'Contenido adulto explícito con personas reales detectado.';
          } else if (res.reason === 'client_real_sexual') {
            message = 'Contenido sexual explícito con personas reales detectado.';
          }
          setErr(message);
          return;
        }
      } catch (scanErr) {
        error('[continue] nudity scan failed', scanErr?.message || scanErr);
      }

      const masterImagePromise = (async () => {
        const img = new Image();
        img.src = masterDataUrl;
        await img.decode();
        return img;
      })();

      const baseModerationPayload = {
        filename: uploaded?.file?.name || 'image.png',
        designName: trimmedDesignName,
        lowQualityAck: level === 'bad' ? Boolean(ackLow) : false,
        approxDpi: effDpi || undefined,
        rid: ridCandidate || undefined,
      };
      const defaultPreviewOptions = {
        maxDimension: MOD_PREVIEW_DEFAULT_MAX_DIMENSION,
        quality: MOD_PREVIEW_DEFAULT_QUALITY,
        format: 'image/jpeg',
        fallbackFormats: MOD_PREVIEW_FALLBACK_FORMATS,
      };

      const previewCache = new Map();
      const ensurePreview = (options = defaultPreviewOptions) => {
        const key = JSON.stringify({
          maxDimension: options?.maxDimension ?? null,
          quality: options?.quality ?? null,
          format: options?.format || 'image/jpeg',
          fallback: Array.isArray(options?.fallbackFormats) ? options.fallbackFormats : [],
        });
        if (!previewCache.has(key)) {
          const promise = (async () => {
            const image = await masterImagePromise;
            return createPreviewFromImage(image, options);
          })().catch((err) => {
            previewCache.delete(key);
            throw err;
          });
          previewCache.set(key, promise);
        }
        return previewCache.get(key);
      };

      const sendPreviewModerationRequest = async (preview) => {
        return postJSON(
          getResolvedApiUrl('/api/moderate-image?preview=1&debug=1'),
          { ...baseModerationPayload, imageBase64: preview.base64 },
          60000,
        );
      };

      const sendOriginalModerationRequest = () => postJSON(
        getResolvedApiUrl('/api/moderate-image?debug=1'),
        { ...baseModerationPayload, dataUrl: masterDataUrl },
        60000,
      );

      const uploadedSize = uploaded?.file?.size || 0;
      const usePreviewFirst = uploadedSize > MOD_PREVIEW_THRESHOLD_BYTES;

      const performPreviewFallback = async (limitHint) => {
        let previewLimit = Number(limitHint) || MOD_PREVIEW_LIMIT_BYTES;
        if (!Number.isFinite(previewLimit) || previewLimit <= 0) {
          previewLimit = MOD_PREVIEW_LIMIT_BYTES;
        }
        let lastError = null;
        let adjustmentsMade = true;
        let previewAttempts = 0;

        const trySend = async (options) => {
          const preview = await ensurePreview(options);
          if (previewLimit && Number.isFinite(previewLimit) && preview.bytes > previewLimit) {
            adjustmentsMade = true;
            return null;
          }
          if (previewAttempts >= 2) {
            return null;
          }
          previewAttempts += 1;
          try {
            const response = await sendPreviewModerationRequest(preview);
            if (adjustmentsMade) {
              setModerationNotice('Tu imagen es grande, ajustamos la vista previa; el archivo original se mantiene intacto.');
            }
            return response;
          } catch (err) {
            if (err?.status === 413) {
              adjustmentsMade = true;
              lastError = err;
              const nextLimit = Number(err?.json?.limitBytes ?? err?.json?.limit ?? err?.json?.limit_bytes);
              if (Number.isFinite(nextLimit) && nextLimit > 0) {
                previewLimit = nextLimit;
              }
              return null;
            }
            throw err;
          }
        };

        const qualityOptions = MOD_PREVIEW_RETRY_QUALITIES.map((quality) => ({
          maxDimension: MOD_PREVIEW_DEFAULT_MAX_DIMENSION,
          quality,
          format: 'image/jpeg',
          fallbackFormats: ['image/jpeg'],
        }));
        const dimensionOptions = MOD_PREVIEW_RETRY_DIMENSIONS.map((maxDimension) => ({
          maxDimension,
          quality: 0.6,
          format: 'image/jpeg',
          fallbackFormats: ['image/jpeg'],
        }));

        for (const options of [...qualityOptions, ...dimensionOptions]) {
          const response = await trySend(options);
          if (response) {
            return response;
          }
        }

        if (lastError) {
          throw lastError;
        }
        throw new Error('preview_optimization_failed');
      };

      let moderationResponse;
      try {
        if (usePreviewFirst) {
          try {
            const preview = await ensurePreview(defaultPreviewOptions);
            moderationResponse = await sendPreviewModerationRequest(preview);
          } catch (previewErr) {
            if (previewErr?.status === 413) {
              const limitHint = previewErr?.json?.limitBytes ?? previewErr?.json?.limit ?? previewErr?.json?.limit_bytes;
              moderationResponse = await performPreviewFallback(limitHint);
            } else {
              throw previewErr;
            }
          }
        } else {
          try {
            moderationResponse = await sendOriginalModerationRequest();
          } catch (moderationErr) {
            if (moderationErr?.status === 413) {
              const preview = await ensurePreview(defaultPreviewOptions);
              try {
                moderationResponse = await sendPreviewModerationRequest(preview);
              } catch (previewErr) {
                if (previewErr?.status === 413) {
                  const limitHint = previewErr?.json?.limitBytes ?? previewErr?.json?.limit ?? previewErr?.json?.limit_bytes;
                  moderationResponse = await performPreviewFallback(limitHint);
                } else {
                  throw previewErr;
                }
              }
            } else {
              throw moderationErr;
            }
          }
        }
      } catch (moderationErr) {
        error('moderate-image failed', moderationErr);
        setErr('No se pudo validar la imagen. Intentá nuevamente.');
        return;
      }
      if (!moderationResponse?.ok) {
        const message = moderationReasonMessage(moderationResponse?.reason);
        setErr(message);
        return;
      }

      await nextPaint(1);
      const img = await masterImagePromise;
      const pxPerCm = layout?.dpi ? layout.dpi / 2.54 : (effDpi || 300) / 2.54;
      const masterWidthExact = Math.max(1, Math.round(activeWcm * pxPerCm));
      const masterHeightExact = Math.max(1, Math.round(activeHcm * pxPerCm));
      const masterWidthMm = activeWcm * 10;
      const masterHeightMm = activeHcm * 10;
      const dpiForMockup = layout?.dpi || effDpi || 300;
      const designMime = designBlob.type || 'image/png';
      const shouldUploadMaster = KEEP_MASTER && !SKIP_MASTER_UPLOAD;
      const sanitizeForFileName = (value, fallback = 'Design') => {
        const base = safeStr(value, fallback);
        const cleaned = safeReplace(base, /[\\/:*?"<>|]+/g, '').trim();
        return cleaned || fallback;
      };
      const formatDimensionCm = (cm) => {
        const num = Number(cm);
        if (!Number.isFinite(num) || num <= 0) return '0';
        const rounded = Math.round(num * 10) / 10;
        const formatted = Number.isInteger(rounded) ? String(Math.trunc(rounded)) : String(rounded);
        return safeReplace(formatted, /\.0+$/, '');
      };
      let materialLabel = String(material || '').trim();
      if (/pro/i.test(materialLabel)) materialLabel = 'PRO';
      else if (/glass/i.test(materialLabel)) materialLabel = 'Glasspad';
      else if (!materialLabel || /classic/i.test(materialLabel)) materialLabel = 'Classic';
      const namePart = sanitizeForFileName(trimmedDesignName);
      const widthLabel = formatDimensionCm(activeWcm ?? (masterWidthMm ? masterWidthMm / 10 : undefined));
      const heightLabel = formatDimensionCm(activeHcm ?? (masterHeightMm ? masterHeightMm / 10 : undefined));
      const materialPart = sanitizeForFileName(materialLabel, 'Classic');
      const pdfFileName = safeReplace(`${namePart} ${widthLabel}x${heightLabel} ${materialPart}`, /\s+/g, ' ').trim();
      const yyyymmValue = (() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      })();
      const pdfPath = `pdf-${yyyymmValue}/${pdfFileName}.pdf`;
      const mockupPath = `mockups-${yyyymmValue}/${pdfFileName}.png`;

      const mockupStart = tnow();
      const mockupPromise = (async () => {
        let blob = null;
        try {
          blob = await generateMockupOffthread(designBlob, {
            composition: {
              widthPx: flowState?.masterWidthPx || masterWidthExact,
              heightPx: flowState?.masterHeightPx || masterHeightExact,
              widthCm: flowState?.widthCm || activeWcm,
              heightCm: flowState?.heightCm || activeHcm,
            },
            material: flowState?.material || material,
            options: { material: flowState?.material || material },
            materialLabel: flowState?.material || material,
            radiusPx: Number(import.meta.env?.VITE_MOCKUP_PAD_RADIUS_PX) || 8,
          });
        } catch (_) {
          blob = null;
        }
        if (!blob) {
          blob = await renderMockup1080(img, {
            material,
            materialLabel: material,
            approxDpi: dpiForMockup,
            composition: {
              widthPx: masterWidthExact,
              heightPx: masterHeightExact,
              widthCm: activeWcm,
              heightCm: activeHcm,
              widthMm: masterWidthMm,
              heightMm: masterHeightMm,
              dpi: dpiForMockup,
              material,
            },
          });
        }
        diagTime('mockup_ready', mockupStart);
        const mockupUrl = URL.createObjectURL(blob);
        let mockupPublicUrl = flowState?.mockupPublicUrl || null;
        if (!mockupPublicUrl) {
          try {
            const sign = await postJSON(
              getResolvedApiUrl('/api/storage/sign'),
              { bucket: MOCKUP_BUCKET, contentType: 'image/png', path: mockupPath },
              30000,
            );
            if (sign?.uploadUrl) {
              const uploadRes = await fetch(sign.uploadUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'image/png' },
                body: blob,
              });
              if (uploadRes.ok) {
                mockupPublicUrl = sign.publicUrl || mockupPublicUrl;
              }
            }
          } catch (mockupUploadErr) {
            warn('[diag] mockup upload failed', mockupUploadErr);
          }
        }
        return { mockupBlob: blob, mockupUrl, mockupPublicUrl };
      })();

      const pdfStart = tnow();
      const pdfPromise = (async () => {
        const maxPdfBytes = Number(import.meta.env?.VITE_MAX_PDF_BYTES) || 40 * 1024 * 1024;
        let bytes = await buildPdfOffthread(designBlob, {
          bleedMm: 20,
          widthPx: masterWidthExact,
          heightPx: masterHeightExact,
          widthMm: masterWidthMm,
          heightMm: masterHeightMm,
          maxBytes: maxPdfBytes,
          mime: designMime,
        });
        if (!bytes) {
          const localBytes = await buildPdfFromMaster(designBlob, {
            bleedMm: 20,
            widthPx: masterWidthExact,
            heightPx: masterHeightExact,
            widthMm: masterWidthMm,
            heightMm: masterHeightMm,
            maxBytes: maxPdfBytes,
            mime: designMime,
          });
          bytes = localBytes?.buffer && localBytes.byteOffset === 0 && localBytes.byteLength === localBytes.buffer?.byteLength
            ? localBytes.buffer
            : localBytes?.buffer || localBytes || null;
        }
        diagTime('pdf_built', pdfStart);
        return bytes;
      })();

      const shaStart = tnow();
      const shaPromise = (async () => {
        const hex = await designShaPromise;
        diagTime('sha_done', shaStart);
        return hex;
      })();

      const signStart = tnow();
      const pdfSignPromise = postJSON(
        getResolvedApiUrl('/api/storage/sign'),
        { bucket: 'outputs', contentType: 'application/pdf', path: pdfPath },
        60000,
      );
      const masterSignPromise = shouldUploadMaster
        ? postJSON(getResolvedApiUrl('/api/storage/sign'), { bucket: 'outputs', contentType: designMime }, 60000)
        : Promise.resolve(null);

      const [pdfBytes, pdfSign, masterSign, designSha, mockupResult] = await Promise.all([
        pdfPromise,
        pdfSignPromise,
        masterSignPromise,
        shaPromise,
        mockupPromise,
      ]);
      diagTime('signs_ready', signStart);

      if (!pdfBytes) {
        setErr('No se pudo generar el PDF.');
        return;
      }
      if (!pdfSign?.uploadUrl || !pdfSign?.publicUrl) {
        setErr('No se pudo firmar la subida del PDF.');
        return;
      }
      if (shouldUploadMaster && masterSign && (!masterSign?.uploadUrl || !masterSign?.publicUrl)) {
        setErr('No se pudo firmar la subida de la imagen.');
        return;
      }

      const { mockupBlob, mockupUrl, mockupPublicUrl } = mockupResult || {};
      if (!mockupBlob || !mockupUrl) {
        setErr('No se pudo generar el mockup.');
        return;
      }

      await nextPaint(1);
      diag('[diag] master dims', { width: masterWidthExact, height: masterHeightExact });

      const pdfBody = pdfBytes instanceof Blob ? pdfBytes : new Blob([pdfBytes], { type: 'application/pdf' });
      let pdfUploadRes;
      let masterUploadRes = { ok: true };
      const uploadsStart = tnow();
      try {
        pdfUploadRes = await fetch(pdfSign.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/pdf' },
          body: pdfBody,
        });
      } catch (pdfUploadErr) {
        error('[pdf-upload] failed', pdfUploadErr);
        setErr('No se pudo subir el PDF.');
        return;
      }
      if (shouldUploadMaster && masterSign?.uploadUrl) {
        try {
          masterUploadRes = await fetch(masterSign.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': designMime },
            body: designBlob,
          });
        } catch (masterUploadErr) {
          error('[master-upload] failed', masterUploadErr);
          setErr('No se pudo subir la imagen.');
          return;
        }
      }
      diagTime('uploads_done', uploadsStart);

      if (!pdfUploadRes?.ok) {
        error('[pdf-upload] failed', pdfUploadRes?.statusText || pdfUploadRes?.status || 'upload_failed');
        setErr('No se pudo subir el PDF.');
        return;
      }
      if (shouldUploadMaster && !masterUploadRes?.ok) {
        error('[master-upload] failed', masterUploadRes?.statusText || masterUploadRes?.status || 'upload_failed');
        setErr('No se pudo subir la imagen.');
        return;
      }

      const nextPdfUrl = String(pdfSign.publicUrl || '');
      let nextMasterUrl = shouldUploadMaster && masterSign ? String(masterSign.publicUrl || '') : null;
      diag('[diag] uploads ok', { pdf: nextPdfUrl, master: nextMasterUrl });

      if (shouldUploadMaster && DELETE_MASTER_AFTER_PDF && masterSign?.path && masterUploadRes?.ok) {
        try {
          await postJSON(
            getResolvedApiUrl('/api/storage/delete'),
            {
              bucket: masterSign.bucket || 'outputs',
              path: masterSign.path,
            },
            30000,
          );
          diag('[diag] master deleted from storage', masterSign.path);
          nextMasterUrl = null;
        } catch (deleteErr) {
          warn('[diag] master delete failed (kept for safety)', deleteErr);
        }
      }

      const designHash = designSha;
      setDesignHashState(designHash);
      setMasterPublicUrl(nextMasterUrl);
      setPdfPublicUrl(nextPdfUrl);
      setMasterWidthPx(masterWidthExact);
      setMasterHeightPx(masterHeightExact);

      if (!DISABLE_UPLOAD_ORIGINAL) {
        warn('[upload-original] flag disabled, se mantiene flujo legado.');
      }

      const uploadCanonical = nextMasterUrl || '';
      const uploadObjectKey = pdfSign?.path || null;
      const uploadBucket = pdfSign?.bucket || 'outputs';

      setUploaded(prev => ({
        ...prev,
        file: prev?.file,
        localUrl: prev?.localUrl,
        file_hash: designSha,
        file_original_url: uploadCanonical,
        canonical_url: uploadCanonical,
        object_key: uploadObjectKey,
        bucket: uploadBucket || prev?.bucket,
        upload_diag_id: null,
        upload: prev?.upload || null,
        upload_size_bytes: designBlob.size,
        upload_content_type: designMime,
      }));

      const transferPrice = Number(priceAmount) > 0 ? Number(priceAmount) : 0;
      const normalPrice = transferPrice;
      const nameRaw = safeStr(trimmedDesignName || flowState?.designName || flow?.designName, 'Personalizado');
      const nameClean = safeReplace(nameRaw, /\s+/g, ' ').slice(0, 40) || 'Personalizado';
      const chosenWidthCmRaw = Number(activeWcm);
      const chosenHeightCmRaw = Number(activeHcm);
      const chosenWidthCm = Number.isFinite(chosenWidthCmRaw) && chosenWidthCmRaw > 0
        ? Math.round(chosenWidthCmRaw)
        : null;
      const chosenHeightCm = Number.isFinite(chosenHeightCmRaw) && chosenHeightCmRaw > 0
        ? Math.round(chosenHeightCmRaw)
        : null;
      const selectedMaterial = normalizeMaterialLabelSafe(
        material
        || flowState?.material
        || flow?.material
        || flowState?.options?.material,
      );
      const existingWidth = Number(flowState?.widthCm ?? flow?.widthCm);
      const existingHeight = Number(flowState?.heightCm ?? flow?.heightCm);
      const widthToStore = chosenWidthCm
        ?? (Number.isFinite(existingWidth) && existingWidth > 0 ? Math.round(existingWidth) : null);
      const heightToStore = chosenHeightCm
        ?? (Number.isFinite(existingHeight) && existingHeight > 0 ? Math.round(existingHeight) : null);
      const finalMaterial = selectedMaterial === 'Glasspad' ? 'Glasspad' : selectedMaterial || 'Classic';
      let finalWidthCm = widthToStore;
      let finalHeightCm = heightToStore;
      if (finalMaterial === 'Glasspad') {
        finalWidthCm = 49;
        finalHeightCm = 42;
      }

      flow.set({
        // Guardar SIEMPRE la medida elegida por el cliente (cm), para evitar caer a px/DPI
        widthCm: finalWidthCm,
        heightCm: finalHeightCm,
        productType: finalMaterial === 'Glasspad' ? 'glasspad' : 'mousepad',
        editorState: layout,
        mockupBlob,
        mockupUrl,
        mockupPublicUrl: mockupPublicUrl || flowState?.mockupPublicUrl || null,
        printFullResDataUrl: masterDataUrl,
        masterPublicUrl: nextMasterUrl,
        pdfPublicUrl: nextPdfUrl,
        masterWidthPx: masterWidthExact,
        masterHeightPx: masterHeightExact,
        designHash,
        fileOriginalUrl: null,
        uploadObjectKey,
        uploadBucket: uploadBucket,
        uploadDiagId: null,
        uploadSizeBytes: designBlob.size,
        uploadContentType: designMime,
        uploadSha256: designSha,
        designName: nameClean,
        material: finalMaterial,
        options: { ...(flowState?.options || {}), material: finalMaterial },
        lowQualityAck: level === 'bad' ? Boolean(ackLow) : false,
        approxDpi: effDpi || null,
        priceTransfer: transferPrice,
        priceNormal: normalPrice,
        priceCurrency: PRICE_CURRENCY,
      });
      try {
        diag('[audit:flow:persist]', {
          designName: nameClean,
          material: finalMaterial,
          widthCm: finalWidthCm,
          heightCm: finalHeightCm,
        });
      } catch (_) {
        // noop
      }
      // Actualizar el nombre global para handlers legacy que lean preservedCustom
      try {
        if (typeof window !== 'undefined') {
          const nextFlowState = (typeof flow?.get === 'function' ? flow.get() : flow) || {};
          const syncedName = (nextFlowState?.designName ?? trimmedDesignName ?? '').toString();
          window.preservedCustom = syncedName || null;
        }
      } catch (_) {
        // no-op
      }
      try {
        if (typeof window !== 'undefined') {
          window.preservedCustom = nameClean || 'Personalizado';
        }
      } catch {}
      try {
        await ensureMockupUrlInFlow(flow, {
          dataUrl: masterDataUrl,
          widthPx: masterWidthExact,
          heightPx: masterHeightExact,
          widthMm: masterWidthMm,
          heightMm: masterHeightMm,
          dpi: dpiForMockup,
          material,
        });
      } catch (mockupEnsureError) {
        warn('[diag] ensure mockup url failed during continue', mockupEnsureError);
      }
      const qs = new URLSearchParams();
      if (finalMaterial) {
        qs.set('mat', finalMaterial);
      }
      if (Number.isFinite(finalWidthCm) && finalWidthCm > 0) {
        qs.set('w', String(finalWidthCm));
      }
      if (Number.isFinite(finalHeightCm) && finalHeightCm > 0) {
        qs.set('h', String(finalHeightCm));
      }
      if (nameClean) {
        qs.set('name', nameClean);
      }
      const query = qs.toString();
      navigate(`/mockup${query ? `?${query}` : ''}`);
    } catch (e) {
      error(e);
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }


  const title = 'Tu Mousepad Personalizado — MGMGAMERS';
  const description = 'Mousepad Profesionales Personalizados, Gamers, diseño y medida que quieras. Perfectos para gaming control y speed.';
  const url = 'https://www.mgmgamers.store/';
  const hasImage = Boolean(uploaded);
  const isCanvasReady = Boolean(hasImage && imageUrl);
  const requiresLowAck = hasImage && level === 'bad';
  const ackLowMissing = requiresLowAck && !ackLow;
  const shouldShowAckError = ackLowError && ackLowMissing;
  useEffect(() => {
    if (!requiresLowAck) {
      if (ackLow) {
        setAckLow(false);
      }
      setAckLowError(false);
      if (err === ACK_LOW_ERROR_MESSAGE) {
        setErr('');
      }
    }
  }, [requiresLowAck, ackLow, err]);
  const configTriggerClasses = [
    styles.configTrigger,
    configOpen ? styles.configTriggerActive : '',
    !hasImage ? styles.configTriggerDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  const configPanelClasses = [
    styles.configPanel,
    !hasImage ? styles.configPanelDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  const updateConfigPanelPosition = useCallback(() => {
    if (!configOpen) return;
    if (typeof window === 'undefined') return;

    const triggerEl = configTriggerButtonRef.current;
    const panelEl = configPanelRef.current;
    if (!triggerEl || !panelEl) return;

    const docEl = document.documentElement;
    const docStyles = window.getComputedStyle(docEl);
    const safeAreaTop = Number.parseFloat(docStyles.getPropertyValue('--safe-area-top')) || 0;
    const safeAreaRight = Number.parseFloat(docStyles.getPropertyValue('--safe-area-right')) || 0;
    const safeAreaBottom = Number.parseFloat(docStyles.getPropertyValue('--safe-area-bottom')) || 0;
    const safeAreaLeft = Number.parseFloat(docStyles.getPropertyValue('--safe-area-left')) || 0;

    const EDGE_MARGIN = 12;
    const GAP = 12;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const triggerRect = triggerEl.getBoundingClientRect();
    const panelRect = panelEl.getBoundingClientRect();

    const topLimit = safeAreaTop + EDGE_MARGIN;
    const bottomLimit = viewportHeight - safeAreaBottom - EDGE_MARGIN;

    const preferredTop = triggerRect.bottom + GAP;
    const preferredBottom = triggerRect.top - GAP;
    const spaceBelow = bottomLimit - preferredTop;
    const spaceAbove = preferredBottom - topLimit;
    const constrainedSpaceBelow = Math.max(spaceBelow, 0);
    const constrainedSpaceAbove = Math.max(spaceAbove, 0);
    const shouldFlip = panelRect.height > constrainedSpaceBelow
      && constrainedSpaceAbove > constrainedSpaceBelow;

    let top = shouldFlip
      ? preferredBottom - panelRect.height
      : preferredTop;

    if (top < topLimit) {
      top = topLimit;
    }

    if (top + panelRect.height > bottomLimit) {
      top = Math.max(topLimit, bottomLimit - panelRect.height);
    }

    const availableSpace = Math.max(bottomLimit - top, 0);
    const constrainedMaxHeight = Math.min(availableSpace, viewportHeight * 0.7);
    const resolvedMaxHeight = Math.max(
      0,
      Math.min(panelRect.height, constrainedMaxHeight),
    );

    const maxWidthAvailable = Math.max(
      viewportWidth - safeAreaLeft - safeAreaRight - EDGE_MARGIN * 2,
      0,
    );
    const constrainedMaxWidth = Math.min(520, Math.max(maxWidthAvailable, 0));
    const fallbackWidth = Math.min(panelRect.width, 520);
    const widthForPosition = constrainedMaxWidth > 0
      ? Math.min(panelRect.width, constrainedMaxWidth)
      : fallbackWidth;
    const minLeft = safeAreaLeft + EDGE_MARGIN;
    const maxLeft = viewportWidth - safeAreaRight - EDGE_MARGIN - widthForPosition;
    let left = triggerRect.left;
    if (left < minLeft) {
      left = minLeft;
    }
    if (left > maxLeft) {
      left = Math.max(minLeft, maxLeft);
    }

    setConfigPanelStyle((prev) => {
      const next = {
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        maxHeight: `${resolvedMaxHeight}px`,
        maxWidth: `${constrainedMaxWidth > 0 ? constrainedMaxWidth : fallbackWidth}px`,
      };
      if (
        prev.position === next.position
        && prev.top === next.top
        && prev.left === next.left
        && prev.maxHeight === next.maxHeight
        && prev.maxWidth === next.maxWidth
      ) {
        return prev;
      }
      return next;
    });
  }, [configOpen]);

  const designNameInputClasses = [
    styles.inputText,
    designNameError ? styles.inputTextError : '',
  ]
    .filter(Boolean)
    .join(' ');

  const canvasStageClasses = [
    styles.canvasStage,

    !isCanvasReady ? styles.canvasStageEmpty : '',

  ]
    .filter(Boolean)
    .join(' ');

  const recomputeCanvasFit = useCallback(() => {
    if (typeof window === 'undefined') return;
    const pageEl = pageRef.current;
    if (!pageEl) return;

    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;

    const parsePx = (value) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const pageStyles = window.getComputedStyle(pageEl);
    const paddingTop = parsePx(pageStyles?.paddingTop);
    const paddingLeft = parsePx(pageStyles?.paddingLeft);
    const paddingRight = parsePx(pageStyles?.paddingRight);

    const availableWidth = viewportWidth - paddingLeft - paddingRight;
    const widthLimit = availableWidth > 0
      ? Math.min(CANVAS_MAX_WIDTH, availableWidth)
      : CANVAS_MAX_WIDTH;

    const isDesktop = viewportWidth >= 960;

    if (!isDesktop) {
      setCanvasFit((prev) => (
        prev.height === null
          && prev.maxWidth === widthLimit
          && prev.sectionOneMinHeight === null
          ? prev
          : { height: null, maxWidth: widthLimit, sectionOneMinHeight: null }
      ));
      return;
    }

    const headerHeight = document
      .querySelector('header')
      ?.getBoundingClientRect()?.height || 0;

    const sectionOneAvailable = Math.max(0, viewportHeight - headerHeight);

    const pageRect = pageEl.getBoundingClientRect();
    const headingEl = headingRef.current;
    const lienzoEl = lienzoCardRef.current;
    const sectionInnerEl = sectionOneInnerRef.current;

    let spacingBeforeTitle = paddingTop;
    let titleHeightRaw = 0;
    let titleMarginBottom = 0;

    if (headingEl) {
      const headingRect = headingEl.getBoundingClientRect();
      const headingStyles = window.getComputedStyle(headingEl);
      titleHeightRaw = headingRect.height;
      titleMarginBottom = parsePx(headingStyles?.marginBottom);
      if (pageRect) {
        spacingBeforeTitle = Math.max(
          paddingTop,
          headingRect.top - pageRect.top,
        );
      }
    }

    let outerGap = 0;
    if (headingEl && lienzoEl) {
      const headingRect = headingEl.getBoundingClientRect();
      const lienzoRect = lienzoEl.getBoundingClientRect();
      outerGap = Math.max(0, lienzoRect.top - headingRect.bottom);
    } else if (sectionInnerEl) {
      const sectionInnerStyles = window.getComputedStyle(sectionInnerEl);
      outerGap = parsePx(sectionInnerStyles?.rowGap || sectionInnerStyles?.gap);
    }

    if (!Number.isFinite(outerGap)) outerGap = 0;

    const titleBlockHeight = spacingBeforeTitle + titleHeightRaw + titleMarginBottom;
    const maxAvailableLienzo = Math.max(0, sectionOneAvailable - titleBlockHeight - outerGap);
    const lienzoHeight = maxAvailableLienzo;
    const sectionOneMinHeight = Math.max(0, sectionOneAvailable - spacingBeforeTitle);

    setCanvasFit((prev) => {
      const next = {
        height: lienzoHeight,
        maxWidth: widthLimit,
        sectionOneMinHeight,
      };
      return prev.height === next.height
        && prev.maxWidth === next.maxWidth
        && prev.sectionOneMinHeight === next.sectionOneMinHeight
        ? prev
        : next;
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleResize = () => recomputeCanvasFit();
    recomputeCanvasFit();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [recomputeCanvasFit]);

  useEffect(() => {
    recomputeCanvasFit();
  }, [recomputeCanvasFit, hasImage, configOpen, err, level, ackLow]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => recomputeCanvasFit());
    const observed = [
      headingRef.current,
      sectionOneInnerRef.current,
      lienzoCardRef.current,
    ].filter(Boolean);
    observed.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [recomputeCanvasFit]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (!configOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!configDropdownRef.current) return;
      if (configDropdownRef.current.contains(event.target)) return;
      setConfigOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [configOpen]);

  useLayoutEffect(() => {
    if (!configOpen) return undefined;
    if (typeof window === 'undefined') return undefined;

    updateConfigPanelPosition();
    const frame = window.requestAnimationFrame(() => updateConfigPanelPosition());

    let panelObserver;
    let triggerObserver;
    if (typeof ResizeObserver !== 'undefined') {
      if (configPanelRef.current) {
        panelObserver = new ResizeObserver(() => updateConfigPanelPosition());
        panelObserver.observe(configPanelRef.current);
      }
      if (configTriggerButtonRef.current) {
        triggerObserver = new ResizeObserver(() => updateConfigPanelPosition());
        triggerObserver.observe(configTriggerButtonRef.current);
      }
    }

    return () => {
      window.cancelAnimationFrame(frame);
      if (panelObserver) panelObserver.disconnect();
      if (triggerObserver) triggerObserver.disconnect();
    };
  }, [configOpen, updateConfigPanelPosition]);

  useEffect(() => {
    if (!configOpen) return undefined;
    if (typeof window === 'undefined') return undefined;

    const handleLayoutChange = () => updateConfigPanelPosition();
    window.addEventListener('resize', handleLayoutChange);
    window.addEventListener('scroll', handleLayoutChange, true);

    const { visualViewport } = window;
    if (visualViewport) {
      visualViewport.addEventListener('resize', handleLayoutChange);
      visualViewport.addEventListener('scroll', handleLayoutChange);
    }

    return () => {
      window.removeEventListener('resize', handleLayoutChange);
      window.removeEventListener('scroll', handleLayoutChange, true);
      if (visualViewport) {
        visualViewport.removeEventListener('resize', handleLayoutChange);
        visualViewport.removeEventListener('scroll', handleLayoutChange);
      }
    };
  }, [configOpen, updateConfigPanelPosition]);

  useEffect(() => {
    if (!configOpen) return undefined;
    if (typeof document === 'undefined') return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setConfigOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [configOpen]);

  useEffect(() => {
    if (!configOpen) return undefined;
    if (!hasImage) return undefined;
    if (typeof window === 'undefined') return undefined;

    const frame = window.requestAnimationFrame(() => {
      designNameInputRef.current?.focus?.();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [configOpen, hasImage]);

  useEffect(() => {
    if (configOpen) {
      wasConfigOpenRef.current = true;
      return;
    }
    if (!wasConfigOpenRef.current) return;
    wasConfigOpenRef.current = false;
    const triggerEl = configTriggerButtonRef.current;
    if (triggerEl && !triggerEl.disabled) {
      triggerEl.focus();
    }
  }, [configOpen]);

  const editorMaxWidthStyle = useMemo(() => (
    canvasFit.maxWidth ? { maxWidth: `${canvasFit.maxWidth}px` } : undefined
  ), [canvasFit.maxWidth]);

  const sectionOneStyle = useMemo(() => (
    canvasFit.sectionOneMinHeight != null
      ? { minHeight: `${canvasFit.sectionOneMinHeight}px` }
      : undefined
  ), [canvasFit.sectionOneMinHeight]);

  const editorContainerClasses = useMemo(
    () => `${styles.editor} ${styles.editorFullHeight}`,
    [],
  );

  const configDropdown = (
    <div className={styles.configDropdown} ref={configDropdownRef}>
      <button
        type="button"
        className={configTriggerClasses}
        onClick={() => setConfigOpen((open) => !open)}
        disabled={!hasImage}
        ref={configTriggerButtonRef}
        aria-expanded={configOpen}
        aria-controls="configuracion-editor"
        aria-haspopup="menu"
        aria-label="Configura tu mousepad"
      >
        <span className={styles.configTriggerIcon} aria-hidden="true">
          <img src={CONFIG_ICON_SRC} alt="" />
        </span>
        <span className={styles.configTriggerLabel}>Configura tu mousepad</span>
        <span className={styles.configTriggerArrow} aria-hidden="true">
          <img
            src={CONFIG_ARROW_ICON_SRC}
            alt=""
            className={configOpen ? styles.configTriggerArrowOpen : ''}
          />
        </span>
      </button>
      {configOpen && (
        <div
          id="configuracion-editor"
          className={configPanelClasses}
          aria-disabled={!hasImage}
          ref={configPanelRef}
          style={configPanelStyle}
          role="menu"
        >
          <div className={styles.configSheet}>
            <div className={styles.configForm}>
              <div className={`${styles.field} ${styles.formRow}`}>
                <label className={styles.configSectionTitle} htmlFor="design-name">
                  Nombre de tu diseño
                </label>
                <input
                  type="text"
                  id="design-name"
                  ref={designNameInputRef}
                  className={designNameInputClasses}
                  placeholder="Ej: Nubes y cielo rosa"
                  value={designName}
                  onChange={handleDesignNameChange}
                  disabled={!hasImage}
                  aria-invalid={designNameError ? 'true' : 'false'}
                  aria-describedby={
                    designNameError ? 'design-name-error' : undefined
                  }
                />
                {designNameError && (
                  <p className={styles.errorMessage} id="design-name-error">
                    {designNameError}
                  </p>
                )}
              </div>
              <div className={styles.fieldBlock}>
                <SizeControls
                  material={material}
                  size={size}
                  mode={mode}
                  onChange={handleSizeChange}
                  locked={material === 'Glasspad'}
                  disabled={!hasImage}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={styles.page} ref={pageRef}>
      <SeoJsonLd
        title={title}
        description={description}
        canonical={url}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'MGMGAMERS',
          url: 'https://www.mgmgamers.store',
          sameAs: ['https://www.instagram.com/mgmgamers.store']
        }}
      />

      <section
        className={styles.sectionOne}
        ref={sectionOneRef}
        style={sectionOneStyle}
      >
        <div
          className={styles.sectionOneInner}
          ref={sectionOneInnerRef}
          style={editorMaxWidthStyle}
        >
          <div
            className={styles.pageHeading}
            ref={headingRef}
          >
            {/* <Link target="_blank" rel="noopener" to="/tutorial" className={styles.tutorialButton}>
              <span>Ver tutorial</span>
              <img
                src={TUTORIAL_ICON_SRC}
                alt=""
                className={styles.tutorialButtonIcon}
              />
            </Link> */}
          </div>

          <div className={editorContainerClasses}>
            <div className={canvasStageClasses} ref={lienzoCardRef}>
              {hasImage && (
                <div className={styles.canvasPriceWrapper}>
                  <Calculadora
                    width={activeSizeCm.w}
                    height={activeSizeCm.h}
                    material={material}
                    setPrice={setPriceAmount}
                    render={({ transfer, valid, format }) => {
                      const amount = typeof transfer === 'number' ? Math.max(0, transfer) : 0;
                      const formattedAmount = `$${format(amount)}`;
                      const priceClasses = [styles.canvasPriceTag];
                      const widthValue = Number(activeSizeCm?.w);
                      const heightValue = Number(activeSizeCm?.h);
                      const hasDimensions =
                        Number.isFinite(widthValue) && Number.isFinite(heightValue) && widthValue > 0 && heightValue > 0;
                      const formatDimension = value => {
                        if (!Number.isFinite(value)) return '';
                        const hasDecimals = Math.abs(value - Math.trunc(value)) > 0.0001;
                        return value.toLocaleString('es-AR', {
                          minimumFractionDigits: hasDecimals ? 1 : 0,
                          maximumFractionDigits: hasDecimals ? 1 : 1,
                        });
                      };
                      const summaryLabel = hasDimensions
                        ? `${material} / ${formatDimension(widthValue)}x${formatDimension(heightValue)}`
                        : material;
                      if (!valid) {
                        priceClasses.push(styles.canvasPriceTagDisabled);
                      }
                      return (
                        <div className={priceClasses.join(' ')}>
                          <span className={styles.canvasPriceSummary}>{summaryLabel}</span>
                          <div className={styles.canvasPriceLine}>
                            <span className={styles.canvasPriceAmount}>{formattedAmount}</span>
                            <span className={styles.canvasPriceLabel}>Con transferencia</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                </div>
              )}
              <div className={styles.canvasViewport}>

                <EditorCanvas
                  ref={canvasRef}
                  imageUrl={imageUrl}
                  imageFile={uploaded?.file}
                  sizeCm={activeSizeCm}
                  bleedMm={3}
                  dpi={300}
                  onLayoutChange={setLayout}
                  onClearImage={handleClearImage}
                  showCanvas={isCanvasReady}
                  topLeftOverlay={configDropdown}
                  lienzoHeight={canvasFit.height}
                />
                {!hasImage && (
                  <div className={styles.uploadOverlay}>
                    <UploadStep
                      className={styles.uploadControl}
                      onUploaded={info => {
                        setUploaded(info);
                        setAckLow(false);
                        setAckLowError(false);
                        setConfigOpen(true);
                      }}
                      renderTrigger={({ openPicker, busy }) => (
                        <button
                          type="button"
                          className={styles.uploadButton}
                          onClick={openPicker}
                          disabled={busy}
                          aria-label="Agregar imagen"
                          role="button"
                        >
                          <span className={styles.uploadButtonIcon} aria-hidden="true">
                            +
                          </span>
                          <span className={styles.uploadButtonText}>
                            {busy ? 'Subiendo…' : 'Agregar imagen'}
                          </span>
                        </button>
                      )}
                    />
                  </div>
                )}
              </div>
              {requiresLowAck && (
                <label
                  className={`${styles.ackLabel} ${styles.canvasAck}`.trim()}
                >
                  <input
                    ref={ackCheckboxRef}
                    className={styles.ackCheckbox}
                    type="checkbox"
                    checked={ackLow}
                    onChange={e => {
                      const { checked } = e.target;
                      setAckLow(checked);
                      if (checked) {
                        setAckLowError(false);
                        if (err === ACK_LOW_ERROR_MESSAGE) {
                          setErr('');
                        }
                      }
                    }}
                    required={requiresLowAck}
                    aria-required={requiresLowAck}
                    aria-invalid={shouldShowAckError ? 'true' : undefined}
                    aria-describedby={shouldShowAckError ? ackLowErrorDescriptionId : undefined}
                  />
                  <span className={styles.ackIndicator} aria-hidden="true" />
                  <span className={`${styles.ackLabelText} ${shouldShowAckError ? `${styles.ackLabelTextError} is-error` : ''}`.trim()}>
                    Acepto imprimir en baja calidad ({effDpi} DPI)
                  </span>
                </label>
              )}
              {hasImage && (
                <button
                  className={`${styles.continueButton} ${styles.canvasContinue}`}
                  disabled={busy || ackLowMissing}
                  onClick={handleContinue}
                >
                  Continuar
                </button>
              )}
              {moderationNotice && (
                <div className={styles.canvasFeedback}>
                  <p className={styles.infoMessage} role="status">{moderationNotice}</p>
                </div>
              )}
              {err && (
                <div className={styles.canvasFeedback}>
                  <p
                    id={err === ACK_LOW_ERROR_MESSAGE ? ackLowErrorDescriptionId : undefined}
                    className={`errorText ${styles.errorMessage}`}
                    role="alert"
                  >
                    {err}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {busy && (
        <LoadingOverlay
          visible
          steps={[]}
          messages={[LOADING_MESSAGES[msgIndex]]}
          subtitle="No cierres nada, esto puede demorar varios segundos."
        />
      )}
    </div>
  );

}
