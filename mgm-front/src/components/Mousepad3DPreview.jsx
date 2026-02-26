import { useEffect, useMemo, useRef, useState } from 'react';
import styles from './Mousepad3DPreview.module.css';

const MODEL_VIEWER_SCRIPT_SRC = 'https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js';

const toFinitePositiveNumber = (value, fallback = 1) => {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
};

const supportsDataUrl = (value) => typeof value === 'string' && /^data:image\//i.test(value.trim());

function ensureModelViewerScript() {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.customElements?.get('model-viewer')) return Promise.resolve(true);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-model-viewer="true"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(true), { once: true });
      existing.addEventListener('error', () => reject(new Error('model_viewer_script_load_failed')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.type = 'module';
    script.src = MODEL_VIEWER_SCRIPT_SRC;
    script.async = true;
    script.dataset.modelViewer = 'true';
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error('model_viewer_script_load_failed'));
    document.head.appendChild(script);
  });
}

export default function Mousepad3DPreview({
  printFullResDataUrl,
  widthCm,
  heightCm,
  modelSrc = '/assets/models/mousepad.glb',
  usdzSrc,
}) {
  const modelViewerRef = useRef(null);
  const textureRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [textureStatus, setTextureStatus] = useState('idle');

  const queryDimensions = useMemo(() => {
    if (typeof window === 'undefined') return { widthCm: null, heightCm: null };
    const params = new URLSearchParams(window.location.search);
    const queryWidth = Number(params.get('w'));
    const queryHeight = Number(params.get('h'));
    return {
      widthCm: Number.isFinite(queryWidth) && queryWidth > 0 ? queryWidth : null,
      heightCm: Number.isFinite(queryHeight) && queryHeight > 0 ? queryHeight : null,
    };
  }, []);

  const resolvedWidthCm = toFinitePositiveNumber(queryDimensions.widthCm ?? widthCm, 90);
  const resolvedHeightCm = toFinitePositiveNumber(queryDimensions.heightCm ?? heightCm, 40);

  const modelUrl = useMemo(() => {
    if (typeof window === 'undefined') return modelSrc;
    try {
      return new URL(modelSrc, window.location.origin).toString();
    } catch {
      return modelSrc;
    }
  }, [modelSrc]);

  const scale = useMemo(() => {
    const x = resolvedWidthCm / 100;
    const y = 0.003;
    const z = resolvedHeightCm / 100;
    return `${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`;
  }, [resolvedHeightCm, resolvedWidthCm]);

  useEffect(() => {
    let mounted = true;
    console.log('Cargando modelo desde:', modelUrl);
    ensureModelViewerScript()
      .then(() => {
        if (mounted) setReady(true);
      })
      .catch(() => {
        if (mounted) setTextureStatus('script_error');
      });

    return () => {
      mounted = false;
    };
  }, [modelUrl]);

  useEffect(() => {
    if (!ready) return undefined;
    const modelViewer = modelViewerRef.current;
    const canApplyTexture = supportsDataUrl(printFullResDataUrl);
    if (!modelViewer || !canApplyTexture) return undefined;

    let cancelled = false;

    const applyTexture = async () => {
      setTextureStatus('loading');
      try {
        await modelViewer.updateComplete;
        if (cancelled) return;

        const material = modelViewer.model?.materials?.[0];
        if (!material) {
          setTextureStatus('missing_material');
          return;
        }

        if (textureRef.current) {
          textureRef.current.dispose?.();
          textureRef.current = null;
        }

        const texture = await modelViewer.createTexture(printFullResDataUrl);
        if (cancelled) {
          texture.dispose?.();
          return;
        }

        if (typeof material.pbrMetallicRoughness?.setBaseColorTexture === 'function') {
          material.pbrMetallicRoughness.setBaseColorTexture(texture);
        } else if (material.pbrMetallicRoughness?.baseColorTexture?.setTexture) {
          material.pbrMetallicRoughness.baseColorTexture.setTexture(texture);
        }

        textureRef.current = texture;
        setTextureStatus('ready');
      } catch {
        if (!cancelled) {
          setTextureStatus('texture_error');
        }
      }
    };

    const onLoad = () => {
      applyTexture();
    };

    modelViewer.addEventListener('load', onLoad);
    if (modelViewer.loaded) {
      applyTexture();
    }

    return () => {
      cancelled = true;
      modelViewer.removeEventListener('load', onLoad);
      if (textureRef.current) {
        textureRef.current.dispose?.();
        textureRef.current = null;
      }
    };
  }, [printFullResDataUrl, ready]);

  const showIOSHint = !usdzSrc;

  return (
    <div className={styles.wrapper}>
      <div className={styles.viewerContainer}>
        {ready ? (
          <model-viewer
            ref={modelViewerRef}
            src={modelUrl}
            ios-src={usdzSrc}
            ar
            ar-modes="webxr scene-viewer quick-look"
            ar-placement="floor"
            camera-controls
            touch-action="pan-y"
            shadow-intensity="1"
            scale={scale}
            alt="Vista 3D de tu mousepad personalizado"
            className={styles.modelViewer}
          />
        ) : (
          <div className={styles.loadingState}>Cargando visualizador 3D…</div>
        )}
      </div>

      <p className={styles.caption}>
        Dimensiones AR: {resolvedWidthCm}×{resolvedHeightCm} cm (grosor fijo 0.3 cm).
      </p>
      {textureStatus === 'texture_error' || textureStatus === 'missing_material' ? (
        <p className={styles.warning}>No pudimos aplicar la textura personalizada. Mostramos un modelo base.</p>
      ) : null}
      {showIOSHint ? (
        <p className={styles.warning}>
          En iOS se requiere archivo USDZ para Quick Look. Si no está disponible, se mostrará solo la vista 3D web.
        </p>
      ) : null}
    </div>
  );
}
