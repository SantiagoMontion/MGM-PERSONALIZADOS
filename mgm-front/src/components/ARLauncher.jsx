import { useEffect, useMemo, useRef, useState } from 'react';
import { isTouchDevice } from '@/lib/device.ts';
import styles from './ARLauncher.module.css';

const MODEL_VIEWER_SCRIPT_ID = 'mgm-model-viewer-script';
const MODEL_SRC = 'https://vxkewodclwozoennpqqv.supabase.co/storage/v1/object/public/preview/models/mousepad.glb';
const LOAD_TIMEOUT_MS = 5000;

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

const createFallbackPlaneGltfBlobUrl = () => {
  const positions = new Float32Array([
    -0.5, 0, -0.5,
    0.5, 0, -0.5,
    0.5, 0, 0.5,
    -0.5, 0, 0.5,
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

  const positionBytes = new Uint8Array(positions.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  const merged = new Uint8Array(positionBytes.byteLength + indexBytes.byteLength);
  merged.set(positionBytes, 0);
  merged.set(indexBytes, positionBytes.byteLength);

  const bufferBase64 = window.btoa(String.fromCharCode(...merged));

  const gltf = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0 },
        indices: 1,
      }],
    }],
    buffers: [{
      byteLength: merged.byteLength,
      uri: `data:application/octet-stream;base64,${bufferBase64}`,
    }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength, target: 34962 },
      {
        buffer: 0,
        byteOffset: positionBytes.byteLength,
        byteLength: indexBytes.byteLength,
        target: 34963,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 4,
        type: 'VEC3',
        min: [-0.5, 0, -0.5],
        max: [0.5, 0, 0.5],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 6,
        type: 'SCALAR',
      },
    ],
  };

  const blob = new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' });
  return URL.createObjectURL(blob);
};

export default function ARLauncher({ printFullResDataUrl, widthCm, heightCm }) {
  const modelViewerRef = useRef(null);
  const fallbackBlobUrlRef = useRef('');
  const triedFallbackRef = useRef(false);

  const [isVisibleOnDevice, setIsVisibleOnDevice] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [activeModelSrc, setActiveModelSrc] = useState(MODEL_SRC);
  const [screenLog, setScreenLog] = useState('');

  useEffect(() => {
    ensureModelViewerScript();
    setIsVisibleOnDevice(detectMobileOrTablet());
  }, []);

  useEffect(() => () => {
    if (fallbackBlobUrlRef.current) {
      URL.revokeObjectURL(fallbackBlobUrlRef.current);
      fallbackBlobUrlRef.current = '';
    }
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

    const setConnectionErrorState = () => {
      setLoadError('No se pudo cargar el modelo. Verifica tu conexión o el CORS de Supabase');
      setScreenLog('Error de conexión con el modelo 3D');
      setModelLoaded(false);
    };

    const swapToFallbackModel = () => {
      if (!fallbackBlobUrlRef.current) {
        fallbackBlobUrlRef.current = createFallbackPlaneGltfBlobUrl();
      }
      triedFallbackRef.current = true;
      setActiveModelSrc(fallbackBlobUrlRef.current);
    };

    const onLoad = () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      setLoadError('');
      setScreenLog('');
      setModelLoaded(true);
      console.log('[ar-launcher] model loaded and ready', { src: activeModelSrc });
    };

    const onFailure = (reason, err) => {
      if (timeoutId) window.clearTimeout(timeoutId);
      setConnectionErrorState();
      if (!triedFallbackRef.current && activeModelSrc === MODEL_SRC) {
        console.error(`[ar-launcher] ${reason}; loading fallback plane`, err);
        swapToFallbackModel();
        return;
      }
      console.error(`[ar-launcher] ${reason}`, err);
    };

    console.log('Intentando descargar de Supabase:', activeModelSrc);

    if (el.model) {
      setLoadError('');
      setScreenLog('');
      setModelLoaded(true);
      return undefined;
    }

    setModelLoaded(false);
    setLoadError('');
    timeoutId = window.setTimeout(() => {
      onFailure(`load timeout after ${LOAD_TIMEOUT_MS / 1000}s`);
    }, LOAD_TIMEOUT_MS);

    const onError = (err) => onFailure('model failed to load', err);

    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
    return () => {
      if (timeoutId) window.clearTimeout(timeoutId);
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
    };
  }, [activeModelSrc]);

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
        src: activeModelSrc,
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
        {modelLoaded ? 'Ver en mi escritorio' : (loadError ? 'Error al cargar' : 'Cargando...')}
      </button>
      {loadError ? <p role="alert">{loadError}</p> : null}
      {screenLog ? <div role="status">{screenLog}</div> : null}
      <model-viewer
        ref={modelViewerRef}
        src={activeModelSrc}
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
