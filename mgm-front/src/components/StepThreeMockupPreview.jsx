import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import styles from './StepThreeMockupPreview.module.css';

function resolveMaxPreviewHeightPx() {
  if (typeof window === 'undefined') return 420;
  const viewportBased = Math.round(window.innerHeight * 0.46);
  return Math.max(260, Math.min(460, viewportBased));
}

/**
 * Encuentra el rectángulo mínimo que cubre píxeles con alpha > umbral (muestreo para no bloquear).
 */
function scanOpaqueBounds(imageData, width, height, sampleStep) {
  const data = imageData.data;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const thresh = 28;
  for (let y = 0; y < height; y += sampleStep) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += sampleStep) {
      const i = row + x * 4;
      if (data[i + 3] > thresh) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return { minX: 0, minY: 0, cw: width, ch: height };
  }
  const pad = sampleStep + 3;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);
  return {
    minX,
    minY,
    cw: maxX - minX + 1,
    ch: maxY - minY + 1,
  };
}

/**
 * Vista previa paso 3: recorte visual de márgenes transparentes sin upscale (evita pixelado).
 */
export default function StepThreeMockupPreview({
  src,
  alt,
  frameClassName,
  imageKey,
  isCircular = false,
  disableTightCrop = false,
}) {
  const wrapRef = useRef(null);
  const [tight, setTight] = useState(null);
  const [looseFallback, setLooseFallback] = useState(false);
  const [availableW, setAvailableW] = useState(0);
  const [maxPreviewHeightPx, setMaxPreviewHeightPx] = useState(resolveMaxPreviewHeightPx);

  useEffect(() => {
    setTight(null);
    setLooseFallback(false);
    if (!src) return undefined;

    let cancelled = false;
    const img = new Image();
    if (/^https?:\/\//i.test(src)) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      if (cancelled) return;
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      if (!nw || !nh) return;

      if (isCircular || disableTightCrop) {
        setTight({ nw, nh, minX: 0, minY: 0, cw: nw, ch: nh });
        setLooseFallback(true);
        return;
      }

      try {
        const canvas = document.createElement('canvas');
        canvas.width = nw;
        canvas.height = nh;
        const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
        if (!ctx) throw new Error('canvas_context_unavailable');
        ctx.clearRect(0, 0, nw, nh);
        ctx.drawImage(img, 0, 0);
        const step = Math.max(1, Math.floor(Math.max(nw, nh) / 1080));
        const imageData = ctx.getImageData(0, 0, nw, nh);
        const { minX, minY, cw, ch } = scanOpaqueBounds(imageData, nw, nh, step);
        setTight({ nw, nh, minX, minY, cw, ch });
        setLooseFallback(false);
      } catch {
        setTight({ nw, nh, minX: 0, minY: 0, cw: nw, ch: nh });
        setLooseFallback(true);
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setTight(null);
        setLooseFallback(false);
      }
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [disableTightCrop, isCircular, src, imageKey]);

  useLayoutEffect(() => {
    const host = wrapRef.current;
    if (!host) return undefined;
    const container = host.parentElement;
    if (!container) return undefined;
    const ro = new ResizeObserver(() => {
      setAvailableW(container.clientWidth);
    });
    ro.observe(container);
    setAvailableW(container.clientWidth);
    return () => ro.disconnect();
  }, [tight, src]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const updateViewportMetrics = () => {
      setMaxPreviewHeightPx(resolveMaxPreviewHeightPx());
    };
    updateViewportMetrics();
    window.addEventListener('resize', updateViewportMetrics);
    return () => window.removeEventListener('resize', updateViewportMetrics);
  }, []);

  let renderW = availableW;
  if (tight && availableW > 0) {
    const ratio = tight.cw / tight.ch;
    const projectedHeight = availableW / ratio;
    if (projectedHeight > maxPreviewHeightPx) {
      renderW = Math.round(maxPreviewHeightPx * ratio);
    }
  }
  let effectiveW = Math.max(0, Math.min(availableW, renderW));

  const preferLoose = isCircular
    || looseFallback
    || Boolean(tight && effectiveW > 0 && effectiveW > tight.cw * 1.02);
  let useTight = false;
  let scale = 0;

  if (tight && effectiveW > 0 && !preferLoose) {
    scale = effectiveW / tight.cw;
    useTight = scale > 0;
  }
  const maxHeightStyle = { maxHeight: `${maxPreviewHeightPx}px` };
  const tightHostStyle = useTight
    ? {
        ...maxHeightStyle,
        aspectRatio: `${tight.cw} / ${tight.ch}`,
        inlineSize: effectiveW > 0 ? `${effectiveW}px` : '100%',
      }
    : maxHeightStyle;
  const looseImgStyle = !useTight
    ? maxHeightStyle
    : undefined;
  const circularHostClassName = [
    useTight ? styles.cropHostTight : styles.cropHostLoose,
    isCircular ? styles.cropHostCircular : '',
  ]
    .filter(Boolean)
    .join(' ');
  const circularImgClassName = [
    useTight ? styles.imgTight : styles.imgLoose,
    isCircular ? styles.imgCircular : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={frameClassName}>
      <div
        ref={wrapRef}
        className={circularHostClassName}
        style={tightHostStyle}
      >
        {src ? (
          <img
            key={`${imageKey || ''}-${src}-${useTight ? 't' : 'l'}-${isCircular ? 'c' : 'r'}`}
            src={src}
            alt={alt}
            className={circularImgClassName}
            draggable={false}
            style={
              useTight
                ? {
                    position: 'absolute',
                    left: `${-tight.minX * scale}px`,
                    top: `${-tight.minY * scale}px`,
                    width: `${tight.nw * scale}px`,
                    height: `${tight.nh * scale}px`,
                  }
                : looseImgStyle
            }
          />
        ) : null}
      </div>
    </div>
  );
}
