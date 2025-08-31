/* eslint-disable */
import { useEffect, useMemo, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Stage, Layer, Rect, Group, Image as KonvaImage, Transformer, Circle, Text } from 'react-konva';
import useImage from 'use-image';
import styles from './EditorCanvas.module.css';
import ColorPopover from './ColorPopover';
import { dlog } from '../lib/debug';
import { getDiagContext } from '@/lib/diagContext';
import { PX_PER_CM } from '@/lib/export-consts';
import { exportCanvas } from '@/lib/exportService';
import { buildSubmitJobBody, prevalidateSubmitBody } from '../lib/jobPayload';
import { submitJob } from '../lib/submitJob';
import { camera as cameraMatrix, compose as composeMatrix, worldToLocal } from '@/lib/matrix2d';
import { dpiFor, dpiLevel } from '../lib/dpi';

console.assert(Number.isFinite(PX_PER_CM), '[export] PX_PER_CM inválido', PX_PER_CM);

const DEBUG_SCALE = import.meta.env.VITE_DEBUG_SCALE === '1';
const DEBUG_TRANSFORM = import.meta.env.VITE_DEBUG_TRANSFORM === '1';
const DEBUG_SIZE = import.meta.env.VITE_DEBUG === '1';

const CM_PER_INCH = 2.54;
const mmToCm = (mm) => mm / 10;

const VIEW_ZOOM_MIN = 0.3;
const VIEW_ZOOM_MAX = 12;
const IMG_ZOOM_MAX  = 50;   // límite cuando mantengo proporción
const STAGE_BG = '#e5e7eb';
const SNAP_LIVE_CM = 2.0;
const RELEASE_CM   = 3.0;
const MIN_DPI = 100;
const MIN_SCALE = 0.05;

// ---------- Editor ----------
const EditorCanvas = forwardRef(function EditorCanvas(
  {
    imageUrl,
    imageFile,
    sizeCm = { w: 90, h: 40 }, // tamaño final SIN sangrado (cm)
    bleedMm = 3,
    onLayoutChange,
    material,
    onPickedColor,
  },
  ref
) {
  const wCm = Number(sizeCm?.w ?? 90);
  const hCm = Number(sizeCm?.h ?? 40);
  const bleedCm = mmToCm(bleedMm);
  const cornerRadiusCm = 1.5;
  const workCm = useMemo(() => ({ w: wCm + 2*bleedCm, h: hCm + 2*bleedCm }), [wCm, hCm, bleedCm]);

  // viewport
  const wrapRef = useRef(null);
  const stageRef = useRef(null);
  const exportStageRef = useRef(null);
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
  const pickingColorRef = useRef(false);
  const pickCallbackRef = useRef(null);
  const [isPickingColor, setIsPickingColor] = useState(false);
  const loupeRef = useRef(null);
  const currentHexRef = useRef('#000000');
  const [pickOverlay, setPickOverlay] = useState({ x: 0, y: 0, hex: '#000000' });

  const pointerWorld = (stage) => {
    const pt = stage.getPointerPosition();
    const cam = cameraMatrix({ panX: viewPos.x, panY: viewPos.y, zoom: baseScale * viewScale });
    return worldToLocal(pt, cam);
  };
  const isOutsideWorkArea = (wp) => wp.x < 0 || wp.y < 0 || wp.x > workCm.w || wp.y > workCm.h;

  const startPickColor = useCallback((cb) => {
    pickCallbackRef.current = cb;
    pickingColorRef.current = true;
    setIsPickingColor(true);
  }, []);

  const viewPxPerCm = useMemo(() => baseScale * viewScale, [baseScale, viewScale]);

  const updateLoupe = useCallback((clientX, clientY) => {
    if (!exportStageRef.current) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.container().getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const k = baseScale * viewScale;
    const worldX = (x - viewPos.x) / k;
    const worldY = (y - viewPos.y) / k;
    if (worldX < bleedCm || worldX > bleedCm + wCm || worldY < bleedCm || worldY > bleedCm + hCm) return;
    const px = Math.floor((worldX - bleedCm) * viewPxPerCm);
    const py = Math.floor((worldY - bleedCm) * viewPxPerCm);
    try {
      const src = exportStageRef.current.toCanvas();
      const ctx = src.getContext('2d');
      const data = ctx.getImageData(px, py, 1, 1).data;
      const hex = `#${[0,1,2].map(i=>data[i].toString(16).padStart(2,'0')).join('')}`;
      currentHexRef.current = hex;
      const loupe = loupeRef.current;
      if (loupe) {
        const lctx = loupe.getContext('2d');
        lctx.imageSmoothingEnabled = false;
        lctx.clearRect(0,0,120,120);
        lctx.drawImage(src, px - 10, py - 10, 20, 20, 0, 0, 120, 120);
        lctx.strokeStyle = 'rgba(0,0,0,0.3)';
        for (let i=0;i<=20;i++) {
          const p = i * 6;
          lctx.beginPath();
          lctx.moveTo(p,0); lctx.lineTo(p,120); lctx.stroke();
          lctx.beginPath();
          lctx.moveTo(0,p); lctx.lineTo(120,p); lctx.stroke();
        }
        lctx.strokeStyle = '#ffffff';
        lctx.lineWidth = 2;
        lctx.strokeRect(9*6,9*6,6,6);
      }
      setPickOverlay({ x: clientX + 15, y: clientY + 15, hex });
      dlog('[COLOR-PICK]', hex, px, py);
    } catch { /* ignore */ }
  }, [baseScale, viewScale, viewPos.x, viewPos.y, bleedCm, viewPxPerCm, wCm, hCm]);

  useEffect(() => {
    if (!isPickingColor) return;
    const move = (e) => updateLoupe(e.clientX, e.clientY);
    const down = (e) => {
      if (e.button === 0) {
        updateLoupe(e.clientX, e.clientY);
        pickCallbackRef.current?.(currentHexRef.current);
        onPickedColor?.(currentHexRef.current);
        pickingColorRef.current = false;
        setIsPickingColor(false);
      } else if (e.button === 2) {
        pickingColorRef.current = false;
        setIsPickingColor(false);
      }
    };
    const key = (e) => {
      if (e.key === 'Escape') {
        pickingColorRef.current = false;
        setIsPickingColor(false);
      }
    };
    const ctxMenu = (e) => e.preventDefault();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    window.addEventListener('contextmenu', ctxMenu);
    document.body.style.cursor = 'crosshair';
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
      window.removeEventListener('contextmenu', ctxMenu);
      document.body.style.cursor = '';
    };
  }, [isPickingColor, updateLoupe, onPickedColor]);

  // selección
  const imgRef = useRef(null);
  const trRef  = useRef(null);
  const [showTransformer, setShowTransformer] = useState(true);
  const scaleGestureRef = useRef(null);
  const scaleRafRef = useRef(false);
  const dragGestureRef = useRef(null);
  const dragRafRef = useRef(false);

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
    if (pickingColorRef.current) return;
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
    if (pickingColorRef.current) return;
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
      w: imgEl.naturalWidth / PX_PER_CM,
      h: imgEl.naturalHeight / PX_PER_CM
    };
  }, [imgEl]);

  const [imgTx, setImgTx] = useState({ x_cm: 0, y_cm: 0, scaleX: 1, scaleY: 1, rotation_deg: 0 });
  const imgTxRef = useRef(imgTx);
  useEffect(() => { imgTxRef.current = imgTx; }, [imgTx]);
  const sizingChangeRef = useRef(false);
  const sizeChangeTimeoutRef = useRef(null);
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
    setIsManual(true);
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
  const [mode, setMode] = useState('cover'); // 'cover' | 'contain' | 'stretch'
  const [isManual, setIsManual] = useState(false);
  const [bgColor, setBgColor] = useState('#ffffff');
  const [freeScale, setFreeScale] = useState(false);
  const [notice, setNotice] = useState('');
  const noticeRef = useRef(null);
  const theta = (imgTx.rotation_deg * Math.PI) / 180;

  const showNotice = useCallback((msg) => {
    setNotice(msg);
    clearTimeout(noticeRef.current);
    noticeRef.current = setTimeout(() => setNotice(''), 1500);
  }, []);

  useEffect(() => () => clearTimeout(noticeRef.current), []);

  const clampScaleByDpi = useCallback((sx, sy, keepRatio) => {
    if (!imgEl || !imgBaseCm) return { sx, sy, clamped: false };
    const maxScaleX = (imgEl.naturalWidth * CM_PER_INCH) / (MIN_DPI * imgBaseCm.w);
    const maxScaleY = (imgEl.naturalHeight * CM_PER_INCH) / (MIN_DPI * imgBaseCm.h);
    let nx = sx;
    let ny = sy;
    let clamped = false;
    if (keepRatio) {
      const signX = Math.sign(nx);
      const signY = Math.sign(ny);
      const uni = Math.min(Math.abs(nx), Math.abs(ny), maxScaleX, maxScaleY);
      clamped = uni < Math.abs(nx) || uni < Math.abs(ny);
      nx = signX * uni;
      ny = signY * uni;
    } else {
      if (Math.abs(nx) > maxScaleX) { nx = Math.sign(nx) * maxScaleX; clamped = true; }
      if (Math.abs(ny) > maxScaleY) { ny = Math.sign(ny) * maxScaleY; clamped = true; }
    }
    return { sx: nx, sy: ny, clamped };
  }, [imgEl, imgBaseCm]);

  useEffect(() => {
    if (freeScale) return;
    const res = clampScaleByDpi(imgTx.scaleX, imgTx.scaleY, false);
    if (res.clamped) {
      setImgTx((tx) => ({ ...tx, scaleX: res.sx, scaleY: res.sy }));
      showNotice('Ajustado al máximo por calidad');
    }
  }, [freeScale, wCm, hCm, material, imgEl, imgBaseCm, imgTx.scaleX, imgTx.scaleY, clampScaleByDpi, showNotice]);

  useEffect(() => { sizingChangeRef.current = true; }, [wCm, hCm, bleedMm, material]);

  // cover inicial 1 sola vez
  const didInitRef = useRef(false);
  useEffect(() => {
    if (!imgBaseCm || didInitRef.current) return;
    const c = Math.abs(Math.cos(theta));
    const sSin = Math.abs(Math.sin(theta));
    const denomW = imgBaseCm.w * c + imgBaseCm.h * sSin;
    const denomH = imgBaseCm.w * sSin + imgBaseCm.h * c;
    const coverScale = Math.max(workCm.w / denomW, workCm.h / denomH);
    const w = imgBaseCm.w * coverScale, h = imgBaseCm.h * coverScale;
    const initial = { x_cm: (workCm.w - w)/2, y_cm: (workCm.h - h)/2, scaleX: coverScale, scaleY: coverScale, rotation_deg: 0 };
    setImgTx(initial);
    pushHistory(initial);
    setMode('cover');
    const maxContain = Math.min(workCm.w / denomW, workCm.h / denomH);
    dlog('[FIT]', 'cover', 1, coverScale, maxContain, coverScale, { w: wCm, h: hCm }, material);
    didInitRef.current = true;
  }, [imgBaseCm, workCm.w, workCm.h, theta, wCm, hCm, material]);

  // medidas visuales (para offset centro)
  const dispW = imgBaseCm ? imgBaseCm.w * Math.abs(imgTx.scaleX) : 0;
  const dispH = imgBaseCm ? imgBaseCm.h * Math.abs(imgTx.scaleY) : 0;
  const flipXSign = imgTx.scaleX < 0 ? -1 : 1;
  const flipYSign = imgTx.scaleY < 0 ? -1 : 1;
  const rotAABBHalf = (w, h, ang) => ({
    halfW: (Math.abs(w * Math.cos(ang)) + Math.abs(h * Math.sin(ang))) / 2,
    halfH: (Math.abs(w * Math.sin(ang)) + Math.abs(h * Math.cos(ang))) / 2,
  });

  // imán fuerte (centro + AABB rotado)
  const stickRef = useRef({ x: null, y: null, activeX: false, activeY: false });
  const gestureStartRef = useRef(null);
  const dragBoundFunc = useCallback((pos) => {
    if (!imgBaseCm) return pos;
    if (scaleGestureRef.current) return pos;

    let cx = pos.x;
    let cy = pos.y;

    const w = imgBaseCm.w * Math.abs(imgTx.scaleX);
    const h = imgBaseCm.h * Math.abs(imgTx.scaleY);
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


  // transformer
  useEffect(() => {
    if (!trRef.current) return;
    if (showTransformer && imgRef.current) trRef.current.nodes([imgRef.current]);
    else trRef.current.nodes([]);
    trRef.current.getLayer()?.batchDraw();
  }, [imgEl, showTransformer]);

  const onTransformStart = (e) => {
    if (!imgRef.current || !imgBaseCm) return;
    const container = stageRef.current?.container();
    const pointerId = e?.evt?.pointerId;
    if (container && pointerId != null) {
      container.setPointerCapture(pointerId);
    }
    const active = trRef.current?.getActiveAnchor();
    const lockX = active === 'top-center' || active === 'bottom-center';
    const lockY = active === 'middle-left' || active === 'middle-right';
    gestureStartRef.current = imgTx;
    setIsManual(true);
    const stage = stageRef.current;
    const pointer = pointerWorld(stage);
    const wScaled = imgBaseCm.w * Math.abs(imgTx.scaleX);
    const hScaled = imgBaseCm.h * Math.abs(imgTx.scaleY);
    const cx = imgTx.x_cm + wScaled / 2;
    const cy = imgTx.y_cm + hScaled / 2;
    const thetaRad = imgTx.rotation_deg * Math.PI / 180;
    const startMatrix = composeMatrix({ x: cx, y: cy, rotation: thetaRad, scaleX: imgTx.scaleX, scaleY: imgTx.scaleY });
    const startPointerLocal = worldToLocal(pointer, startMatrix);
    scaleGestureRef.current = {
      pointerId,
      startMatrix,
      startPointerLocal,
      initScaleX: imgTx.scaleX,
      initScaleY: imgTx.scaleY,
      pivotWorld: { x: cx, y: cy },
      lockX,
      lockY,
      latest: null,
    };
    if (DEBUG_SCALE) console.log('[SCALE] start', { startScaleX: imgTx.scaleX, startScaleY: imgTx.scaleY, startX: imgTx.x_cm, startY: imgTx.y_cm });
  };

  const onTransform = () => {
    if (!scaleGestureRef.current || !imgBaseCm) return;
    const g = scaleGestureRef.current;
    const stage = stageRef.current;
    const pointer = pointerWorld(stage);
    const pointerLocal = worldToLocal(pointer, g.startMatrix);
    let ratioX = g.startPointerLocal.x !== 0 ? pointerLocal.x / g.startPointerLocal.x : 1;
    let ratioY = g.startPointerLocal.y !== 0 ? pointerLocal.y / g.startPointerLocal.y : 1;
    if (g.lockX) ratioX = 1;
    if (g.lockY) ratioY = 1;
    if (!freeScale) {
      const uni = Math.max(Math.abs(ratioX), Math.abs(ratioY));
      ratioX = Math.sign(ratioX) * uni;
      ratioY = Math.sign(ratioY) * uni;
    }
    let scaleX = g.initScaleX * ratioX;
    let scaleY = g.initScaleY * ratioY;
    const res = clampScaleByDpi(scaleX, scaleY, !freeScale);
    if (!freeScale && res.clamped) showNotice('Límite por calidad');
    scaleX = res.sx;
    scaleY = res.sy;
    scaleX = Math.sign(scaleX) * Math.max(Math.abs(scaleX), MIN_SCALE);
    scaleY = Math.sign(scaleY) * Math.max(Math.abs(scaleY), MIN_SCALE);
    scaleX = Math.sign(scaleX) * Math.min(Math.abs(scaleX), IMG_ZOOM_MAX);
    scaleY = Math.sign(scaleY) * Math.min(Math.abs(scaleY), IMG_ZOOM_MAX);
    const latest = sanitizeTransform({
      x_cm: g.pivotWorld.x - imgBaseCm.w * Math.abs(scaleX) / 2,
      y_cm: g.pivotWorld.y - imgBaseCm.h * Math.abs(scaleY) / 2,
      scaleX,
      scaleY,
      rotation_deg: imgTx.rotation_deg,
    });
    g.latest = latest;
    if (!scaleRafRef.current) {
      scaleRafRef.current = true;
      requestAnimationFrame(() => {
        scaleRafRef.current = false;
        if (scaleGestureRef.current?.latest) {
          setImgTx((tx) => ({ ...tx, ...scaleGestureRef.current.latest }));
          if (DEBUG_SCALE) console.log('[SCALE] move', scaleGestureRef.current.latest);
        }
      });
    }
  };

  const onTransformEnd = () => {
    const n = imgRef.current;
    if (!n || !imgBaseCm) return;
    const container = stageRef.current?.container();
    const pid = scaleGestureRef.current?.pointerId;
    if (pid != null && container?.hasPointerCapture(pid)) {
      container.releasePointerCapture(pid);
    }
    const latest = scaleGestureRef.current?.latest;
    const finalTx = latest ? sanitizeTransform(latest) : sanitizeTransform({ ...imgTx, rotation_deg: n.rotation() });
    setImgTx(finalTx);
    if (DEBUG_SCALE) console.log('[SCALE] end', finalTx);
    scaleGestureRef.current = null;
    if (gestureStartRef.current) {
      pushHistory(finalTx);
      gestureStartRef.current = null;
    }
  };

  // centro actual
  const currentCenter = () => {
    const w = imgBaseCm.w * Math.abs(imgTx.scaleX);
    const h = imgBaseCm.h * Math.abs(imgTx.scaleY);
    return { cx: imgTx.x_cm + w/2, cy: imgTx.y_cm + h/2 };
  };

  // cover/contain/estirar con rotación
  const applyFit = useCallback((mode) => {
    if (!imgBaseCm) return;
    setIsManual(false);
    const prevScale = Math.abs(imgTx.scaleX);
    const { cx, cy } = currentCenter();
    const w = imgBaseCm.w, h = imgBaseCm.h;
    const c = Math.abs(Math.cos(theta));
    const s = Math.abs(Math.sin(theta));
    const denomW = w * c + h * s;
    const denomH = w * s + h * c;
    const minCover = Math.max(workCm.w / denomW, workCm.h / denomH);
    const maxContain = Math.min(workCm.w / denomW, workCm.h / denomH);

    if (mode === 'cover') {
      const scale = Math.max(prevScale, minCover);
      const newW = w * scale, newH = h * scale;
      pushHistory(imgTx);
      setImgTx((prev) => ({
        x_cm: cx - newW / 2, y_cm: cy - newH / 2,
        scaleX: scale * Math.sign(prev.scaleX),
        scaleY: scale * Math.sign(prev.scaleY),
        rotation_deg: prev.rotation_deg,
      }));
      setMode('cover');
      dlog('[FIT]', 'cover', prevScale, minCover, maxContain, scale, { w: wCm, h: hCm }, material);
      return;
    }

    if (mode === 'contain') {
      const scale = Math.min(prevScale, maxContain);
      const newW = w * scale, newH = h * scale;
      pushHistory(imgTx);
      setImgTx((prev) => ({
        x_cm: cx - newW / 2, y_cm: cy - newH / 2,
        scaleX: scale * Math.sign(prev.scaleX),
        scaleY: scale * Math.sign(prev.scaleY),
        rotation_deg: prev.rotation_deg,
      }));
      setMode('contain');
      dlog('[FIT]', 'contain', prevScale, minCover, maxContain, scale, { w: wCm, h: hCm }, material);
      return;
    }

    if (mode === 'stretch') {
      const A11 = w * c, A12 = h * s;
      const A21 = w * s, A22 = h * c;
      const det = A11 * A22 - A12 * A21;
      let sx = 1, sy = 1;
      if (Math.abs(det) > 1e-6) {
        sx = ((workCm.w * A22) - (A12 * workCm.h)) / det;
        sy = ((-A21 * workCm.w) + (A11 * workCm.h)) / det;
      } else {
        sx = sy = minCover;
      }
      sx = Math.max(sx, MIN_SCALE);
      sy = Math.max(sy, MIN_SCALE);
      const newW = w * sx, newH = h * sy;
      pushHistory(imgTx);
      setImgTx((prev) => ({
        x_cm: cx - newW / 2, y_cm: cy - newH / 2,
        scaleX: sx * Math.sign(imgTx.scaleX),
        scaleY: sy * Math.sign(imgTx.scaleY),
        rotation_deg: prev.rotation_deg,
      }));
      setMode('stretch');
      dlog('[FIT]', 'stretch', prevScale, minCover, maxContain, { sx, sy }, { w: wCm, h: hCm }, material);
    }
  }, [imgBaseCm?.w, imgBaseCm?.h, workCm.w, workCm.h, theta, imgTx, wCm, hCm, material]);

  const fitCover = useCallback(() => { applyFit('cover'); }, [applyFit]);
  const fitContain = useCallback(() => { applyFit('contain'); }, [applyFit]);
  const fitStretchCentered = useCallback(() => { applyFit('stretch'); }, [applyFit]);

  const centerHoriz = useCallback(() => {
    if (!imgBaseCm) return;
    const w = imgBaseCm.w * Math.abs(imgTx.scaleX);
    pushHistory(imgTx);
    setIsManual(true);
    setImgTx((tx) => ({ ...tx, x_cm: (workCm.w - w) / 2 }));
  }, [imgBaseCm?.w, workCm.w, imgTx.scaleX]);

  const centerVert = useCallback(() => {
    if (!imgBaseCm) return;
    const h = imgBaseCm.h * Math.abs(imgTx.scaleY);
    pushHistory(imgTx);
    setIsManual(true);
    setImgTx((tx) => ({ ...tx, y_cm: (workCm.h - h) / 2 }));
  }, [imgBaseCm?.h, workCm.h, imgTx.scaleY]);

  const centerBoth = useCallback(() => {
    if (!imgBaseCm) return;
    const w = imgBaseCm.w * Math.abs(imgTx.scaleX);
    const h = imgBaseCm.h * Math.abs(imgTx.scaleY);
    pushHistory(imgTx);
    setIsManual(true);
    setImgTx((tx) => ({ ...tx, x_cm: (workCm.w - w)/2, y_cm: (workCm.h - h)/2 }));
  }, [imgBaseCm?.w, imgBaseCm?.h, imgTx.scaleX, imgTx.scaleY, workCm.w, workCm.h]);

  const centerHorizRef = useRef(centerHoriz);
  useEffect(() => { centerHorizRef.current = centerHoriz; }, [centerHoriz]);
  const centerVertRef = useRef(centerVert);
  useEffect(() => { centerVertRef.current = centerVert; }, [centerVert]);

  const sanitizeTransform = useCallback((tx) => {
    if (!imgBaseCm) return tx;
    let { x_cm, y_cm, scaleX, scaleY } = tx;
    if (!Number.isFinite(x_cm)) x_cm = 0;
    if (!Number.isFinite(y_cm)) y_cm = 0;
    const signX = Math.sign(scaleX) || 1;
    const signY = Math.sign(scaleY) || 1;
    const absX = Math.min(Math.max(Math.abs(scaleX), MIN_SCALE), IMG_ZOOM_MAX);
    const absY = Math.min(Math.max(Math.abs(scaleY), MIN_SCALE), IMG_ZOOM_MAX);
    return { ...tx, x_cm, y_cm, scaleX: signX * absX, scaleY: signY * absY };
  }, [imgBaseCm]);

  const onImgPointerDown = (e) => {
    if (!imgBaseCm) return;
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const pointerId = e.evt.pointerId;
    const container = stage?.container();
    if (container && pointerId != null) {
      container.setPointerCapture(pointerId);
    }
    isPanningRef.current = false;
    stickRef.current = { x: null, y: null, activeX: false, activeY: false };
    setShowTransformer(true);
    if (trRef.current && imgRef.current) {
      trRef.current.nodes([imgRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
    const world = pointerWorld(stage);
    dragGestureRef.current = {
      pointerId,
      startPointer: world,
      node0: { ...imgTx },
      latest: null,
    };
    gestureStartRef.current = imgTx;
    setIsManual(true);
  };

  const onImgPointerMove = (e) => {
    const g = dragGestureRef.current;
    if (!g || !imgBaseCm || scaleGestureRef.current) return;
    const stage = e.target.getStage();
    const world = pointerWorld(stage);
    const dx = world.x - g.startPointer.x;
    const dy = world.y - g.startPointer.y;
    const w = imgBaseCm.w * Math.abs(g.node0.scaleX);
    const h = imgBaseCm.h * Math.abs(g.node0.scaleY);
    let cx = g.node0.x_cm + dx + w / 2;
    let cy = g.node0.y_cm + dy + h / 2;
    ({ x: cx, y: cy } = dragBoundFunc({ x: cx, y: cy }));
    const latest = { x_cm: cx - w / 2, y_cm: cy - h / 2 };
    g.latest = latest;
    if (!dragRafRef.current) {
      dragRafRef.current = true;
      requestAnimationFrame(() => {
        dragRafRef.current = false;
        if (dragGestureRef.current?.latest) {
          setImgTx((tx) => ({ ...tx, ...dragGestureRef.current.latest }));
        }
      });
    }
  };

  const onImgPointerUp = (e) => {
    const g = dragGestureRef.current;
    const container = e.target.getStage()?.container();
    if (g?.pointerId != null && container?.hasPointerCapture(g.pointerId)) {
      container.releasePointerCapture(g.pointerId);
    }
    const finalTx = g?.latest ? sanitizeTransform({ ...imgTx, ...g.latest }) : imgTx;
    setImgTx(finalTx);
    dragGestureRef.current = null;
    if (gestureStartRef.current) {
      pushHistory(finalTx);
      gestureStartRef.current = null;
    }
  };

  const alignEdge = (edge) => {
    if (!imgBaseCm) return;
    const w = imgBaseCm.w * Math.abs(imgTx.scaleX);
    const h = imgBaseCm.h * Math.abs(imgTx.scaleY);
    const { halfW, halfH } = rotAABBHalf(w, h, theta);

    let cx = imgTx.x_cm + w/2;
    let cy = imgTx.y_cm + h/2;

    if (edge === 'left')   cx = halfW;
    if (edge === 'right')  cx = workCm.w - halfW;
    if (edge === 'top')    cy = halfH;
    if (edge === 'bottom') cy = workCm.h - halfH;

    pushHistory(imgTx);
    setIsManual(true);
    setImgTx((tx) => ({
      ...tx,
      x_cm: cx - (imgBaseCm.w * Math.abs(tx.scaleX))/2,
      y_cm: cy - (imgBaseCm.h * Math.abs(tx.scaleY))/2,
    }));
  };

  const rotate = (deg) => {
    pushHistory(imgTx);
    setIsManual(true);
    setImgTx((tx) => ({ ...tx, rotation_deg: (tx.rotation_deg + deg) % 360 }));
  };

  const flipHoriz = () => {
    pushHistory(imgTx);
    setIsManual(true);
    setImgTx((tx) => sanitizeTransform({ ...tx, scaleX: -tx.scaleX }));
  };

  const flipVert = () => {
    pushHistory(imgTx);
    setIsManual(true);
    setImgTx((tx) => sanitizeTransform({ ...tx, scaleY: -tx.scaleY }));
  };

  const applyFitRef = useRef(applyFit);
  useEffect(() => { applyFitRef.current = applyFit; }, [applyFit]);

  useEffect(() => {
    if (!sizingChangeRef.current || !imgEl) return;
    if (sizeChangeTimeoutRef.current) clearTimeout(sizeChangeTimeoutRef.current);
    sizeChangeTimeoutRef.current = setTimeout(async () => {
      const diagId = getDiagContext().diag_id || '';
      if (DEBUG_SIZE) {
        console.debug('[SIZE-CHANGE before]', { diagId, fitMode: mode, tx: imgTxRef.current, size: { w_cm: wCm, h_cm: hCm, material } });
      }
      await Promise.resolve(applyFitRef.current(mode));
      centerHorizRef.current?.();
      centerVertRef.current?.();
      sizingChangeRef.current = false;
      if (DEBUG_SIZE) {
        console.debug('[SIZE-CHANGE after]', { diagId, fitMode: mode, tx: imgTxRef.current, size: { w_cm: wCm, h_cm: hCm, material } });
      }
    }, 120);
    return () => clearTimeout(sizeChangeTimeoutRef.current);
  }, [wCm, hCm, bleedMm, material, mode, imgEl]);


  // calidad
  const dpiEffective = useMemo(() => {
    if (!imgEl || !imgBaseCm) return null;
    const printedWcm = imgBaseCm.w * Math.abs(imgTx.scaleX);
    const printedHcm = imgBaseCm.h * Math.abs(imgTx.scaleY);
    if (printedWcm <= 0 || printedHcm <= 0) return null;
    return dpiFor(printedWcm, printedHcm, imgEl.naturalWidth, imgEl.naturalHeight);
  }, [imgEl, imgBaseCm, imgTx.scaleX, imgTx.scaleY]);

  const quality = useMemo(() => {
    if (dpiEffective == null) return { label:'—', color:'#9ca3af' };
    const level = dpiLevel(dpiEffective, 300, MIN_DPI);
    if (level === 'bad') return { label:`Baja (${dpiEffective|0} DPI)`,  color:'#ef4444' };
    if (level === 'warn') return { label:`Buena (${dpiEffective|0} DPI)`, color:'#f59e0b' };
    return { label:`Excelente (${Math.min(300, dpiEffective|0)} DPI)`, color:'#10b981' };
  }, [dpiEffective]);

  const fitTip = 'preset inicial; si modificás manualmente, se mantiene hasta reencajar';

  const getPadRectPx = () => {
    const k = baseScale * viewScale;
    return {
      x: Math.round(viewPos.x + bleedCm * k),
      y: Math.round(viewPos.y + bleedCm * k),
      w: Math.round(wCm * k),
      h: Math.round(hCm * k),
      radius_px: Math.round(cornerRadiusCm * k),
    };
  };

  const getPadRect = () => ({
    x: bleedCm,
    y: bleedCm,
    w: wCm,
    h: hCm,
    radius: cornerRadiusCm,
  });

  const getRenderDescriptorV2 = () => {
    if (!imgEl || !imgBaseCm) return null;
    const cmPerPx = 1 / PX_PER_CM;
    const canvas_px = {
      w: Math.round(workCm.w / cmPerPx),
      h: Math.round(workCm.h / cmPerPx),
    };
    const w = imgBaseCm.w * Math.abs(imgTx.scaleX);
    const h = imgBaseCm.h * Math.abs(imgTx.scaleY);
    const cx = imgTx.x_cm + w / 2;
    const cy = imgTx.y_cm + h / 2;
    const { halfW, halfH } = rotAABBHalf(w, h, theta);
    let left = cx - halfW;
    let top = cy - halfH;
    let right = cx + halfW;
    let bottom = cy + halfH;
    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(workCm.w, right);
    bottom = Math.min(workCm.h, bottom);
    const place_px = {
      x: Math.round(left / cmPerPx),
      y: Math.round(top / cmPerPx),
      w: Math.round(Math.max(0, right - left) / cmPerPx),
      h: Math.round(Math.max(0, bottom - top) / cmPerPx),
    };
    const snapped = Math.round(imgTx.rotation_deg / 90) * 90;
    const rotate_deg = ((snapped % 360) + 360) % 360;
    return {
      canvas_px,
      src_px: { w: imgEl.naturalWidth, h: imgEl.naturalHeight },
      place_px,
      pad_px: getPadRectPx(),
      rotate_deg,
      flipX: imgTx.scaleX < 0,
      flipY: imgTx.scaleY < 0,
      fit_mode: mode,
      bg_hex: bgColor,
      w_cm: wCm,
      h_cm: hCm,
      bleed_mm: bleedMm,
    };
  };

  const padRectPx = getPadRectPx();

  const exportPadAsBlob = async () => {
    if (!exportStageRef.current) return null;
    const inner_w_px = Math.round(wCm * PX_PER_CM);
    const inner_h_px = Math.round(hCm * PX_PER_CM);
    const pad_px = getPadRectPx();
    const pixelRatioX = inner_w_px / pad_px.w;
    const pixelRatioY = inner_h_px / pad_px.h;
    const pixelRatio = Math.min(pixelRatioX, pixelRatioY);
    const canvas = exportStageRef.current.toCanvas({ pixelRatio });
    const blob = await exportCanvas(canvas, 'print');
    const outBitmap = await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve({ width: i.width, height: i.height });
      i.src = URL.createObjectURL(blob);
    });
    const desc = getRenderDescriptorV2();
    dlog({
      pad_px: desc?.pad_px,
      canvas_px: desc?.canvas_px,
      place_px: desc?.place_px,
      rotate_deg: desc?.rotate_deg,
      w_cm: wCm,
      h_cm: hCm,
      bleed_mm: bleedMm,
      inner_w_px,
      inner_h_px,
      pixelRatioX,
      pixelRatioY,
      pixelRatio,
      outBitmap,
    });
    return blob;
  };

  useImperativeHandle(ref, () => ({
    getRenderDescriptor: () => {
      if (!imgEl || !imgBaseCm) return null;
      const naturalW = imgEl.naturalWidth;
      const naturalH = imgEl.naturalHeight;
    const cmPerPx = 1 / PX_PER_CM;
      const dispW = imgBaseCm.w * Math.abs(imgTx.scaleX);
      const dispH = imgBaseCm.h * Math.abs(imgTx.scaleY);
      const originX = imgTx.x_cm + dispW / 2;
      const originY = imgTx.y_cm + dispH / 2;
      const theta = (imgTx.rotation_deg * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      function canvasToSrc(cx, cy) {
        const dx = cx - originX;
        const dy = cy - originY;
        const rx = dx * cos + dy * sin;
        const ry = -dx * sin + dy * cos;
        const sx = (rx + dispW / 2) / (cmPerPx * Math.abs(imgTx.scaleX));
        const sy = (ry + dispH / 2) / (cmPerPx * Math.abs(imgTx.scaleY));
        return { sx, sy };
      }
      const workW = workCm.w;
      const workH = workCm.h;
      const pts = [
        canvasToSrc(0, 0),
        canvasToSrc(workW, 0),
        canvasToSrc(0, workH),
        canvasToSrc(workW, workH),
      ];
      let left = Math.max(0, Math.min(...pts.map(p => p.sx)));
      let top = Math.max(0, Math.min(...pts.map(p => p.sy)));
      let right = Math.min(naturalW, Math.max(...pts.map(p => p.sx)));
      let bottom = Math.min(naturalH, Math.max(...pts.map(p => p.sy)));
      left = Math.floor(left);
      top = Math.floor(top);
      const width = Math.ceil(right - left);
      const height = Math.ceil(bottom - top);
      return {
        src_px: { w: naturalW, h: naturalH },
        crop_px: { left, top, width, height },
        rotate_deg: ((imgTx.rotation_deg % 360) + 360) % 360,
        fit_mode: mode,
        bg: mode === 'contain' ? bgColor : '#ffffff',
        canvas_px: {
          w: Math.round(workW / cmPerPx),
          h: Math.round(workH / cmPerPx),
        },
        w_cm: wCm,
        h_cm: hCm,
        bleed_mm: bleedMm,
      };
    },
    getRenderDescriptorV2,
    getPadRect,
    getPadRectPx,
    exportPadAsBlob,
    startPickColor,
  }));

  // popover color
  const [colorOpen, setColorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastDiag, setLastDiag] = useState(null);
  const API_BASE = (import.meta.env.VITE_API_BASE || 'https://mgm-api.vercel.app').replace(/\/$/, '');
  const toggleContain = () => { fitContain(); setColorOpen(true); };
  const closeColor = () => setColorOpen(false);
  // track latest callback to avoid effect loops when parent re-renders
  const layoutChangeRef = useRef(onLayoutChange);
  useEffect(() => {
    layoutChangeRef.current = onLayoutChange;
  }, [onLayoutChange]);

  const prevLayoutRef = useRef(null);
  // export layout
  useEffect(() => {
    const next = {
      dpi: Math.round(PX_PER_CM * CM_PER_INCH),
      bleed_mm: bleedMm,
      size_cm: { w: wCm, h: hCm },
      image: imgEl ? { natural_px: { w: imgEl.naturalWidth, h: imgEl.naturalHeight } } : null,
      transform: {
        x_cm: imgTx.x_cm,
        y_cm: imgTx.y_cm,
        scaleX: imgTx.scaleX,
        scaleY: imgTx.scaleY,
        rotation_deg: imgTx.rotation_deg,
        fitMode: mode,
        isManual,
      },
      mode,
      background: mode === 'contain' ? bgColor : '#ffffff',
      corner_radius_cm: cornerRadiusCm,
    };
    const prev = prevLayoutRef.current;
    const tol = 0.01; // cm tolerance
    const rotTol = 0.1; // deg tolerance
    const changed =
      !prev ||
      Math.abs(prev.transform.x_cm - next.transform.x_cm) > tol ||
      Math.abs(prev.transform.y_cm - next.transform.y_cm) > tol ||
      Math.abs(prev.transform.scaleX - next.transform.scaleX) > tol ||
      Math.abs(prev.transform.scaleY - next.transform.scaleY) > tol ||
      Math.abs(prev.transform.rotation_deg - next.transform.rotation_deg) > rotTol ||
      prev.transform.fitMode !== next.transform.fitMode ||
      prev.transform.isManual !== next.transform.isManual ||
      prev.mode !== next.mode ||
      prev.background !== next.background ||
      prev.bleed_mm !== next.bleed_mm ||
      prev.size_cm.w !== next.size_cm.w ||
      prev.size_cm.h !== next.size_cm.h;
    if (changed) {
      prevLayoutRef.current = next;
      layoutChangeRef.current?.(next);
    }
  }, [bleedMm, wCm, hCm, imgEl, imgTx, mode, bgColor, cornerRadiusCm, isManual]);

  // Confirmar y crear job
async function onConfirmSubmit() {
  try {
    const submitBody = buildSubmitJobBody({
      material: materialSelected,
      size: { w: sizeCm?.w, h: sizeCm?.h, bleed_mm: 3 },
      fit_mode: transform?.fitMode, // 'cover'|'contain'|'stretch'
      bg: bgColor || '#ffffff',
      dpi: Math.round(currentDpi || PX_PER_CM * CM_PER_INCH),
      uploads: {
        signed_url: uploadUrlResponse?.upload?.signed_url,
        object_key: uploadUrlResponse?.object_key,
        canonical: uploaded?.file_original_url,
      },
      file_hash: fileSha256,
      price: { amount: 45900, currency: 'ARS' },
      customer: { email: customerEmail, name: customerName },
      notes: '',
      source: 'web',
    });

    const pre = prevalidateSubmitBody(submitBody);
    dlog('[PREVALIDATE EditorCanvas]', pre, submitBody);
    if (!pre.ok) {
      alert(pre.problems.join('\n'));
      return;
    }

    const apiBase = (import.meta.env.VITE_API_BASE || 'https://mgm-api.vercel.app').replace(/\/$/, '');
    const job = await submitJob(apiBase, submitBody);

    onDone?.(job);
  } catch (err) {
    console.error(err);
    alert(String(err?.message || err));
  }
}

  return (
    <div className={styles.colorWrapper}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <button onClick={fitCover} disabled={!imgEl} title={fitTip}>Cubrir</button>

        <div className={styles.colorWrapper}>
          <button onClick={toggleContain} disabled={!imgEl} title={fitTip}>Contener</button>
          {mode === 'contain' && imgEl && (
            <div className={styles.colorPopoverWrap}>
              <ColorPopover
                value={bgColor}
                onChange={setBgColor}
                open={colorOpen}
                onClose={closeColor}
                onPickFromCanvas={() => startPickColor(setBgColor)}
              />
            </div>
          )}
        </div>

        <button onClick={fitStretchCentered} disabled={!imgEl} title={fitTip}>Estirar</button>


        <button onClick={centerHoriz} disabled={!imgEl}>Centrar H</button>
        <button onClick={centerVert} disabled={!imgEl}>Centrar V</button>
        <button onClick={() => alignEdge('left')} disabled={!imgEl}>Izq</button>
        <button onClick={() => alignEdge('right')} disabled={!imgEl}>Der</button>
        <button onClick={() => alignEdge('top')} disabled={!imgEl}>Arriba</button>
        <button onClick={() => alignEdge('bottom')} disabled={!imgEl}>Abajo</button>
        <button onClick={() => rotate(-90)} disabled={!imgEl}>⟲ -90°</button>
        <button onClick={() => rotate(90)} disabled={!imgEl}>⟳ +90°</button>

        <button onClick={flipHoriz} disabled={!imgEl}>Espejo H</button>
        <button onClick={flipVert} disabled={!imgEl}>Espejo V</button>

        <label
          className={styles.freeScale}
          title="Permite deformar sin mantener proporción."
        >
          <input
            type="checkbox"
            checked={freeScale}
            onChange={e => setFreeScale(e.target.checked)}
          />
          Escalar libre
        </label>

        <span className={`${styles.qualityBadge} ${
          quality.color === '#ef4444' ? styles.qualityBad :
          quality.color === '#f59e0b' ? styles.qualityWarn :
          quality.color === '#10b981' ? styles.qualityOk :
          styles.qualityUnknown
        }`}>
          Calidad: {quality.label}
        </span>
        <button
          onClick={onConfirmSubmit}
          disabled={busy || !imgEl || !imageFile}
          className={styles.confirmButton}
        >{busy ? 'Creando…' : 'Crear job'}</button>
      </div>

      {notice && <p className={styles.notice}>{notice}</p>}
      {lastDiag && <p className={styles.errorBox}>{lastDiag}</p>}

      {/* Canvas */}
      <div
        ref={wrapRef}
        className={`${styles.canvasWrapper} ${isPanningRef.current ? styles.grabbing : ''} ${isPickingColor ? styles.picking : ''}`}
      >
        <button
          onClick={undo}
          disabled={histIndex <= 0}
          className={styles.undoButton}
        >↺</button>
        <Stage
          ref={stageRef}
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
                    scaleX={flipXSign}
                    scaleY={flipYSign}
                    offsetX={dispW / 2}
                    offsetY={dispH / 2}
                    rotation={imgTx.rotation_deg}
                    onPointerDown={onImgPointerDown}
                    onPointerMove={onImgPointerMove}
                    onPointerUp={onImgPointerUp}
                    onPointerLeave={onImgPointerUp}
                    onPointerCancel={onImgPointerUp}
                  />
                  <Transformer
                    ref={trRef}
                    visible={showTransformer}
                    rotateEnabled
                    rotationSnaps={[0, 90, 180, 270]}
                    keepRatio={false}
                    enabledAnchors={['top-left','top-right','bottom-left','bottom-right','top-center','bottom-center','middle-left','middle-right']}
                    boundBoxFunc={(oldBox, newBox) => {
                      const MIN_W = MIN_SCALE * (imgBaseCm?.w || 1);
                      const MIN_H = MIN_SCALE * (imgBaseCm?.h || 1);
                      const MAX_W = (imgBaseCm?.w || 1) * IMG_ZOOM_MAX;
                      const MAX_H = (imgBaseCm?.h || 1) * IMG_ZOOM_MAX;
                      const w = Math.max(MIN_W, Math.min(newBox.width,  MAX_W));
                      const h = Math.max(MIN_H, Math.min(newBox.height, MAX_H));
                      return { ...newBox, width: w, height: h };
                    }}
                    onTransformStart={onTransformStart}
                    onTransform={onTransform}
                    onTransformEnd={onTransformEnd}
                  />
                  {DEBUG_TRANSFORM && (
                    <Group listening={false}>
                      {scaleGestureRef.current?.startAnchor && (
                        <Circle x={scaleGestureRef.current.startAnchor.x} y={scaleGestureRef.current.startAnchor.y} radius={0.5} fill="red" />
                      )}
                      <Rect
                        x={imgTx.x_cm + dispW / 2}
                        y={imgTx.y_cm + dispH / 2}
                        width={dispW}
                        height={dispH}
                        offsetX={dispW / 2}
                        offsetY={dispH / 2}
                        rotation={imgTx.rotation_deg}
                        stroke="red"
                      />
                      <Text
                        x={1}
                        y={1}
                        fontSize={3}
                        fill="red"
                        text={`tx:${imgTx.x_cm.toFixed(1)} ty:${imgTx.y_cm.toFixed(1)} sx:${imgTx.scaleX.toFixed(2)} sy:${imgTx.scaleY.toFixed(2)} θ:${imgTx.rotation_deg.toFixed(1)}`}
                      />
                    </Group>
                  )}
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
                    scaleX={flipXSign}
                    scaleY={flipYSign}
                    offsetX={dispW / 2}
                    offsetY={dispH / 2}
                    rotation={imgTx.rotation_deg}
                    onPointerDown={onImgPointerDown}
                    onPointerMove={onImgPointerMove}
                    onPointerUp={onImgPointerUp}
                    onPointerLeave={onImgPointerUp}
                    onPointerCancel={onImgPointerUp}
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
        <Stage
          ref={exportStageRef}
          width={padRectPx.w}
          height={padRectPx.h}
          style={{ display: 'none' }}
        >
          <Layer>
            <Rect
              x={0}
              y={0}
              width={padRectPx.w}
              height={padRectPx.h}
              fill={mode === 'contain' ? (bgColor || '#ffffff') : '#ffffff'}
              listening={false}
            />
            {imgEl && imgBaseCm && (
              <KonvaImage
                image={imgEl}
                x={(imgTx.x_cm - bleedCm + dispW / 2) * viewPxPerCm}
                y={(imgTx.y_cm - bleedCm + dispH / 2) * viewPxPerCm}
                width={dispW * viewPxPerCm}
                height={dispH * viewPxPerCm}
                scaleX={flipXSign}
                scaleY={flipYSign}
                offsetX={(dispW * viewPxPerCm) / 2}
                offsetY={(dispH * viewPxPerCm) / 2}
                rotation={imgTx.rotation_deg}
                listening={false}
              />
            )}
          </Layer>
        </Stage>
        {isPickingColor && (
          <div
            className={styles.pickOverlay}
            style={{ left: pickOverlay.x, top: pickOverlay.y }}
          >
            <canvas ref={loupeRef} width={120} height={120} />
            <div
              className={styles.pickLabel}
              style={{ background: pickOverlay.hex }}
            >
              {pickOverlay.hex}
            </div>
          </div>
        )}
        {imageUrl && imgStatus !== 'loaded' && (
          <div className={`spinner ${styles.spinnerOverlay}`} />
        )}
        </div>
      </div>
    );
});

export default EditorCanvas;
