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

const detectIphone = () => {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator?.userAgent || '';
  return /iPhone/i.test(ua);
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
  const [isIphone, setIsIphone] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);

  useEffect(() => {
    ensureModelViewerScript();
    setIsVisibleOnDevice(detectMobileOrTablet());
    setIsIphone(detectIphone());
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

  const arModes = useMemo(() => (isIphone
    ? 'quick-look webxr scene-viewer'
    : 'webxr scene-viewer quick-look'), [isIphone]);

  useEffect(() => {
    const el = modelViewerRef.current;
    if (!el || typeof printFullResDataUrl !== 'string' || !printFullResDataUrl.trim()) return;

    const hydrateTexture = async () => {
      try {
        await el.updateComplete;
        if (!el.model) return;
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

    const onLoad = () => {
      setModelLoaded(true);
      hydrateTexture();
    };

    if (el.model) {
      setModelLoaded(true);
      hydrateTexture();
      return undefined;
    }

    el.addEventListener('load', onLoad);
    return () => {
      el.removeEventListener('load', onLoad);
    };
  }, [printFullResDataUrl]);

  const launchAr = async () => {
    if (!isVisibleOnDevice || isLaunching) return;
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
      <button type="button" className={styles.button} onClick={launchAr} disabled={isLaunching}>
        <span aria-hidden="true" className={styles.icon}>📷</span>
        Ver en mi escritorio (AR)
      </button>
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
