// src/pages/Home.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SeoJsonLd from '../components/SeoJsonLd';

import UploadStep from '../components/UploadStep';
import EditorCanvas from '../components/EditorCanvas';
import SizeControls from '../components/SizeControls';
import Calculadora from '../components/Calculadora';
import ColorPopover from '../components/ColorPopover';
import LoadingOverlay from '../components/LoadingOverlay';

import { LIMITS, STANDARD, GLASSPAD_SIZE_CM } from '../lib/material.js';

import { dpiLevel } from '../lib/dpi';
import styles from './Home.module.css';
import { renderMockup1080 } from '../lib/mockup.js';
import { quickHateSymbolCheck } from '@/lib/moderation.ts';
import { scanNudityClient } from '@/lib/moderation/nsfw.client.js';
import { useFlow } from '@/state/flow.js';
import { apiFetch } from '@/lib/api.js';

export const BUTTON_MAP = {
  Cubrir: 'cubrir',
  Contener: 'contener',
  Estirar: 'estirar',
  'Centrar H': 'centrarH',
  'Centrar V': 'centrarV',
  Izq: 'left',
  Der: 'right',
  Arriba: 'top',
  Abajo: 'bottom',
  Rotar: 'rotate',
  'Espejo horizontal': 'mirrorX',
  'Espejo vertical': 'mirrorY',
};

const ACTION_GROUPS = [
  ['Cubrir', 'Contener', 'Estirar'],
  ['Izq', 'Centrar V', 'Der'],
  ['Arriba', 'Centrar H', 'Abajo'],
  ['Rotar'],
  ['Espejo horizontal', 'Espejo vertical'],
];

export default function Home() {

  // archivo subido
  const [uploaded, setUploaded] = useState(null);
  // crear ObjectURL una sola vez
  const [imageUrl, setImageUrl] = useState(null);
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
  const [ackLow, setAckLow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const flow = useFlow();
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [containColor, setContainColor] = useState('#ffffff');

  useEffect(() => {
    if (typeof layout?.background === 'string') {
      setContainColor(layout.background);
    }
  }, [layout?.background]);

  useEffect(() => {
    if (!uploaded) {
      setColorPickerOpen(false);
    }
  }, [uploaded]);

  useEffect(() => {
    if (layout?.mode !== 'contain') {
      setColorPickerOpen(false);
    }
  }, [layout?.mode]);

  const effDpi = useMemo(() => {
    if (!layout) return null;
    return Math.round(
      Math.min(
        layout.dpi / Math.max(1e-6, Math.abs(layout.transform.scaleX)),
        layout.dpi / Math.max(1e-6, Math.abs(layout.transform.scaleY))
      )
    );
  }, [layout]);
  const level = useMemo(() => (effDpi ? dpiLevel(effDpi, 120, 90) : null), [effDpi]);
  const quality = useMemo(() => {
    if (effDpi == null || Number.isNaN(effDpi)) {
      return { tone: 'neutral', label: 'Subí una imagen' };
    }
    const rounded = Math.max(1, Math.round(effDpi));
    if (rounded >= 120) return { tone: 'excellent', label: `Excelente (${rounded} DPI)` };
    if (rounded >= 90) return { tone: 'good', label: `Buena (${rounded} DPI)` };
    return { tone: 'low', label: `Baja (${rounded} DPI)` };
  }, [effDpi]);
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

  const hasUpload = Boolean(uploaded);

  const handleColorChange = useCallback((value) => {
    if (!value) return;
    let hex = value;
    if (typeof hex === 'string' && !hex.startsWith('#')) {
      hex = `#${hex}`;
    }
    setContainColor(hex);
    const api = canvasRef.current;
    api?.setBackgroundColor?.(hex);
  }, []);

  const handlePickFromCanvas = useCallback(() => {
    const api = canvasRef.current;
    if (!api?.startPickColor) return;
    setColorPickerOpen(false);
    api.startPickColor((hex) => {
      if (!hex) return;
      handleColorChange(hex);
    });
  }, [handleColorChange]);

  const handleAction = useCallback(
    (label) => {
      const actionName = BUTTON_MAP[label];
      const api = canvasRef.current;
      if (!actionName || !api || typeof api[actionName] !== 'function' || !hasUpload) {
        return;
      }
      api[actionName]();
      if (actionName === 'contener') {
        const next = api.getBackgroundColor?.();
        if (typeof next === 'string') {
          handleColorChange(next);
        }
        setColorPickerOpen(true);
      } else {
        setColorPickerOpen(false);
      }
    },
    [hasUpload, handleColorChange],
  );

  async function handleContinue() {
    if (!layout || !canvasRef.current) {
      setErr('Falta imagen o layout');
      return;
    }
    if (trimmedDesignName.length < 2) {
      setErr('El nombre del modelo debe tener al menos 2 caracteres.');
      return;
    }
    if (level === 'bad' && !ackLow) {
      setErr('Confirmá que aceptás continuar con la calidad baja.');
      return;
    }
    try {
      setErr('');
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
  const qualityClass =
    styles[`quality${quality.tone.charAt(0).toUpperCase() + quality.tone.slice(1)}`] ||
    styles.qualityNeutral;
  const continueDisabled = busy || priceAmount <= 0 || trimmedDesignName.length < 2;
  return (
    <div className={styles.container}>
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
      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <details className={styles.accordion} open>
            <summary className={styles.accordionTitle}>Personalizar</summary>
            <div className={styles.accordionContent}>
              <label className={styles.fieldLabel}>
                Nombre del modelo
                <input
                  type="text"
                  placeholder="Nombre del modelo"
                  value={designName}
                  onChange={(e) => setDesignName(e.target.value)}
                />
              </label>
              <SizeControls
                material={material}
                size={size}
                mode={mode}
                onChange={handleSizeChange}
                locked={material === 'Glasspad'}
              />
            </div>
          </details>
          <details className={styles.accordion} open>
            <summary className={styles.accordionTitle}>Resumen</summary>
            <div className={styles.accordionContent}>
              <div className={styles.priceBlock}>
                <span className={styles.priceLabel}>Precio estimado</span>
                <Calculadora
                  width={activeWcm}
                  height={activeHcm}
                  material={material}
                  setPrice={setPriceAmount}
                />
              </div>
              <div className={`${styles.qualityBadge} ${qualityClass}`}>
                {quality.label}
              </div>
              {hasUpload && level === 'bad' && (
                <label className={styles.ackField}>
                  <input
                    type="checkbox"
                    checked={ackLow}
                    onChange={(e) => setAckLow(e.target.checked)}
                  />
                  <span>Acepto imprimir en baja calidad ({effDpi ?? '—'} DPI)</span>
                </label>
              )}
              {hasUpload && (
                <button
                  type="button"
                  className={styles.primaryButton}
                  disabled={continueDisabled}
                  onClick={handleContinue}
                >
                  {busy ? 'Procesando…' : 'Continuar'}
                </button>
              )}
              {err && <p className={`errorText ${styles.error}`}>{err}</p>}
            </div>
          </details>
        </aside>

        <section className={styles.main}>
          <div className={styles.canvasCard}>
            <div className={styles.uploadSection}>
              <div className={styles.uploadCopy}>
                <h1 className={styles.headline}>Editor MGM</h1>
                <p className={styles.subhead}>Subí tu arte y ajustalo al lienzo.</p>
              </div>
              <UploadStep onUploaded={(file) => { setUploaded(file); setAckLow(false); }} />
            </div>

            <div className={styles.actionsSection}>
              <h2 className={styles.sectionTitle}>Ajustes del lienzo</h2>
              <div className={styles.actionGroups}>
                {ACTION_GROUPS.map((group) => (
                  <div key={group.join('-')} className={styles.actionRow}>
                    {group.map((label) => {
                      const actionName = BUTTON_MAP[label];
                      const api = canvasRef.current;
                      const hasAction = actionName && api && typeof api[actionName] === 'function';
                      const disabled = !hasAction || !hasUpload;
                      const titleAttr = !actionName || !hasAction
                        ? 'Acción no configurada'
                        : !hasUpload
                          ? 'Subí una imagen para usar esta acción'
                          : undefined;
                      const button = (
                        <button
                          key={label}
                          type="button"
                          aria-label={label}
                          className={styles.actionButton}
                          disabled={disabled}
                          onClick={() => handleAction(label)}
                          title={titleAttr}
                        >
                          {label}
                        </button>
                      );
                      if (label === 'Contener') {
                        return (
                          <div key={label} className={styles.containWrapper}>
                            {button}
                            {colorPickerOpen && hasUpload && (
                              <div className={styles.popoverAnchor}>
                                <ColorPopover
                                  value={containColor}
                                  onChange={handleColorChange}
                                  open={colorPickerOpen}
                                  onClose={() => setColorPickerOpen(false)}
                                  onPickFromCanvas={handlePickFromCanvas}
                                />
                              </div>
                            )}
                          </div>
                        );
                      }
                      return button;
                    })}
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.canvasStage}>
              <EditorCanvas
                ref={canvasRef}
                imageUrl={imageUrl}
                imageFile={uploaded?.file}
                sizeCm={activeSizeCm}
                bleedMm={3}
                dpi={300}
                material={material}
                onLayoutChange={setLayout}
              />
            </div>
          </div>
        </section>
      </div>
      <LoadingOverlay show={busy} messages={['Creando tu pedido…']} />
    </div>
  );
}
