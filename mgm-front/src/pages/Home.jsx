import { diag, warn, error } from '@/lib/log';
// src/pages/Home.jsx
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useId,
} from 'react';
import { useOutletContext } from 'react-router-dom';
import SeoJsonLd from '../components/SeoJsonLd';

import UploadStep from '../components/UploadStep';
import Calculadora from '../components/Calculadora.jsx';
import CustomSizeFields from '../components/CustomSizeFields.jsx';
import EditorCanvas from '../components/EditorCanvas';
import ColorPopover from '../components/ColorPopover';
import LoadingOverlay from '../components/LoadingOverlay';
import StepThreeMockupPreview from '../components/StepThreeMockupPreview.jsx';
import PrintAreaHelpCaption from '../components/PrintAreaHelpCaption.jsx';
import deleteActionIconSrc from '@/assets/icons/eliminar.svg';
import toolsActionIconSrc from '@/assets/icons/herramientas.svg';
import uploadAreaIconSrc from '@/assets/icons/imagen.svg';
import uploadAreaLightIconSrc from '@/assets/icons/imagen2.svg';
import replaceActionIconSrc from '@/assets/icons/remplazar.svg';
import vrActionIconSrc from '@/assets/icons/vr.svg';
import closeXIconSrc from '../icons/closeX.svg';

import {
  LIMITS,
  GLASSPAD_SIZE_CM,
  DEFAULT_SIZE_CM,
  MIN_DIMENSION_CM_BY_MATERIAL,
  isFixedPad49x42Material,
} from '../lib/material.js';
import { calculateTransferPricing, formatARS } from '../lib/pricing.js';

import {
  DPI_WARN_THRESHOLD,
  DPI_LOW_THRESHOLD,
  qualityLevel,
} from '../lib/dpi';
import styles from './Home.module.css';
import { renderMockup1080 } from '../lib/mockup.js';
import { buildPdfFromMaster } from '../lib/buildPdf.js';
import { ensureMockupUrlInFlow } from './Mockup.jsx';
import { quickHateSymbolCheck } from '@/lib/moderation.ts';
import { scanNudityClient } from '@/lib/moderation/nsfw.client.js';
import { useFlow } from '@/state/flow.js';
import { isTouchDevice } from '@/lib/device.ts';
import { getMaxImageMb, bytesToMB, formatHeavyImageToastMessage } from '@/lib/imageLimits.js';
import { MAX_IMAGE_MB as MAX_IMAGE_MB_BASE } from '../lib/imageSizeLimit.js';
import { createJobAndProduct, pickCommerceTarget } from '@/lib/shopify.ts';
import { parseSupabasePublicStorageUrl } from '@/lib/supabaseUrl.ts';
import {
  projectNameContainsForbiddenWord,
  PROJECT_NAME_FORBIDDEN_WORDS_MESSAGE,
} from '../../../lib/_lib/projectNameForbiddenWords.js';

const MAX_IMAGE_MB = MAX_IMAGE_MB_BASE; // proviene de VITE_MAX_IMAGE_MB (default 30MB)
const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;

const asStr = (value) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const safeStr = (value, fallback = '') => {
  const str = asStr(value).trim();
  return str || fallback;
};
const safeReplace = (value, pattern, repl) => asStr(value).replace(pattern, repl);

const sanitizeFileName = (value, fallback = 'design') => {
  const normalized = safeStr(value, fallback)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/-+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^-+|-+$/g, '')
    .trim();
  if (normalized) return normalized;
  return fallback;
};
const normalizeMaterialLabelSafe = (value) => {
  const label = safeStr(value);
  if (label === 'Alfombra') return 'Alfombra';
  if (label === 'Ultra') return 'Ultra';
  const normalized = label.toLowerCase();
  if (normalized.includes('glass')) return 'Glasspad';
  if (normalized.includes('ultra')) return 'Ultra';
  if (normalized.includes('pro')) return 'PRO';
  if (normalized.includes('alfombra')) return 'Alfombra';
  return 'Classic';
};

/** Si el estado local quedó en Classic pero el flow tiene PRO (u otro), alinear antes del paso 3. */
const reconcileReviewMaterialFromFlow = (localMaterial, flowState) => {
  const src = flowState && typeof flowState === 'object' ? flowState : {};
  const fromFlow = normalizeMaterialLabelSafe(src.material ?? src.options?.material);
  const local = normalizeMaterialLabelSafe(localMaterial);
  if (local === fromFlow) return local;
  if (local !== 'Classic' && fromFlow === 'Classic') return local;
  if (fromFlow !== 'Classic' && local === 'Classic') return fromFlow;
  return local;
};
const normalizeShapeSafe = (value) => {
  const normalized = safeStr(value).toLowerCase();
  if (normalized === 'circle' || normalized === 'circular' || normalized === 'form') {
    return 'circle';
  }
  return 'rounded_rect';
};
const resolveCircularShapeFromSource = (source, materialLabel) => {
  if (isFixedPad49x42Material(normalizeMaterialLabelSafe(materialLabel))) return false;
  if (source?.isCircular === true || source?.options?.isCircular === true) return true;
  return [
    source?.shape,
    source?.options?.shape,
    source?.editorState?.shape,
  ].some((candidate) => normalizeShapeSafe(candidate) === 'circle');
};
const formatMaterialLabelWithShape = (value, isCircular = false) => {
  const materialLabel = normalizeMaterialLabelSafe(value);
  if (isCircular && !isFixedPad49x42Material(materialLabel)) {
    return `${materialLabel} Form`;
  }
  return materialLabel;
};
const PROJECT_NAME_ALLOWED_CHARACTERS_REGEX = /^[\p{L}\p{N}.,\-@ ]+$/u;
const PROJECT_NAME_HAS_LETTER_REGEX = /\p{L}/u;
const PROJECT_NAME_EMOJI_REGEX = /[\p{Extended_Pictographic}\uFE0F\u200D]/u;
const stripProjectNameEmojis = (value) => asStr(value).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '');

function validateProjectName(value) {
  const raw = asStr(value);
  const trimmed = raw.trim();
  if (!trimmed) return PROJECT_NAME_ERROR_MESSAGE;
  if (PROJECT_NAME_EMOJI_REGEX.test(raw)) {
    return 'No uses emojis en el nombre del proyecto.';
  }
  if (!PROJECT_NAME_ALLOWED_CHARACTERS_REGEX.test(raw)) {
    return 'Usá solo letras, números, espacios y los símbolos . , - @';
  }
  if (!PROJECT_NAME_HAS_LETTER_REGEX.test(raw)) {
    return 'El nombre del proyecto debe incluir al menos una letra.';
  }
  if (projectNameContainsForbiddenWord(raw)) {
    return PROJECT_NAME_FORBIDDEN_WORDS_MESSAGE;
  }
  return '';
}

const withTimeout = (promise, ms, onTimeout) => new Promise((resolve, reject) => {
  let finished = false;
  const timer = setTimeout(() => {
    if (finished) return;
    finished = true;
    try {
      onTimeout?.();
    } catch {}
    resolve({ timeout: true });
  }, ms);
  promise.then((value) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    resolve(value);
  }).catch((err) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    reject(err);
  });
});
import { apiFetch, postJSON, getResolvedApiUrl } from '@/lib/api.js';
import { resolveIconAsset } from '@/lib/iconRegistry.js';
import { sha256Hex } from '@/lib/hash.js';
import { trackEvent } from '@/lib/tracking';

const STEP_TWO_TOOL_ICON_SOURCES = {
  centerHorizontal: resolveIconAsset('centrado_V.svg'),
  centerVertical: resolveIconAsset('centrado_h.svg'),
  alignLeft: resolveIconAsset('izquierda.svg'),
  alignRight: resolveIconAsset('derecha.svg'),
  alignTop: resolveIconAsset('arriba.svg'),
  alignBottom: resolveIconAsset('abajo.svg'),
  flipHorizontal: resolveIconAsset('espejo_h.svg'),
  flipVertical: resolveIconAsset('espejo_v.svg'),
  rotate90: resolveIconAsset('rotar.svg'),
  cover: resolveIconAsset('cubrir.svg'),
  contain: resolveIconAsset('contener.svg'),
  stretch: resolveIconAsset('estirar.svg'),
  circular: resolveIconAsset('shape-circle.svg'),
  rectangular: resolveIconAsset('shape-square.svg'),
};
const STEP_TWO_DRAWER_SECTIONS = {
  size: 'size',
  material: 'material',
  project: 'project',
};
const STEP_TWO_SIZE_OPTIONS = [
  { id: 'mini', label: '', w: 25, h: 25 },
  { id: 'Classic', label: '', w: 82, h: 32 },
  { id: 'large', label: '', w: 90, h: 40 },
  { id: 'xl', label: '', w: 100, h: 60 },
  { id: 'xxl', label: '', w: 140, h: 100 },
];
const STEP_TWO_CUSTOM_SIZE_OPTION = {
  id: 'custom',
  value: 'custom',
  label: 'Personalizada',
  description: '',
};
const STEP_TWO_MATERIAL_OPTIONS = [
  {
    value: 'Classic',
    label: 'Classic',
    description: 'Diario, gaming casual y trabajo.',
  },
  {
    value: 'PRO',
    label: 'Pro',
    description: 'Juegos competitivos / shooters.',
    recommended: true,
  },
  {
    value: 'Alfombra',
    label: 'Alfombra para piso',
    description: 'Decoración del setup.',
  },
  {
    value: 'Glasspad',
    label: 'Glasspad',
    description: 'Movimientos rápidos y flicks.',
    disabled: true,
  },
  {
    value: 'Ultra',
    label: 'Ultra',
    description: 'FPS ultra preciso y tracking.',
  },
];
const isMaterialDropdownLocked = (o) => Boolean(o?.comingSoon || o?.disabled);
/** Resumen paso 3 — fila "Material". */
const STEP_THREE_MATERIAL_SUMMARY = {
  Classic: 'Híbrido (Base goma)',
  PRO: 'Control (Base caucho)',
  Glasspad: 'Speed (Vidrio templado)',
  Alfombra: 'Suave (Base ecocuero)',
  Ultra: 'Control (Base Poron)',
};
/** Resumen paso 3 — fila "Uso ideal". */
const STEP_THREE_IDEAL_USE_SUMMARY = {
  Classic: 'Diario, gaming casual y trabajo.',
  PRO: 'Juegos competitivos / shooters.',
  Glasspad: 'Movimientos rápidos y flicks.',
  Alfombra: 'Decoración del setup.',
  Ultra: 'FPS ultra preciso y tracking.',
};
const PROJECT_NAME_ERROR_MESSAGE = 'Ingresá un nombre para tu proyecto antes de continuar.';


const DISABLE_UPLOAD_ORIGINAL = (import.meta.env?.VITE_DISABLE_UPLOAD_ORIGINAL ?? '1') === '1';
/**
 * Pruebas: en `true` al confirmar paso 2 se salta `handleContinue` y se abre el paso 3 sin re-subir.
 * Producción: `false` (Confirmar en «Elegir tamaño y material» ejecuta la subida completa).
 */
const SKIP_STEP2_CONTINUE_UPLOAD = false;
const KEEP_MASTER = (import.meta.env?.VITE_KEEP_MASTER ?? '0') === '1';
const DELETE_MASTER_AFTER_PDF = (import.meta.env?.VITE_DELETE_MASTER_AFTER_PDF ?? '1') === '1';
const CANVAS_MAX_WIDTH = 1280;
const DEFAULT_SIZE = { w: 90, h: 40 };
const ACK_LOW_ERROR_MESSAGE = 'Confirmá que aceptás imprimir en baja calidad.';
const MODERATION_REASON_MESSAGES = {
  real_nudity: 'Bloqueado por moderaci\u00F3n: contenido adulto expl\u00EDcito detectado.',
  extremism_nazi: 'Bloqueado por moderaci\u00F3n: contenido extremista nazi detectado.',
  extremism_nazi_text: 'Bloqueado por moderaci\u00F3n: texto extremista nazi detectado.',
  invalid_body: 'No se pudo analizar la imagen enviada. Prob\u00E1 de nuevo.',
  server_error: 'Error del servidor de moderaci\u00F3n. Intent\u00E1 nuevamente m\u00E1s tarde.',
  blocked: 'Bloqueado por moderaci\u00F3n.',
};

const MOD_PREVIEW_LIMIT_BYTES = 800_000;
const MOD_PREVIEW_THRESHOLD_BYTES = -1;
const MOD_PREVIEW_DEFAULT_MAX_DIMENSION = 1280;
const MOD_PREVIEW_DEFAULT_QUALITY = 0.85;
const MOD_PREVIEW_FALLBACK_FORMATS = ['image/jpeg'];
const MOD_PREVIEW_RETRY_QUALITIES = [0.8, 0.7, 0.6];
const MOD_PREVIEW_RETRY_DIMENSIONS = [1024, 896, 768, 640];

const STEP_TWO_UPLOAD_MESSAGE = 'Guardando tu diseño en alta resolución...';
const STEP_TWO_UPLOAD_SUBTITLE = 'No cierres nada, esto puede demorar varios segundos.';
const STEP_THREE_COMMERCE_PENDING_LABEL = 'Enviando...';
/** Cupón mostrado en el total del paso 3 (transferencia). */
const STEP_THREE_TRANSFER_DISCOUNT = 'TRANSFERENCIA';
const STEP_THREE_ADD_TO_CART_LABEL = 'Agregar al carrito';
const STEP_THREE_CHECKOUT_BUTTON_LABEL = 'Finalizar compra';
const STEP_ONE_PREVIEW_MAX_WIDTH_PX = 551;
const SKIP_MASTER_UPLOAD = String(import.meta.env?.VITE_SKIP_MASTER_UPLOAD || '0') === '1';
const MOCKUP_BUCKET = String(import.meta.env?.VITE_MOCKUP_UPLOAD_BUCKET || 'preview');
/** PDF / master / mockup generados en `handleContinue` (paso 2 → Supabase). No incluye `uploads` del paso 1. */
const STEP_TWO_REMOTE_STORAGE_BUCKETS = new Set(['outputs', 'preview']);
const HOME_STEP = {
  upload: 1,
  edit: 2,
  review: 3,
};
const STEP_ONE_ACCEPTED_MIME_TYPES = ['image/png', 'image/jpeg'];
const STEP_ONE_MOBILE_QUERY = '(max-width: 768px)';
const STEP_ONE_PREVIEW_REFERENCE_CM = { w: 140, h: 100 };
const CUSTOM_SIZE_BASE_LIMITS_CM = { minW: 25, minH: 25, maxW: 140, maxH: 100 };
const STEP_ONE_PREVIEW_MEDIUM_BOOST_LIMIT_CM = { w: 100, h: 60 };
const STEP_ONE_PREVIEW_SMALL_BOOST_LIMIT_CM = { w: 82, h: 32 };
const STEP_ONE_PREVIEW_FOCUSED_BOOST_LIMIT_CM = { w: 90, h: 40 };
const STEP_ONE_PREVIEW_SPECIAL_BOOST_SIZE_CM = { w: 25, h: 25 };
const STEP_ONE_PREVIEW_MEDIUM_BOOST_RATIO = 0.15;
const STEP_ONE_PREVIEW_MEDIUM_EXTRA_SCALE_RATIO = 0.1;
const STEP_ONE_PREVIEW_MEDIUM_RANGE_EXTRA_SCALE_RATIO = 0.1;
const STEP_ONE_PREVIEW_SMALL_RANGE_EXTRA_SCALE_RATIO = 0.15;
const STEP_ONE_PREVIEW_FOCUSED_RANGE_EXTRA_SCALE_RATIO = 0.1;
const STEP_ONE_PREVIEW_SPECIAL_SIZE_EXTRA_SCALE_RATIO = 0.25;
const STEP_ONE_DESKTOP_SPACING_MAX_SIZE_CM = { w: 100, h: 60 };
const STEP_ONE_DESKTOP_SPACING_MIN_SIZE_CM = { w: 25, h: 25 };
const STEP_ONE_DESKTOP_SPACING_PX = { min: 40, max: 90 };
const STEP_TWO_FOOTER_BOTTOM_SPACING_PX = { tight: 40, min: 100, max: 120 };
const STEP_TWO_100CM_HEIGHT_LAYOUT_CM = 100;
const STEP_TWO_PREVIEW_FRAME_LIFT_100CM_HEIGHT_DESKTOP_PX = 0;
const STEP_TWO_100CM_DESKTOP_STAGE_TIGHTEN_PX = 96;
const STEP_TWO_SMALL_STAGE_MAX_SIDE_CM = 35;
const STEP_TWO_SMALL_STAGE_VISUAL_SCALE = 0.8;
const STEP_TWO_MOBILE_STAGE_VISUAL_SCALE = 1.08;
const STEP_TWO_DESKTOP_TOOLBAR_EXTRA_WIDTH_PX = 20;
const STEP_TWO_TOOLBAR_EXTRA_GAP_PX = 20;
/** Misma imagen de fondo por posición que las categorías anteriores; ahora enlaces a sitios de wallpapers. */
const STEP_ONE_RECOMMENDED_CATEGORIES = [
  {
    id: 'wallhaven',
    label: 'Wallhaven',
    href: 'https://wallhaven.cc/',
    background: 'var(--nm-preview-gradient-minimalistas)',
  },
  {
    id: 'wallhere',
    label: 'Wallhere',
    href: 'https://wallhere.com/',
    background: 'var(--nm-preview-gradient-anime)',
  },
  {
    id: 'alphacoders',
    label: 'Alphacoders',
    href: 'https://wall.alphacoders.com/',
    background: 'var(--nm-preview-gradient-gaming)',
  },
  {
    id: 'unsplash',
    label: 'Unsplash',
    href: 'https://unsplash.com/es',
    background: 'var(--nm-preview-gradient-naturaleza)',
  },
  {
    id: 'pexels',
    label: 'Pexels',
    href: 'https://www.pexels.com/es-es/',
    background: 'var(--nm-preview-gradient-abstractos)',
  },
  {
    id: 'artvee',
    label: 'Artvee',
    href: 'https://artvee.com/',
    background: 'var(--nm-preview-gradient-setups-oscuros)',
  },
];
const sameCmSize = (left, right) => (
  Number(left?.w) === Number(right?.w) && Number(left?.h) === Number(right?.h)
);
const formatSizeLabel = (size) => `${Number(size?.w) || 0}×${Number(size?.h) || 0} cm`;
const formatStepOneSizeDropdownLabel = (size) => `${Number(size?.w) || 0}x${Number(size?.h) || 0} cm`;
const STEP_ONE_CUSTOM_SIZE_TRIGGER_LABEL = '';
const GLASSPAD_FIXED_SIZE_OPTION_ID = 'glasspad-fixed';

const buildGlasspadFixedSizeOption = () => ({
  id: GLASSPAD_FIXED_SIZE_OPTION_ID,
  value: `${Number(GLASSPAD_SIZE_CM.w)}x${Number(GLASSPAD_SIZE_CM.h)}`,
  w: Number(GLASSPAD_SIZE_CM.w),
  h: Number(GLASSPAD_SIZE_CM.h),
  label: 'Fijo',
  measurementLabel: formatSizeLabel(GLASSPAD_SIZE_CM),
  menuLabel: formatStepOneSizeDropdownLabel(GLASSPAD_SIZE_CM),
});

const getDropdownStandardSizeOptionsForMaterial = (targetMaterial) => {
  if (isFixedPad49x42Material(targetMaterial)) {
    return [buildGlasspadFixedSizeOption()];
  }

  return STEP_TWO_SIZE_OPTIONS.filter((option) => {
    if (targetMaterial === 'PRO' && sameCmSize(option, { w: 140, h: 100 })) {
      return false;
    }
    return true;
  });
};

const isSizeAllowedForMaterial = (candidate, targetMaterial) => {
  if (isFixedPad49x42Material(targetMaterial)) {
    return sameCmSize(candidate, GLASSPAD_SIZE_CM);
  }

  const min = MIN_DIMENSION_CM_BY_MATERIAL[targetMaterial] || { w: 1, h: 1 };
  const limits = LIMITS[targetMaterial] || {};
  const w = Number(candidate?.w);
  const h = Number(candidate?.h);

  if (!Number.isFinite(w) || !Number.isFinite(h)) return false;
  if (w < (Number(min.w) || 1) || h < (Number(min.h) || 1)) return false;
  if (Number.isFinite(Number(limits.maxW)) && w > Number(limits.maxW)) return false;
  if (Number.isFinite(Number(limits.maxH)) && h > Number(limits.maxH)) return false;

  return true;
};

const isDropdownStandardSizeForMaterial = (candidate, targetMaterial) => (
  getDropdownStandardSizeOptionsForMaterial(targetMaterial).some((option) => sameCmSize(option, candidate))
);

const getDefaultDropdownSizeForMaterial = (targetMaterial) => {
  if (isFixedPad49x42Material(targetMaterial)) {
    return { ...GLASSPAD_SIZE_CM };
  }

  const fallback = DEFAULT_SIZE_CM[targetMaterial] || DEFAULT_SIZE_CM.Classic || DEFAULT_SIZE;
  return {
    w: Number(fallback.w) || DEFAULT_SIZE.w,
    h: Number(fallback.h) || DEFAULT_SIZE.h,
  };
};

const resolveSelectedSizeOptionId = ({
  targetMaterial,
  targetMode,
  candidateSize,
  standardOptions,
}) => {
  if (isFixedPad49x42Material(targetMaterial)) {
    return standardOptions[0]?.id || GLASSPAD_FIXED_SIZE_OPTION_ID;
  }
  if (targetMode === 'custom') {
    return STEP_TWO_CUSTOM_SIZE_OPTION.id;
  }
  return (
    standardOptions.find((option) => sameCmSize(option, candidateSize))?.id
    || STEP_TWO_CUSTOM_SIZE_OPTION.id
  );
};

const resolveEditorSelectionFromFlow = (flowState) => {
  const source = flowState && typeof flowState === 'object' ? flowState : {};
  const rawMaterial = source.material ?? source.options?.material;
  const material = normalizeMaterialLabelSafe(rawMaterial);
  const isCircular = resolveCircularShapeFromSource(source, material);
  const widthCm = Number(source.widthCm);
  const heightCm = Number(source.heightCm);
  const hasPresetSize =
    Number.isFinite(widthCm) && widthCm > 0
    && Number.isFinite(heightCm) && heightCm > 0;
  const hasPresetMaterial = safeStr(rawMaterial).length > 0;
  const hasPreset = hasPresetMaterial || hasPresetSize;

  if (material === 'Glasspad' || material === 'Ultra') {
    return {
      hasPreset,
      material,
      mode: 'standard',
      size: { ...GLASSPAD_SIZE_CM },
      isCircular: false,
    };
  }

  if (hasPresetSize) {
    const candidateSize = { w: Math.round(widthCm), h: Math.round(heightCm) };
    if (isSizeAllowedForMaterial(candidateSize, material)) {
      return {
        hasPreset,
        material,
        mode: isDropdownStandardSizeForMaterial(candidateSize, material) ? 'standard' : 'custom',
        size: candidateSize,
        isCircular,
      };
    }
  }

  return {
    hasPreset,
    material,
    mode: 'standard',
    size: getDefaultDropdownSizeForMaterial(material),
    isCircular,
  };
};

function getStepOnePreviewScale(widthCm, heightCm) {
  const baseScale = STEP_ONE_PREVIEW_MAX_WIDTH_PX / STEP_ONE_PREVIEW_REFERENCE_CM.w;
  const safeWidth = Number.isFinite(Number(widthCm)) && Number(widthCm) > 0 ? Number(widthCm) : 1;
  const safeHeight = Number.isFinite(Number(heightCm)) && Number(heightCm) > 0 ? Number(heightCm) : 1;
  const qualifiesForMediumBoost =
    safeWidth <= STEP_ONE_PREVIEW_MEDIUM_BOOST_LIMIT_CM.w
    && safeHeight <= STEP_ONE_PREVIEW_MEDIUM_BOOST_LIMIT_CM.h;
  const qualifiesForSmallBoost =
    safeWidth <= STEP_ONE_PREVIEW_SMALL_BOOST_LIMIT_CM.w
    && safeHeight <= STEP_ONE_PREVIEW_SMALL_BOOST_LIMIT_CM.h;
  const qualifiesForFocusedBoost =
    safeWidth <= STEP_ONE_PREVIEW_FOCUSED_BOOST_LIMIT_CM.w
    && safeHeight <= STEP_ONE_PREVIEW_FOCUSED_BOOST_LIMIT_CM.h;
  const qualifiesForSpecialBoost =
    safeWidth === STEP_ONE_PREVIEW_SPECIAL_BOOST_SIZE_CM.w
    && safeHeight === STEP_ONE_PREVIEW_SPECIAL_BOOST_SIZE_CM.h;
  let currentVisualScale = baseScale
    * (qualifiesForMediumBoost ? (1 + STEP_ONE_PREVIEW_MEDIUM_BOOST_RATIO) : 1)
    * (qualifiesForMediumBoost ? (1 + STEP_ONE_PREVIEW_MEDIUM_EXTRA_SCALE_RATIO) : 1);

  if (qualifiesForSmallBoost) {
    currentVisualScale *= 1 + STEP_ONE_PREVIEW_SMALL_RANGE_EXTRA_SCALE_RATIO;
  } else if (qualifiesForMediumBoost) {
    currentVisualScale *= 1 + STEP_ONE_PREVIEW_MEDIUM_RANGE_EXTRA_SCALE_RATIO;
  }

  if (qualifiesForSpecialBoost) {
    return currentVisualScale * (1 + STEP_ONE_PREVIEW_SPECIAL_SIZE_EXTRA_SCALE_RATIO);
  }

  if (qualifiesForFocusedBoost) {
    return currentVisualScale * (1 + STEP_ONE_PREVIEW_FOCUSED_RANGE_EXTRA_SCALE_RATIO);
  }

  return currentVisualScale;
}

function fitStageWithinBounds(widthCm, heightCm, maxWidthPx, maxHeightPx) {
  const safeWidth = Number.isFinite(Number(widthCm)) && Number(widthCm) > 0 ? Number(widthCm) : 1;
  const safeHeight = Number.isFinite(Number(heightCm)) && Number(heightCm) > 0 ? Number(heightCm) : 1;
  const boundedWidth = Number.isFinite(Number(maxWidthPx)) && Number(maxWidthPx) > 0 ? Number(maxWidthPx) : safeWidth;
  const boundedHeight = Number.isFinite(Number(maxHeightPx)) && Number(maxHeightPx) > 0 ? Number(maxHeightPx) : safeHeight;
  const scale = Math.min(boundedWidth / safeWidth, boundedHeight / safeHeight);

  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

/** Solo móvil + proporción cuadrada / casi cuadrada (no aplica a 82×32, 140×100, etc.). */
const STEP_ONE_MOBILE_SQUAREISH_ASPECT_MAX = 1.35;
const STEP_ONE_MOBILE_SHELL_MAX_W_PX = 258;
const STEP_ONE_MOBILE_SHELL_MAX_H_PX = 236;
/** Achique leve; el cap px evita que el cuadrado invada los dropdowns. */
const STEP_ONE_MOBILE_SQUAREISH_EXTRA_SCALE = 0.9;

function shouldCapStepOneMobilePreviewShell(widthCm, heightCm) {
  const sw = Number.isFinite(Number(widthCm)) && Number(widthCm) > 0 ? Number(widthCm) : 1;
  const sh = Number.isFinite(Number(heightCm)) && Number(heightCm) > 0 ? Number(heightCm) : 1;
  const minSide = Math.min(sw, sh);
  const maxSide = Math.max(sw, sh);
  const ratio = maxSide / minSide;
  return ratio <= STEP_ONE_MOBILE_SQUAREISH_ASPECT_MAX;
}

function capPreviewShellPx(widthPx, heightPx, maxWPx, maxHPx) {
  const w = Math.max(1, Number(widthPx));
  const h = Math.max(1, Number(heightPx));
  const mw = Number(maxWPx);
  const mh = Number(maxHPx);
  if (!Number.isFinite(mw) || mw <= 0 || !Number.isFinite(mh) || mh <= 0) {
    return { width: Math.round(w), height: Math.round(h) };
  }
  const s = Math.min(1, mw / w, mh / h);
  return {
    width: Math.max(1, Math.round(w * s)),
    height: Math.max(1, Math.round(h * s)),
  };
}

function getStepOneDesktopPreviewSpacingPx(widthCm, heightCm) {
  const safeWidth = Number.isFinite(Number(widthCm)) && Number(widthCm) > 0 ? Number(widthCm) : 1;
  const safeHeight = Number.isFinite(Number(heightCm)) && Number(heightCm) > 0 ? Number(heightCm) : 1;
  if (
    safeWidth > STEP_ONE_DESKTOP_SPACING_MAX_SIZE_CM.w
    || safeHeight > STEP_ONE_DESKTOP_SPACING_MAX_SIZE_CM.h
  ) {
    return STEP_ONE_DESKTOP_SPACING_PX.min;
  }

  const minArea =
    STEP_ONE_DESKTOP_SPACING_MIN_SIZE_CM.w * STEP_ONE_DESKTOP_SPACING_MIN_SIZE_CM.h;
  const maxArea =
    STEP_ONE_DESKTOP_SPACING_MAX_SIZE_CM.w * STEP_ONE_DESKTOP_SPACING_MAX_SIZE_CM.h;
  const clampedArea = Math.min(Math.max(safeWidth * safeHeight, minArea), maxArea);
  const areaRange = Math.max(1, maxArea - minArea);
  const progress = (maxArea - clampedArea) / areaRange;

  return Math.round(
    STEP_ONE_DESKTOP_SPACING_PX.min
    + (STEP_ONE_DESKTOP_SPACING_PX.max - STEP_ONE_DESKTOP_SPACING_PX.min) * progress,
  );
}

function getStepTwoFooterBottomSpacingPx(widthCm, heightCm) {
  const safeWidth = Number.isFinite(Number(widthCm)) && Number(widthCm) > 0 ? Number(widthCm) : 1;
  const safeHeight = Number.isFinite(Number(heightCm)) && Number(heightCm) > 0 ? Number(heightCm) : 1;
  const currentSize = { w: safeWidth, h: safeHeight };

  if (sameCmSize(currentSize, STEP_ONE_PREVIEW_REFERENCE_CM)) {
    return STEP_TWO_FOOTER_BOTTOM_SPACING_PX.tight;
  }

  const minArea = CUSTOM_SIZE_BASE_LIMITS_CM.minW * CUSTOM_SIZE_BASE_LIMITS_CM.minH;
  const maxArea = STEP_ONE_PREVIEW_REFERENCE_CM.w * STEP_ONE_PREVIEW_REFERENCE_CM.h;
  const clampedArea = Math.min(Math.max(safeWidth * safeHeight, minArea), maxArea);
  const progress = (clampedArea - minArea) / Math.max(1, maxArea - minArea);

  return Math.round(
    STEP_TWO_FOOTER_BOTTOM_SPACING_PX.max
    - ((STEP_TWO_FOOTER_BOTTOM_SPACING_PX.max - STEP_TWO_FOOTER_BOTTOM_SPACING_PX.min) * progress),
  );
}

function RulerIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        d="M5 16.5 16.5 5a2.12 2.12 0 1 1 3 3L8 19.5a2.12 2.12 0 0 1-3-3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m12 9 3 3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="m9 12 3 3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="m6 15 3 3" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function homeStepReducer(state, action) {
  switch (action?.type) {
    case 'RESET':
      return HOME_STEP.upload;
    case 'EDIT':
      return action?.hasImage ? HOME_STEP.edit : HOME_STEP.upload;
    case 'REVIEW':
      return state === HOME_STEP.edit ? HOME_STEP.review : state;
    case 'RESTORE_EDIT':
      return action?.hasImage ? HOME_STEP.edit : HOME_STEP.upload;
    default:
      return state;
  }
}

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
    return `Bloqueado por moderaci\u00F3n (c\u00F3digo: ${reason}).`;
  }
  return 'Bloqueado por moderaci\u00F3n.';
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
    throw new Error('La imagen no tiene dimensiones v\u00E1lidas.');
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
    throw new Error('No se pudo crear el contexto para la previsualizaci\u00F3n.');
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
    throw new Error('No se pudo generar la previsualizaci\u00F3n.');
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

const resolveCheckoutTargetUrl = (result) => {
  const directCandidates = [
    result?.checkoutUrl,
    result?.url,
    result?.productUrl,
    result?.cartUrl,
    result?.privateCheckoutUrl,
    result?.raw?.checkoutUrl,
    result?.raw?.url,
    result?.raw?.productUrl,
    result?.meta?.productUrl,
  ];
  for (const candidate of directCandidates) {
    const value = safeStr(candidate);
    if (value) return value;
  }
  return pickCommerceTarget(result) || pickCommerceTarget(result?.raw) || null;
};

/** URL de la ficha del producto en Shopify (no carrito ni checkout). */
const isLikelyCartOrCheckoutPath = (value) => /\/cart(?:\/|$|\?)/i.test(value) || /\/checkouts?\//i.test(value);

const resolveProductPageTargetUrl = (result) => {
  if (!result || typeof result !== 'object') return null;

  const productCandidates = [
    result?.productUrl,
    result?.publicUrl,
    result?.raw?.productUrl,
    result?.raw?.publicUrl,
    result?.meta?.productUrl,
  ];
  const shopHost = () => {
    const domainRaw = safeStr(import.meta.env?.VITE_SHOPIFY_DOMAIN);
    if (!domainRaw) return '';
    return domainRaw.replace(/^https?:\/\//i, '').replace(/\/+$/, '').split('/')[0];
  };

  for (const candidate of productCandidates) {
    const value = safeStr(candidate);
    if (!value || isLikelyCartOrCheckoutPath(value)) continue;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('/') && /\/products\//i.test(value)) {
      const host = shopHost();
      if (host) return `https://${host}${value}`;
    }
  }

  const handleRaw =
    safeStr(result?.productHandle)
    || safeStr(result?.handle)
    || safeStr(result?.raw?.productHandle)
    || safeStr(result?.raw?.handle);
  if (handleRaw) {
    let handle = handleRaw.replace(/^\/+/, '').replace(/\/+$/, '');
    handle = safeReplace(handle, /^products\//i, '');
    const host = shopHost();
    if (host && handle) {
      return `https://${host}/products/${encodeURIComponent(handle)}`;
    }
  }

  const fallback = pickCommerceTarget(result) || pickCommerceTarget(result?.raw);
  const fb = safeStr(fallback);
  if (fb && /\/products\//i.test(fb) && !isLikelyCartOrCheckoutPath(fb)) return fb;

  return null;
};

/** Navegación en la misma pestaña: evita ventanas emergentes y avisos del navegador. */
function navigateSameTab(url) {
  const trimmed = safeStr(url);
  if (!trimmed) return false;
  try {
    window.location.assign(trimmed);
    return true;
  } catch (assignErr) {
    error('[home-step-three-commerce] location_assign_failed', assignErr);
  }
  return false;
}

const resolveCheckoutErrorMessage = (checkoutError) => {
  const friendlyMessage = safeStr(checkoutError?.friendlyMessage);
  if (friendlyMessage) return friendlyMessage;
  const rawMessage = safeStr(checkoutError?.message);
  const name = safeStr(checkoutError?.name);
  if (
    name === 'TypeError'
    && /network|fetch|load failed|abort|failed to fetch/i.test(rawMessage)
  ) {
    return 'No pudimos completar la solicitud (red o el servidor tardó demasiado). Si el navegador muestra CORS suele ser un timeout: esperá un momento y probá de nuevo.';
  }
  if (rawMessage && /[\sáéíóúüñ]/i.test(rawMessage)) {
    return rawMessage;
  }
  return 'No se pudo abrir el checkout. Intentá nuevamente.';
};

function tryOpenCommerceTarget(url) {
  const trimmed = safeStr(url);
  if (!trimmed) return false;
  try {
    const popup = window.open(trimmed, '_blank', 'noopener');
    if (popup) return true;
  } catch (openErr) {
    warn('[home-step-three-commerce] window_open_failed', openErr);
  }
  try {
    window.location.assign(trimmed);
    return true;
  } catch (assignErr) {
    error('[home-step-three-commerce] location_assign_failed', assignErr);
  }
  return false;
}


export default function Home() {
  const outletContext = useOutletContext() || {};
  const { setHeaderStepOverride, isDarkMode = true } = outletContext;
  const [currentStep, dispatchStep] = useReducer(homeStepReducer, HOME_STEP.upload);
  const currentStepRef = useRef(currentStep);
  currentStepRef.current = currentStep;
  const flow = useFlow();
  const initialEditorSelection = useMemo(
    () => resolveEditorSelectionFromFlow((typeof flow?.get === 'function' ? flow.get() : flow) || {}),
    [flow],
  );

  // archivo subido
  const uploaded = flow?.uploadedAsset || null;
  const imageUrl =
    typeof flow?.imageSourceUrl === 'string' && flow.imageSourceUrl.trim()
      ? flow.imageSourceUrl.trim()
      : null;
  const setUploaded = useCallback((nextUploaded) => {
    if (typeof flow?.setImageAsset === 'function') {
      flow.setImageAsset(nextUploaded);
      return;
    }

    const currentFlowState = (typeof flow?.get === 'function' ? flow.get() : flow) || {};
    const currentUploaded = currentFlowState.uploadedAsset || null;
    const resolvedUploaded =
      typeof nextUploaded === 'function' ? nextUploaded(currentUploaded) : nextUploaded;
    const resolvedImageUrl =
      resolvedUploaded?.localUrl
      || resolvedUploaded?.canonical_url
      || resolvedUploaded?.file_original_url
      || null;

    flow?.set?.({
      uploadedAsset: resolvedUploaded || null,
      masterFile: resolvedUploaded?.file || null,
      imageLocalUrl: resolvedUploaded?.localUrl || null,
      imageSourceUrl: resolvedImageUrl,
      fileOriginalUrl: resolvedUploaded?.file_original_url || resolvedUploaded?.canonical_url || null,
    });
  }, [flow]);
  const [configOpen, setConfigOpen] = useState(false);
  const [toolsDrawerOpen, setToolsDrawerOpen] = useState(false);
  const [stepTwoContainColorOpen, setStepTwoContainColorOpen] = useState(false);
  const stepTwoContainColorAnchorRef = useRef(null);
  const [openConfigSection, setOpenConfigSection] = useState(STEP_TWO_DRAWER_SECTIONS.project);

  // No se ejecutan filtros rapidos al subir imagen

  // medidas y material (source of truth)
  const [material, setMaterial] = useState(initialEditorSelection.material);
  const [mode, setMode] = useState(initialEditorSelection.mode);
  const [size, setSize] = useState(() => ({ ...initialEditorSelection.size }));
  const [isCircular, setIsCircular] = useState(Boolean(initialEditorSelection.isCircular));
  const didHydrateEditorSelectionRef = useRef(initialEditorSelection.hasPreset);
  const sizeCm = useMemo(
    () => ({ w: Math.round(Number(size.w)) || 90, h: Math.round(Number(size.h)) || 40 }),
    [size.w, size.h],
  );
  const customSizeLimits = useMemo(() => {
    const materialMin = MIN_DIMENSION_CM_BY_MATERIAL[material] || {};
    const materialMax = LIMITS[material] || {};
    const minW = Math.max(CUSTOM_SIZE_BASE_LIMITS_CM.minW, Number(materialMin.w) || CUSTOM_SIZE_BASE_LIMITS_CM.minW);
    const minH = Math.max(CUSTOM_SIZE_BASE_LIMITS_CM.minH, Number(materialMin.h) || CUSTOM_SIZE_BASE_LIMITS_CM.minH);
    const maxW = Math.max(minW, Math.min(CUSTOM_SIZE_BASE_LIMITS_CM.maxW, Number(materialMax.maxW) || CUSTOM_SIZE_BASE_LIMITS_CM.maxW));
    const maxH = Math.max(minH, Math.min(CUSTOM_SIZE_BASE_LIMITS_CM.maxH, Number(materialMax.maxH) || CUSTOM_SIZE_BASE_LIMITS_CM.maxH));

    return { minW, minH, maxW, maxH };
  }, [material]);

  const useFixedPadDimensions = isFixedPad49x42Material(material);
  const activeWcm = useFixedPadDimensions ? GLASSPAD_SIZE_CM.w : sizeCm.w;
  const activeHcm = useFixedPadDimensions ? GLASSPAD_SIZE_CM.h : sizeCm.h;
  const activeSizeCm = useMemo(() => ({ w: activeWcm, h: activeHcm }), [activeWcm, activeHcm]);
  const lastSize = useRef({});
  const lastRectSizeRef = useRef({});

  const clampSizeForMaterial = useCallback(
    (candidate, targetMaterial = material) => {
      const min = MIN_DIMENSION_CM_BY_MATERIAL[targetMaterial] || { w: 1, h: 1 };
      const lim = LIMITS[targetMaterial] || {};
      const clamp = (value, minVal, maxVal) => {
        const numeric = Number(value);
        const lower = Math.round(typeof minVal === 'number' ? minVal : 1);
        const rounded = Number.isFinite(numeric) ? Math.round(numeric) : NaN;
        const upper = typeof maxVal === 'number' ? Math.round(maxVal) : rounded;
        if (!Number.isFinite(numeric)) return lower;
        if (Number.isFinite(upper)) return Math.max(lower, Math.min(upper, rounded));
        return Math.max(lower, rounded);
      };
      return {
        w: clamp(candidate?.w, min.w, lim.maxW),
        h: clamp(candidate?.h, min.h, lim.maxH),
      };
    },
    [material],
  );

  const normalizeCircularSizeForMaterial = useCallback(
    (candidate, targetMaterial = material) => {
      const clamped = clampSizeForMaterial(candidate, targetMaterial);
      const min = MIN_DIMENSION_CM_BY_MATERIAL[targetMaterial] || { w: 1, h: 1 };
      const lim = LIMITS[targetMaterial] || {};
      const minSide = Math.max(min.w ?? 1, min.h ?? 1);
      const maxSide = Math.min(
        typeof lim.maxW === 'number' ? lim.maxW : clamped.w,
        typeof lim.maxH === 'number' ? lim.maxH : clamped.h,
      );
      const side = Math.max(minSide, Math.min(maxSide, Math.max(clamped.w, clamped.h)));
      return { w: side, h: side };
    },
    [clampSizeForMaterial, material],
  );

  const applyCircularConstraint = useCallback(
    (candidate, targetMaterial = material) => {
      if (!isCircular || isFixedPad49x42Material(targetMaterial)) {
        return clampSizeForMaterial(candidate, targetMaterial);
      }
      return normalizeCircularSizeForMaterial(candidate, targetMaterial);
    },
    [clampSizeForMaterial, isCircular, material, normalizeCircularSizeForMaterial],
  );

  useEffect(() => {
    if (isFixedPad49x42Material(material) && isCircular) {
      setIsCircular(false);
    }
  }, [material, isCircular]);

  const fixedPadSizeInitRef = useRef(false);
  useEffect(() => {
    if (!isFixedPad49x42Material(material)) {
      fixedPadSizeInitRef.current = false;
      return;
    }
    if (fixedPadSizeInitRef.current) return;
    setSize({ w: GLASSPAD_SIZE_CM.w, h: GLASSPAD_SIZE_CM.h });
    fixedPadSizeInitRef.current = true;
  }, [material]);

  const [priceAmount, setPriceAmount] = useState(0);
  const latestTransferPriceRef = useRef(0);
  const PRICE_CURRENCY = 'ARS';

  // layout del canvas
  const [layout, setLayout] = useState(null);
  const [designName, setDesignName] = useState('');
  const [designNameError, setDesignNameError] = useState('');
  const [ackLow, setAckLow] = useState(false);
  const [ackLowError, setAckLowError] = useState(false);
  const ackCheckboxRef = useRef(null);
  const ackLowErrorDescriptionId = useId();
  const stepThreeCheckoutTitleId = useId();
  const stepThreeCheckoutDescId = useId();
  const [mockupUrl, setMockupUrl] = useState(null);
  const [mockupBlob, setMockupBlob] = useState(null);
  const [reviewPreviewUrl, setReviewPreviewUrl] = useState(null);
  const mockupUrlRef = useRef(null);
  const isMobileDevice = useMemo(() => isTouchDevice(), []);
  const [err, setErr] = useState('');
  const [moderationNotice, setModerationNotice] = useState('');
  const [busy, setBusy] = useState(false);
  /** Paso 3: null | 'cart' | 'checkout-public' | 'checkout-private' mientras corre createJobAndProduct */
  const [stepThreeCommerceAction, setStepThreeCommerceAction] = useState(null);
  const [stepThreeCheckoutPromptOpen, setStepThreeCheckoutPromptOpen] = useState(false);
  const stepThreeCheckoutModalRef = useRef(null);
  const stepThreeCheckoutFirstButtonRef = useRef(null);
  const [reviewExitBusy, setReviewExitBusy] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [masterPublicUrl, setMasterPublicUrl] = useState(null);
  const [masterWidthPx, setMasterWidthPx] = useState(null);
  const [masterHeightPx, setMasterHeightPx] = useState(null);
  const [designHashState, setDesignHashState] = useState(null);
  const [pdfPublicUrl, setPdfPublicUrl] = useState(null);
  const canvasRef = useRef(null);
  const designNameInputRef = useRef(null);
  const didHydrateDesignNameRef = useRef(false);
  const pageRef = useRef(null);
  const stepOneFileInputRef = useRef(null);
  const stepOneSizeDropdownRef = useRef(null);
  const stepOneMaterialDropdownRef = useRef(null);
  const stepOneCustomSizePanelRef = useRef(null);
  const stepTwoFileInputRef = useRef(null);
  const stepTwoFooterRef = useRef(null);
  const stepTwoWorkspaceRef = useRef(null);
  const stepOneDragDepthRef = useRef(0);
  const sectionOneRef = useRef(null);
  const sectionOneInnerRef = useRef(null);
  const headingRef = useRef(null);
  const lienzoCardRef = useRef(null);
  const configDropdownRef = useRef(null);
  const configTriggerButtonRef = useRef(null);
  const configPanelRef = useRef(null);
  const toolsDrawerRef = useRef(null);
  const [configPanelStyle, setConfigPanelStyle] = useState({});
  const wasConfigOpenRef = useRef(false);
  const [canvasFit, setCanvasFit] = useState({ height: null, maxWidth: null, sectionOneMinHeight: null });
  const [stepOneDragActive, setStepOneDragActive] = useState(false);
  const [isStepOneSizeMenuOpen, setStepOneSizeMenuOpen] = useState(false);
  const [isStepOneMaterialMenuOpen, setStepOneMaterialMenuOpen] = useState(false);
  const [isStepOneMobileViewport, setStepOneMobileViewport] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(STEP_ONE_MOBILE_QUERY).matches;
  });
  const [stepTwoViewportMetrics, setStepTwoViewportMetrics] = useState(() => {
    if (typeof window === 'undefined') {
      return {
        viewportWidth: 0,
        viewportHeight: 0,
        frameWidth: 0,
        frameTop: 0,
        footerHeight: 0,
      };
    }

    return {
      viewportWidth: window.innerWidth || 0,
      viewportHeight: window.innerHeight || 0,
      frameWidth: 0,
      frameTop: 0,
      footerHeight: 0,
    };
  });
  const [isStepOneCustomSizePanelOpen, setStepOneCustomSizePanelOpen] = useState(false);
  const [isGalleryOpen, setGalleryOpen] = useState(false);
  const flowSetRef = useRef(flow?.set);
  const heavyToastShownRef = useRef(false);
  const hasImage = Boolean(
    uploaded
    || imageUrl
    || flow?.imageLocalUrl
    || flow?.imageSourceUrl
    || flow?.fileOriginalUrl
    || flow?.masterFile,
  );
  const isStepUpload = currentStep === HOME_STEP.upload;
  const isStepEdit = currentStep === HOME_STEP.edit;
  const isStepReview = currentStep === HOME_STEP.review;
  const [showStepTwoRepositionHint, setShowStepTwoRepositionHint] = useState(true);
  const isStepOneCustomSizeMode = mode === 'custom' && !isFixedPad49x42Material(material);
  const isStepOneCustomSizePanelCollapsible = isStepOneMobileViewport && isStepOneCustomSizeMode;
  const isStepOneCustomSizePanelVisible = !isStepOneCustomSizePanelCollapsible || isStepOneCustomSizePanelOpen;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQueryList = window.matchMedia(STEP_ONE_MOBILE_QUERY);
    const handleChange = (event) => {
      setStepOneMobileViewport(event.matches);
    };

    setStepOneMobileViewport(mediaQueryList.matches);

    if (typeof mediaQueryList.addEventListener === 'function') {
      mediaQueryList.addEventListener('change', handleChange);
    } else if (typeof mediaQueryList.addListener === 'function') {
      mediaQueryList.addListener(handleChange);
    }

    return () => {
      if (typeof mediaQueryList.removeEventListener === 'function') {
        mediaQueryList.removeEventListener('change', handleChange);
      } else if (typeof mediaQueryList.removeListener === 'function') {
        mediaQueryList.removeListener(handleChange);
      }
    };
  }, []);

  const recomputeStepTwoViewportMetrics = useCallback(() => {
    if (typeof window === 'undefined' || !isStepEdit) return;

    const parsePx = (value) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const pageEl = pageRef.current;
    const workspaceEl = stepTwoWorkspaceRef.current;
    const frameEl = lienzoCardRef.current;
    const footerEl = stepTwoFooterRef.current;
    const pageStyles = pageEl ? window.getComputedStyle(pageEl) : null;
    const pagePaddingInline = parsePx(pageStyles?.paddingLeft) + parsePx(pageStyles?.paddingRight);
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const workspaceRect = workspaceEl?.getBoundingClientRect?.();
    const frameRect = frameEl?.getBoundingClientRect?.();
    const footerRect = footerEl?.getBoundingClientRect?.();
    const frameWidth = workspaceRect?.width || Math.max(0, viewportWidth - pagePaddingInline);
    const frameTop = frameRect?.top || 0;
    const footerHeight = footerRect?.height || 0;

    setStepTwoViewportMetrics((prev) => {
      const next = {
        viewportWidth,
        viewportHeight,
        frameWidth,
        frameTop,
        footerHeight,
      };

      return prev.viewportWidth === next.viewportWidth
        && prev.viewportHeight === next.viewportHeight
        && prev.frameWidth === next.frameWidth
        && prev.frameTop === next.frameTop
        && prev.footerHeight === next.footerHeight
        ? prev
        : next;
    });
  }, [isStepEdit]);

  useLayoutEffect(() => {
    if (!isStepEdit || typeof window === 'undefined') return undefined;

    recomputeStepTwoViewportMetrics();

    const handleResize = () => {
      recomputeStepTwoViewportMetrics();
    };

    window.addEventListener('resize', handleResize);

    let observer;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        recomputeStepTwoViewportMetrics();
      });

      [
        pageRef.current,
        headingRef.current,
        stepTwoWorkspaceRef.current,
        lienzoCardRef.current,
        stepTwoFooterRef.current,
      ]
        .filter(Boolean)
        .forEach((node) => observer.observe(node));
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      observer?.disconnect();
    };
  }, [isStepEdit, recomputeStepTwoViewportMetrics]);

  useEffect(() => {
    setHeaderStepOverride?.(currentStep);
  }, [currentStep, setHeaderStepOverride]);

  useEffect(() => {
    flowSetRef.current = flow?.set;
  }, [flow?.set]);

  useEffect(() => () => {
    setHeaderStepOverride?.(null);
  }, [setHeaderStepOverride]);

  useEffect(() => () => {
    flowSetRef.current?.({ designName: '' });
  }, []);

  useEffect(() => {
    if (!hasImage && currentStep !== HOME_STEP.upload) {
      dispatchStep({ type: 'RESET' });
    }
  }, [currentStep, hasImage]);

  useEffect(() => {
    if (isStepUpload || isStepReview || !hasImage) {
      setConfigOpen(false);
      setToolsDrawerOpen(false);
    }
  }, [hasImage, isStepReview, isStepUpload]);

  useEffect(() => {
    if (!isStepUpload) {
      stepOneDragDepthRef.current = 0;
      setStepOneDragActive(false);
    }
  }, [isStepUpload]);

  useEffect(() => {
    if (!isStepUpload) {
      setStepOneSizeMenuOpen(false);
    }
  }, [isStepUpload]);

  useEffect(() => {
    if (!isStepUpload) {
      setStepOneMaterialMenuOpen(false);
    }
  }, [isStepUpload]);

  useEffect(() => {
    if (!isStepUpload) {
      setGalleryOpen(false);
    }
  }, [isStepUpload]);

  useEffect(() => {
    if (!isStepEdit || typeof window === 'undefined') return undefined;
    if ((window.innerWidth || 0) >= 768) return undefined;

    let frameId = 0;
    const resetScrollTop = () => {
      window.scrollTo(0, 0);
      if (pageRef.current) {
        pageRef.current.scrollTop = 0;
      }
      if (sectionOneRef.current) {
        sectionOneRef.current.scrollTop = 0;
      }
    };

    resetScrollTop();
    frameId = window.requestAnimationFrame(resetScrollTop);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [isStepEdit]);

  useEffect(() => {
    if (!isStepUpload || !isStepOneCustomSizeMode) {
      setStepOneCustomSizePanelOpen(false);
      return;
    }

    if (!isStepOneMobileViewport) {
      setStepOneCustomSizePanelOpen(true);
      return;
    }

    setStepOneCustomSizePanelOpen(true);
  }, [isStepOneCustomSizeMode, isStepOneMobileViewport, isStepUpload]);

  useEffect(() => {
    if (!isGalleryOpen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setGalleryOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isGalleryOpen]);

  useEffect(() => {
    if (!isStepOneSizeMenuOpen && !isStepOneMaterialMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (stepOneSizeDropdownRef.current?.contains(event.target)) return;
      if (stepOneMaterialDropdownRef.current?.contains(event.target)) return;
      setStepOneSizeMenuOpen(false);
      setStepOneMaterialMenuOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setStepOneSizeMenuOpen(false);
        setStepOneMaterialMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isStepOneMaterialMenuOpen, isStepOneSizeMenuOpen]);

  useEffect(() => {
    if (!isStepUpload || !isStepOneMobileViewport || !isStepOneCustomSizeMode || !isStepOneCustomSizePanelOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      const panelEl = stepOneCustomSizePanelRef.current;
      if (!panelEl) return;
      if (panelEl.contains(event.target)) return;
      if (stepOneSizeDropdownRef.current?.contains(event.target)) return;
      setStepOneCustomSizePanelOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [
    isStepOneCustomSizeMode,
    isStepOneCustomSizePanelOpen,
    isStepOneMobileViewport,
    isStepUpload,
  ]);

  useLayoutEffect(() => {
    if (!isStepUpload || !isStepOneMobileViewport) return undefined;

    let rafOne = 0;
    let rafTwo = 0;

    const forceMobileLayout = () => {
      const previewNode = lienzoCardRef.current;
      if (previewNode) {
        previewNode.getBoundingClientRect();
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('resize'));
      }
    };

    rafOne = window.requestAnimationFrame(() => {
      forceMobileLayout();
      rafTwo = window.requestAnimationFrame(forceMobileLayout);
    });

    return () => {
      if (rafOne) window.cancelAnimationFrame(rafOne);
      if (rafTwo) window.cancelAnimationFrame(rafTwo);
    };
  }, [
    isStepOneCustomSizePanelVisible,
    isStepOneMaterialMenuOpen,
    isStepOneMobileViewport,
    isStepOneSizeMenuOpen,
    isStepUpload,
  ]);

  const showHeavyImageToast = useCallback((actualMb, maxMb) => {
    if (heavyToastShownRef.current) {
      return;
    }
    heavyToastShownRef.current = true;
    const toast = window?.toast;
    toast?.error?.(formatHeavyImageToastMessage(actualMb, maxMb), { duration: 6000 });
  }, []);

  const maybeShowHeavyImageToastFromError = useCallback((checkoutError) => {
    const reason = safeStr(checkoutError?.reason || checkoutError?.code || checkoutError?.message).toLowerCase();
    if (!reason) return;
    const heavyReasons = new Set([
      'payload_too_large',
      'publish_payload_too_large',
      'file_too_large',
      'pdf_too_large',
      'supabase_object_too_large',
      'image_too_heavy',
      'preview_too_large',
    ]);
    if (!heavyReasons.has(reason)) return;

    const detail = (checkoutError && typeof checkoutError === 'object')
      ? (checkoutError.detail || checkoutError.json || null)
      : null;

    const actualBytes = (
      typeof detail?.estimatedBytes === 'number' ? detail.estimatedBytes
        : typeof detail?.bytes === 'number' ? detail.bytes
          : typeof detail?.sizeBytes === 'number' ? detail.sizeBytes
            : typeof detail?.size_bytes === 'number' ? detail.size_bytes
              : typeof detail?.size === 'number' ? detail.size
              : null
    );

    const maxBytes = (
      typeof detail?.limitBytes === 'number' ? detail.limitBytes
        : typeof detail?.max_size_bytes === 'number' ? detail.max_size_bytes
          : typeof detail?.limit_bytes === 'number' ? detail.limit_bytes
            : typeof detail?.limit === 'number' ? detail.limit
            : null
    );

    const fallbackActualBytes = typeof uploaded?.file?.size === 'number'
      ? uploaded.file.size
      : typeof flow?.masterBytes === 'number'
        ? flow.masterBytes
        : null;

    const fallbackMaxBytes = MAX_IMAGE_BYTES;

    const finalActualBytes = actualBytes ?? fallbackActualBytes;
    const finalMaxBytes = maxBytes ?? fallbackMaxBytes;

    if (!(Number.isFinite(finalActualBytes) && finalActualBytes > 0)) return;
    if (!(Number.isFinite(finalMaxBytes) && finalMaxBytes > 0)) return;

    const actualMb = bytesToMB(finalActualBytes);
    const maxMb = bytesToMB(finalMaxBytes);
    showHeavyImageToast(actualMb, maxMb);
  }, [bytesToMB, flow, MAX_IMAGE_BYTES, showHeavyImageToast, uploaded]);

  const handleUploaded = useCallback((info) => {
    const file = info?.file;
    if (!file) return;

    heavyToastShownRef.current = false;
    setReviewPreviewUrl(null);
    if (file.size > MAX_IMAGE_BYTES) {
      try {
        if (info?.localUrl) URL.revokeObjectURL(info.localUrl);
      } catch {}
      setUploaded(null);
      flow?.set?.({
        mockupUrl: null,
        mockupPublicUrl: null,
        masterBytes: null,
        masterPublicUrl: null,
        fileOriginalUrl: null,
      });
      const toast = window?.toast;
      const tooHeavyMessage = formatHeavyImageToastMessage(
        bytesToMB(file.size),
        MAX_IMAGE_MB,
      );
      toast?.error?.(tooHeavyMessage, { duration: 6000 });
      if (info?.isReplacing) {
        setIsReplacing(false);
      }
      return;
    }

    flow?.set?.({ masterBytes: file.size });
    setErr('');
    setUploaded(info);
    setAckLow(false);
    setAckLowError(false);
    if (info?.openConfig) {
      setOpenConfigSection(STEP_TWO_DRAWER_SECTIONS.project);
    }
    setConfigOpen(Boolean(info?.openConfig));
    setToolsDrawerOpen(false);
    dispatchStep({ type: 'EDIT', hasImage: true });
  }, [flow, setUploaded]);

  useEffect(() => () => {
    if (mockupUrlRef.current && mockupUrlRef.current.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(mockupUrlRef.current);
      } catch {}
    }
    mockupUrlRef.current = null;
  }, []);

  const clearProjectNameState = useCallback(() => {
    didHydrateDesignNameRef.current = true;
    setDesignName('');
    setDesignNameError('');
    flow?.set?.({ designName: '' });
  }, [flow]);

  const handleClearImage = useCallback(() => {
    heavyToastShownRef.current = false;
    setUploaded(null);
    setReviewPreviewUrl(null);
    setLayout(null);
    setAckLowError(false);
    clearProjectNameState();
    setAckLow(false);
    setErr('');
    setModerationNotice('');
    setIsReplacing(false);
    setPriceAmount(0);
    setConfigOpen(false);
    setToolsDrawerOpen(false);
    latestTransferPriceRef.current = 0;
    if (mockupUrlRef.current && mockupUrlRef.current.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(mockupUrlRef.current);
      } catch {}
    }
    mockupUrlRef.current = null;
    setMockupUrl(null);
    setMockupBlob(null);
    flow?.set?.({
      mockupUrl: null,
      mockupPublicUrl: null,
      masterBytes: null,
      masterPublicUrl: null,
      fileOriginalUrl: null,
    });
  }, [clearProjectNameState, flow, setUploaded]);

  const handleCalculatedPrice = useCallback((nextPrice) => {
    const parsed = Number(nextPrice);
    const normalized = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    latestTransferPriceRef.current = normalized;
    setPriceAmount(normalized);
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
  const level = useMemo(() => {
    if (!effDpi) return null;
    return qualityLevel({
      dpi: effDpi,
      naturalWidth: layout?.image?.natural_px?.w,
      sizeCm: layout?.size_cm,
      warn: DPI_WARN_THRESHOLD,
      low: DPI_LOW_THRESHOLD,
    });
  }, [effDpi, layout]);
  const trimmedDesignName = useMemo(() => (designName || '').trim(), [designName]);
  const designNameValidationMessage = useMemo(
    () => validateProjectName(designName),
    [designName],
  );
  const liveDesignNameError = trimmedDesignName ? designNameValidationMessage : '';
  const resolvedDesignNameError = designNameError || liveDesignNameError;

  useEffect(() => {
    if (didHydrateEditorSelectionRef.current) return;
    const nextSelection = resolveEditorSelectionFromFlow(
      (typeof flow?.get === 'function' ? flow.get() : flow) || {},
    );
    if (!nextSelection.hasPreset) return;
    didHydrateEditorSelectionRef.current = true;
    setMaterial(nextSelection.material);
    setMode(nextSelection.mode);
    setSize({ ...nextSelection.size });
    setIsCircular(Boolean(nextSelection.isCircular));
    setStepOneCustomSizePanelOpen(
      nextSelection.mode === 'custom' && !isFixedPad49x42Material(nextSelection.material),
    );
  }, [flow, flow?.heightCm, flow?.material, flow?.options?.material, flow?.options?.shape, flow?.shape, flow?.widthCm]);

  const handleSizeChange = useCallback((next) => {
    didHydrateEditorSelectionRef.current = true;
    if (next.material && next.material !== material) {
      const nextMaterial = next.material;
      if (!isFixedPad49x42Material(material)) {
        lastSize.current[material] = { ...size };
      }
      if (nextMaterial === 'Glasspad' || nextMaterial === 'Ultra') {
        setIsCircular(false);
        setMaterial(nextMaterial);
        setMode('standard');
        setSize({ w: GLASSPAD_SIZE_CM.w, h: GLASSPAD_SIZE_CM.h });
        return;
      }
      const stored = lastSize.current[nextMaterial];
      const currentSizeIsValid = isSizeAllowedForMaterial(size, nextMaterial);
      const shouldUseDefaultSize = !currentSizeIsValid || (isFixedPad49x42Material(material) && !stored);
      let finalSize;
      let nextModeValue;

      if (shouldUseDefaultSize) {
        finalSize = getDefaultDropdownSizeForMaterial(nextMaterial);
        nextModeValue = 'standard';
      } else if (mode === 'custom') {
        finalSize = applyCircularConstraint(size, nextMaterial);
        nextModeValue = 'custom';
      } else {
        const candidateSize = stored && isSizeAllowedForMaterial(stored, nextMaterial)
          ? stored
          : size;
        finalSize = applyCircularConstraint(candidateSize, nextMaterial);
        nextModeValue = isDropdownStandardSizeForMaterial(finalSize, nextMaterial)
          ? 'standard'
          : 'custom';
      }

      setMaterial(nextMaterial);
      setMode(nextModeValue);
      setSize(finalSize);

      if (!stored || stored.w !== finalSize.w || stored.h !== finalSize.h) {
        lastSize.current[nextMaterial] = finalSize;
      }
      return;
    }
    const isFixedSizeSelection =
      next.mode === 'standard'
      && typeof next.w === 'number'
      && typeof next.h === 'number';
    if (isFixedSizeSelection) {
      const normalized = clampSizeForMaterial({ w: next.w, h: next.h });
      setIsCircular(false);
      setMode('standard');
      setSize(normalized);
      setStepOneCustomSizePanelOpen(false);
      if (!isFixedPad49x42Material(material)) {
        lastRectSizeRef.current[material] = normalized;
        lastSize.current[material] = normalized;
      }
      return;
    }
    if (next.mode && next.mode !== mode) {
      setMode(next.mode);
      if (next.mode === 'standard' && typeof next.w === 'number' && typeof next.h === 'number') {
        const normalized = applyCircularConstraint({ w: next.w, h: next.h });
        setSize(normalized);
        if (!isFixedPad49x42Material(material)) {
          lastSize.current[material] = normalized;
        }
      }
    }
    if (typeof next.w === 'number' || typeof next.h === 'number') {
      const nextSize = {
        w: typeof next.w === 'number' ? next.w : size.w,
        h: typeof next.h === 'number' ? next.h : size.h,
      };
      if (isCircular && !isFixedPad49x42Material(material)) {
        if (typeof next.w === 'number' && typeof next.h !== 'number') {
          nextSize.h = next.w;
        } else if (typeof next.h === 'number' && typeof next.w !== 'number') {
          nextSize.w = next.h;
        }
      }
      const normalized = applyCircularConstraint(nextSize);
      setSize(normalized);
      if (!isFixedPad49x42Material(material)) {
        lastSize.current[material] = normalized;
      }
    }
  }, [applyCircularConstraint, clampSizeForMaterial, isCircular, material, mode, size]);

  const handleCustomSizeChange = useCallback((nextSize) => {
    handleSizeChange({ mode: 'custom', ...nextSize });
  }, [handleSizeChange]);


  const handleToggleCircular = useCallback(() => {
    if (isFixedPad49x42Material(material)) return;
    setIsCircular((prev) => {
      if (!prev) {
        if (!isFixedPad49x42Material(material)) {
          lastRectSizeRef.current[material] = { ...size };
        }
        const squared = normalizeCircularSizeForMaterial(size);
        setSize(squared);
        if (!isFixedPad49x42Material(material)) {
          lastSize.current[material] = squared;
        }
        return true;
      }
      const restore = lastRectSizeRef.current[material];
      if (restore) {
        const clamped = clampSizeForMaterial(restore);
        setSize(clamped);
        if (!isFixedPad49x42Material(material)) {
          lastSize.current[material] = clamped;
        }
      }
      return false;
    });
  }, [clampSizeForMaterial, material, normalizeCircularSizeForMaterial, size]);


  useEffect(() => {
    if (!isCircular || isFixedPad49x42Material(material)) return;
    const squared = normalizeCircularSizeForMaterial(size);
    if (squared.w !== size.w || squared.h !== size.h) {
      setSize(squared);
      if (!isFixedPad49x42Material(material)) {
        lastSize.current[material] = squared;
      }
    }
  }, [isCircular, material, normalizeCircularSizeForMaterial, size]);


  function handleDesignNameChange(event) {
    const { value } = event.target;
    const sanitizedValue = stripProjectNameEmojis(value);
    didHydrateDesignNameRef.current = true;
    setDesignName(sanitizedValue);
    if (sanitizedValue !== value) {
      setDesignNameError('No uses emojis en el nombre del proyecto.');
      return;
    }
    setDesignNameError(sanitizedValue.trim().length > 0 ? validateProjectName(sanitizedValue) : '');
  }

  useEffect(() => {
    if (didHydrateDesignNameRef.current) return;
    const externalName = safeStr(flow?.designName);
    if (!designName && externalName) {
      didHydrateDesignNameRef.current = true;
      setDesignName(externalName);
      return;
    }
    if (designName) {
      didHydrateDesignNameRef.current = true;
    }
  }, [designName, flow?.designName]);

  const handleStepTwoEditorUnmount = useCallback(() => {
    if (currentStepRef.current !== HOME_STEP.upload) return;
    setIsCircular(false);
    setStepOneCustomSizePanelOpen(false);
  }, []);

  useEffect(() => {
    if (typeof flow?.set !== 'function') return;

    const nextWidthCm = Math.round(Number(activeSizeCm?.w) || 0);
    const nextHeightCm = Math.round(Number(activeSizeCm?.h) || 0);
    const nextShape = isCircular && !isFixedPad49x42Material(material) ? 'circle' : 'rounded_rect';
    const nextIsCircular = nextShape === 'circle';
    const nextOptions = {
      ...((flow?.options && typeof flow.options === 'object') ? flow.options : {}),
      material,
      productType: material === 'Glasspad' ? 'glasspad' : material === 'Alfombra' ? 'alfombra' : 'mousepad',
      shape: nextShape,
      isCircular: nextIsCircular,
    };

    const shouldSync =
      flow?.designName !== designName
      || flow?.material !== material
      || Boolean(flow?.isCircular) !== nextIsCircular
      || flow?.shape !== nextShape
      || Number(flow?.widthCm || 0) !== nextWidthCm
      || Number(flow?.heightCm || 0) !== nextHeightCm
      || Number(flow?.priceTransfer || 0) !== Number(priceAmount || 0)
      || flow?.priceCurrency !== PRICE_CURRENCY
      || flow?.options?.material !== nextOptions.material
      || flow?.options?.productType !== nextOptions.productType
      || flow?.options?.shape !== nextOptions.shape
      || Boolean(flow?.options?.isCircular) !== nextOptions.isCircular;

    if (!shouldSync) return;

    flow.set({
      designName,
      material,
      isCircular: nextIsCircular,
      shape: nextShape,
      widthCm: nextWidthCm || null,
      heightCm: nextHeightCm || null,
      priceTransfer: Number(priceAmount || 0),
      priceCurrency: PRICE_CURRENCY,
      options: nextOptions,
    });
  }, [
    activeSizeCm?.h,
    activeSizeCm?.w,
    designName,
    flow,
    flow?.designName,
    flow?.heightCm,
    flow?.isCircular,
    flow?.material,
    flow?.options?.material,
    flow?.options?.productType,
    flow?.options?.shape,
    flow?.options?.isCircular,
    flow?.priceCurrency,
    flow?.priceTransfer,
    flow?.shape,
    flow?.widthCm,
    isCircular,
    material,
    priceAmount,
  ]);

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

  async function handleContinue(options = {}) {
    if (busy) {
      return false;
    }
    const acceptedLowQuality = Boolean(options?.acceptLowQuality) || ackLow;
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
    if (mockupUrlRef.current && mockupUrlRef.current.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(mockupUrlRef.current);
      } catch {}
    }
    mockupUrlRef.current = null;
    setMockupUrl(null);
    setMockupBlob(null);
    setErr('');
    if (!layout?.image || !canvasRef.current) {
      setErr('Falta imagen o layout');
      return false;
    }
    if (trimmedDesignName.length < 2) {
      setDesignNameError('Ingresa un nombre para tu modelo antes de continuar');
      setOpenConfigSection(STEP_TWO_DRAWER_SECTIONS.project);
      setConfigOpen(true);
      designNameInputRef.current?.focus?.();
      return false;
    }
    setDesignNameError('');
    if (requiresLowAck && !acceptedLowQuality) {
      setAckLowError(true);
      setErr(ACK_LOW_ERROR_MESSAGE);
      setOpenConfigSection(STEP_TWO_DRAWER_SECTIONS.project);
      setConfigOpen(true);
      ackCheckboxRef.current?.focus?.({ preventScroll: true });
      if (typeof window !== 'undefined') {
        window.requestAnimationFrame(() => {
          ackCheckboxRef.current?.focus?.({ preventScroll: true });
        });
      }
      return false;
    }
    try {
      setModerationNotice('');
      setBusy(true);
      const flowState = (typeof flow?.get === 'function' ? flow.get() : flow) || {};
      const maxImageMb = getMaxImageMb();
      const notifyTooHeavy = (actualMB) => {
        showHeavyImageToast(actualMB, maxImageMb);
        setBusy(false);
      };
      const masterFile = uploaded?.file || flowState?.masterFile || null;
      if (masterFile?.size) {
        const masterSizeMb = bytesToMB(masterFile.size);
        if (masterSizeMb > maxImageMb) {
          notifyTooHeavy(masterSizeMb);
          return false;
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
          return false;
        }
      }
      await nextPaint(2);
      const designBlob = await canvasRef.current.exportPadAsBlob?.({
        maxDimension: 4000,
      });
      if (!designBlob || !designBlob.size) {
        setErr('No se pudo generar la imagen');
        return false;
      }

      const pdfSourceBlob = designBlob;
      const pdfSourceMime = pdfSourceBlob?.type || 'image/png';

      const mockupDataUrl = await blobToDataUrl(designBlob);

      const designShaPromise = (async () => {
        const workerHash = await sha256Offthread(pdfSourceBlob);
        if (workerHash) return workerHash;
        return sha256Hex(pdfSourceBlob);
      })();
      const masterDataUrl = await blobToDataUrl(pdfSourceBlob);
      await nextPaint(1);

      // client-side gate: filename keywords
      const metaForCheck = [uploaded?.file?.name, trimmedDesignName].filter(Boolean).join(' ');
      if (quickHateSymbolCheck(metaForCheck)) {
        setErr('Contenido no permitido (odio nazi detectado)');
        return false;
      }

      // client-side gate: NSFW scan in browser (no server TFJS)
      try {
        const res = await withTimeout(
          scanNudityClient(masterDataUrl),
          12000,
          () => warn('[continue] nudity scan timeout; allowing flow'),
        );
        if (!res?.timeout && res?.blocked) {
          let message = 'Contenido adulto detectado.';
          if (res.reason === 'client_real_nudity') {
            message = 'Contenido adulto expl\u00EDcito con personas reales detectado.';
          } else if (res.reason === 'client_real_sexual') {
            message = 'Contenido sexual expl\u00EDcito con personas reales detectado.';
          }
          setErr(message);
          return false;
        }
      } catch (scanErr) {
        warn('[continue] nudity scan failed; allowing flow', scanErr?.message || scanErr);
      }

      const masterImagePromise = (async () => {
        const img = new Image();
        img.src = masterDataUrl;
        await img.decode();
        return img;
      })();

      const mockupImagePromise = (async () => {
        const img = new Image();
        img.src = mockupDataUrl;
        await img.decode();
        return img;
      })();

      const baseModerationPayload = {
        filename: uploaded?.file?.name || 'image.png',
        designName: trimmedDesignName,
        lowQualityAck: level === 'bad' ? acceptedLowQuality : false,
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
        const baseModerationError = 'No se pudo validar la imagen. Intent\u00E1 nuevamente.';
        const detailCandidates = [
          moderationErr?.json?.error,
          moderationErr?.json?.message,
          moderationErr?.json?.reason,
          moderationErr?.message,
          moderationErr?.bodyText,
          moderationErr?.status,
          moderationErr?.reason,
          moderationErr,
        ];
        let detail = '';
        for (const candidate of detailCandidates) {
          const candidateStr = asStr(candidate).trim();
          if (candidateStr) {
            detail = candidateStr;
            break;
          }
        }

        if (isMobileDevice && detail) {
          const detailSuffix = ` [mobile-debug:${detail}]`;
          setErr(`${baseModerationError}${detailSuffix}`);
        } else {
          setErr(baseModerationError);
        }
        return false;
      }
      if (!moderationResponse?.ok) {
        const message = moderationReasonMessage(moderationResponse?.reason);
        setErr(message);
        return false;
      }

      await nextPaint(1);
      await masterImagePromise;
      const pxPerCm = layout?.dpi ? layout.dpi / 2.54 : (effDpi || 300) / 2.54;
      const masterWidthExact = Math.max(1, Math.round(activeWcm * pxPerCm));
      const masterHeightExact = Math.max(1, Math.round(activeHcm * pxPerCm));
      const masterWidthMm = activeWcm * 10;
      const masterHeightMm = activeHcm * 10;
      const dpiForMockup = layout?.dpi || effDpi || 300;
      const designMime = pdfSourceMime || 'image/png';
      const shouldUploadMaster = KEEP_MASTER && !SKIP_MASTER_UPLOAD;
      const formatDimensionCm = (cm) => {
        const num = Number(cm);
        if (!Number.isFinite(num) || num <= 0) return '0';
        const rounded = Math.round(num * 10) / 10;
        const formatted = Number.isInteger(rounded) ? String(Math.trunc(rounded)) : String(rounded);
        return safeReplace(formatted, /\.0+$/, '');
      };
      let materialLabel = String(material || '').trim();
      if (/pro/i.test(materialLabel)) materialLabel = 'PRO';
      else if (/ultra/i.test(materialLabel)) materialLabel = 'Ultra';
      else if (/glass/i.test(materialLabel)) materialLabel = 'Glasspad';
      else if (/alfombr/i.test(materialLabel)) materialLabel = 'Alfombra';
      else if (!materialLabel || /classic/i.test(materialLabel)) materialLabel = 'Classic';
      materialLabel = formatMaterialLabelWithShape(materialLabel, isCircular);
      const namePart = sanitizeFileName(trimmedDesignName, 'design');
      const widthLabel = formatDimensionCm(activeWcm ?? (masterWidthMm ? masterWidthMm / 10 : undefined));
      const heightLabel = formatDimensionCm(activeHcm ?? (masterHeightMm ? masterHeightMm / 10 : undefined));
      const materialPart = sanitizeFileName(materialLabel, 'classic');
      const pdfFileName = sanitizeFileName(`${namePart}-${widthLabel}x${heightLabel}-${materialPart}`, 'design-pdf');
      const yyyymmValue = (() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      })();
      const pdfPath = `pdf-${yyyymmValue}/${pdfFileName}.pdf`;

      const mockupStart = tnow();
      const mockupPromise = (async () => {
        let newMockupBlob = null;
        try {
          newMockupBlob = await generateMockupOffthread(pdfSourceBlob, {
            composition: {
              widthPx: flowState?.masterWidthPx || masterWidthExact,
              heightPx: flowState?.masterHeightPx || masterHeightExact,
              widthCm: flowState?.widthCm || activeWcm,
              heightCm: flowState?.heightCm || activeHcm,
              widthMm: masterWidthMm,
              heightMm: masterHeightMm,
              dpi: dpiForMockup,
            },
            material: flowState?.material || material,
            options: { material: flowState?.material || material },
            materialLabel: flowState?.material || material,
            radiusPx: Number(import.meta.env?.VITE_MOCKUP_PAD_RADIUS_PX) || 8,
          });
        } catch (_) {
          newMockupBlob = null;
        }
        if (!newMockupBlob) {
          try {
            const mockupImage = await mockupImagePromise;
            newMockupBlob = await renderMockup1080(mockupImage, {
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
          } catch (mockupErr) {
            warn('[mockup] renderMockup1080 failed', mockupErr);
          }
        }
        if (!newMockupBlob) {
          newMockupBlob = new Blob([], { type: 'image/png' });
        }
        diagTime('mockup_ready', mockupStart);
        const mockupUrl = URL.createObjectURL(newMockupBlob);
        const designShaForMockup = await designShaPromise;
        const mockupPath = `mockups-${yyyymmValue}/mockup-${designShaForMockup || 'unknown'}.png`;
        let mockupPublicUrl = null;
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
                body: newMockupBlob,
              });
              if (uploadRes.ok) {
                mockupPublicUrl = sign.publicUrl || mockupPublicUrl;
              }
            }
          } catch (mockupUploadErr) {
            warn('[diag] mockup upload failed', mockupUploadErr);
          }
        }
        return { mockupBlob: newMockupBlob, mockupUrl, mockupPublicUrl };
      })();

      const pdfStart = tnow();
      const pdfPromise = (async () => {
        const maxPdfBytes = Number(import.meta.env?.VITE_MAX_PDF_BYTES) || 40 * 1024 * 1024;
        let bytes = await buildPdfOffthread(pdfSourceBlob, {
          bleedMm: 20,
          widthPx: masterWidthExact,
          heightPx: masterHeightExact,
          widthMm: masterWidthMm,
          heightMm: masterHeightMm,
          maxBytes: maxPdfBytes,
          mime: designMime,
        });
        if (!bytes) {
          const localBytes = await buildPdfFromMaster(pdfSourceBlob, {
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
      const pdfSignPromise = (async () => {
        try {
          return await postJSON(
            getResolvedApiUrl('/api/storage/sign'),
            { bucket: 'outputs', contentType: 'application/pdf', path: pdfPath },
            60000,
          );
        } catch (sign) {
          const errText = sign?.bodyText || sign?.message || '';
          console.error('[Sign Error]', sign?.status, errText);
          throw sign;
        }
      })();
      const masterSignPromise = shouldUploadMaster
        ? (async () => {
            try {
              return await postJSON(getResolvedApiUrl('/api/storage/sign'), { bucket: 'outputs', contentType: designMime }, 60000);
            } catch (sign) {
              const errText = sign?.bodyText || sign?.message || '';
              console.error('[Sign Error]', sign?.status, errText);
              throw sign;
            }
          })()
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
        return false;
      }
      if (!pdfSign?.uploadUrl || !pdfSign?.publicUrl) {
        setErr('No se pudo firmar la subida del PDF.');
        return false;
      }
      if (shouldUploadMaster && masterSign && (!masterSign?.uploadUrl || !masterSign?.publicUrl)) {
        setErr('No se pudo firmar la subida de la imagen.');
        return false;
      }

      const { mockupBlob: generatedMockupBlob, mockupUrl: generatedMockupUrl, mockupPublicUrl } = mockupResult || {};
      if (!generatedMockupBlob || !generatedMockupUrl) {
        setErr('No se pudo generar el mockup.');
        return false;
      }

      if (mockupUrlRef.current && mockupUrlRef.current.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(mockupUrlRef.current);
        } catch {}
      }
      mockupUrlRef.current = generatedMockupUrl;
      // No agregar ?v= a URLs blob: — en Firefox (y otros) deja de coincidir con el ObjectURL
      // registrado y el <img> falla con error de seguridad / sin imagen.
      const cacheBustedMockupUrl =
        typeof generatedMockupUrl === 'string'
        && generatedMockupUrl.startsWith('blob:')
          ? generatedMockupUrl
          : designSha
            ? `${generatedMockupUrl}${String(generatedMockupUrl).includes('?') ? '&' : '?'}v=${designSha}`
            : generatedMockupUrl;
      setMockupBlob(generatedMockupBlob);
      setMockupUrl(cacheBustedMockupUrl);

      await nextPaint(1);
      diag('[diag] master dims', { width: masterWidthExact, height: masterHeightExact });

      const pdfBody = pdfBytes instanceof Blob ? pdfBytes : new Blob([pdfBytes], { type: 'application/pdf' });
      const uploadsStart = tnow();
      const pdfUploadTask = fetch(pdfSign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: pdfBody,
      });
      const masterUploadTask = shouldUploadMaster && masterSign?.uploadUrl
        ? fetch(masterSign.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': designMime },
            body: pdfSourceBlob,
          })
        : Promise.resolve({ ok: true });

      const [pdfUploadResult, masterUploadResult] = await Promise.allSettled([pdfUploadTask, masterUploadTask]);

      if (pdfUploadResult.status === 'rejected') {
        error('[pdf-upload] failed', pdfUploadResult.reason);
        if (pdfUploadResult?.reason?.status === 413) {
          try {
            showHeavyImageToast(bytesToMB(pdfBody?.size || 0), MAX_IMAGE_MB);
          } catch {}
        }
        setErr('No se pudo subir el PDF.');
        return false;
      }
      if (masterUploadResult.status === 'rejected') {
        error('[master-upload] failed', masterUploadResult.reason);
        if (masterUploadResult?.reason?.status === 413) {
          try {
            showHeavyImageToast(bytesToMB(pdfSourceBlob?.size || 0), MAX_IMAGE_MB);
          } catch {}
        }
        setErr('No se pudo subir la imagen.');
        return false;
      }

      const pdfUploadRes = pdfUploadResult.value;
      const masterUploadRes = masterUploadResult.value;
      diagTime('uploads_done', uploadsStart);

      if (!pdfUploadRes?.ok) {
        error('[pdf-upload] failed', pdfUploadRes?.statusText || pdfUploadRes?.status || 'upload_failed');
        if (pdfUploadRes?.status === 413) {
          try {
            showHeavyImageToast(bytesToMB(pdfBody?.size || 0), MAX_IMAGE_MB);
          } catch {}
        }
        setErr('No se pudo subir el PDF.');
        return false;
      }
      if (shouldUploadMaster && !masterUploadRes?.ok) {
        error('[master-upload] failed', masterUploadRes?.statusText || masterUploadRes?.status || 'upload_failed');
        if (masterUploadRes?.status === 413) {
          try {
            showHeavyImageToast(bytesToMB(pdfSourceBlob?.size || 0), MAX_IMAGE_MB);
          } catch {}
        }
        setErr('No se pudo subir la imagen.');
        return false;
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
        upload_size_bytes: pdfSourceBlob?.size ?? designBlob?.size ?? 0,
        upload_content_type: designMime,
      }));

      const transferPrice = Number(latestTransferPriceRef.current) > 0
        ? Number(latestTransferPriceRef.current)
        : Number(priceAmount) > 0
          ? Number(priceAmount)
          : 0;
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
      const finalMaterial = selectedMaterial || 'Classic';
      let finalWidthCm = widthToStore;
      let finalHeightCm = heightToStore;
      if (isFixedPad49x42Material(finalMaterial)) {
        finalWidthCm = 49;
        finalHeightCm = 42;
      }

      const nextProductType = finalMaterial === 'Glasspad'
        ? 'glasspad'
        : finalMaterial === 'Alfombra'
          ? 'alfombra'
          : 'mousepad';
      flow.set({
        // Guardar SIEMPRE la medida elegida por el cliente (cm), para evitar caer a px/DPI
        widthCm: finalWidthCm,
        heightCm: finalHeightCm,
        productType: nextProductType,
        editorState: layout,
        mockupBlob: generatedMockupBlob,
        mockupUrl: cacheBustedMockupUrl,
        mockupPublicUrl: mockupPublicUrl || null,
        mockupHash: null,
        mockupUploadOk: false,
        mockupUploadError: null,
        printFullResDataUrl: masterDataUrl,
        masterPublicUrl: nextMasterUrl,
        pdfPublicUrl: nextPdfUrl,
        masterWidthPx: masterWidthExact,
        masterHeightPx: masterHeightExact,
        designHash,
        fileOriginalUrl: uploadCanonical || null,
        uploadObjectKey,
        uploadBucket: uploadBucket,
        uploadDiagId: null,
        uploadSizeBytes: pdfSourceBlob?.size ?? designBlob?.size ?? 0,
        uploadContentType: designMime,
        uploadSha256: designSha,
        designName: nameClean,
        material: finalMaterial,
        isCircular: isCircular && !isFixedPad49x42Material(finalMaterial),
        shape: isCircular && !isFixedPad49x42Material(finalMaterial) ? 'circle' : 'rounded_rect',
        options: {
          ...(flowState?.options || {}),
          material: finalMaterial,
          productType: nextProductType,
          shape: isCircular && !isFixedPad49x42Material(finalMaterial) ? 'circle' : 'rounded_rect',
          isCircular: isCircular && !isFixedPad49x42Material(finalMaterial),
        },
        lowQualityAck: level === 'bad' ? acceptedLowQuality : false,
        approxDpi: effDpi || null,
        priceTransfer: transferPrice,
        priceNormal: normalPrice,
        priceAmount: transferPrice,
        priceCurrency: PRICE_CURRENCY,
      });
      try {
        diag('[audit:flow:persist]', {
          designName: nameClean,
          material: finalMaterial,
          widthCm: finalWidthCm,
          heightCm: finalHeightCm,
          shape: isCircular && !isFixedPad49x42Material(finalMaterial) ? 'circle' : 'rounded_rect',
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
      return true;
    } catch (e) {
      error(e);
      setErr(String(e?.message || e));
      return false;
    } finally {
      setBusy(false);
    }
  }


  const title = 'Mousepad Personalizado a Medida | Calidad Gamer y Profesional | NOTMID';
  const description = 'Dise\u00F1\u00E1 tu mousepad personalizado a medida con calidad profesional. Ideal para gaming, trabajo o setup creativo. Env\u00EDos a todo el pa\u00EDs \u2013 NOTMID.';
  const url = 'https://personalizados.notmid.ar/';
  const isPublishing = busy;
  const editorImageUrl = useMemo(
    () => flow?.imageLocalUrl || imageUrl || uploaded?.localUrl || null,
    [flow?.imageLocalUrl, imageUrl, uploaded?.localUrl],
  );
  const editorExternalImageUrl = useMemo(
    () => flow?.fileOriginalUrl || uploaded?.canonical_url || uploaded?.file_original_url || null,
    [flow?.fileOriginalUrl, uploaded?.canonical_url, uploaded?.file_original_url],
  );
  const isCanvasReady = Boolean(
    editorImageUrl
    || editorExternalImageUrl
    || uploaded?.file
    || flow?.masterFile,
  );
  useEffect(() => {
    if (!isStepEdit) return;
    setShowStepTwoRepositionHint(true);
  }, [editorImageUrl, isStepEdit]);
  const handleStepTwoImageDragStart = useCallback(() => {
    setShowStepTwoRepositionHint(false);
  }, []);
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
    if (viewportWidth <= 640) {
      const triggerRect = triggerEl.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset || 0;
      const scrollY = window.scrollY || window.pageYOffset || 0;

      setConfigPanelStyle((prev) => {
        const next = {
          position: 'absolute',
          top: `${(triggerEl?.offsetHeight || 0) + GAP}px`,
          left: '-14px',
          right: 0,
          maxHeight: '487px',
          maxWidth: '90vw',
          width: '90vw',
          minWidth: '90vw',
          paddingBottom: '40px',
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
      return;
    }
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
    styles.stepTwoProjectInput,
    resolvedDesignNameError ? styles.inputTextError : '',
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

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    if (!toolsDrawerOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!toolsDrawerRef.current) return;
      if (toolsDrawerRef.current.contains(event.target)) return;
      setToolsDrawerOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [toolsDrawerOpen]);

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
  const stepOneBaseSizeOptions = useMemo(
    () => getDropdownStandardSizeOptionsForMaterial(material),
    [material],
  );
  const stepOneSizeOptions = useMemo(() => (
    stepOneBaseSizeOptions.map((option) => ({
      id: option.id || `${Number(option.w)}x${Number(option.h)}`,
      value: option.value || `${Number(option.w)}x${Number(option.h)}`,
      w: Number(option.w),
      h: Number(option.h),
      label: option.label,
      measurementLabel: option.measurementLabel || formatStepOneSizeDropdownLabel(option),
      menuLabel: option.menuLabel || `${formatStepOneSizeDropdownLabel(option)} ${option.label || ''}`.trim(),
    }))
  ), [stepOneBaseSizeOptions]);
  const stepOneCustomSizeOption = useMemo(() => ({
    ...STEP_TWO_CUSTOM_SIZE_OPTION,
    isCustom: true,
    menuLabel: STEP_ONE_CUSTOM_SIZE_TRIGGER_LABEL,
    triggerLabel: STEP_ONE_CUSTOM_SIZE_TRIGGER_LABEL,
  }), []);
  const stepOneSelectedSizeId = useMemo(
    () => resolveSelectedSizeOptionId({
      targetMaterial: material,
      targetMode: mode,
      candidateSize: activeSizeCm,
      standardOptions: stepOneSizeOptions,
    }),
    [activeSizeCm, material, mode, stepOneSizeOptions],
  );
  const isStepOneCustomSizeSelected = stepOneSelectedSizeId === STEP_TWO_CUSTOM_SIZE_OPTION.id;
  const stepOneSelectedSizeMeta = useMemo(() => {
    if (isStepOneCustomSizeSelected) {
      return stepOneCustomSizeOption;
    }
    return (
      stepOneSizeOptions.find((option) => option.id === stepOneSelectedSizeId)
      || stepOneSizeOptions[0]
      || (isFixedPad49x42Material(material) ? buildGlasspadFixedSizeOption() : stepOneCustomSizeOption)
    );
  }, [
    isStepOneCustomSizeSelected,
    material,
    stepOneCustomSizeOption,
    stepOneSelectedSizeId,
    stepOneSizeOptions,
  ]);
  const stepOneDropdownOptions = useMemo(
    () => (isFixedPad49x42Material(material) ? stepOneSizeOptions : [...stepOneSizeOptions, stepOneCustomSizeOption]),
    [material, stepOneCustomSizeOption, stepOneSizeOptions],
  );
  const stepOneMaterialOptions = useMemo(
    () => STEP_TWO_MATERIAL_OPTIONS.map((option) => ({ ...option })),
    [],
  );
  const selectedStepOneMaterialOption = useMemo(
    () => stepOneMaterialOptions.find((option) => option.value === material) || stepOneMaterialOptions[0] || null,
    [material, stepOneMaterialOptions],
  );
  const stepOneSelectedSizeTriggerLabel = useMemo(() => {
    if (isStepOneCustomSizeSelected) {
      return (
        stepOneCustomSizeOption.triggerLabel
        || stepOneCustomSizeOption.menuLabel
        || stepOneCustomSizeOption.label
      );
    }
    if (!stepOneSelectedSizeMeta) return formatStepOneSizeDropdownLabel(activeSizeCm);
    return stepOneSelectedSizeMeta.menuLabel || formatStepOneSizeDropdownLabel(stepOneSelectedSizeMeta);
  }, [activeSizeCm, isStepOneCustomSizeSelected, stepOneCustomSizeOption, stepOneSelectedSizeMeta]);
  const stepOneTransferPricing = useMemo(
    () => calculateTransferPricing({
      width: activeSizeCm.w,
      height: activeSizeCm.h,
      material,
    }),
    [activeSizeCm.h, activeSizeCm.w, material],
  );
  const stepOneFormattedPriceAmount = useMemo(
    () => formatARS(stepOneTransferPricing.valid ? stepOneTransferPricing.transfer : 0),
    [stepOneTransferPricing.transfer, stepOneTransferPricing.valid],
  );
  const formatStepOneDimension = useCallback((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return '--';
    }
    const hasDecimals = Math.abs(numeric - Math.trunc(numeric)) > 0.0001;
    return numeric.toLocaleString('es-AR', {
      minimumFractionDigits: hasDecimals ? 1 : 0,
      maximumFractionDigits: hasDecimals ? 1 : 1,
    });
  }, []);
  const stepOneCanvasWidthLabel = useMemo(
    () => `${formatStepOneDimension(activeSizeCm?.w)} cm`,
    [activeSizeCm?.w, formatStepOneDimension],
  );
  const stepOneCanvasHeightLabel = useMemo(
    () => `${formatStepOneDimension(activeSizeCm?.h)} cm`,
    [activeSizeCm?.h, formatStepOneDimension],
  );
  const stepOneCanvasBackgroundColor = useMemo(
    () => (isDarkMode ? 'var(--nm-canvas-bg-dark)' : 'var(--nm-canvas-bg-light)'),
    [isDarkMode],
  );
  const isStepOneCanvasLightTheme = !isDarkMode;
  const stepOneUploadIconSrc = isDarkMode ? uploadAreaIconSrc : uploadAreaLightIconSrc;
  const stepOneCanvasStyle = useMemo(() => {
    const widthValue = Number(activeSizeCm?.w);
    const heightValue = Number(activeSizeCm?.h);
    const safeWidth = Number.isFinite(widthValue) && widthValue > 0 ? widthValue : 1;
    const safeHeight = Number.isFinite(heightValue) && heightValue > 0 ? heightValue : 1;
    const referenceScale = STEP_ONE_PREVIEW_MAX_WIDTH_PX / STEP_ONE_PREVIEW_REFERENCE_CM.w;
    const scale = getStepOnePreviewScale(safeWidth, safeHeight);
    let scaledWidthPx = safeWidth * scale;
    let scaledHeightPx = safeHeight * scale;
    const mobileSquareishCap =
      isStepOneMobileViewport && shouldCapStepOneMobilePreviewShell(safeWidth, safeHeight);
    if (mobileSquareishCap) {
      scaledWidthPx *= STEP_ONE_MOBILE_SQUAREISH_EXTRA_SCALE;
      scaledHeightPx *= STEP_ONE_MOBILE_SQUAREISH_EXTRA_SCALE;
      const capped = capPreviewShellPx(
        scaledWidthPx,
        scaledHeightPx,
        STEP_ONE_MOBILE_SHELL_MAX_W_PX,
        STEP_ONE_MOBILE_SHELL_MAX_H_PX,
      );
      scaledWidthPx = capped.width;
      scaledHeightPx = capped.height;
    }
    const selectedWidthProgress = Math.min(safeWidth / STEP_ONE_PREVIEW_REFERENCE_CM.w, 1);
    const selectedHeightProgress = Math.min(safeHeight / STEP_ONE_PREVIEW_REFERENCE_CM.h, 1);
    const heroOffsetPx = Math.round((1 - selectedHeightProgress) * 56);
    const blockShiftYPx = Math.round(selectedHeightProgress * -16);
    const measureOffsetMinPx = 12;
    const measureOffsetMaxPx = 20;
    const measureTrackReservePx = 20;
    const measureRowOffsetPx = Math.round(
      measureOffsetMinPx + ((measureOffsetMaxPx - measureOffsetMinPx) * selectedHeightProgress),
    );
    const measureColumnOffsetPx = Math.round(
      measureOffsetMinPx + ((measureOffsetMaxPx - measureOffsetMinPx) * selectedWidthProgress),
    );
    const measureRowSpacePx = measureRowOffsetPx + measureTrackReservePx;
    const measureColumnSpacePx = measureColumnOffsetPx + measureTrackReservePx;
    const figureWidthPx = scaledWidthPx;
    const figureHeightPx = scaledHeightPx + measureRowSpacePx;
    const previewWrapperMaxHeightPx = Math.round(STEP_ONE_PREVIEW_REFERENCE_CM.h * referenceScale) + (measureOffsetMaxPx + measureTrackReservePx);
    const previewWrapperMaxWidthPx = STEP_ONE_PREVIEW_MAX_WIDTH_PX;
    const layoutMinHeightPx = previewWrapperMaxHeightPx + 220;
    const layoutGapPx = Math.max(10, Math.round(16 - (selectedHeightProgress * 6)));
    const headingGapPx = Math.max(4, Math.round(10 - (selectedHeightProgress * 6)));
    const heroGapPx = Math.max(0, Math.round(4 - (selectedHeightProgress * 3)));
    const sizeSectionGapPx = 8;
    const previewStackGapPx = 20;
    const layoutMaxWidthPx = Math.max(previewWrapperMaxWidthPx + 140, 760);
    const previewBodyGapPx = 12;
    const captionEstimatedHeightPx = 12;
    const desiredPreviewSpacingPx = isStepOneMobileViewport
      ? 0
      : getStepOneDesktopPreviewSpacingPx(safeWidth, safeHeight);
    const previewTopSpacingPx = isStepOneMobileViewport
      ? (mobileSquareishCap ? 8 : 0)
      : Math.max(0, desiredPreviewSpacingPx - layoutGapPx - previewBodyGapPx - captionEstimatedHeightPx);
    const previewBottomSpacingPx = isStepOneMobileViewport
      ? 0
      : Math.max(0, desiredPreviewSpacingPx - previewStackGapPx);

    return {
      '--step-one-preview-max-width-px': `${previewWrapperMaxWidthPx}px`,
      '--step-one-preview-figure-width-px': `${figureWidthPx}px`,
      '--step-one-preview-figure-height-px': `${figureHeightPx}px`,
      '--step-one-canvas-background-color': stepOneCanvasBackgroundColor,
      '--step-one-shell-width-px': `${scaledWidthPx}px`,
      '--step-one-shell-height-px': `${scaledHeightPx}px`,
      '--step-one-preview-wrapper-max-height': `${previewWrapperMaxHeightPx}px`,
      '--step-one-measure-row-offset-px': `${measureRowOffsetPx}px`,
      '--step-one-measure-column-offset-px': `${measureColumnOffsetPx}px`,
      '--step-one-measure-row-space-px': `${measureRowSpacePx}px`,
      '--step-one-measure-column-space-px': `${measureColumnSpacePx}px`,
      '--step-one-layout-min-height': `${layoutMinHeightPx}px`,
      '--step-one-layout-gap': `${layoutGapPx}px`,
      '--step-one-heading-gap': `${headingGapPx}px`,
      '--step-one-hero-gap': `${heroGapPx}px`,
      '--step-one-hero-offset-top': `${heroOffsetPx}px`,
      '--step-one-block-shift-y': `${blockShiftYPx}px`,
      '--step-one-size-gap': `${sizeSectionGapPx}px`,
      '--step-one-preview-stack-gap': `${previewStackGapPx}px`,
      '--step-one-preview-frame-margin-top': `${previewTopSpacingPx}px`,
      '--step-one-preview-frame-margin-bottom': `${previewBottomSpacingPx}px`,
      '--step-one-layout-max-width': `${layoutMaxWidthPx}px`,
      '--step-one-preview-reference-ratio': `${STEP_ONE_PREVIEW_REFERENCE_CM.w} / ${STEP_ONE_PREVIEW_REFERENCE_CM.h}`,
      '--step-one-selected-ratio': `${safeWidth} / ${safeHeight}`,
    };
  }, [activeSizeCm?.h, activeSizeCm?.w, isStepOneMobileViewport, stepOneCanvasBackgroundColor]);
  const stepTwoCanvasStyle = useMemo(() => {
    const widthValue = Number(activeSizeCm?.w);
    const heightValue = Number(activeSizeCm?.h);
    const safeWidth = Number.isFinite(widthValue) && widthValue > 0 ? widthValue : 1;
    const safeHeight = Number.isFinite(heightValue) && heightValue > 0 ? heightValue : 1;
    const viewportWidth = stepTwoViewportMetrics.viewportWidth
      || (typeof window !== 'undefined' ? window.innerWidth || 0 : 0);
    const viewportHeight = stepTwoViewportMetrics.viewportHeight
      || (typeof window !== 'undefined' ? window.innerHeight || 0 : 0);
    const isCompactViewport = viewportWidth <= 960;
    const isMobileViewport = viewportWidth < 768;
    const desktopToolbarExtraPx =
      !isMobileViewport && !isCompactViewport ? STEP_TWO_DESKTOP_TOOLBAR_EXTRA_WIDTH_PX : 0;
    const toolbarWidthPx =
      (isMobileViewport ? 82 : isCompactViewport ? 90 : 80) + desktopToolbarExtraPx;
    const shellGapPx = isMobileViewport ? 12 : isCompactViewport ? 14 : 18;
    const toolbarExtraGapPx = isMobileViewport ? 0 : STEP_TWO_TOOLBAR_EXTRA_GAP_PX;
    const shellOuterGutterPx = isMobileViewport ? 0 : isCompactViewport ? 24 : 40;
    const measureOffsetPx = isMobileViewport ? 8 : 10;
    const measureTrackPx = isMobileViewport ? 12 : 16;
    const measureSpacePx = measureOffsetPx + measureTrackPx;
    const minStageWidthPx = isMobileViewport ? 150 : isCompactViewport ? 200 : 220;
    const frameWidthFallback = Math.max(
      240,
      viewportWidth - (isMobileViewport ? 24 : 64),
    );
    const frameWidthPx = Math.max(
      240,
      stepTwoViewportMetrics.frameWidth || frameWidthFallback,
    );
    const availableShellWidthPx = Math.max(240, frameWidthPx - shellOuterGutterPx);
    const horizontalChromePx = isMobileViewport
      ? (measureSpacePx + shellGapPx)
      : (
        toolbarWidthPx
        + measureSpacePx
        + (shellGapPx * 2)
        + toolbarExtraGapPx
      );
    const absoluteStageWidthCapPx = isMobileViewport
      ? Math.max(420, viewportWidth - 40)
      : isCompactViewport ? 640 : 1120;
    const maxStageWidthPx = Math.max(
      minStageWidthPx,
      Math.min(absoluteStageWidthCapPx, availableShellWidthPx - horizontalChromePx),
    );
    const frameTopPx = stepTwoViewportMetrics.frameTop || (isMobileViewport ? 132 : 176);
    const footerHeightPx = stepTwoViewportMetrics.footerHeight || (isMobileViewport ? 156 : 108);
    const verticalChromePx = isMobileViewport ? 102 : isCompactViewport ? 112 : 124;
    const viewportBottomReservePx = isMobileViewport ? 26 : 36;
    const is100cmHeightLayout = safeHeight >= STEP_TWO_100CM_HEIGHT_LAYOUT_CM;
    const hundredCmDesktopStageTightenPx = (
      !isMobileViewport && is100cmHeightLayout ? STEP_TWO_100CM_DESKTOP_STAGE_TIGHTEN_PX : 0
    );
    const absoluteStageHeightCapPx = Math.round((viewportHeight || 0) * (isMobileViewport ? 0.42 : 0.58));
    const maxStageHeightPx = Math.max(
      isMobileViewport ? 132 : 180,
      Math.min(
        absoluteStageHeightCapPx || Number.POSITIVE_INFINITY,
        (viewportHeight || 0)
          - frameTopPx
          - footerHeightPx
          - viewportBottomReservePx
          - verticalChromePx
          - hundredCmDesktopStageTightenPx,
      ),
    );
    let fittedStage = fitStageWithinBounds(
      safeWidth,
      safeHeight,
      maxStageWidthPx,
      maxStageHeightPx,
    );
    if (Math.max(safeWidth, safeHeight) <= STEP_TWO_SMALL_STAGE_MAX_SIDE_CM) {
      fittedStage = {
        width: Math.max(1, Math.round(fittedStage.width * STEP_TWO_SMALL_STAGE_VISUAL_SCALE)),
        height: Math.max(1, Math.round(fittedStage.height * STEP_TWO_SMALL_STAGE_VISUAL_SCALE)),
      };
    }
    if (isMobileViewport) {
      const mobileScale = Math.min(
        STEP_TWO_MOBILE_STAGE_VISUAL_SCALE,
        maxStageWidthPx / Math.max(1, fittedStage.width),
        maxStageHeightPx / Math.max(1, fittedStage.height),
      );
      if (mobileScale > 1) {
        fittedStage = {
          width: Math.max(1, Math.round(fittedStage.width * mobileScale)),
          height: Math.max(1, Math.round(fittedStage.height * mobileScale)),
        };
      }
    }
    const shellWidthPx = Math.max(
      320,
      Math.min(
        frameWidthPx,
        isMobileViewport
          ? fittedStage.width + measureSpacePx + shellGapPx
          : (
            fittedStage.width
            + measureSpacePx
            + toolbarWidthPx
            + (shellGapPx * 2)
            + toolbarExtraGapPx
          ),
      ),
    );
    const footerActionMinWidthPx = isMobileViewport ? 0 : isCompactViewport ? 220 : 248;
    const is100cmHeightDesktop = (
      !isMobileViewport && safeHeight >= STEP_TWO_100CM_HEIGHT_LAYOUT_CM
    );
    const rawFooterBottomSpacePx = getStepTwoFooterBottomSpacingPx(safeWidth, safeHeight);
    const footerBottomSpacePx = is100cmHeightDesktop
      ? null
      : rawFooterBottomSpacePx;
    /* 100cm desktop: quitamos el margen superior extra del bundle (antes 80px) para subir el preview ~80px */
    const previewFrameLiftPx = 0;
    const previewFrameMarginTopPx = (
      is100cmHeightDesktop ? STEP_TWO_PREVIEW_FRAME_LIFT_100CM_HEIGHT_DESKTOP_PX : 0
    );

    return {
      '--step-one-preview-reference-ratio': `${STEP_ONE_PREVIEW_REFERENCE_CM.w} / ${STEP_ONE_PREVIEW_REFERENCE_CM.h}`,
      '--step-one-selected-ratio': `${safeWidth} / ${safeHeight}`,
      '--step-two-stage-width': `${fittedStage.width}px`,
      '--step-two-stage-height': `${fittedStage.height}px`,
      '--step-two-toolbar-width': `${toolbarWidthPx}px`,
      '--step-two-toolbar-offset': `${toolbarExtraGapPx}px`,
      '--step-two-shell-gap': `${shellGapPx}px`,
      '--step-two-measure-offset': `${measureOffsetPx}px`,
      '--step-two-measure-track-size': `${measureTrackPx}px`,
      '--step-two-measure-space': `${measureSpacePx}px`,
      '--step-two-measure-line-thickness': `${isMobileViewport ? 0.75 : 1}px`,
      '--step-two-title-gap': is100cmHeightDesktop ? '4px' : '15px',
      '--step-two-shell-width': `${shellWidthPx}px`,
      '--step-two-footer-action-min-width': `${footerActionMinWidthPx}px`,
      '--step-two-footer-bottom-space': (
        footerBottomSpacePx == null
          ? 'calc(50px + env(safe-area-inset-bottom, 0px))'
          : `${footerBottomSpacePx}px`
      ),
      '--step-two-preview-bundle-margin-top': `${previewFrameLiftPx}px`,
      '--step-two-preview-frame-margin-top': `${previewFrameMarginTopPx}px`,
      ...(is100cmHeightDesktop
        ? {
          '--step-two-back-rail-margin-block-start': '20px',
          '--step-two-back-rail-margin-block-end': '0px',
          '--step-two-caption-bottom-bonus': '4px',
          '--step-two-footer-stack-margin-start': 'auto',
          '--step-two-preview-frame-padding-block-start': '8px',
          '--step-two-layout-padding-top': '0',
          '--step-two-layout-gap': '14px',
          '--step-two-layout-min-block': 'calc(100dvh - 260px)',
          '--step-two-workspace-justify': 'flex-start',
          '--step-two-workspace-flex': '0 1 auto',
          '--step-two-workspace-min-block': '0',
          '--step-two-workspace-gap': '6px',
          '--step-two-preview-frame-flex': '0 1 auto',
          '--step-two-preview-frame-min-block': '0',
          '--step-two-preview-bundle-min-block': '0',
          '--step-two-stage-reserve-tail': '28px',
          /* Solo la barra de precio/CTA: translateY hacia arriba para evitar corte en el borde */
          '--step-two-footer-stack-lift-px': '60px',
        }
        : {}),
    };
  }, [
    activeSizeCm?.h,
    activeSizeCm?.w,
    stepTwoViewportMetrics.footerHeight,
    stepTwoViewportMetrics.frameTop,
    stepTwoViewportMetrics.frameWidth,
    stepTwoViewportMetrics.viewportHeight,
    stepTwoViewportMetrics.viewportWidth,
  ]);
  const stepTwoPreviewShellStyle = useMemo(
    () => ({
      display: 'flex',
      flex: '1 1 auto',
      height: '100%',
      minHeight: '100%',
      width: '100%',
    }),
    [],
  );

  const handleStepOneSizeOptionSelect = useCallback((option) => {
    if (!option) return;
    if (option.isCustom) {
      setStepOneCustomSizePanelOpen(true);
      handleSizeChange({ mode: 'custom' });
      setStepOneSizeMenuOpen(false);
      return;
    }

    setStepOneCustomSizePanelOpen(false);
    handleSizeChange({ mode: 'standard', w: option.w, h: option.h });
    setStepOneSizeMenuOpen(false);
  }, [handleSizeChange]);

  const handleStepOneMaterialSelect = useCallback((nextMaterial) => {
    if (!nextMaterial) return;
    if (STEP_TWO_MATERIAL_OPTIONS.some((o) => o.value === nextMaterial && isMaterialDropdownLocked(o))) {
      return;
    }
    handleSizeChange({ material: nextMaterial });
    setStepOneMaterialMenuOpen(false);
  }, [handleSizeChange]);

  const handleStepOnePickedFile = useCallback((file, options = {}) => {
    if (!file) return;
    const normalizedName = String(file.name || '').toLowerCase();
    const isAcceptedType =
      STEP_ONE_ACCEPTED_MIME_TYPES.includes(file.type)
      || /\.(png|jpe?g)$/.test(normalizedName);
    if (!isAcceptedType) {
      if (options?.isReplacing) {
        setIsReplacing(false);
      }
      setErr('Solo se permiten imágenes PNG o JPG.');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    handleUploaded({
      file,
      localUrl,
      openConfig: Boolean(options?.openConfig),
      isReplacing: Boolean(options?.isReplacing),
    });
  }, [handleUploaded]);

  const handleStepOneOpenPicker = useCallback(() => {
    setErr('');
    stepOneFileInputRef.current?.click();
  }, []);

  const handleStepOneOpenRecommended = useCallback(() => {
    setErr('');
    setStepOneSizeMenuOpen(false);
    setStepOneMaterialMenuOpen(false);
    setGalleryOpen(true);
  }, []);

  const handleStepOneOpenCustomSizePanel = useCallback(() => {
    setStepOneSizeMenuOpen(false);
    setStepOneMaterialMenuOpen(false);
    setStepOneCustomSizePanelOpen(true);
  }, []);

  const handleStepOneCloseRecommended = useCallback(() => {
    setGalleryOpen(false);
  }, []);

  const handleStepOneInputChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file) {
      handleStepOnePickedFile(file);
    }
    event.target.value = '';
  }, [handleStepOnePickedFile]);

  const handleStepOneDragEnter = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    stepOneDragDepthRef.current += 1;
    setStepOneDragActive(true);
  }, []);

  const handleStepOneDragOver = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    setStepOneDragActive(true);
  }, []);

  const handleStepOneDragLeave = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    stepOneDragDepthRef.current = Math.max(0, stepOneDragDepthRef.current - 1);
    if (stepOneDragDepthRef.current === 0) {
      setStepOneDragActive(false);
    }
  }, []);

  const handleStepOneDrop = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    stepOneDragDepthRef.current = 0;
    setStepOneDragActive(false);
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    handleStepOnePickedFile(file);
  }, [handleStepOnePickedFile]);

  const captureReviewPreview = useCallback(() => {
    const editor = canvasRef.current;
    if (!editor) return null;
    const devicePixelRatio = typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1.5;
    const pixelRatio = Math.min(Math.max(devicePixelRatio, 1), 2);
    const previewDataUrl =
      editor.exportPadDataURL?.(pixelRatio)
      || editor.exportPreviewDataURL?.()
      || null;
    if (previewDataUrl) {
      setReviewPreviewUrl(previewDataUrl);
    }
    return previewDataUrl;
  }, []);
  const formattedPriceAmount = useMemo(() => {
    const amount = Number(priceAmount);
    const safeAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
    return safeAmount.toLocaleString('es-AR', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
  }, [priceAmount]);

  const stepTwoQualityState = useMemo(() => {
    if (!hasImage) return null;
    if (level === 'bad') {
      return {
        label: 'Calidad baja',
        icon: 'warning',
        toneClassName: styles.stepTwoStatusBadgeWarning,
      };
    }
    if (level === 'warn') {
      return {
        label: 'Calidad Media',
        icon: 'warning',
        toneClassName: styles.stepTwoStatusBadgeMedium,
      };
    }
    return {
      label: 'Calidad óptima',
      icon: 'success',
      toneClassName: styles.stepTwoStatusBadgeSuccess,
    };
  }, [hasImage, level]);

  const stepTwoStatusBadgeClasses = [
    styles.stepTwoStatusBadge,
    stepTwoQualityState?.toneClassName || '',
  ]
    .filter(Boolean)
    .join(' ');
  const stepTwoBaseSizeOptions = useMemo(
    () => getDropdownStandardSizeOptionsForMaterial(material),
    [material],
  );
  const selectedStepTwoSizeOptionId = useMemo(
    () => resolveSelectedSizeOptionId({
      targetMaterial: material,
      targetMode: mode,
      candidateSize: activeSizeCm,
      standardOptions: stepTwoBaseSizeOptions,
    }),
    [activeSizeCm, material, mode, stepTwoBaseSizeOptions],
  );
  const selectedStepTwoSizeOption = useMemo(() => {
    if (selectedStepTwoSizeOptionId === STEP_TWO_CUSTOM_SIZE_OPTION.id) {
      return STEP_TWO_CUSTOM_SIZE_OPTION;
    }
    return (
      stepTwoBaseSizeOptions.find((option) => option.id === selectedStepTwoSizeOptionId)
      || stepTwoBaseSizeOptions[0]
      || (isFixedPad49x42Material(material) ? buildGlasspadFixedSizeOption() : STEP_TWO_CUSTOM_SIZE_OPTION)
    );
  }, [material, selectedStepTwoSizeOptionId, stepTwoBaseSizeOptions]);
  const stepTwoDrawerSizeOptions = useMemo(() => (
    stepTwoBaseSizeOptions.map((option) => {
      const w = Number(option.w) || 0;
      const h = Number(option.h) || 0;
      const pricing = calculateTransferPricing({
        width: w,
        height: h,
        material,
      });
      const transfer = pricing.valid ? Number(pricing.transfer) || 0 : 0;
      const priceLabel = transfer > 0 ? `$${formatARS(transfer)}` : '—';
      return {
        ...option,
        price: transfer,
        priceLabel,
        measurementLabel: option.measurementLabel || formatSizeLabel(option),
      };
    })
  ), [stepTwoBaseSizeOptions, material]);

  const stepTwoDrawerMaterialOptions = useMemo(() => (
    STEP_TWO_MATERIAL_OPTIONS.map((option) => {
      const pricing = calculateTransferPricing({
        width: activeSizeCm.w,
        height: activeSizeCm.h,
        material: option.value,
      });
      const transfer = pricing.valid ? Number(pricing.transfer) || 0 : 0;
      const priceLabel = transfer > 0 ? `$${formatARS(transfer)}` : '—';
      return {
        ...option,
        totalPrice: transfer,
        priceLabel,
      };
    })
  ), [activeSizeCm.h, activeSizeCm.w]);
  const selectedStepTwoMaterialOption = useMemo(
    () => stepTwoDrawerMaterialOptions.find((option) => option.value === material) || stepTwoDrawerMaterialOptions[0] || null,
    [material, stepTwoDrawerMaterialOptions],
  );
  const stepTwoSizeSummary = useMemo(() => {
    if (isFixedPad49x42Material(material)) {
      return `Fijo · ${formatSizeLabel(activeSizeCm)}`;
    }
    if (!selectedStepTwoSizeOption) return 'Sin tamaño';
    if (selectedStepTwoSizeOption.id === STEP_TWO_CUSTOM_SIZE_OPTION.id) {
      return `${selectedStepTwoSizeOption.label} · ${formatSizeLabel(activeSizeCm)}`;
    }
    return `${selectedStepTwoSizeOption.label} · ${selectedStepTwoSizeOption.measurementLabel || formatSizeLabel(selectedStepTwoSizeOption)}`;
  }, [activeSizeCm, material, selectedStepTwoSizeOption]);
  const stepTwoMaterialSummary = useMemo(
    () => selectedStepTwoMaterialOption?.label || 'Sin material',
    [selectedStepTwoMaterialOption],
  );
  const stepTwoFooterMobileSizeMaterialLine = useMemo(() => {
    const w = Math.round(Number(activeSizeCm?.w) || 0);
    const h = Math.round(Number(activeSizeCm?.h) || 0);
    const matVal = String(selectedStepTwoMaterialOption?.value ?? material ?? '').trim();
    const matPart = matVal ? matVal.toUpperCase() : '—';
    return `${w}x${h} - ${matPart}`;
  }, [activeSizeCm?.w, activeSizeCm?.h, material, selectedStepTwoMaterialOption?.value]);
  const showStepTwoCustomSizeInputs = Boolean(
    !isFixedPad49x42Material(material)
    && selectedStepTwoSizeOptionId === STEP_TWO_CUSTOM_SIZE_OPTION.id,
  );
  const stepTwoProjectSummary = useMemo(() => trimmedDesignName, [trimmedDesignName]);
  const stepThreeMockupPublicSrc = useMemo(() => {
    const raw = typeof flow?.mockupPublicUrl === 'string' ? flow.mockupPublicUrl.trim() : '';
    if (!raw || raw.startsWith('blob:')) return null;
    return raw;
  }, [flow?.mockupPublicUrl]);
  const stepThreePreviewSrc =
    stepThreeMockupPublicSrc
    || mockupUrl
    || reviewPreviewUrl
    || editorImageUrl
    || uploaded?.canonical_url
    || uploaded?.file_original_url
    || null;
  /** Resumen paso 3: medida sin prefijo. */
  const stepThreeSizeDetail = useMemo(
    () => formatSizeLabel(activeSizeCm),
    [activeSizeCm],
  );
  const stepThreeMaterialDetail = useMemo(() => {
    const body =
      STEP_THREE_MATERIAL_SUMMARY[material]
      || selectedStepTwoMaterialOption?.label
      || material;
    const prefix = safeStr(material);
    if (!prefix) return body;
    if (!body) return prefix;
    return `${prefix}-${body}`;
  }, [material, selectedStepTwoMaterialOption]);
  const stepThreeIdealUseDetail = useMemo(
    () => STEP_THREE_IDEAL_USE_SUMMARY[material] || '',
    [material],
  );
  const canConfirmStepTwoConfig = Boolean(
    hasImage
    && selectedStepTwoSizeOption
    && selectedStepTwoMaterialOption
    && !designNameValidationMessage
    && !isPublishing
    && !isStepReview,
  );

  const toggleConfigSection = useCallback((section) => {
    setOpenConfigSection((current) => (current === section ? null : section));
  }, []);

  const handleStepTwoSizeOptionSelect = useCallback((optionId) => {
    if (optionId === STEP_TWO_CUSTOM_SIZE_OPTION.id) {
      handleSizeChange({ mode: 'custom' });
      setOpenConfigSection(STEP_TWO_DRAWER_SECTIONS.size);
      return;
    }

    const selectedOption = STEP_TWO_SIZE_OPTIONS.find((option) => option.id === optionId);
    if (!selectedOption) return;
    handleSizeChange({
      mode: 'standard',
      w: selectedOption.w,
      h: selectedOption.h,
    });
    const hasMaterialSelected = Boolean(
      selectedStepTwoMaterialOption?.value
      || material,
    );
    const nextOpenSection = hasMaterialSelected
      ? STEP_TWO_DRAWER_SECTIONS.project
      : STEP_TWO_DRAWER_SECTIONS.material;
    setOpenConfigSection(
      nextOpenSection,
    );
  }, [handleSizeChange, material, selectedStepTwoMaterialOption?.value]);

  const handleStepTwoMaterialSelect = useCallback((nextMaterial) => {
    if (STEP_TWO_MATERIAL_OPTIONS.some((o) => o.value === nextMaterial && isMaterialDropdownLocked(o))) {
      return;
    }
    handleSizeChange({ material: nextMaterial });
    setOpenConfigSection(STEP_TWO_DRAWER_SECTIONS.project);
  }, [handleSizeChange]);

  const handleReturnToUpload = useCallback(() => {
    handleClearImage();
    dispatchStep({ type: 'RESET' });
  }, [handleClearImage]);

  const handleStepTwoOpenReplace = useCallback(() => {
    setErr('');
    stepTwoFileInputRef.current?.click();
  }, []);

  const handleStepTwoReplaceChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file) {
      setIsReplacing(true);
      handleStepOnePickedFile(file, { openConfig: false, isReplacing: true });
    }
    event.target.value = '';
  }, [handleStepOnePickedFile]);

  const handleStepTwoOpenTools = useCallback(() => {
    setConfigOpen(false);
    setToolsDrawerOpen(true);
  }, []);

  const handleStepTwoCloseTools = useCallback(() => {
    setToolsDrawerOpen(false);
  }, []);

  const handleStepTwoOpenConfig = useCallback(() => {
    setToolsDrawerOpen(false);
    setOpenConfigSection(STEP_TWO_DRAWER_SECTIONS.project);
    setConfigOpen(true);
  }, []);

  const handleStepTwoCloseConfig = useCallback(() => {
    setConfigOpen(false);
  }, []);

  const validateStepTwoSelection = useCallback(() => {
    if (!hasImage) {
      setErr('Subí una imagen antes de continuar.');
      return false;
    }

    if (!selectedStepTwoSizeOption) {
      setErr('Seleccioná un tamaño antes de continuar.');
      setConfigOpen(true);
      setOpenConfigSection(STEP_TWO_DRAWER_SECTIONS.size);
      return false;
    }

    if (!selectedStepTwoMaterialOption) {
      setErr('Seleccioná un material antes de continuar.');
      setConfigOpen(true);
      setOpenConfigSection(STEP_TWO_DRAWER_SECTIONS.material);
      return false;
    }

    const projectNameError = validateProjectName(designName);
    if (projectNameError) {
      setDesignNameError(projectNameError);
      setConfigOpen(true);
      setOpenConfigSection(STEP_TWO_DRAWER_SECTIONS.project);
      setTimeout(() => {
        designNameInputRef.current?.focus?.();
      }, 0);
      return false;
    }

    setErr('');
    setDesignNameError('');
    return true;
  }, [designName, hasImage, selectedStepTwoMaterialOption, selectedStepTwoSizeOption]);

  const openStepThreeReview = useCallback(() => {
    const fs = (typeof flow?.get === 'function' ? flow.get() : flow) || {};
    const aligned = reconcileReviewMaterialFromFlow(material, fs);
    if (aligned !== material) {
      setMaterial(aligned);
    }
    captureReviewPreview();
    setConfigOpen(false);
    setToolsDrawerOpen(false);
    dispatchStep({ type: 'REVIEW' });
  }, [captureReviewPreview, flow, material]);

  const handleReturnToEditor = useCallback(() => {
    if (reviewExitBusy || stepThreeCommerceAction) return;
    setErr('');
    setConfigOpen(false);
    setToolsDrawerOpen(false);

    const run = async () => {
      setReviewExitBusy(true);
      try {
        const flowState = (typeof flow?.get === 'function' ? flow.get() : flow) || {};
        const targets = new Map();

        const addTarget = (bucketRaw, pathRaw) => {
          const bucket = typeof bucketRaw === 'string' ? bucketRaw.trim() : '';
          const path = typeof pathRaw === 'string' ? pathRaw.trim() : '';
          if (!bucket || !path || !STEP_TWO_REMOTE_STORAGE_BUCKETS.has(bucket)) return;
          targets.set(`${bucket}::${path}`, { bucket, path });
        };

        addTarget(flowState.uploadBucket, flowState.uploadObjectKey);
        addTarget(uploaded?.bucket, uploaded?.object_key);

        const addFromUrl = (url) => {
          const parsed = parseSupabasePublicStorageUrl(url);
          if (parsed) addTarget(parsed.bucket, parsed.path);
        };
        addFromUrl(flowState.mockupPublicUrl);
        addFromUrl(flowState.masterPublicUrl);
        addFromUrl(flowState.pdfPublicUrl);

        const deleteEndpoint = getResolvedApiUrl('/api/storage/delete');
        for (const { bucket, path } of targets.values()) {
          try {
            await postJSON(deleteEndpoint, { bucket, path }, 20000);
          } catch (delErr) {
            warn('[home:return-to-editor] storage delete failed', { bucket, path, delErr });
          }
        }

        flow?.set?.({
          pdfPublicUrl: null,
          masterPublicUrl: null,
          mockupPublicUrl: null,
          mockupHash: null,
          uploadObjectKey: null,
          uploadBucket: null,
          uploadSha256: null,
          uploadSizeBytes: null,
          uploadContentType: null,
          fileOriginalUrl: null,
        });

        setUploaded((prev) => {
          if (!prev || typeof prev !== 'object') return prev;
          return {
            ...prev,
            object_key: null,
            bucket: null,
            canonical_url: null,
            file_original_url: null,
            file_hash: null,
          };
        });

        setMasterPublicUrl(null);
        setPdfPublicUrl(null);
        setDesignHashState(null);

        dispatchStep({ type: 'RESTORE_EDIT', hasImage: Boolean(uploaded) });
      } finally {
        setReviewExitBusy(false);
      }
    };

    void run();
  }, [
    dispatchStep,
    flow,
    reviewExitBusy,
    setUploaded,
    stepThreeCommerceAction,
    uploaded,
  ]);

  const handleReviewAddToCart = useCallback(async () => {
    if (busy || stepThreeCommerceAction) return;
    setErr('');
    setStepThreeCommerceAction('cart');
    try {
      const result = await createJobAndProduct('cart', flow, {
        discountCode: STEP_THREE_TRANSFER_DISCOUNT,
      });
      let targetUrl = resolveProductPageTargetUrl(result);
      if (!targetUrl) {
        const snap = typeof flow?.get === 'function' ? flow.get() : flow;
        targetUrl = resolveProductPageTargetUrl(snap?.lastProduct || null);
      }
      if (!targetUrl) {
        setErr('No se pudo abrir la página del producto. Intentá nuevamente.');
        return;
      }
      if (!navigateSameTab(targetUrl)) {
        setErr('No se pudo abrir la página del producto. Intentá nuevamente.');
      }
    } catch (cartError) {
      error('[home-step-three-cart] failed', cartError);
      maybeShowHeavyImageToastFromError(cartError);
      setErr(resolveCheckoutErrorMessage(cartError));
    } finally {
      setStepThreeCommerceAction(null);
    }
  }, [busy, flow, stepThreeCommerceAction]);

  const openStepThreeCheckoutPrompt = useCallback(() => {
    if (busy || stepThreeCommerceAction) return;
    setErr('');
    setStepThreeCheckoutPromptOpen(true);
  }, [busy, stepThreeCommerceAction]);

  const closeStepThreeCheckoutPrompt = useCallback(() => {
    if (stepThreeCommerceAction) return;
    setStepThreeCheckoutPromptOpen(false);
  }, [stepThreeCommerceAction]);

  const handleStepThreeCheckoutPublic = useCallback(async () => {
    if (busy || stepThreeCommerceAction) return;
    setErr('');
    setStepThreeCheckoutPromptOpen(false);
    setStepThreeCommerceAction('checkout-public');
    try {
      const result = await createJobAndProduct('checkout', flow, {
        discountCode: STEP_THREE_TRANSFER_DISCOUNT,
      });
      const checkoutUrl = resolveCheckoutTargetUrl(result);
      if (!checkoutUrl) {
        setErr('No se pudo abrir el checkout. Intentá nuevamente.');
        return;
      }
      if (!tryOpenCommerceTarget(checkoutUrl)) {
        setErr('No se pudo abrir el checkout. Intentá nuevamente.');
      }
    } catch (checkoutError) {
      error('[home-step-three-checkout-public] failed', checkoutError);
      maybeShowHeavyImageToastFromError(checkoutError);
      setErr(resolveCheckoutErrorMessage(checkoutError));
    } finally {
      setStepThreeCommerceAction(null);
    }
  }, [busy, flow, stepThreeCommerceAction]);

  const handleStepThreeCheckoutPrivate = useCallback(async () => {
    if (busy || stepThreeCommerceAction) return;
    setErr('');

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const flowState = (typeof flow?.get === 'function' ? flow.get() : flow) || {};
    let emailRaw = typeof flowState.customerEmail === 'string' ? flowState.customerEmail.trim() : '';

    if (!emailPattern.test(emailRaw)) {
      if (typeof window === 'undefined') {
        setErr('Ingresá un correo electrónico válido para comprar en privado.');
        return;
      }
      const promptDefault = typeof flowState.customerEmail === 'string' ? flowState.customerEmail : '';
      const provided = window.prompt(
        'Ingresá tu correo electrónico para continuar con la compra privada:',
        promptDefault,
      );
      if (provided == null) {
        return;
      }
      const normalized = provided.trim();
      if (!emailPattern.test(normalized)) {
        window.alert('Ingresá un correo electrónico válido para comprar en privado.');
        return;
      }
      emailRaw = normalized;
    }

    if (emailRaw !== flowState.customerEmail && typeof flow?.set === 'function') {
      flow.set({ customerEmail: emailRaw });
    }

    setStepThreeCheckoutPromptOpen(false);
    setStepThreeCommerceAction('checkout-private');
    try {
      const submissionFlow = { ...flow, customerEmail: emailRaw };
      const result = await createJobAndProduct('private', submissionFlow, {});
      const checkoutUrl = resolveCheckoutTargetUrl(result);
      if (!checkoutUrl) {
        setErr('No se pudo abrir el checkout privado. Intentá nuevamente.');
        return;
      }
      if (!tryOpenCommerceTarget(checkoutUrl)) {
        setErr('No se pudo abrir el checkout privado. Intentá nuevamente.');
      }
    } catch (checkoutError) {
      error('[home-step-three-checkout-private] failed', checkoutError);
      maybeShowHeavyImageToastFromError(checkoutError);
      setErr(resolveCheckoutErrorMessage(checkoutError));
    } finally {
      setStepThreeCommerceAction(null);
    }
  }, [busy, flow, stepThreeCommerceAction]);

  useEffect(() => {
    if (!stepThreeCheckoutPromptOpen) return;
    const t = window.setTimeout(() => {
      try {
        stepThreeCheckoutFirstButtonRef.current?.focus?.();
      } catch (focusErr) {
        warn('[home-step-three-checkout-prompt] focus_failed', focusErr);
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [stepThreeCheckoutPromptOpen]);

  useEffect(() => {
    if (!stepThreeCheckoutPromptOpen) return;
    function handleKeyDown(event) {
      if (event.key === 'Escape' || event.key === 'Esc') {
        if (stepThreeCommerceAction) return;
        event.preventDefault();
        setStepThreeCheckoutPromptOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [stepThreeCheckoutPromptOpen, stepThreeCommerceAction]);

  useEffect(() => {
    if (!isStepReview) {
      setStepThreeCheckoutPromptOpen(false);
    }
  }, [isStepReview]);

  const stepTwoEditorFitMode = safeStr(layout?.mode, 'cover');
  const stepTwoCircularToggleLabel = isCircular ? 'Volver a rectangular' : 'Lienzo circular';
  const stepTwoCircularToggleIcon = isCircular
    ? STEP_TWO_TOOL_ICON_SOURCES.rectangular
    : STEP_TWO_TOOL_ICON_SOURCES.circular;
  const stepTwoCircularToggleDisabled = isFixedPad49x42Material(material);
  const getStepTwoDrawerActionClassName = (isActive = false) => [
    styles.stepTwoDrawerAction,
    isActive ? styles.stepTwoDrawerActionActive : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleStepTwoToolAction = useCallback((action) => {
    const editor = canvasRef.current;
    if (!editor) return;

    const actionMap = {
      centerHorizontal: () => editor.centerHoriz?.(),
      centerVertical: () => editor.centerVert?.(),
      alignLeft: () => editor.alignLeft?.(),
      alignRight: () => editor.alignRight?.(),
      alignTop: () => editor.alignTop?.(),
      alignBottom: () => editor.alignBottom?.(),
      flipHorizontal: () => editor.flipHorizontal?.(),
      flipVertical: () => editor.flipVertical?.(),
      rotate90: () => editor.rotate90?.(),
      cover: () => editor.fitCover?.(),
      contain: () => editor.fitContain?.(),
      stretch: () => editor.fitStretchCentered?.(),
    };

    actionMap[action]?.();

    const isStepTwoToolsMobileViewport =
      typeof window !== 'undefined' && window.matchMedia(STEP_ONE_MOBILE_QUERY).matches;
    const closeAfterFit = action === 'cover' || action === 'contain' || action === 'stretch';
    if (closeAfterFit || isStepTwoToolsMobileViewport) {
      setToolsDrawerOpen(false);
    }
  }, []);

  const handleStepTwoDrawerToggleCircular = useCallback(() => {
    if (isFixedPad49x42Material(material)) return;
    handleToggleCircular();
    setToolsDrawerOpen(false);
  }, [handleToggleCircular, material]);

  const stepTwoContainColorValue = useMemo(() => {
    const raw = layout?.background;
    if (typeof raw !== 'string' || !raw.startsWith('#')) return '#ffffff';
    if (raw.length === 4) {
      return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
    }
    return raw.length === 7 ? raw.toLowerCase() : '#ffffff';
  }, [layout?.background]);

  useEffect(() => {
    if (safeStr(layout?.mode, 'cover') !== 'contain') {
      setStepTwoContainColorOpen(false);
    }
  }, [layout?.mode]);

  const handleStepTwoContainColorPreview = useCallback((hex) => {
    canvasRef.current?.previewBackgroundColor?.(hex);
  }, []);

  const handleStepTwoContainColorCommit = useCallback((hex) => {
    canvasRef.current?.commitBackgroundColor?.(hex);
  }, []);

  const handleStepTwoContainPickFromCanvas = useCallback(() => {
    canvasRef.current?.startPickColor?.((hex) => {
      canvasRef.current?.commitBackgroundColor?.(hex);
    });
  }, []);

  const handleStepTwoOpenAr = useCallback(() => {
    canvasRef.current?.openArMeasure?.();
  }, []);

  const handleConfigDrawerSubmit = async (event) => {
    event.preventDefault();
    if (!validateStepTwoSelection()) return;
    if (SKIP_STEP2_CONTINUE_UPLOAD) {
      openStepThreeReview();
      return;
    }
    const uploadOk = await handleContinue();
    if (!uploadOk) return;
    openStepThreeReview();
  };

  return (
    <div
      className={`${styles.page} ${isStepUpload ? styles.pageStepUpload : ''} ${isStepEdit ? styles.pageStepEdit : ''} ${isStepReview ? styles.pageStepReview : ''}`.trim()}
      ref={pageRef}
    >
      <SeoJsonLd
        title={title}
        description={description}
        canonical={url}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'NOTMID',
          url: 'https://personalizados.notmid.ar/'
        }}
      />

      <section
        className={`${styles.sectionOne} ${isStepUpload ? styles.sectionOneStepUpload : ''} ${isStepEdit ? styles.sectionOneStepEdit : ''} ${isStepReview ? styles.sectionOneStepReview : ''}`.trim()}
        ref={sectionOneRef}
        style={isStepUpload || isStepReview ? undefined : sectionOneStyle}
      >
        <div
          className={`${styles.sectionOneInner} ${isStepUpload ? styles.sectionOneInnerStepUpload : ''} ${isStepEdit ? styles.sectionOneInnerStepEdit : ''} ${isStepReview ? styles.sectionOneInnerStepReview : ''}`.trim()}
          ref={sectionOneInnerRef}
          style={isStepUpload ? stepOneCanvasStyle : isStepReview ? undefined : editorMaxWidthStyle}
        >
          {isStepUpload ? (
            <div
              className={`${styles.pageHeading} ${styles.pageHeadingStepUpload}`.trim()}
              ref={headingRef}
            >
              <div className={styles.stepHero}>
                <h1 className={styles.stepHeroTitle}>Personalizá tu mousepad</h1>
              </div>
            </div>
          ) : null}

          {isStepUpload ? (
            <>
              <div className={`${styles.stepOneLayout} ${isStepOneCustomSizeSelected ? styles.stepOneLayoutCustom : ''}`.trim()}>
                <div className={styles.stepOneSizeSection}>
                  <div className={styles.stepOneSelectorsRow}>
                    <div className={styles.stepOneSelectorGroup}>
                      <span className={styles.stepOneSizeLabel} id="step-one-size-label">
                        TAMAÑO
                      </span>
                      <div className={styles.stepOneSizeDropdown} ref={stepOneSizeDropdownRef}>
                        <button
                          id="step-one-size-select"
                          type="button"
                          className={`${styles.stepOneSizeTrigger} ${isStepOneSizeMenuOpen ? styles.stepOneSizeTriggerOpen : ''}`.trim()}
                          aria-haspopup="listbox"
                          aria-expanded={isStepOneSizeMenuOpen}
                          aria-controls="step-one-size-menu"
                          aria-labelledby="step-one-size-label step-one-size-trigger-title"
                          onClick={() => {
                            setStepOneMaterialMenuOpen(false);
                            setStepOneSizeMenuOpen((prev) => !prev);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setStepOneMaterialMenuOpen(false);
                              setStepOneSizeMenuOpen(true);
                            } else if (event.key === 'Escape') {
                              setStepOneSizeMenuOpen(false);
                            }
                          }}
                        >
                          <span
                            className={`${styles.stepOneSizeTriggerBody} ${isFixedPad49x42Material(material) ? styles.stepOneSizeTriggerBodyGlasspad : ''}`.trim()}
                          >
                            <span className={styles.stepOneDropdownValue} id="step-one-size-trigger-title">
                              {stepOneSelectedSizeTriggerLabel}
                            </span>
                          </span>
                          <span className={styles.stepOneSizeArrow} aria-hidden="true">
                            <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                              <path
                                d="M7 10l5 5 5-5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        </button>

                        {isStepOneSizeMenuOpen && (
                          <div
                            id="step-one-size-menu"
                            className={styles.stepOneSizeMenu}
                            role="listbox"
                            aria-labelledby="step-one-size-label"
                          >
                            {stepOneDropdownOptions.map((option) => {
                              const isSelected = option.id === stepOneSelectedSizeId;

                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  role="option"
                                  aria-selected={isSelected}
                                  className={`${styles.stepOneSizeOption} ${isSelected ? styles.stepOneSizeOptionSelected : ''}`.trim()}
                                  onClick={() => handleStepOneSizeOptionSelect(option)}
                                >
                                  <span className={styles.stepOneSizeOptionLead}>
                                    <span className={styles.stepOneDropdownValue}>
                                      {option.isCustom ? option.menuLabel || option.label : option.menuLabel}
                                    </span>
                                  </span>
                                  <span className={styles.stepOneSizeOptionTail}>
                                    {isSelected ? (
                                      <span className={styles.stepOneSizeOptionCheck} aria-hidden="true">
                                        <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                                          <path
                                            d="m6.5 12.5 3.5 3.5 7.5-8"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          />
                                        </svg>
                                      </span>
                                    ) : null}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {isStepOneCustomSizeSelected && isStepOneMobileViewport && !isStepOneCustomSizePanelVisible && (
                        <button
                          type="button"
                          className={styles.stepOneCustomSizeEditButton}
                          onClick={handleStepOneOpenCustomSizePanel}
                        >
                          <span className={styles.stepOneCustomSizeEditIcon} aria-hidden="true">
                            <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                              <path
                                d="M4 20h4l10-10-4-4L4 16v4Z"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.75"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              <path
                                d="m12 6 4 4"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.75"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                          <span>Editar medida</span>
                        </button>
                      )}
                    </div>

                    <div className={styles.stepOneSelectorGroup}>
                      <span className={styles.stepOneSizeLabel} id="step-one-material-label">
                        MATERIAL
                      </span>
                      <div className={styles.stepOneSizeDropdown} ref={stepOneMaterialDropdownRef}>
                        <button
                          id="step-one-material-select"
                          type="button"
                          className={`${styles.stepOneSizeTrigger} ${isStepOneMaterialMenuOpen ? styles.stepOneSizeTriggerOpen : ''}`.trim()}
                          aria-haspopup="listbox"
                          aria-expanded={isStepOneMaterialMenuOpen}
                          aria-controls="step-one-material-menu"
                          aria-labelledby="step-one-material-label step-one-material-trigger-title"
                          onClick={() => {
                            setStepOneSizeMenuOpen(false);
                            setStepOneMaterialMenuOpen((prev) => !prev);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setStepOneSizeMenuOpen(false);
                              setStepOneMaterialMenuOpen(true);
                            } else if (event.key === 'Escape') {
                              setStepOneMaterialMenuOpen(false);
                            }
                          }}
                        >
                          <span className={styles.stepOneSizeTriggerBody}>
                            <span className={styles.stepOneDropdownValueRow}>
                              <span className={styles.stepOneDropdownValue} id="step-one-material-trigger-title">
                                {selectedStepOneMaterialOption?.label || material}
                              </span>
                              {selectedStepOneMaterialOption?.recommended ? (
                                <span className={styles.stepOneDropdownBadge}>Recomendado</span>
                              ) : null}
                              {selectedStepOneMaterialOption?.comingSoon ? (
                                <span className={styles.stepOneDropdownBadgeSoon}>Próximamente</span>
                              ) : null}
                            </span>
                          </span>
                          <span className={styles.stepOneSizeArrow} aria-hidden="true">
                            <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                              <path
                                d="M7 10l5 5 5-5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        </button>

                        {isStepOneMaterialMenuOpen && (
                          <div
                            id="step-one-material-menu"
                            className={styles.stepOneSizeMenu}
                            role="listbox"
                            aria-labelledby="step-one-material-label"
                          >
                            {stepOneMaterialOptions.map((option) => {
                              const isSelected = selectedStepOneMaterialOption?.value === option.value;
                              const isLocked = isMaterialDropdownLocked(option);

                              return (
                                <button
                                  key={option.value}
                                  type="button"
                                  role="option"
                                  aria-selected={isSelected}
                                  aria-disabled={isLocked}
                                  disabled={isLocked}
                                  className={[
                                    styles.stepOneSizeOption,
                                    isSelected ? styles.stepOneSizeOptionSelected : '',
                                    isLocked ? styles.stepOneSizeOptionDisabled : '',
                                  ].filter(Boolean).join(' ')}
                                  onClick={() => handleStepOneMaterialSelect(option.value)}
                                >
                                  <span className={styles.stepOneSizeOptionLead}>
                                    <span className={styles.stepOneDropdownValueRow}>
                                      <span className={styles.stepOneDropdownValue}>{option.label}</span>
                                      {option.recommended ? (
                                        <span className={styles.stepOneDropdownBadge}>Recomendado</span>
                                      ) : null}
                                      {option.comingSoon ? (
                                        <span className={styles.stepOneDropdownBadgeSoon}>Próximamente</span>
                                      ) : null}
                                    </span>
                                  </span>
                                  <span className={styles.stepOneSizeOptionTail}>
                                    {isSelected ? (
                                      <span className={styles.stepOneSizeOptionCheck} aria-hidden="true">
                                        <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                                          <path
                                            d="m6.5 12.5 3.5 3.5 7.5-8"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                          />
                                        </svg>
                                      </span>
                                    ) : null}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  {isStepOneCustomSizeSelected && !isFixedPad49x42Material(material) && (
                    <div
                      ref={stepOneCustomSizePanelRef}
                      className={[
                        styles.stepOneCustomSizePanel,
                        isStepOneCustomSizePanelVisible
                          ? styles.stepOneCustomSizePanelOpen
                          : styles.stepOneCustomSizePanelClosed,
                      ].filter(Boolean).join(' ')}
                      aria-hidden={isStepOneCustomSizePanelVisible ? undefined : 'true'}
                    >
                      <CustomSizeFields
                        size={activeSizeCm}
                        limits={customSizeLimits}
                        onChange={handleCustomSizeChange}
                        disabled={isStepOneCustomSizePanelCollapsible && !isStepOneCustomSizePanelVisible}
                        className={styles.stepOneCustomSizeFields}
                      />
                    </div>
                  )}
                </div>

                <div className={`${styles.stepOnePreviewStack} ${isStepOneCustomSizeSelected ? styles.stepOnePreviewStackCustom : ''}`.trim()}>
                  <div className={styles.stepOnePreviewBody}>
                    <PrintAreaHelpCaption
                      labelClassName={`${styles.stepTwoPreviewCaption} ${styles.stepOnePreviewCaption}`.trim()}
                    />
                    <div className={styles.stepOneCanvasFrame} ref={lienzoCardRef}>
                      <div className={styles.stepOneCanvasStage}>
                        <div
                          className={styles.stepOneCanvasViewport}
                          onDragEnter={handleStepOneDragEnter}
                          onDragOver={handleStepOneDragOver}
                          onDragLeave={handleStepOneDragLeave}
                          onDrop={handleStepOneDrop}
                          aria-label="Área de carga de imagen"
                        >
                          <div className={styles.stepOneCanvasFigure}>
                            <div
                              className={`${styles.stepOneCanvasShell} ${stepOneDragActive ? styles.stepOneCanvasShellActive : ''} ${isStepOneCanvasLightTheme ? styles.stepOneCanvasShellLight : ''}`.trim()}
                            >
                            <div className={styles.stepOneCanvasGrid} />
                            <div className={styles.stepOneCanvasContent}>
                              <span className={`${styles.stepOneCanvasIcon} ${styles.stepOneCanvasMedia}`.trim()} aria-hidden="true">
                                <img
                                  src={stepOneUploadIconSrc}
                                  alt=""
                                  className={`${styles.stepOneCanvasIconImage} ${isStepOneCanvasLightTheme ? styles.stepOneCanvasIconImageLight : ''}`.trim()}
                                />
                              </span>
                                <h2 className={styles.stepOneCanvasTitle}>
                                  Arrastrá tu imagen aquí
                                </h2>
                                <p className={styles.stepOneCanvasText}>
                                  o subí tu diseño para comenzar
                                </p>
                              </div>
                              <div className={styles.stepOneCanvasMeasureColumn} aria-hidden="true">
                                <span className={styles.stepOneCanvasMeasureLineVertical} />
                                <span className={styles.stepOneCanvasMeasureLabelVertical}>{stepOneCanvasHeightLabel}</span>
                                <span className={styles.stepOneCanvasMeasureLineVertical} />
                              </div>
                              <div className={styles.stepOneCanvasMeasureRow} aria-hidden="true">
                                <span className={styles.stepOneCanvasMeasureLine} />
                                <span className={styles.stepOneCanvasMeasureLabel}>{stepOneCanvasWidthLabel}</span>
                                <span className={styles.stepOneCanvasMeasureLine} />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className={styles.stepOneActions}>
                    <input
                      ref={stepOneFileInputRef}
                      type="file"
                      accept="image/png, image/jpeg"
                      className={styles.stepOneHiddenInput}
                      onChange={handleStepOneInputChange}
                    />
                    <div className={`${styles.stepOneFooterBar} ${!isDarkMode ? styles.stepOneFooterBarLight : ''}`.trim()}>
                      <div className={styles.stepOneFooterPriceBlock}>
                        <span className={`${styles.stepOneFooterPrice} ${!isDarkMode ? styles.stepOneFooterPriceLight : ''}`.trim()}>$ {stepOneFormattedPriceAmount}</span>
                        <span className={`${styles.stepOneFooterPriceCaption} ${!isDarkMode ? styles.stepOneFooterPriceCaptionLight : ''}`.trim()}>Total según configuración</span>
                      </div>
                      <button
                        type="button"
                        className={`${styles.stepPrimaryAction} ${styles.stepOneFooterAction}`.trim()}
                        onClick={handleStepOneOpenPicker}
                        aria-label="Subir mi imagen"
                      >
                        <span className={styles.stepPrimaryActionIcon} aria-hidden="true">
                          <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                            <path
                              d="M12 16V4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.75"
                              strokeLinecap="round"
                            />
                            <path
                              d="M8 8l4-4 4 4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.75"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              d="M5 20h14"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.75"
                              strokeLinecap="round"
                            />
                          </svg>
                        </span>
                        <span>Subir mi imagen</span>
                      </button>
                    </div>
                    <button
                      type="button"
                      className={styles.stepOneSecondaryAction}
                      onClick={handleStepOneOpenRecommended}
                    >
                      <span className={styles.stepOneSecondaryActionIcon} aria-hidden="true">
                        <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                          <path
                            d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="m18.5 14 0.8 2.2 2.2 0.8-2.2 0.8-0.8 2.2-0.8-2.2-2.2-0.8 2.2-0.8 0.8-2.2Z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <span>Páginas con imágenes 4k</span>
                    </button>

                    {err && (
                      <p className={styles.stepInlineError} role="alert">
                        {err}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {isGalleryOpen && (
                <div
                  className={styles.stepOneGalleryOverlay}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="step-one-gallery-title"
                >
                  <div className={styles.stepOneGalleryContent}>
                    <button
                      type="button"
                      className={styles.stepOneGalleryBackButton}
                      onClick={handleStepOneCloseRecommended}
                    >
                      <span aria-hidden="true">←</span>
                      <span>Volver</span>
                    </button>

                    <div className={styles.stepOneGalleryHeader}>
                      <h2 className={styles.stepOneGalleryTitle} id="step-one-gallery-title">
                        Páginas con imágenes 4k
                      </h2>
                      <p className={styles.stepOneGallerySubtitle}>
                        Busca tu diseño ideal.
                      </p>
                    </div>

                    <div className={styles.stepOneGalleryGrid}>
                      {STEP_ONE_RECOMMENDED_CATEGORIES.map((category) => (
                        <a
                          key={category.id}
                          href={category.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.stepOneGalleryCard}
                          aria-label={`Abrir ${category.label} en una pestaña nueva`}
                        >
                          <span
                            className={styles.stepOneGalleryCardMedia}
                            style={{ background: category.background }}
                            aria-hidden="true"
                          />
                          <span className={styles.stepOneGalleryCardShade} aria-hidden="true" />
                          <span className={styles.stepOneGalleryCardLabel}>{category.label}</span>
                        </a>
                      ))}
                    </div>

                  </div>
                </div>
              )}
            </>
          ) : isStepReview ? (
            <div className={styles.stepThreeLayout}>
              <div className={styles.stepThreePreviewCard} ref={headingRef}>
                {stepThreePreviewSrc ? (
                  <StepThreeMockupPreview
                    frameClassName={styles.stepThreePreviewFrame}
                    src={stepThreePreviewSrc}
                    alt={`Vista previa de ${trimmedDesignName || 'tu diseño'}`}
                    imageKey={designHashState || ''}
                  />
                ) : (
                  <div className={styles.stepThreePreviewFrame}>
                    <div className={styles.stepThreePreviewFallback}>
                      Vista previa no disponible
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.stepThreeDetailsCard}>
                <div className={styles.stepThreeDetailRow}>
                  <span className={styles.stepThreeDetailLabel}>Tamaño</span>
                  <span className={styles.stepThreeDetailValue}>{stepThreeSizeDetail}</span>
                </div>
                <div className={styles.stepThreeDetailRow}>
                  <span className={styles.stepThreeDetailLabel}>Material</span>
                  <span className={styles.stepThreeDetailValue}>{stepThreeMaterialDetail}</span>
                </div>
                <div className={styles.stepThreeDetailRow}>
                  <span className={styles.stepThreeDetailLabel}>Uso ideal</span>
                  <span className={styles.stepThreeDetailValue}>{stepThreeIdealUseDetail}</span>
                </div>
                <div className={`${styles.stepThreeDetailRow} ${styles.stepThreeDetailRowTotal}`.trim()}>
                  <span className={styles.stepThreeDetailLabel}>Total</span>
                  <span className={styles.stepThreeDetailValueTotal}>
                    $ {formattedPriceAmount} (Abonando con transferencia)
                  </span>
                </div>
              </div>

              <div className={styles.stepThreeSafetyNote}>
                <span className={styles.stepThreeSafetyIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                    <path
                      d="M12 3 6 5.5v5.9c0 4.2 2.5 8 6 9.6 3.5-1.6 6-5.4 6-9.6V5.5L12 3Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinejoin="round"
                    />
                    <path
                      d="m9.5 12 1.8 1.8 3.7-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className={styles.stepThreeSafetyNoteText}>
                  Esto es exactamente lo que enviaremos a imprimir
                </span>
              </div>

              {err && (
                <div className={styles.stepTwoFeedback}>
                  <p className={`errorText ${styles.errorMessage}`} role="alert">
                    {err}
                  </p>
                </div>
              )}

              <div className={styles.stepThreeActionsRow}>
                <button
                  type="button"
                  className={styles.stepThreeSecondaryButton}
                  onClick={handleReviewAddToCart}
                  disabled={
                    busy
                    || Boolean(stepThreeCommerceAction)
                    || stepThreeCheckoutPromptOpen
                  }
                >
                  {stepThreeCommerceAction === 'cart'
                    ? STEP_THREE_COMMERCE_PENDING_LABEL
                    : STEP_THREE_ADD_TO_CART_LABEL}
                </button>
                <button
                  type="button"
                  className={styles.stepThreePrimaryButton}
                  onClick={openStepThreeCheckoutPrompt}
                  disabled={
                    busy
                    || Boolean(stepThreeCommerceAction)
                    || stepThreeCheckoutPromptOpen
                  }
                >
                  {stepThreeCommerceAction === 'checkout-public'
                    || stepThreeCommerceAction === 'checkout-private'
                    ? STEP_THREE_COMMERCE_PENDING_LABEL
                    : STEP_THREE_CHECKOUT_BUTTON_LABEL}
                </button>
              </div>

              <button
                type="button"
                className={styles.stepThreeBackLink}
                onClick={handleReturnToEditor}
                disabled={
                  Boolean(stepThreeCommerceAction)
                  || reviewExitBusy
                  || stepThreeCheckoutPromptOpen
                }
              >
                <span className={styles.stepTwoBackIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                    <path
                      d="M15 6l-6 6 6 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span>Volver al editor</span>
              </button>

              {stepThreeCheckoutPromptOpen ? (
                <div
                  role="presentation"
                  className={styles.stepThreeCheckoutModalBackdrop}
                  onClick={() => {
                    if (stepThreeCommerceAction) return;
                    closeStepThreeCheckoutPrompt();
                  }}
                >
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={stepThreeCheckoutTitleId}
                    aria-describedby={stepThreeCheckoutDescId}
                    ref={stepThreeCheckoutModalRef}
                    className={styles.stepThreeCheckoutModalCard}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={closeStepThreeCheckoutPrompt}
                      disabled={Boolean(stepThreeCommerceAction)}
                      aria-label="Cerrar"
                      className={styles.stepThreeCheckoutModalClose}
                    >
                      ×
                    </button>
                    <h2 id={stepThreeCheckoutTitleId} className={styles.stepThreeCheckoutModalTitle}>
                      Elegí cómo publicar tu diseño
                    </h2>
                    <p id={stepThreeCheckoutDescId} className={styles.stepThreeCheckoutModalDescription}>
                      📣 Público: visible en la tienda.
                      <br />
                      <br />
                      🔒 Privado: solo vos lo verás.
                    </p>
                    <div className={styles.stepThreeCheckoutModalActions}>
                      <button
                        ref={stepThreeCheckoutFirstButtonRef}
                        type="button"
                        className={styles.stepThreeCheckoutModalPrimary}
                        disabled={
                          busy
                          || Boolean(stepThreeCommerceAction)
                        }
                        onClick={() => {
                          void handleStepThreeCheckoutPublic();
                        }}
                      >
                        {stepThreeCommerceAction === 'checkout-public'
                          ? 'Procesando…'
                          : 'Comprar público'}
                      </button>
                      <button
                        type="button"
                        className={styles.stepThreeCheckoutModalSecondary}
                        disabled={
                          busy
                          || Boolean(stepThreeCommerceAction)
                        }
                        onClick={() => {
                          void handleStepThreeCheckoutPrivate();
                        }}
                      >
                        {stepThreeCommerceAction === 'checkout-private'
                          ? 'Procesando…'
                          : 'Comprar en privado'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className={styles.stepTwoLayout} style={stepTwoCanvasStyle}>
              <Calculadora
                width={activeSizeCm.w}
                height={activeSizeCm.h}
                material={material}
                setPrice={handleCalculatedPrice}
                render={() => null}
              />

              <div className={styles.stepTwoWorkspace} ref={stepTwoWorkspaceRef}>
                <div className={styles.stepTwoPreviewFrame} ref={lienzoCardRef}>
                  <div className={styles.stepTwoPreviewBackRail}>
                    <button
                      type="button"
                      className={styles.stepTwoBackButton}
                      onClick={handleReturnToUpload}
                      aria-label="Volver al paso de carga"
                    >
                      <span className={styles.stepTwoBackIcon} aria-hidden="true">
                        <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                          <path
                            d="M15 6l-6 6 6 6"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <span>Volver</span>
                    </button>
                  </div>
                  <div className={styles.stepTwoPreviewBundle}>
                    <p className={styles.stepTwoPreviewTitle} ref={headingRef}>VISTA PREVIA DEL DISEÑO</p>
                    <div className={styles.stepTwoPreviewCanvasColumn}>
                      <div className={styles.stepTwoPreviewViewport}>
                        <div className={styles.stepTwoPreviewShell} style={stepTwoPreviewShellStyle}>
                          <EditorCanvas
                            ref={canvasRef}
                            imageUrl={editorImageUrl}
                            externalImageUrl={editorExternalImageUrl}
                            imageFile={uploaded?.file}
                            sizeCm={activeSizeCm}
                            bleedMm={3}
                            dpi={300}
                            material={material}
                            isCircular={isCircular}
                            onToggleCircular={handleToggleCircular}
                            onLayoutChange={setLayout}
                            onClearImage={handleClearImage}
                            showCanvas={isCanvasReady}
                            showHistoryControls={false}
                            showToolbar={false}
                            isReplacing={isReplacing}
                            onReplaceSettled={() => setIsReplacing(false)}
                            editorRootClassName={styles.stepTwoCanvasRoot}
                            lienzoClassName={styles.stepTwoCanvasLienzo}
                            canvasWrapperClassName={styles.stepTwoCanvasWrapper}
                            allowCanvasPan={false}
                            onUnmountCleanup={handleStepTwoEditorUnmount}
                            onImageDragStart={handleStepTwoImageDragStart}
                          />
                          {isCanvasReady && showStepTwoRepositionHint && (
                            <div className={styles.stepTwoPreviewHint} aria-hidden="true">
                              <span className={styles.stepTwoPreviewHintIcon}>
                                <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                                  <path
                                    d="M12 4v16"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.7"
                                    strokeLinecap="round"
                                  />
                                  <path
                                    d="M4 12h16"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.7"
                                    strokeLinecap="round"
                                  />
                                  <path
                                    d="m12 4 2.5 2.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.7"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="M12 4 9.5 6.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.7"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="m12 20 2.5-2.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.7"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="M12 20 9.5 17.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.7"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="m4 12 2.5-2.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.7"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="m4 12 2.5 2.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.7"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="m20 12-2.5-2.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.7"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="m20 12-2.5 2.5"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.7"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </span>
                              <span>Arrastrá para reposicionar</span>
                            </div>
                          )}
                        </div>
                        <div className={styles.stepTwoPreviewMeasureColumn} aria-hidden="true">
                          <span className={styles.stepTwoPreviewMeasureLineVertical} />
                          <span className={styles.stepTwoPreviewMeasureLabelVertical}>{stepOneCanvasHeightLabel}</span>
                          <span className={styles.stepTwoPreviewMeasureLineVertical} />
                        </div>
                        <div className={styles.stepTwoPreviewMeasureRow} aria-hidden="true">
                          <span className={styles.stepTwoPreviewMeasureLine} />
                          <span className={styles.stepTwoPreviewMeasureLabel}>{stepOneCanvasWidthLabel}</span>
                          <span className={styles.stepTwoPreviewMeasureLine} />
                        </div>
                      </div>
                    </div>
                    <PrintAreaHelpCaption
                      showHelp
                      rowClassName={styles.stepTwoPreviewCaptionBottom}
                      labelClassName={styles.stepTwoPreviewCaption}
                    />

                    <aside className={styles.stepTwoActionsRail} aria-label="Acciones del editor">
                      <input
                        ref={stepTwoFileInputRef}
                        type="file"
                        accept="image/png, image/jpeg"
                        className={styles.stepOneHiddenInput}
                        onChange={handleStepTwoReplaceChange}
                      />
                      <button
                        type="button"
                        className={styles.stepTwoActionButton}
                        onClick={handleStepTwoOpenReplace}
                      >
                        <span className={styles.stepTwoActionIcon} aria-hidden="true">
                          <img
                            src={replaceActionIconSrc}
                            alt=""
                            className={`${styles.stepTwoActionIconImage} step-two-action-rail-icon`.trim()}
                          />
                        </span>
                        <span>Reemplazar</span>
                      </button>
                      <button
                        type="button"
                        className={styles.stepTwoActionButton}
                        onClick={handleClearImage}
                      >
                        <span className={styles.stepTwoActionIcon} aria-hidden="true">
                          <img
                            src={deleteActionIconSrc}
                            alt=""
                            className={`${styles.stepTwoActionIconImage} step-two-action-rail-icon`.trim()}
                          />
                        </span>
                        <span>Eliminar</span>
                      </button>
                      <button
                        type="button"
                        className={styles.stepTwoActionButton}
                        onClick={handleStepTwoOpenAr}
                      >
                        <span className={styles.stepTwoActionIcon} aria-hidden="true">
                          <img
                            src={vrActionIconSrc}
                            alt=""
                            className={`${styles.stepTwoActionIconImage} step-two-action-rail-icon`.trim()}
                          />
                        </span>
                        <span>Ver en AR</span>
                      </button>
                      <span className={styles.stepTwoActionsDivider} aria-hidden="true" />
                      <button
                        type="button"
                        className={styles.stepTwoActionButton}
                        onClick={handleStepTwoOpenTools}
                        aria-expanded={toolsDrawerOpen}
                        aria-controls="editor-tools-drawer"
                      >
                        <span className={styles.stepTwoActionIcon} aria-hidden="true">
                          <img
                            src={toolsActionIconSrc}
                            alt=""
                            className={`${styles.stepTwoActionIconImage} step-two-action-rail-icon`.trim()}
                          />
                        </span>
                        <span>Herramientas</span>
                      </button>
                    </aside>

                    {stepTwoEditorFitMode === 'contain' && (
                      <div className={styles.stepTwoContainColorDock}>
                        <div className={styles.stepTwoContainColorDockMain}>
                          <span className={styles.stepTwoContainColorLabel}>Fondo</span>
                          <div className={styles.stepTwoContainColorTriggerWrap}>
                            <button
                              ref={stepTwoContainColorAnchorRef}
                              type="button"
                              className={styles.stepTwoContainColorTrigger}
                              aria-expanded={stepTwoContainColorOpen}
                              aria-haspopup="dialog"
                              aria-label="Elegir color de fondo"
                              onClick={() => setStepTwoContainColorOpen((open) => !open)}
                            >
                              <span
                                className={styles.stepTwoContainColorSwatch}
                                style={{ backgroundColor: stepTwoContainColorValue }}
                                aria-hidden="true"
                              />
                            </button>
                          </div>
                        </div>
                        <div className={styles.stepTwoContainColorPopoverWrap}>
                          <ColorPopover
                            value={stepTwoContainColorValue}
                            onChange={handleStepTwoContainColorPreview}
                            onChangeComplete={handleStepTwoContainColorCommit}
                            open={stepTwoContainColorOpen}
                            onClose={() => setStepTwoContainColorOpen(false)}
                            anchorRef={stepTwoContainColorAnchorRef}
                            onPickFromCanvas={handleStepTwoContainPickFromCanvas}
                            intrinsicWrapper
                            popoverClassName={styles.stepTwoContainColorPopoverSurface}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className={styles.stepTwoFooterStack}>
                <div className={styles.stepTwoFooter} ref={stepTwoFooterRef}>
                  <div className={styles.stepTwoFooterTopRow}>
                    <div className={styles.stepTwoFooterPriceBlock}>
                      <span className={styles.stepTwoFooterPrice}>$ {formattedPriceAmount}</span>
                      <span className={styles.stepTwoFooterPriceCaption}>Total según configuración</span>
                      <span className={styles.stepTwoFooterSizeMaterialLine}>
                        {stepTwoFooterMobileSizeMaterialLine}
                      </span>
                    </div>

                    <div className={styles.stepTwoFooterMeta}>
                      {stepTwoQualityState && (
                        <span className={stepTwoStatusBadgeClasses}>
                          <span className={styles.stepTwoStatusBadgeIcon} aria-hidden="true">
                            {stepTwoQualityState.icon === 'success' ? (
                              <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                                <path
                                  d="m6.5 12.5 3.2 3.2L17.5 8"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                                <path
                                  d="M12 7.5v5"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                />
                                <circle cx="12" cy="16.5" r="1.1" fill="currentColor" />
                                <path
                                  d="M12 3.8 20 18a1.2 1.2 0 0 1-1.04 1.8H5.04A1.2 1.2 0 0 1 4 18L12 3.8Z"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.75"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </span>
                          <span className={styles.stepTwoStatusText}>{stepTwoQualityState.label}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className={styles.stepTwoFooterPrimary}
                    onClick={handleStepTwoOpenConfig}
                    disabled={isPublishing || isStepReview}
                  >
                    <span className={styles.stepTwoFooterPrimaryLabel}>Elegir tamaño y material</span>
                    <span className={styles.stepTwoFooterPrimaryArrow} aria-hidden="true">→</span>
                  </button>
                </div>

                {moderationNotice && (
                  <div className={styles.stepTwoFeedback}>
                    <p className={styles.infoMessage} role="status">{moderationNotice}</p>
                  </div>
                )}

                {err && err !== ACK_LOW_ERROR_MESSAGE && (
                  <div className={styles.stepTwoFeedback}>
                    <p className={`errorText ${styles.errorMessage}`} role="alert">
                      {err}
                    </p>
                  </div>
                )}
              </div>

              {configOpen && (
                <div
                  className={`${styles.stepTwoDrawerBackdrop} ${styles.stepTwoConfigDrawerBackdrop}`.trim()}
                  onClick={handleStepTwoCloseConfig}
                  role="presentation"
                >
                  <div
                    className={`${styles.stepTwoConfigDrawer} dark`.trim()}
                    id="configuracion-editor"
                    ref={configDropdownRef}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="configuracion-editor-titulo"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className={styles.stepTwoDrawerHeader}>
                      <div className={styles.stepTwoDrawerHeading}>
                        <h2 className={styles.stepTwoDrawerTitle} id="configuracion-editor-titulo">
                          Elegí tamaño y material
                        </h2>
                        <p className={styles.stepTwoDrawerEyebrow}>Paso 2 de 3</p>
                      </div>
                      <button
                        type="button"
                        className={styles.stepTwoDrawerClose}
                        onClick={handleStepTwoCloseConfig}
                        aria-label="Cerrar configuración"
                      >
                        <img
                          src={closeXIconSrc}
                          alt=""
                          className={styles.stepTwoDrawerCloseIcon}
                        />
                      </button>
                    </div>

                    <form className={styles.stepTwoConfigForm} onSubmit={handleConfigDrawerSubmit}>
                      <div className={styles.stepTwoAccordion} ref={configPanelRef}>
                        <section className={styles.stepTwoAccordionSection}>
                          <button
                            type="button"
                            className={styles.stepTwoAccordionTrigger}
                            aria-expanded={openConfigSection === STEP_TWO_DRAWER_SECTIONS.size}
                            onClick={() => toggleConfigSection(STEP_TWO_DRAWER_SECTIONS.size)}
                          >
                            <span className={styles.stepTwoAccordionHeaderContent}>
                              <span className={styles.stepTwoAccordionTitle}>Tamaño</span>
                              {openConfigSection !== STEP_TWO_DRAWER_SECTIONS.size && (
                                <span className={styles.stepTwoAccordionSummary}>{stepTwoSizeSummary}</span>
                              )}
                            </span>
                            <span
                              className={`${styles.stepTwoAccordionChevron} ${openConfigSection === STEP_TWO_DRAWER_SECTIONS.size ? styles.stepTwoAccordionChevronOpen : ''}`.trim()}
                              aria-hidden="true"
                            >
                              <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                                <path
                                  d="M7 10l5 5 5-5"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.75"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </span>
                          </button>

                          {openConfigSection === STEP_TWO_DRAWER_SECTIONS.size && (
                            <div className={styles.stepTwoAccordionContent}>
                              {stepTwoDrawerSizeOptions.map((option) => {
                                const isSelected = selectedStepTwoSizeOptionId === option.id;
                                const isFixedSize = option.id === GLASSPAD_FIXED_SIZE_OPTION_ID;
                                return (
                                  <label
                                    key={option.id}
                                    className={`${styles.stepTwoOptionCard} ${isSelected ? styles.stepTwoOptionCardSelected : ''} ${isFixedSize ? styles.stepTwoOptionCardDisabled : ''}`.trim()}
                                  >
                                    <input
                                      type="radio"
                                      name="step-two-size"
                                      className={styles.stepTwoOptionInput}
                                      checked={isSelected}
                                      disabled={isFixedSize}
                                      onChange={() => handleStepTwoSizeOptionSelect(option.id)}
                                    />
                                    <span className={styles.stepTwoOptionControl} aria-hidden="true" />
                                    <span className={styles.stepTwoOptionBody}>
                                      <span className={styles.stepTwoOptionTitle}>{option.label}</span>
                                      <span className={styles.stepTwoOptionDescription}>{option.measurementLabel}</span>
                                    </span>
                                    <span className={styles.stepTwoOptionPrice}>{option.priceLabel}</span>
                                  </label>
                                );
                              })}

                              {!isFixedPad49x42Material(material) && (
                                <label
                                  className={`${styles.stepTwoOptionCard} ${selectedStepTwoSizeOptionId === STEP_TWO_CUSTOM_SIZE_OPTION.id ? styles.stepTwoOptionCardSelected : ''}`.trim()}
                                >
                                  <input
                                    type="radio"
                                    name="step-two-size"
                                    className={styles.stepTwoOptionInput}
                                    checked={selectedStepTwoSizeOptionId === STEP_TWO_CUSTOM_SIZE_OPTION.id}
                                    onChange={() => handleStepTwoSizeOptionSelect(STEP_TWO_CUSTOM_SIZE_OPTION.id)}
                                  />
                                  <span className={styles.stepTwoOptionControl} aria-hidden="true" />
                                  <span className={styles.stepTwoOptionBody}>
                                    <span className={styles.stepTwoOptionTitleRow}>
                                      <RulerIcon className={styles.stepTwoOptionIcon} />
                                      <span className={styles.stepTwoOptionTitle}>{STEP_TWO_CUSTOM_SIZE_OPTION.label}</span>
                                    </span>
                                    <span className={styles.stepTwoOptionDescription}>{STEP_TWO_CUSTOM_SIZE_OPTION.description}</span>
                                  </span>
                                  <span className={styles.stepTwoOptionPrice} />
                                </label>
                              )}

                              {isFixedPad49x42Material(material) && (
                                <p className={styles.stepTwoAccordionHint}>
                                  {material === 'Ultra'
                                    ? `Ultra usa una medida fija de ${formatSizeLabel(GLASSPAD_SIZE_CM)}.`
                                    : `Glasspad usa una medida fija de ${formatSizeLabel(GLASSPAD_SIZE_CM)}.`}
                                </p>
                              )}
                            </div>
                          )}

                          {openConfigSection === STEP_TWO_DRAWER_SECTIONS.size
                            && showStepTwoCustomSizeInputs && (
                            <div className={styles.stepTwoCustomSizePanel}>
                              <CustomSizeFields
                                compact
                                size={activeSizeCm}
                                limits={customSizeLimits}
                                onChange={handleCustomSizeChange}
                                onEnterCommit={() => setOpenConfigSection(null)}
                              />
                            </div>
                          )}
                        </section>

                        <section className={styles.stepTwoAccordionSection}>
                          <button
                            type="button"
                            className={styles.stepTwoAccordionTrigger}
                            aria-expanded={openConfigSection === STEP_TWO_DRAWER_SECTIONS.material}
                            onClick={() => toggleConfigSection(STEP_TWO_DRAWER_SECTIONS.material)}
                          >
                            <span className={styles.stepTwoAccordionHeaderContent}>
                              <span className={styles.stepTwoAccordionTitle}>Material</span>
                              {openConfigSection !== STEP_TWO_DRAWER_SECTIONS.material && (
                                <span className={styles.stepTwoAccordionSummary}>{stepTwoMaterialSummary}</span>
                              )}
                            </span>
                            <span
                              className={`${styles.stepTwoAccordionChevron} ${openConfigSection === STEP_TWO_DRAWER_SECTIONS.material ? styles.stepTwoAccordionChevronOpen : ''}`.trim()}
                              aria-hidden="true"
                            >
                              <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                                <path
                                  d="M7 10l5 5 5-5"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.75"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </span>
                          </button>

                          {openConfigSection === STEP_TWO_DRAWER_SECTIONS.material && (
                            <div className={styles.stepTwoAccordionContent}>
                              {stepTwoDrawerMaterialOptions.map((option) => {
                                const isSelected = selectedStepTwoMaterialOption?.value === option.value;
                                const isLocked = isMaterialDropdownLocked(option);
                                return (
                                  <label
                                    key={option.value}
                                    className={[
                                      styles.stepTwoOptionCard,
                                      isSelected ? styles.stepTwoOptionCardSelected : '',
                                      isLocked ? styles.stepTwoOptionCardDisabled : '',
                                    ].filter(Boolean).join(' ')}
                                  >
                                    <input
                                      type="radio"
                                      name="step-two-material"
                                      className={styles.stepTwoOptionInput}
                                      checked={isSelected}
                                      disabled={isLocked}
                                      onChange={() => {
                                        if (isLocked) return;
                                        handleStepTwoMaterialSelect(option.value);
                                      }}
                                    />
                                    <span className={styles.stepTwoOptionControl} aria-hidden="true" />
                                    <span className={styles.stepTwoOptionBody}>
                                      <span className={styles.stepTwoOptionTitleRow}>
                                        <span className={styles.stepTwoOptionTitle}>{option.label}</span>
                                        {option.recommended && (
                                          <span className={styles.stepTwoOptionBadge}>Recomendado</span>
                                        )}
                                        {option.comingSoon && (
                                          <span className={styles.stepTwoOptionBadgeSoon}>Próximamente</span>
                                        )}
                                      </span>
                                      <span className={styles.stepTwoOptionDescription}>{option.description}</span>
                                    </span>
                                    <span className={styles.stepTwoOptionPrice}>{option.priceLabel}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </section>

                        <section className={styles.stepTwoAccordionSection}>
                          <button
                            type="button"
                            className={styles.stepTwoAccordionTrigger}
                            aria-expanded={openConfigSection === STEP_TWO_DRAWER_SECTIONS.project}
                            onClick={() => toggleConfigSection(STEP_TWO_DRAWER_SECTIONS.project)}
                          >
                            <span className={styles.stepTwoAccordionHeaderContent}>
                              <span className={styles.stepTwoAccordionTitle}>Nombre del proyecto</span>
                              {openConfigSection !== STEP_TWO_DRAWER_SECTIONS.project && stepTwoProjectSummary ? (
                                <span className={styles.stepTwoAccordionSummary}>{stepTwoProjectSummary}</span>
                              ) : null}
                            </span>
                            <span
                              className={`${styles.stepTwoAccordionChevron} ${openConfigSection === STEP_TWO_DRAWER_SECTIONS.project ? styles.stepTwoAccordionChevronOpen : ''}`.trim()}
                              aria-hidden="true"
                            >
                              <svg viewBox="0 0 24 24" className={styles.stepOneIconSvg}>
                                <path
                                  d="M7 10l5 5 5-5"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.75"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </span>
                          </button>

                          {openConfigSection === STEP_TWO_DRAWER_SECTIONS.project && (
                            <div className={styles.stepTwoAccordionContent}>
                              <div className={styles.stepTwoConfigField}>
                                <label className={styles.stepTwoConfigLabel} htmlFor="design-name">
                                  Nombre del proyecto
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
                                  aria-invalid={resolvedDesignNameError ? 'true' : 'false'}
                                  aria-describedby={resolvedDesignNameError ? 'design-name-help design-name-error' : 'design-name-help'}
                                />
                                <p className={styles.stepTwoConfigHelpText} id="design-name-help">
                                  Este nombre te ayudará a identificar tu pedido
                                </p>
                                {resolvedDesignNameError && (
                                  <p className={styles.errorMessage} id="design-name-error">
                                    {resolvedDesignNameError}
                                  </p>
                                )}
                                {requiresLowAck && (
                                  <div className={styles.stepTwoLowAck}>
                                    <label
                                      className={[
                                        styles.ackLabel,
                                        styles.stepTwoLowAckLabel,
                                        shouldShowAckError ? styles.ackLabelInvalid : '',
                                      ].filter(Boolean).join(' ')}
                                    >
                                      <input
                                        ref={ackCheckboxRef}
                                        type="checkbox"
                                        className={styles.ackCheckbox}
                                        checked={ackLow}
                                        onChange={(event) => {
                                          const nextChecked = event.target.checked;
                                          setAckLow(nextChecked);
                                          if (nextChecked) {
                                            setAckLowError(false);
                                            if (err === ACK_LOW_ERROR_MESSAGE) {
                                              setErr('');
                                            }
                                          }
                                        }}
                                        aria-invalid={shouldShowAckError ? 'true' : 'false'}
                                        aria-describedby={shouldShowAckError ? ackLowErrorDescriptionId : undefined}
                                      />
                                      <span className={styles.ackIndicator} aria-hidden="true" />
                                      <span className={`${styles.ackLabelText} ${shouldShowAckError ? styles.ackLabelTextError : ''}`.trim()}>
                                        Acepto imprimir en baja calidad.
                                      </span>
                                    </label>
                                    {shouldShowAckError && (
                                      <p
                                        id={ackLowErrorDescriptionId}
                                        className={`${styles.stepTwoLowAckHint} ${styles.stepTwoLowAckHintError}`.trim()}
                                      >
                                        {ACK_LOW_ERROR_MESSAGE}
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </section>
                      </div>

                      <div className={styles.stepTwoConfigFooter}>
                        <div className={styles.stepTwoConfigFooterPriceBlock}>
                          <p className={styles.stepTwoConfigFooterLabel}>Total</p>
                          <p className={styles.stepTwoConfigFooterAmount}>$ {formattedPriceAmount}</p>
                        </div>

                        <div className={styles.stepTwoConfigActions}>
                          <button
                            type="submit"
                            className={`${styles.stepTwoPrimaryButton} ${styles.stepTwoConfigSubmitButton}`.trim()}
                            disabled={isPublishing || !canConfirmStepTwoConfig}
                          >
                            Confirmar selección
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {toolsDrawerOpen && (
                <div
                  className={`${styles.stepTwoDrawerBackdrop} ${styles.stepTwoToolsDrawerBackdrop}`.trim()}
                  onClick={handleStepTwoCloseTools}
                  role="presentation"
                >
                  <div
                    className={`${styles.stepTwoToolsDrawer} dark`.trim()}
                    ref={toolsDrawerRef}
                    id="editor-tools-drawer"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="editor-tools-title"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className={styles.stepTwoDrawerHeader}>
                      <div className={styles.stepTwoToolsDrawerHeading}>
                        <span className={styles.stepTwoToolsDrawerHeadingIcon} aria-hidden="true">
                          <img src={toolsActionIconSrc} alt="" draggable="false" />
                        </span>
                        <h2 className={styles.stepTwoDrawerTitle} id="editor-tools-title">
                          Herramientas
                        </h2>
                      </div>
                      <button
                        type="button"
                        className={styles.stepTwoDrawerClose}
                        onClick={handleStepTwoCloseTools}
                        aria-label="Cerrar herramientas"
                      >
                        <img
                          src={closeXIconSrc}
                          alt=""
                          className={styles.stepTwoDrawerCloseIcon}
                        />
                      </button>
                    </div>

                    <div className={styles.stepTwoToolsDrawerScroll}>
                    <div className={styles.stepTwoDrawerSection}>
                      <p className={styles.stepTwoDrawerSectionTitle}>ALINEACIÓN</p>
                      <button type="button" className={styles.stepTwoDrawerAction} onClick={() => handleStepTwoToolAction('centerHorizontal')}>
                        <span className={styles.stepTwoDrawerActionIcon} aria-hidden="true">
                          <img
                            src={STEP_TWO_TOOL_ICON_SOURCES.centerHorizontal}
                            alt=""
                            className={styles.stepTwoDrawerActionIconImage}
                            draggable="false"
                          />
                        </span>
                        <span>Centrar horizontalmente</span>
                      </button>
                      <button type="button" className={styles.stepTwoDrawerAction} onClick={() => handleStepTwoToolAction('centerVertical')}>
                        <span className={styles.stepTwoDrawerActionIcon} aria-hidden="true">
                          <img
                            src={STEP_TWO_TOOL_ICON_SOURCES.centerVertical}
                            alt=""
                            className={styles.stepTwoDrawerActionIconImage}
                            draggable="false"
                          />
                        </span>
                        <span>Centrar verticalmente</span>
                      </button>
                      <button type="button" className={styles.stepTwoDrawerAction} onClick={() => handleStepTwoToolAction('alignLeft')}>
                        <span className={styles.stepTwoDrawerActionIcon} aria-hidden="true">
                          <img
                            src={STEP_TWO_TOOL_ICON_SOURCES.alignLeft}
                            alt=""
                            className={styles.stepTwoDrawerActionIconImage}
                            draggable="false"
                          />
                        </span>
                        <span>Alinear izquierda</span>
                      </button>
                      <button type="button" className={styles.stepTwoDrawerAction} onClick={() => handleStepTwoToolAction('alignRight')}>
                        <span className={styles.stepTwoDrawerActionIcon} aria-hidden="true">
                          <img
                            src={STEP_TWO_TOOL_ICON_SOURCES.alignRight}
                            alt=""
                            className={styles.stepTwoDrawerActionIconImage}
                            draggable="false"
                          />
                        </span>
                        <span>Alinear derecha</span>
                      </button>
                      <button type="button" className={styles.stepTwoDrawerAction} onClick={() => handleStepTwoToolAction('alignTop')}>
                        <span className={styles.stepTwoDrawerActionIcon} aria-hidden="true">
                          <img
                            src={STEP_TWO_TOOL_ICON_SOURCES.alignTop}
                            alt=""
                            className={styles.stepTwoDrawerActionIconImage}
                            draggable="false"
                          />
                        </span>
                        <span>Alinear arriba</span>
                      </button>
                      <button type="button" className={styles.stepTwoDrawerAction} onClick={() => handleStepTwoToolAction('alignBottom')}>
                        <span className={styles.stepTwoDrawerActionIcon} aria-hidden="true">
                          <img
                            src={STEP_TWO_TOOL_ICON_SOURCES.alignBottom}
                            alt=""
                            className={styles.stepTwoDrawerActionIconImage}
                            draggable="false"
                          />
                        </span>
                        <span>Alinear abajo</span>
                      </button>
                    </div>

                    <div className={styles.stepTwoDrawerSection}>
                      <p className={styles.stepTwoDrawerSectionTitle}>TRANSFORMACIÓN</p>
                      <button type="button" className={styles.stepTwoDrawerAction} onClick={() => handleStepTwoToolAction('flipHorizontal')}>
                        <span className={styles.stepTwoDrawerActionIcon} aria-hidden="true">
                          <img
                            src={STEP_TWO_TOOL_ICON_SOURCES.flipHorizontal}
                            alt=""
                            className={styles.stepTwoDrawerActionIconImage}
                            draggable="false"
                          />
                        </span>
                        <span>Espejo horizontal</span>
                      </button>
                      <button type="button" className={styles.stepTwoDrawerAction} onClick={() => handleStepTwoToolAction('flipVertical')}>
                        <span className={styles.stepTwoDrawerActionIcon} aria-hidden="true">
                          <img
                            src={STEP_TWO_TOOL_ICON_SOURCES.flipVertical}
                            alt=""
                            className={styles.stepTwoDrawerActionIconImage}
                            draggable="false"
                          />
                        </span>
                        <span>Espejo vertical</span>
                      </button>
                      <button type="button" className={styles.stepTwoDrawerAction} onClick={() => handleStepTwoToolAction('rotate90')}>
                        <span className={styles.stepTwoDrawerActionIcon} aria-hidden="true">
                          <img
                            src={STEP_TWO_TOOL_ICON_SOURCES.rotate90}
                            alt=""
                            className={styles.stepTwoDrawerActionIconImage}
                            draggable="false"
                          />
                        </span>
                        <span>Rotar 90°</span>
                      </button>
                    </div>
                    <div className={styles.stepTwoDrawerSection}>
                      <p className={styles.stepTwoDrawerSectionTitle}>AJUSTES</p>
                      <button
                        type="button"
                        className={getStepTwoDrawerActionClassName(stepTwoEditorFitMode === 'cover')}
                        onClick={() => handleStepTwoToolAction('cover')}
                        aria-label="Cubrir"
                        title="Cubrir superficie"
                      >
                        <span className={styles.stepTwoDrawerActionIcon} aria-hidden="true">
                          <img
                            src={STEP_TWO_TOOL_ICON_SOURCES.cover}
                            alt=""
                            className={styles.stepTwoDrawerActionIconImage}
                            draggable="false"
                          />
                        </span>
                        <span>Cubrir</span>
                      </button>
                      <button
                        type="button"
                        className={getStepTwoDrawerActionClassName(stepTwoEditorFitMode === 'contain')}
                        onClick={() => handleStepTwoToolAction('contain')}
                        aria-label="Contener"
                        title="Diseño completo"
                      >
                        <span className={styles.stepTwoDrawerActionIcon} aria-hidden="true">
                          <img
                            src={STEP_TWO_TOOL_ICON_SOURCES.contain}
                            alt=""
                            className={styles.stepTwoDrawerActionIconImage}
                            draggable="false"
                          />
                        </span>
                        <span>Contener</span>
                      </button>
                      <button
                        type="button"
                        className={getStepTwoDrawerActionClassName(stepTwoEditorFitMode === 'stretch')}
                        onClick={() => handleStepTwoToolAction('stretch')}
                        aria-label="Estirar"
                        title="Estirar imagen"
                      >
                        <span className={styles.stepTwoDrawerActionIcon} aria-hidden="true">
                          <img
                            src={STEP_TWO_TOOL_ICON_SOURCES.stretch}
                            alt=""
                            className={styles.stepTwoDrawerActionIconImage}
                            draggable="false"
                          />
                        </span>
                        <span>Estirar</span>
                      </button>
                      <button
                        type="button"
                        className={getStepTwoDrawerActionClassName(isCircular)}
                        onClick={handleStepTwoDrawerToggleCircular}
                        disabled={stepTwoCircularToggleDisabled}
                        aria-label={stepTwoCircularToggleLabel}
                        aria-pressed={isCircular}
                        title={stepTwoCircularToggleDisabled ? 'No disponible para medida fija (Glasspad / Ultra)' : stepTwoCircularToggleLabel}
                      >
                        <span className={styles.stepTwoDrawerActionIcon} aria-hidden="true">
                          <img
                            src={stepTwoCircularToggleIcon}
                            alt=""
                            className={styles.stepTwoDrawerActionIconImage}
                            draggable="false"
                          />
                        </span>
                        <span>{stepTwoCircularToggleLabel}</span>
                      </button>
                    </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {busy && (
        <LoadingOverlay
          visible
          steps={[]}
          messages={[STEP_TWO_UPLOAD_MESSAGE]}
          subtitle={STEP_TWO_UPLOAD_SUBTITLE}
        />
      )}
    </div>
  );

}
