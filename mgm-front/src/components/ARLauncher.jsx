import { useEffect, useMemo, useRef, useState } from 'react';
import { isTouchDevice } from '@/lib/device.ts';
import styles from './ARLauncher.module.css';

const MODEL_VIEWER_SCRIPT_ID = 'mgm-model-viewer-script';
const MODEL_SRC = 'https://vxkewodclwozoennpqqv.supabase.co/storage/v1/object/public/preview/models/mousepad.glb';

const parsePositiveNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
};

const detectMobileOrTablet = () => {
  if (typeof window === 'undefined') return false;
  const ua = (window.navigator?.userAgent || '').toLowerCase();
  const mobileRegex = /android|iphone|ipod|ipad|mobile|tablet|silk|kindle|playbook|opera mini|iemobile/;
  const coarsePointer = typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;
  const narrowScreen = typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 1024px)').matches
    : false;
  return mobileRegex.test(ua) || (coarsePointer && narrowScreen) || isTouchDevice();
};

const getDimensionsFromQuery = () => {
  if (typeof window === 'undefined') return { widthCm: null, heightCm: null };
  const params = new URLSearchParams(window.location.search);
  const widthCm = parsePositiveNumber(params.get('widthCm') ?? params.get('w'));
  const heightCm = parsePositiveNumber(params.get('heightCm') ?? params.get('h'));
  return { widthCm, heightCm };
};

function ensureModelViewerScript() {
  if (typeof window === 'undefined' || customElements.get('model-viewer')) return;
  if (document.getElementById(MODEL_VIEWER_SCRIPT_ID)) return;
  const script = document.createElement('script');
  script.id = MODEL_VIEWER_SCRIPT_ID;
  script.type = 'module';
  script.src = 'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js';
  document.head.appendChild(script);
}

export default function ARLauncher({ printFullResDataUrl, widthCm, heightCm }) {
  const modelViewerRef = useRef(null);
  const [isVisibleOnDevice, setIsVisibleOnDevice] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    ensureModelViewerScript();
    setIsVisibleOnDevice(detectMobileOrTablet());
  }, []);

  const resolvedSize = useMemo(() => {
    const fromQuery = getDimensionsFromQuery();
    const resolvedWidthCm = fromQuery.widthCm ?? parsePositiveNumber(widthCm);
    const resolvedHeightCm = fromQuery.heightCm ?? parsePositiveNumber(heightCm);
    return {
      widthCm: resolvedWidthCm,
      heightCm: resolvedHeightCm,
    };
  }, [widthCm, heightCm]);

  const scale = useMemo(() => {
    const widthM = (resolvedSize.widthCm ?? 1) / 100;
    const heightM = (resolvedSize.heightCm ?? 1) / 100;
    return `${widthM} 0.003 ${heightM}`;
  }, [resolvedSize.heightCm, resolvedSize.widthCm]);

  const arModes = 'webxr scene-viewer quick-look';

  useEffect(() => {
    const el = modelViewerRef.current;
    if (!el) return;

    let timeoutId;

    const onLoad = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      setLoadError('');
      setModelLoaded(true);
      console.log('[ar-launcher] model loaded and ready', { src: MODEL_SRC });
    };

    const onError = (err) => {
      if (timeoutId) window.clearTimeout(timeoutId);
      setModelLoaded(false);
      setLoadError('No se pudo cargar el modelo. Verifica tu conexión o el CORS de Supabase');
      console.error('[ar-launcher] model failed to load', err);
    };

    console.log('Intentando descargar de Supabase:', MODEL_SRC);

    if (el.model) {
      setLoadError('');
      setModelLoaded(true);
      return undefined;
    }

    setModelLoaded(false);
    setLoadError('');
    timeoutId = window.setTimeout(() => {
      setModelLoaded(false);
      setLoadError('No se pudo cargar el modelo. Verifica tu conexión o el CORS de Supabase');
      console.error('[ar-launcher] load timeout after 7s', { src: MODEL_SRC });
    }, 7000);

    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
    };
  }, []);

  useEffect(() => {
    const el = modelViewerRef.current;
    if (!el || !modelLoaded || typeof printFullResDataUrl !== 'string' || !printFullResDataUrl.trim()) return;

    const hydrateTexture = async () => {
      try {
        await el.updateComplete;
        const firstMaterial = el.model?.materials?.[0];
        if (!firstMaterial) return;

        const texture = await el.createTexture(printFullResDataUrl.trim());
        const materials = el.model?.materials || [];
        materials.forEach((material) => {
          const pbr = material?.pbrMetallicRoughness;
          const baseTextureSlot = pbr?.baseColorTexture;
          if (baseTextureSlot?.setTexture) {
            baseTextureSlot.setTexture(texture);
          }
        });
      } catch (err) {
        console.error('[ar-launcher] failed to prepare texture', err);
      }
    };

    hydrateTexture();
  }, [modelLoaded, printFullResDataUrl]);

  const launchAr = async () => {
    if (!isVisibleOnDevice || isLaunching || !modelLoaded) return;
    const el = modelViewerRef.current;
    if (!el || typeof el.activateAR !== 'function') return;

    try {
      setIsLaunching(true);
      console.log('[ar-launcher] activateAR() direct call', {
        modelLoaded,
        src: MODEL_SRC,
      });
      await el.activateAR();
    } catch (err) {
      console.error('[ar-launcher] failed to activate AR', err);
    } finally {
      setIsLaunching(false);
    }
  };

  if (!isVisibleOnDevice) return null;

  return (
    <div className={styles.wrapper}>
      <button type="button" className={styles.button} onClick={launchAr} disabled={isLaunching || !modelLoaded || Boolean(loadError)}>
        <span aria-hidden="true" className={styles.icon}>📷</span>
        {modelLoaded ? 'Ver en mi escritorio' : 'Cargando...'}
      </button>
      {loadError ? <p role="alert">{loadError}</p> : null}
      <model-viewer
        ref={modelViewerRef}
        src={MODEL_SRC}
        crossorigin="anonymous"
        ar
        ar-modes={arModes}
        ar-placement="floor"
        camera-controls={false}
        shadow-intensity="0"
        scale={scale}
        style={{ position: 'absolute', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' }}
      />
    </div>
  );
}
