// src/pages/Home.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import SeoJsonLd from '../components/SeoJsonLd';

import UploadStep from '../components/UploadStep';
import EditorCanvas from '../components/EditorCanvas';
import SizeControls from '../components/SizeControls';
import LoadingOverlay from '../components/LoadingOverlay';

import { LIMITS, STANDARD, GLASSPAD_SIZE_CM } from '../lib/material.js';

import { dpiLevel } from '../lib/dpi';
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


const iconStroke = 2;

const CANVAS_MAX_WIDTH = 1280;
const CANVAS_IDEAL_HEIGHT = 760;
const CANVAS_MIN_HEIGHT = 520;


const UndoIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={iconStroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M9 9 5 13l4 4" />
    <path d="M20 13a7 7 0 0 0-7-7H5" />
  </svg>
);

const RedoIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={iconStroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M15 9 19 13l-4 4" />
    <path d="M4 13a7 7 0 0 1 7-7h8" />
  </svg>
);

const TrashIcon = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={iconStroke} strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M4 7h16" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12" />
    <path d="M9 7V4h6v3" />
  </svg>
);

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
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const designNameInputRef = useRef(null);
  const pageRef = useRef(null);
  const headingRef = useRef(null);
  const editorRef = useRef(null);
  const footerRef = useRef(null);
  const [canvasFit, setCanvasFit] = useState({ height: null, maxWidth: null });
  const flow = useFlow();

  const handleClearImage = useCallback(() => {
    setUploaded(null);
    setLayout(null);
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
  const level = useMemo(() => (effDpi ? dpiLevel(effDpi, 300, 100) : null), [effDpi]);
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
    if (level === 'bad' && !ackLow) {
      setErr('Confirmá que aceptás continuar con la calidad baja.');
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
        setErr(`Bloqueado por moderación: ${err.reason || 'desconocido'}`);
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

  const designNameInputClasses = [
    styles.textInput,
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
    const editorEl = editorRef.current;
    if (!pageEl || !editorEl) return;

    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const headerEl = document.querySelector('header');
    const headerHeight = headerEl?.getBoundingClientRect()?.height || 0;

    const pageStyles = window.getComputedStyle(pageEl);
    const parsePx = value => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const paddingTop = parsePx(pageStyles?.paddingTop);
    const paddingBottom = parsePx(pageStyles?.paddingBottom);
    const paddingLeft = parsePx(pageStyles?.paddingLeft);
    const paddingRight = parsePx(pageStyles?.paddingRight);
    const pageGap = parsePx(pageStyles?.rowGap || pageStyles?.gap);

    const availableWidth = viewportWidth - paddingLeft - paddingRight;
    const widthLimit = availableWidth > 0
      ? Math.min(CANVAS_MAX_WIDTH, availableWidth)
      : CANVAS_MAX_WIDTH;

    const isDesktop = viewportWidth >= 960;

    if (!isDesktop) {
      setCanvasFit(prev => (
        prev.height === null && prev.maxWidth === widthLimit
          ? prev
          : { height: null, maxWidth: widthLimit }
      ));
      return;
    }

    const headingHeight = headingRef.current?.getBoundingClientRect()?.height || 0;
    const editorStyles = window.getComputedStyle(editorEl);
    const editorGap = parsePx(editorStyles?.rowGap || editorStyles?.gap);
    const footerHeight = footerRef.current?.getBoundingClientRect()?.height || 0;

    const availableHeight = viewportHeight
      - headerHeight
      - paddingTop
      - paddingBottom
      - pageGap
      - editorGap
      - headingHeight
      - footerHeight;

    let nextHeight = CANVAS_IDEAL_HEIGHT;
    if (availableHeight > 0) {
      nextHeight = Math.min(CANVAS_IDEAL_HEIGHT, availableHeight);
      if (availableHeight >= CANVAS_MIN_HEIGHT) {
        nextHeight = Math.max(nextHeight, CANVAS_MIN_HEIGHT);
      }
    } else {
      nextHeight = CANVAS_MIN_HEIGHT;
    }

    setCanvasFit(prev => (
      prev.height === nextHeight && prev.maxWidth === widthLimit
        ? prev
        : { height: nextHeight, maxWidth: widthLimit }
    ));
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
    const observed = [headingRef.current, footerRef.current].filter(Boolean);
    observed.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [recomputeCanvasFit]);

  const editorMaxWidthStyle = useMemo(() => (
    canvasFit.maxWidth ? { maxWidth: `${canvasFit.maxWidth}px` } : undefined
  ), [canvasFit.maxWidth]);

  const canvasStageStyle = useMemo(() => (
    canvasFit.height ? { height: `${canvasFit.height}px` } : undefined
  ), [canvasFit.height]);

  const configDropdown = (
    <div className={styles.configDropdown}>
      <button
        type="button"
        className={configTriggerClasses}
        onClick={() => setConfigOpen((open) => !open)}
        disabled={!hasImage}
        aria-expanded={configOpen}
        aria-controls="configuracion-editor"
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
        >
          <div className={styles.field}>
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
          <SizeControls
            material={material}
            size={size}
            mode={mode}
            onChange={handleSizeChange}
            locked={material === 'Glasspad'}
            disabled={!hasImage}
          />
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
      <div
        className={styles.pageHeading}
        ref={headingRef}
        style={editorMaxWidthStyle}
      >
        <Link to="/tutorial" className={styles.tutorialButton}>
          <span>Ver tutorial</span>
          <img
            src={TUTORIAL_ICON_SRC}
            alt=""
            className={styles.tutorialButtonIcon}
          />
        </Link>
      </div>

      <section
        className={styles.editor}
        ref={editorRef}
        style={editorMaxWidthStyle}
      >
        <div className={canvasStageClasses} style={canvasStageStyle}>
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
            />
            {!hasImage && (
              <div className={styles.uploadOverlay}>
                <UploadStep
                  className={styles.uploadControl}
                  onUploaded={file => {
                    setUploaded(file);
                    setAckLow(false);
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
        </div>

        <div className={styles.footerRow} ref={footerRef}>
          <div className={styles.feedbackGroup}>
            {hasImage && level === 'bad' && (
              <label className={styles.ackLabel}>
                <input
                  type="checkbox"
                  checked={ackLow}
                  onChange={e => setAckLow(e.target.checked)}
                />{' '}
                <span>Acepto imprimir en baja calidad ({effDpi} DPI)</span>
              </label>
            )}
            {err && <p className={`errorText ${styles.errorMessage}`}>{err}</p>}
          </div>
          {hasImage && (
            <button
              className={styles.continueButton}
              disabled={busy}
              onClick={handleContinue}
            >
              Continuar
            </button>
          )}
        </div>
      </section>

      <LoadingOverlay show={busy} messages={["Creando tu pedido…"]} />
    </div>
  );

}
