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
import EditorCanvas from '../components/EditorCanvas';
import SizeControls from '../components/SizeControls';
import LoadingOverlay from '../components/LoadingOverlay';

import { LIMITS, STANDARD, GLASSPAD_SIZE_CM } from '../lib/material.js';

import {
  dpiLevel,
  DPI_WARN_THRESHOLD,
  DPI_LOW_THRESHOLD,
} from '../lib/dpi';
import styles from './Home.module.css';
import { renderMockup1080 } from '../lib/mockup.js';
import { quickHateSymbolCheck } from '@/lib/moderation.ts';
import { scanNudityClient } from '@/lib/moderation/nsfw.client.js';
import { useFlow } from '@/state/flow.js';
import { apiFetch } from '@/lib/api.js';
import { resolveIconAsset } from '@/lib/iconRegistry.js';

const CONFIG_ICON_SRC = resolveIconAsset('wheel.svg');
const CONFIG_ARROW_ICON_SRC = resolveIconAsset('down.svg');
const TUTORIAL_ICON_SRC = resolveIconAsset('play.svg');


const CANVAS_MAX_WIDTH = 1280;
const ACK_LOW_ERROR_MESSAGE = 'Confirmá que aceptás imprimir en baja calidad.';
const MODERATION_REASON_MESSAGES = {
  real_nudity: 'Bloqueado por moderación: contenido adulto explícito detectado.',
  extremism_nazi: 'Bloqueado por moderación: contenido extremista nazi detectado.',
  extremism_nazi_text: 'Bloqueado por moderación: texto extremista nazi detectado.',
  invalid_body: 'No se pudo analizar la imagen enviada. Probá de nuevo.',
  server_error: 'Error del servidor de moderación. Intentá nuevamente más tarde.',
  blocked: 'Bloqueado por moderación.',
};

function moderationReasonMessage(reason) {
  if (typeof reason === 'string' && MODERATION_REASON_MESSAGES[reason]) {
    return MODERATION_REASON_MESSAGES[reason];
  }
  if (typeof reason === 'string' && reason) {
    return `Bloqueado por moderación (código: ${reason}).`;
  }
  return 'Bloqueado por moderación.';
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
  const [size, setSize] = useState({ w: 90, h: 40 });
  const sizeCm = useMemo(() => ({ w: Number(size.w) || 90, h: Number(size.h) || 40 }), [size.w, size.h]);
  const isGlasspad = material === 'Glasspad';
  const activeWcm = isGlasspad ? GLASSPAD_SIZE_CM.w : sizeCm.w;
  const activeHcm = isGlasspad ? GLASSPAD_SIZE_CM.h : sizeCm.h;
  const activeSizeCm = useMemo(() => ({ w: activeWcm, h: activeHcm }), [activeWcm, activeHcm]);
  const lastSize = useRef({
    Classic: { w: 90, h: 40 },
    PRO: { w: 90, h: 40 },
  });

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
  const [busy, setBusy] = useState(false);
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

  const handleClearImage = useCallback(() => {
    setUploaded(null);
    setLayout(null);
    setAckLowError(false);
    setDesignName('');
    setDesignNameError('');
    setAckLow(false);
    setErr('');
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
      const prev = lastSize.current[next.material] || size;
      const clamped = {
        w: Math.min(Math.max(prev.w, 1), lim.maxW),
        h: Math.min(Math.max(prev.h, 1), lim.maxH),
      };
      setMaterial(next.material);
      setSize(clamped);
      const isStd = (STANDARD[next.material] || []).some(
        opt => Number(opt.w) === Number(clamped.w) && Number(opt.h) === Number(clamped.h)
      );
      setMode(isStd ? 'standard' : 'custom');
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

  async function handleContinue() {
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
      setBusy(true);
      const master = canvasRef.current.exportPadDataURL?.(2);
      if (!master) {
        setErr('No se pudo generar la imagen');
        setBusy(false);
        return;
      }

      // client-side gate: filename keywords
      const metaForCheck = [uploaded?.file?.name, trimmedDesignName].filter(Boolean).join(' ');
      if (quickHateSymbolCheck(metaForCheck)) {
        setErr('Contenido no permitido (odio nazi detectado)');
        setBusy(false);
        return;
      }

      // client-side gate: NSFW scan in browser (no server TFJS)
      try {
        const res = await scanNudityClient(master);
        if (res?.blocked) {
          let message = 'Contenido adulto detectado.';
          if (res.reason === 'client_real_nudity') {
            message = 'Contenido adulto explícito con personas reales detectado.';
          } else if (res.reason === 'client_real_sexual') {
            message = 'Contenido sexual explícito con personas reales detectado.';
          }
          setErr(message);
          setBusy(false);
          return;
        }
      } catch (scanErr) {
        console.error('[continue] nudity scan failed', scanErr?.message || scanErr);
      }

      const resp = await apiFetch('/api/moderate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: master,
          filename: uploaded?.file?.name || 'image.png',
          designName: trimmedDesignName,
          lowQualityAck: level === 'bad' ? Boolean(ackLow) : false,
          approxDpi: effDpi || undefined,
        })
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        const message = moderationReasonMessage(err?.reason);
        setErr(message);
        setBusy(false);
        return;
      }

      const img = new Image();
      img.src = master;
      await img.decode();
      const blob = await renderMockup1080({
        productType: material === 'Glasspad' ? 'glasspad' : 'mousepad',
        image: img,
        width_cm: activeWcm,
        height_cm: activeHcm,
      });
      const mockupUrl = URL.createObjectURL(blob);

      const transferPrice = Number(priceAmount) > 0 ? Number(priceAmount) : 0;
      const normalPrice = transferPrice;

      flow.set({
        productType: material === 'Glasspad' ? 'glasspad' : 'mousepad',
        editorState: layout,
        mockupBlob: blob,
        mockupUrl,
        printFullResDataUrl: master,
        designName: trimmedDesignName,
        material,
        lowQualityAck: level === 'bad' ? Boolean(ackLow) : false,
        approxDpi: effDpi || null,
        priceTransfer: transferPrice,
        priceNormal: normalPrice,
        priceCurrency: PRICE_CURRENCY,
      });
      navigate('/mockup');
    } catch (e) {
      console.error(e);
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
    styles.textInput,
    styles.inputText,
    designNameError ? styles.textInputError : '',
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
          <div className={styles.configForm}>
            <div className={`${styles.field} ${styles.formRow}`}>
              <label className={styles.fieldLabel} htmlFor="design-name">
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
                <p className={styles.fieldError} id="design-name-error">
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
            <Link target="_blank" rel="noopener" to="/tutorial" className={styles.tutorialButton}>
              <span>Ver tutorial</span>
              <img
                src={TUTORIAL_ICON_SRC}
                alt=""
                className={styles.tutorialButtonIcon}
              />
            </Link>
          </div>

          <div className={editorContainerClasses}>
            <div className={canvasStageClasses} ref={lienzoCardRef}>
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
                      onUploaded={file => {
                        setUploaded(file);
                        setAckLow(false);
                        setAckLowError(false);
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

      <LoadingOverlay show={busy} messages={["Creando tu pedido…"]} />
    </div>
  );

}
