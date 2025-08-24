import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Stage, Layer, Rect, Group, Image as KonvaImage, Transformer } from 'react-konva';
import useImage from 'use-image';
import { HexColorPicker, HexColorInput } from 'react-colorful';

const CM_PER_INCH = 2.54;
const mmToCm = (mm) => mm / 10;

const VIEW_ZOOM_MIN = 0.3;
const VIEW_ZOOM_MAX = 12;
const IMG_ZOOM_MAX  = 50;   // límite cuando mantengo proporción
const STAGE_BG = '#e5e7eb';
const SNAP_LIVE_CM = 2.0;
const RELEASE_CM   = 3.0;

// ---------- Popover de color ----------
function ColorPopover({ value, onChange, open, onClose }) {
  const boxRef = useRef(null);
  const [hex, setHex] = useState(value || '#ffffff');
  const [copied, setCopied] = useState(false);

  useEffect(() => setHex(value || '#ffffff'), [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!boxRef.current) return;
      if (!boxRef.current.contains(e.target)) onClose?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const swatches = [
    '#ffffff','#000000','#f3f4f6','#e5e7eb','#d1d5db',
    '#1f2937','#111827','#ff0000','#ff7f00','#ffb800',
    '#ffe600','#00a859','#00c9a7','#00ccff','#0066ff',
    '#6f42c1','#ff69b4','#8b4513','#808080','#333333'
  ];

  const pickWithEyedropper = async () => {
    try {
      if ('EyeDropper' in window) {
        const eyedropper = new window.EyeDropper();
        const res = await eyedropper.open();
        setHex(res.sRGBHex);
        onChange?.(res.sRGBHex);
      }
    } catch { /* ignore */ }
  };

  const copyHex = async () => {
    try {
      await navigator.clipboard?.writeText(hex);
      setCopied(true);
      setTimeout(() => setCopied(false), 900);
    } catch { /* ignore */ }
  };

  if (!open) return null;

  return (
    <div
      ref={boxRef}
      style={{
        display:'flex', flexDirection:'column', gap:10,
        padding:12, background:'#fff', border:'1px solid #e5e7eb',
        borderRadius:12, boxShadow:'0 8px 24px rgba(0,0,0,0.12)', width:260
      }}
    >
      <HexColorPicker
        color={hex}
        onChange={(c)=>{ setHex(c); onChange?.(c); }}
        style={{ width:'100%', borderRadius:12 }}
      />
      <div style={{ display:'grid', gridTemplateColumns:'repeat(10, 18px)', gap:6 }}>
        {swatches.map((c)=>(
          <button
            key={c}
            title={c}
            onClick={()=>{ setHex(c); onChange?.(c); }}
            style={{
              width:18, height:18, borderRadius:6,
              border: c==='#ffffff' ? '1px solid #e5e7eb' : 'none',
              background:c, cursor:'pointer'
            }}
          />
        ))}
      </div>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
        <div style={{ width:18, height:18, borderRadius:6, border:'1px solid #e5e7eb', background:hex }} />
        <HexColorInput
          color={hex}
          onChange={(c)=>{ const v = c.startsWith('#') ? c : `#${c}`; setHex(v); onChange?.(v); }}
          prefixed
          style={{
            flex:1, padding:'6px 8px', border:'1px solid #e5e7eb',
            borderRadius:10, fontFamily:'ui-monospace, SFMono-Regular, Menlo, monospace'
          }}
        />
        <button title="Cuentagotas" onClick={pickWithEyedropper}
          style={{ border:'1px solid #e5e7eb', background:'#fff', color:'#111827', padding:'6px 10px', borderRadius:10, cursor:'pointer' }}>🧪</button>
        <button title="Copiar" onClick={copyHex}
          style={{ border:'1px solid #111827', background:'#111827', color:'#fff', padding:'6px 10px', borderRadius:10, cursor:'pointer' }}>{copied ? '✓' : 'Copiar'}</button>
      </div>
    </div>
  );
}

// ---------- Editor ----------
export default function EditorCanvas({
  imageUrl,
  sizeCm = { w: 90, h: 40 }, // tamaño final SIN sangrado (cm)
  bleedMm = 3,
  dpi = 300,
  onLayoutChange,
}) {
  const wCm = Number(sizeCm?.w ?? 90);
  const hCm = Number(sizeCm?.h ?? 40);
  const bleedCm = mmToCm(bleedMm);
  const cornerRadiusCm = 1.5;
  const workCm = useMemo(() => ({ w: wCm + 2*bleedCm, h: hCm + 2*bleedCm }), [wCm, hCm, bleedCm]);

  // viewport
  const wrapRef = useRef(null);
  const [wrapSize, setWrapSize] = useState({ w: 960, h: 540 });
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      const next = { w: r.width, h: Math.max(360, r.height) };
      setWrapSize((prev) => (prev.w !== next.w || prev.h !== next.h ? next : prev));
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  const baseScale = useMemo(() => {
    const s = Math.min(wrapSize.w / workCm.w, wrapSize.h / workCm.h);
    return s * 0.95;
  }, [wrapSize.w, wrapSize.h, workCm.w, workCm.h]);
  const [viewScale, setViewScale] = useState(1);
  const [viewPos, setViewPos] = useState(() => {
    const W = workCm.w * baseScale;
    const H = workCm.h * baseScale;
    return { x: (wrapSize.w - W) / 2, y: (wrapSize.h - H) / 2 };
  });

  // pan
  const isPanningRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });

  const pointerWorld = (stage) => {
    const pt = stage.getPointerPosition();
    const k = baseScale * viewScale;
    return { x: (pt.x - viewPos.x) / k, y: (pt.y - viewPos.y) / k };
  };
  const isOutsideWorkArea = (wp) => wp.x < 0 || wp.y < 0 || wp.x > workCm.w || wp.y > workCm.h;

  // selección
  const imgRef = useRef(null);
  const trRef  = useRef(null);
  const [showTransformer, setShowTransformer] = useState(true);

  const isTargetOnImageOrTransformer = (target) => {
    if (!target) return false;
    if (imgRef.current && target === imgRef.current) return true;
    let node = target;
    while (node) {
      if (node === trRef.current) return true;
      node = node.getParent && node.getParent();
    }
    return false;
  };

  const onStageMouseDown = (e) => {
    const stage = e.target.getStage();
    const wp = pointerWorld(stage);
    const onImg = isTargetOnImageOrTransformer(e.target);

    if (!onImg) {
      isPanningRef.current = true;
      lastPointerRef.current = { x: e.evt.clientX, y: e.evt.clientY };
      if (isOutsideWorkArea(wp)) {
        setShowTransformer(false);
        if (trRef.current) {
          trRef.current.nodes([]);
          trRef.current.getLayer()?.batchDraw();
        }
      }
    } else {
      isPanningRef.current = false;
      setShowTransformer(true);
      if (trRef.current && imgRef.current) {
        trRef.current.nodes([imgRef.current]);
        trRef.current.getLayer()?.batchDraw();
      }
    }
  };
  const onStageMouseMove = (e) => {
    if (!isPanningRef.current) return;
    const { clientX, clientY } = e.evt;
    const dx = clientX - lastPointerRef.current.x;
    const dy = clientY - lastPointerRef.current.y;
    lastPointerRef.current = { x: clientX, y: clientY };
    setViewPos((p) => ({ x: p.x + dx, y: p.y + dy }));
  };
  const endPan = () => { isPanningRef.current = false; };

  const onStageWheel = (e) => {
    e.evt.preventDefault();
    const { shiftKey, deltaY } = e.evt;
    if (shiftKey) {
      const step = (deltaY / 2) | 0;
      setViewPos((p) => ({ ...p, x: p.x - step }));
      return;
    }
    const stage = e.target.getStage();
    const pt = stage.getPointerPosition();
    const scaleBy = 1.08;
    const old = viewScale;
    const next = deltaY > 0 ? old / scaleBy : old * scaleBy;
    const clamped = Math.max(VIEW_ZOOM_MIN, Math.min(next, VIEW_ZOOM_MAX));
    const worldX = (pt.x - viewPos.x) / (baseScale * old);
    const worldY = (pt.y - viewPos.y) / (baseScale * old);
    setViewScale(clamped);
    setViewPos({
      x: pt.x - worldX * (baseScale * clamped),
      y: pt.y - worldY * (baseScale * clamped),
    });
  };

  // imagen
  const [imgEl, imgStatus] = useImage(imageUrl || undefined);
  const imgBaseCm = useMemo(() => {
    if (!imgEl) return null;
    return {
      w: (imgEl.naturalWidth  / dpi) * CM_PER_INCH,
      h: (imgEl.naturalHeight / dpi) * CM_PER_INCH
    };
  }, [imgEl, dpi]);

  const [imgTx, setImgTx] = useState({ x_cm: 0, y_cm: 0, scaleX: 1, scaleY: 1, rotation_deg: 0 });
  const historyRef = useRef([]); // pila de estados para undo
  const [histIndex, setHistIndex] = useState(-1);
  const pushHistory = useCallback((tx) => {
    historyRef.current = historyRef.current.slice(0, histIndex + 1);
    historyRef.current.push(tx);
    setHistIndex(historyRef.current.length - 1);
  }, [histIndex]);
  const undo = useCallback(() => {
    setHistIndex((idx) => {
      if (idx <= 0) return idx;
      const nextIdx = idx - 1;
      const prev = historyRef.current[nextIdx];
      if (prev) setImgTx(prev);
      return nextIdx;
    });
  }, []);

  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo]);

  const moveBy = useCallback((dx, dy) => {
    pushHistory(imgTx);
    setImgTx((tx) => ({ ...tx, x_cm: tx.x_cm + dx, y_cm: tx.y_cm + dy }));
  }, [imgTx]);

  useEffect(() => {
    const handler = (e) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const step = e.shiftKey ? 1 : 0.5;
      if (e.key === 'ArrowUp') moveBy(0, -step);
      if (e.key === 'ArrowDown') moveBy(0, step);
      if (e.key === 'ArrowLeft') moveBy(-step, 0);
      if (e.key === 'ArrowRight') moveBy(step, 0);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [moveBy]);
  const [freeScale, setFreeScale] = useState(false); // ⟵ NUEVO: “Estirar sin límites”
  const keepRatio = !freeScale;
  const [mode, setMode] = useState('cover'); // 'cover' | 'contain' | 'stretch'
  const [bgColor, setBgColor] = useState('#ffffff');

  // cover inicial 1 sola vez
  const didInitRef = useRef(false);
  useEffect(() => {
    if (!imgBaseCm || didInitRef.current) return;
    const s = Math.max(workCm.w / imgBaseCm.w, workCm.h / imgBaseCm.h);
    const w = imgBaseCm.w * s, h = imgBaseCm.h * s;
    const initial = { x_cm: (workCm.w - w)/2, y_cm: (workCm.h - h)/2, scaleX: s, scaleY: s, rotation_deg: 0 };
    setImgTx(initial);
    pushHistory(initial);
    setMode('cover');
    didInitRef.current = true;
  }, [imgBaseCm, workCm.w, workCm.h]);

  // medidas visuales (para offset centro)
  const dispW = imgBaseCm ? imgBaseCm.w * imgTx.scaleX : 0;
  const dispH = imgBaseCm ? imgBaseCm.h * imgTx.scaleY : 0;

  const theta = (imgTx.rotation_deg * Math.PI) / 180;
  const rotAABBHalf = (w, h, ang) => ({
    halfW: (Math.abs(w * Math.cos(ang)) + Math.abs(h * Math.sin(ang))) / 2,
    halfH: (Math.abs(w * Math.sin(ang)) + Math.abs(h * Math.cos(ang))) / 2,
  });

  // imán fuerte (centro + AABB rotado)
  const stickRef = useRef({ x: null, y: null, activeX: false, activeY: false });
  const onImgDragStart = () => {
    stickRef.current = { x: null, y: null, activeX: false, activeY: false };
    pushHistory(imgTx);
  };
  const dragBoundFunc = useCallback((pos) => {
    if (!imgBaseCm) return pos;

    let cx = pos.x;
    let cy = pos.y;

    const w = imgBaseCm.w * imgTx.scaleX;
    const h = imgBaseCm.h * imgTx.scaleY;
    const { halfW, halfH } = rotAABBHalf(w, h, theta);

    const dL = Math.abs((cx - halfW) - 0);
    const dR = Math.abs((workCm.w - (cx + halfW)));
    const dT = Math.abs((cy - halfH) - 0);
    const dB = Math.abs((workCm.h - (cy + halfH)));

    const ease = (d) => {
      if (d >= SNAP_LIVE_CM) return 0;
      const t = 1 - d / SNAP_LIVE_CM;
      return t * t * t;
    };

    // X
    if (!stickRef.current.activeX) {
      const eL = ease(dL);
      const eR = ease(dR);
      if (eL > 0 && eL >= eR) {
        const target = halfW;
        cx = cx * (1 - eL) + target * eL;
        if (dL < 0.3) { cx = target; stickRef.current = { ...stickRef.current, activeX: true, x: target }; }
      } else if (eR > 0) {
        const target = workCm.w - halfW;
        cx = cx * (1 - eR) + target * eR;
        if (dR < 0.3) { cx = target; stickRef.current = { ...stickRef.current, activeX: true, x: target }; }
      }
    } else {
      if (Math.abs(cx - stickRef.current.x) > RELEASE_CM) {
        stickRef.current = { ...stickRef.current, activeX: false, x: null };
      } else {
        cx = stickRef.current.x;
      }
    }

    // Y
    if (!stickRef.current.activeY) {
      const eT = ease(dT);
      const eB = ease(dB);
      if (eT > 0 && eT >= eB) {
        const target = halfH;
        cy = cy * (1 - eT) + target * eT;
        if (dT < 0.3) { cy = target; stickRef.current = { ...stickRef.current, activeY: true, y: target }; }
      } else if (eB > 0) {
        const target = workCm.h - halfH;
        cy = cy * (1 - eB) + target * eB;
        if (dB < 0.3) { cy = target; stickRef.current = { ...stickRef.current, activeY: true, y: target }; }
      }
    } else {
      if (Math.abs(cy - stickRef.current.y) > RELEASE_CM) {
        stickRef.current = { ...stickRef.current, activeY: false, y: null };
      } else {
        cy = stickRef.current.y;
      }
    }

    return { x: cx, y: cy };
  }, [imgBaseCm, imgTx.scaleX, imgTx.scaleY, theta, workCm.w, workCm.h]);

  const onImgMouseDown = () => {
    isPanningRef.current = false;
    setShowTransformer(true);
    if (trRef.current && imgRef.current) {
      trRef.current.nodes([imgRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  };
  const onImgDragMove = (e) => {
    isPanningRef.current = false;
    const n = e.target;
    setImgTx((prev) => {
      const w = imgBaseCm.w * prev.scaleX;
      const h = imgBaseCm.h * prev.scaleY;
      return { ...prev, x_cm: n.x() - w / 2, y_cm: n.y() - h / 2 };
    });
  };
  const onImgDragEnd = () => {
    stickRef.current = { x: null, y: null, activeX: false, activeY: false };
  };

  // transformer
  useEffect(() => {
    if (!trRef.current) return;
    if (showTransformer && imgRef.current) trRef.current.nodes([imgRef.current]);
    else trRef.current.nodes([]);
    trRef.current.getLayer()?.batchDraw();
  }, [imgEl, keepRatio, showTransformer]);

  // fin de resize por esquinas
  const onTransformEnd = () => {
    if (!imgRef.current || !imgBaseCm) return;
    pushHistory(imgTx);
    const n = imgRef.current;
    const sx = n.scaleX();
    const sy = n.scaleY();
    setImgTx((prev) => {
      // libre => sin límites superiores
      if (!keepRatio) {
        const newSX = Math.max(prev.scaleX * sx, 0.01);
        const newSY = Math.max(prev.scaleY * sy, 0.01);
        const w = imgBaseCm.w * newSX;
        const h = imgBaseCm.h * newSY;
        return { x_cm: n.x() - w/2, y_cm: n.y() - h/2, scaleX: newSX, scaleY: newSY, rotation_deg: n.rotation() };
      }
      // mantener proporción con clamp razonable
      const uni = Math.min(prev.scaleX * sx, IMG_ZOOM_MAX);
      const w = imgBaseCm.w * uni;
      const h = imgBaseCm.h * uni;
      return { x_cm: n.x() - w/2, y_cm: n.y() - h/2, scaleX: uni, scaleY: uni, rotation_deg: n.rotation() };
    });
    n.scaleX(1); n.scaleY(1);
  };

  // centro actual
  const currentCenter = () => {
    const w = imgBaseCm.w * imgTx.scaleX;
    const h = imgBaseCm.h * imgTx.scaleY;
    return { cx: imgTx.x_cm + w/2, cy: imgTx.y_cm + h/2 };
  };

  // cover/contain/estirar con rotación
  const fitCover = useCallback(() => {
    if (!imgBaseCm) return;
    const { cx, cy } = currentCenter();
    const w = imgBaseCm.w, h = imgBaseCm.h;
    const c = Math.abs(Math.cos(theta));
    const s = Math.abs(Math.sin(theta));
    const denomW = w * c + h * s;
    const denomH = w * s + h * c;
    const sCover = Math.max(workCm.w / denomW, workCm.h / denomH);
    const newW = w * sCover, newH = h * sCover;
    pushHistory(imgTx);
    setImgTx((prev) => ({
      x_cm: cx - newW/2, y_cm: cy - newH/2,
      scaleX: sCover, scaleY: sCover,
      rotation_deg: prev.rotation_deg,
    }));
    setMode('cover');
  }, [imgBaseCm?.w, imgBaseCm?.h, workCm.w, workCm.h, theta, imgTx.x_cm, imgTx.y_cm, imgTx.scaleX, imgTx.scaleY]);

  const fitContain = useCallback(() => {
    if (!imgBaseCm) return;
    const { cx, cy } = currentCenter();
    const w = imgBaseCm.w, h = imgBaseCm.h;
    const c = Math.abs(Math.cos(theta));
    const s = Math.abs(Math.sin(theta));
    const denomW = w * c + h * s;
    const denomH = w * s + h * c;
    const sContain = Math.min(workCm.w / denomW, workCm.h / denomH);
    const newW = w * sContain, newH = h * sContain;
    pushHistory(imgTx);
    setImgTx((prev) => ({
      x_cm: cx - newW/2, y_cm: cy - newH/2,
      scaleX: sContain, scaleY: sContain,
      rotation_deg: prev.rotation_deg,
    }));
    setMode('contain');
  }, [imgBaseCm?.w, imgBaseCm?.h, workCm.w, workCm.h, theta, imgTx.x_cm, imgTx.y_cm, imgTx.scaleX, imgTx.scaleY]);

  // estirar centrado (respeta rotación)
  const fitStretchCentered = useCallback(() => {
    if (!imgBaseCm) return;
    const { cx, cy } = currentCenter();
    const w = imgBaseCm.w, h = imgBaseCm.h;
    const c = Math.abs(Math.cos(theta));
    const s = Math.abs(Math.sin(theta));

    const A11 = w * c, A12 = h * s;
    const A21 = w * s, A22 = h * c;
    const det = A11 * A22 - A12 * A21;

    let sx = 1, sy = 1;
    if (Math.abs(det) > 1e-6) {
      sx = ( (workCm.w * A22) - (A12 * workCm.h) ) / det;
      sy = ( (-A21 * workCm.w) + (A11 * workCm.h) ) / det;
    } else {
      const denomW = w * c + h * s;
      const denomH = w * s + h * c;
      const sCover = Math.max(workCm.w / denomW, workCm.h / denomH);
      sx = sy = sCover;
    }

    sx = Math.max(sx, 0.02);
    sy = Math.max(sy, 0.02);

    const newW = w * sx, newH = h * sy;
    pushHistory(imgTx);
    setImgTx((prev) => ({
      x_cm: cx - newW/2, y_cm: cy - newH/2,
      scaleX: sx, scaleY: sy,
      rotation_deg: prev.rotation_deg,
    }));
    setMode('stretch');
  }, [imgBaseCm?.w, imgBaseCm?.h, workCm.w, workCm.h, theta, imgTx.x_cm, imgTx.y_cm, imgTx.scaleX, imgTx.scaleY]);

  // estirar libre (ignora rotación para el cálculo)
  // eslint-disable-next-line no-unused-vars
  const fitStretchFree = useCallback(() => {
    if (!imgBaseCm) return;
    const { cx, cy } = currentCenter();
    const sx = workCm.w / imgBaseCm.w;
    const sy = workCm.h / imgBaseCm.h;
    const newW = imgBaseCm.w * sx, newH = imgBaseCm.h * sy;
    pushHistory(imgTx);
    setImgTx((prev) => ({
      x_cm: cx - newW/2, y_cm: cy - newH/2,
      scaleX: sx, scaleY: sy,
      rotation_deg: prev.rotation_deg,
    }));
    setMode('stretch');
  }, [imgBaseCm?.w, imgBaseCm?.h, workCm.w, workCm.h, imgTx.x_cm, imgTx.y_cm, imgTx.scaleX, imgTx.scaleY]);

  const centerHoriz = useCallback(() => {
    if (!imgBaseCm) return;
    const w = imgBaseCm.w * imgTx.scaleX;
    pushHistory(imgTx);
    setImgTx((tx) => ({ ...tx, x_cm: (workCm.w - w) / 2 }));
  }, [imgBaseCm?.w, workCm.w, imgTx.scaleX]);

  const centerVert = useCallback(() => {
    if (!imgBaseCm) return;
    const h = imgBaseCm.h * imgTx.scaleY;
    pushHistory(imgTx);
    setImgTx((tx) => ({ ...tx, y_cm: (workCm.h - h) / 2 }));
  }, [imgBaseCm?.h, workCm.h, imgTx.scaleY]);

  const alignEdge = (edge) => {
    if (!imgBaseCm) return;
    const w = imgBaseCm.w * imgTx.scaleX;
    const h = imgBaseCm.h * imgTx.scaleY;
    const { halfW, halfH } = rotAABBHalf(w, h, theta);

    let cx = imgTx.x_cm + w/2;
    let cy = imgTx.y_cm + h/2;

    if (edge === 'left')   cx = halfW;
    if (edge === 'right')  cx = workCm.w - halfW;
    if (edge === 'top')    cy = halfH;
    if (edge === 'bottom') cy = workCm.h - halfH;

    pushHistory(imgTx);
    setImgTx((tx) => ({
      ...tx,
      x_cm: cx - (imgBaseCm.w * tx.scaleX)/2,
      y_cm: cy - (imgBaseCm.h * tx.scaleY)/2,
    }));
  };
  
  const rotate = (deg) => {
    pushHistory(imgTx);
    setImgTx((tx) => ({ ...tx, rotation_deg: (tx.rotation_deg + deg) % 360 }));
  };


  // calidad
  const dpiEffective = useMemo(() => {
    if (!imgEl || !imgBaseCm) return null;
    const printedWcm = imgBaseCm.w * imgTx.scaleX;
    const printedHcm = imgBaseCm.h * imgTx.scaleY;
    if (printedWcm <= 0 || printedHcm <= 0) return null;
    const printedWin = printedWcm / CM_PER_INCH;
    const printedHin = printedHcm / CM_PER_INCH;
    const dpiX = imgEl.naturalWidth  / printedWin;
    const dpiY = imgEl.naturalHeight / printedHin;
    return Math.max(1, Math.min(1000, Math.min(dpiX, dpiY)));
  }, [imgEl, imgBaseCm, imgTx.scaleX, imgTx.scaleY]);

  const quality = useMemo(() => {
    if (dpiEffective == null) return { label:'—', color:'#9ca3af' };
    if (dpiEffective < 80)    return { label:`Baja (${dpiEffective|0} DPI)`,  color:'#ef4444' };
    if (dpiEffective < 200)   return { label:`Buena (${dpiEffective|0} DPI)`, color:'#f59e0b' };
    return { label:`Excelente (${Math.min(300, dpiEffective|0)} DPI)`, color:'#10b981' };
  }, [dpiEffective]);

  // popover color
  const [colorOpen, setColorOpen] = useState(false);
  const toggleContain = () => { fitContain(); setColorOpen(true); };
  const closeColor = () => setColorOpen(false);

  // export layout
  useEffect(() => {
    onLayoutChange?.({
      dpi,
      bleed_mm: bleedMm,
      size_cm: { w: wCm, h: hCm },
      image: imgEl ? { natural_px: { w: imgEl.naturalWidth, h: imgEl.naturalHeight } } : null,
      transform: { x_cm: imgTx.x_cm, y_cm: imgTx.y_cm, scaleX: imgTx.scaleX, scaleY: imgTx.scaleY, rotation_deg: imgTx.rotation_deg },
      mode,
      background: mode === 'contain' ? bgColor : '#ffffff',
      corner_radius_cm: cornerRadiusCm
    });
  }, [onLayoutChange, dpi, bleedMm, wCm, hCm, imgEl, imgTx, mode, bgColor, cornerRadiusCm]);

  return (
    <div>
      {/* Toolbar */}
      <div style={{display:'flex', gap:8, alignItems:'center', marginBottom:8, flexWrap:'wrap'}}>
        <button onClick={fitCover} disabled={!imgEl}>Cubrir</button>

        <div style={{position:'relative', display:'inline-flex', gap:8, alignItems:'center'}}>
          <button onClick={toggleContain} disabled={!imgEl}>Contener</button>
          {mode === 'contain' && imgEl && (
            <div style={{ position:'absolute', zIndex:20, top:'100%', left:0, marginTop:8 }}>
              <ColorPopover value={bgColor} onChange={setBgColor} open={colorOpen} onClose={closeColor} />
            </div>
          )}
        </div>

        <button onClick={fitStretchCentered} disabled={!imgEl}>Estirar</button>


        <button onClick={centerHoriz} disabled={!imgEl}>Centrar H</button>
        <button onClick={centerVert} disabled={!imgEl}>Centrar V</button>
        <button onClick={() => alignEdge('left')} disabled={!imgEl}>Izq</button>
        <button onClick={() => alignEdge('right')} disabled={!imgEl}>Der</button>
        <button onClick={() => alignEdge('top')} disabled={!imgEl}>Arriba</button>
        <button onClick={() => alignEdge('bottom')} disabled={!imgEl}>Abajo</button>
        <button onClick={() => rotate(-90)} disabled={!imgEl}>⟲ -90°</button>
        <button onClick={() => rotate(90)} disabled={!imgEl}>⟳ +90°</button>


        {/* ⟵ NUEVO: checkbox para estirar sin límites desde las esquinas */}
        <label style={{marginLeft:'auto', display:'inline-flex', alignItems:'center', gap:6}}>
          <input type="checkbox" checked={freeScale} onChange={(e)=>setFreeScale(e.target.checked)} disabled={!imgEl} />
          Escalar libre
        </label>

        <span style={{
          padding:'6px 10px', borderRadius:999,
          background: `${quality.color}22`, color: quality.color, border: `1px solid ${quality.color}`
        }}>
          Calidad: {quality.label}
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={wrapRef}
        style={{
          width:'100%', height:'70vh',
          border:'1px solid #ddd', borderRadius:8, overflow:'hidden',
          cursor: isPanningRef.current ? 'grabbing' : 'default',
          background:'#f3f4f6', // ⟵ Fondo del wrapper para eliminar “cuadrito blanco”
          position:'relative'
        }}
      >
        <button
          onClick={undo}
          disabled={histIndex <= 0}
          style={{
            position:'absolute', top:8, left:8, zIndex:20,
            padding:'4px 8px', borderRadius:6,
            border:'1px solid #d1d5db', background:'#fff',
            cursor: histIndex > 0 ? 'pointer' : 'not-allowed'
          }}
        >↺</button>
        <Stage
          width={wrapSize.w}
          height={wrapSize.h}
          scaleX={baseScale * viewScale}
          scaleY={baseScale * viewScale}
          x={viewPos.x}
          y={viewPos.y}
          draggable={false}
          onWheel={onStageWheel}
          onMouseDown={onStageMouseDown}
          onMouseMove={onStageMouseMove}
          onMouseUp={endPan}
          onMouseLeave={endPan}
        >
          <Layer>
            {/* fondo global del stage */}
            <Rect x={-2000} y={-2000} width={4000} height={4000} fill={STAGE_BG} />

            {/* Mesa de trabajo (gris) con borde redondeado SIEMPRE */}
            <Rect
              x={0} y={0}
              width={workCm.w} height={workCm.h}
              fill="#f3f4f6"
              cornerRadius={cornerRadiusCm + bleedCm}
              listening={false}
            />

            {/* Si 'contain': pintamos el color de fondo SIEMPRE debajo del arte (también al deseleccionar) */}
            {mode === 'contain' && (
              <Rect
                x={0} y={0}
                width={workCm.w} height={workCm.h}
                fill={bgColor}
                cornerRadius={cornerRadiusCm + bleedCm}
                listening={false}
              />
            )}

            {/* IMAGEN: seleccionada = sin recorte; deseleccionada = recortada con radio */}
            {imgEl && imgBaseCm && (
              showTransformer ? (
                <>
                  <KonvaImage
                    ref={imgRef}
                    image={imgEl}
                    x={imgTx.x_cm + dispW / 2}
                    y={imgTx.y_cm + dispH / 2}
                    width={dispW}
                    height={dispH}
                    offsetX={dispW / 2}
                    offsetY={dispH / 2}
                    rotation={imgTx.rotation_deg}
                    draggable
                    dragBoundFunc={dragBoundFunc}
                    onDragStart={onImgDragStart}
                    onMouseDown={onImgMouseDown}
                    onDragMove={onImgDragMove}
                    onDragEnd={onImgDragEnd}
                  />
                  <Transformer
                    ref={trRef}
                    visible={showTransformer}
                    rotateEnabled
                    rotationSnaps={[0, 90, 180, 270]}
                    keepRatio={keepRatio}
                    enabledAnchors={['top-left','top-right','bottom-left','bottom-right']}
                    boundBoxFunc={(oldBox, newBox) => {
                      const MIN_W = 0.02 * (imgBaseCm?.w || 1);
                      const MIN_H = 0.02 * (imgBaseCm?.h || 1);

                      if (!keepRatio) {
                        // ⟵ MODO LIBRE: sólo mínimo, SIN límites superiores
                        const w = Math.max(MIN_W, newBox.width);
                        const h = Math.max(MIN_H, newBox.height);
                        return { ...newBox, width: w, height: h };
                      }

                      // Mantener proporción: con topes razonables
                      const MAX_W = (imgBaseCm?.w || 1) * IMG_ZOOM_MAX;
                      const MAX_H = (imgBaseCm?.h || 1) * IMG_ZOOM_MAX;
                      const w = Math.max(MIN_W, Math.min(newBox.width,  MAX_W));
                      const h = Math.max(MIN_H, Math.min(newBox.height, MAX_H));
                      return { ...newBox, width: w, height: h };
                    }}
                    onTransformEnd={onTransformEnd}
                  />
                </>
              ) : (
                <Group
                  clipFunc={(ctx) => {
                    const r = cornerRadiusCm + bleedCm;
                    const w = workCm.w;
                    const h = workCm.h;
                    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
                    ctx.beginPath();
                    ctx.moveTo(rr, 0);
                    ctx.lineTo(w - rr, 0);
                    ctx.arcTo(w, 0, w, rr, rr);
                    ctx.lineTo(w, h - rr);
                    ctx.arcTo(w, h, w - rr, h, rr);
                    ctx.lineTo(rr, h);
                    ctx.arcTo(0, h, 0, h - rr, rr);
                    ctx.lineTo(0, rr);
                    ctx.arcTo(0, 0, rr, 0, rr);
                    ctx.closePath();
                  }}
                ><Rect x={0} y={0} width={workCm.w} height={workCm.h} fill="transparent" />
  {/* si estás en 'contain', pintar el color debajo del arte */}
  {mode === 'contain' && (
    <Rect x={0} y={0} width={workCm.w} height={workCm.h} fill={bgColor} />
  )}
                  <KonvaImage
                    ref={imgRef}
                    image={imgEl}
                    x={imgTx.x_cm + dispW / 2}
                    y={imgTx.y_cm + dispH / 2}
                    width={dispW}
                    height={dispH}
                    offsetX={dispW / 2}
                    offsetY={dispH / 2}
                    rotation={imgTx.rotation_deg}
                    draggable={false}
                    listening={true}
                    onMouseDown={onImgMouseDown}
                  />
                </Group>
              )
            )}

            {/* máscara fuera del área */}
            

            {/* guías */}
            <Rect
              x={0} y={0}
              width={workCm.w} height={workCm.h}
              stroke="#ef4444" strokeWidth={0.04}
              cornerRadius={cornerRadiusCm + bleedCm}
              listening={false}
            />
            <Rect
              x={bleedCm} y={bleedCm}
              width={wCm} height={hCm}
              stroke="#111827" dash={[0.4,0.4]} strokeWidth={0.04}
              cornerRadius={cornerRadiusCm}
              listening={false}
            />
            <Rect
              x={bleedCm + 1} y={bleedCm + 1}
              width={Math.max(0, wCm - 2)} height={Math.max(0, hCm - 2)}
              stroke="#6b7280" dash={[0.3,0.3]} strokeWidth={0.03}
              cornerRadius={Math.max(0, cornerRadiusCm - 1)}
              listening={false}
            />
          </Layer>
        </Stage>
        {imageUrl && imgStatus !== 'loaded' && (
          <div
            className="spinner"
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)'
            }}
          />
        )}
      </div>
    </div>
  );
}
