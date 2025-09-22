// src/pages/Home.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SeoJsonLd from '../components/SeoJsonLd';

import UploadStep from '../components/UploadStep';
import EditorCanvas from '../components/EditorCanvas';
import SizeControls from '../components/SizeControls';
import Calculadora from '../components/Calculadora';
import LoadingOverlay from '../components/LoadingOverlay';

import { LIMITS, STANDARD, GLASSPAD_SIZE_CM } from '../lib/material.js';

import { dpiLevel } from '../lib/dpi';
import styles from './Home.module.css';
import { renderMockup1080 } from '../lib/mockup.js';
import { quickHateSymbolCheck } from '@/lib/moderation.ts';
import { scanNudityClient } from '@/lib/moderation/nsfw.client.js';
import { useFlow } from '@/state/flow.js';
import { apiFetch } from '@/lib/api.js';

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

  useEffect(() => {
    if (uploaded) {
      setConfigOpen(true);
    } else {
      setConfigOpen(false);
    }
  }, [uploaded]);

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

  const handleClearImage = useCallback(() => {
    setUploaded(null);
    setLayout(null);
    setDesignName('');
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
      <div className={styles.sidebar}>
        {uploaded && (
          <div className={`${styles.configAccordion} ${configOpen ? styles.configAccordionOpen : ''}`}>
            <button
              type="button"
              className={styles.configHeader}
              onClick={() => setConfigOpen(open => !open)}
            >
              <span className={styles.configIcon} aria-hidden="true">⚙️</span>
              <span className={styles.configTitle}>Configura tu mousepad</span>
              <span
                className={`${styles.configArrow} ${configOpen ? styles.configArrowOpen : ''}`}
                aria-hidden="true"
              >
                ▾
              </span>
            </button>
            {configOpen && (
              <div className={styles.configContent}>
                <div className={styles.field}>
                  <input
                    type="text"
                    placeholder="Nombre del modelo"
                    value={designName}
                    onChange={e => setDesignName(e.target.value)}
                  />
                </div>
                <SizeControls
                  material={material}
                  size={size}
                  mode={mode}
                  onChange={handleSizeChange}
                  locked={material === 'Glasspad'}
                />
                <Calculadora
                  width={activeWcm}
                  height={activeHcm}
                  material={material}
                  setPrice={setPriceAmount}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.main}>
        <UploadStep onUploaded={file => { setUploaded(file); setAckLow(false); }} />

        {uploaded && (
          <EditorCanvas
            ref={canvasRef}
            imageUrl={imageUrl}
            imageFile={uploaded?.file}
            sizeCm={activeSizeCm}
            bleedMm={3}
            dpi={300}
            onLayoutChange={setLayout}
            onClearImage={handleClearImage}
          />
        )}

        {uploaded && level === 'bad' && (
          <label className={styles.ackLabel}>
            <input
              type="checkbox"
              checked={ackLow}
              onChange={e => setAckLow(e.target.checked)}
            />{' '}
            Acepto imprimir en baja calidad ({effDpi} DPI)
          </label>
        )}

        {uploaded && (
          <button
            className={styles.continueButton}
            disabled={busy || priceAmount <= 0 || trimmedDesignName.length < 2}
            onClick={handleContinue}
          >
            Continuar
          </button>
        )}

        {err && <p className={`errorText ${styles.error}`}>{err}</p>}
      </div>
      <LoadingOverlay show={busy} messages={["Creando tu pedido…"]} />
    </div>
  );
}
