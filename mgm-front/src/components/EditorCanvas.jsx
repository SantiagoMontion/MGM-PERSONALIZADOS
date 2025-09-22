/* eslint-disable */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  Stage,
  Layer,
  Rect,
  Group,
  Image as KonvaImage,
  Transformer,
} from "react-konva";
import Konva from "konva";
import useImage from "use-image";
import styles from "./EditorCanvas.module.css";
import ColorPopover from "./ColorPopover";

import { buildSubmitJobBody, prevalidateSubmitBody } from "../lib/jobPayload";
import { submitJob } from "../lib/submitJob";
import { renderGlasspadPNG } from "../lib/renderGlasspadPNG";

const CM_PER_INCH = 2.54;
const mmToCm = (mm) => mm / 10;

const VIEW_ZOOM_MIN = 0.3;
const VIEW_ZOOM_MAX = 12;
const IMG_ZOOM_MAX = 400; // límite amplio cuando mantengo proporción
const STAGE_BG = "#e5e7eb";
const SNAP_LIVE_CM = 2.0;
const RELEASE_BASE_CM = 0.8;
const RELEASE_MIN_CM = 0.2;
const PRIMARY_SAFE_MARGIN_CM = 1.1;
const SECONDARY_MARGIN_GAP_CM = 0.3;
const SECONDARY_SAFE_MARGIN_CM =
  PRIMARY_SAFE_MARGIN_CM + SECONDARY_MARGIN_GAP_CM;
const CORNER_ANCHORS = new Set([
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
]);

const toolbarIconModules = import.meta.glob("../icons/*.{svg,png}", {
  eager: true,
  import: "default",
});

const resolveIconAsset = (fileName) => {
  const normalized = `../icons/${fileName}`;
  const directMatch = toolbarIconModules[normalized];
  if (directMatch) return directMatch;

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".svg")) {
    const pngKey = normalized.replace(/\.svg$/i, ".png");
    if (toolbarIconModules[pngKey]) {
      return toolbarIconModules[pngKey];
    }
  } else if (lower.endsWith(".png")) {
    const svgKey = normalized.replace(/\.png$/i, ".svg");
    if (toolbarIconModules[svgKey]) {
      return toolbarIconModules[svgKey];
    }
  }

  return `/icons/${fileName}`;
};

const ACTION_ICON_MAP = {
  izquierda: resolveIconAsset("izquierda.svg"),
  centrado_V: resolveIconAsset("centrado_V.svg"),
  derecha: resolveIconAsset("derecha.svg"),
  arriba: resolveIconAsset("arriba.svg"),
  centrado_h: resolveIconAsset("centrado_h.svg"),
  abajo: resolveIconAsset("abajo.svg"),
  rotar: resolveIconAsset("rotar.svg"),
  espejo_v: resolveIconAsset("espejo_v.svg"),
  espejo_h: resolveIconAsset("espejo_h.svg"),
  cubrir: resolveIconAsset("cubrir.svg"),
  contener: resolveIconAsset("contener.svg"),
  estirar: resolveIconAsset("estirar.svg"),
};

// ---------- Editor ----------
const EditorCanvas = forwardRef(function EditorCanvas(
  {
    imageUrl,
    imageFile,
    sizeCm = { w: 90, h: 40 }, // tamaño final SIN sangrado (cm)
    bleedMm = 3,
    dpi = 300,
    onLayoutChange,
    material,
    onPickedColor,
  },
  ref,
) {
  const wCm = Number(sizeCm?.w ?? 90);
  const hCm = Number(sizeCm?.h ?? 40);
  const bleedCm = mmToCm(bleedMm);
  const cornerRadiusCm = 1.5;
  const workCm = useMemo(
    () => ({ w: wCm + 2 * bleedCm, h: hCm + 2 * bleedCm }),
    [wCm, hCm, bleedCm],
  );

  // viewport
  const wrapRef = useRef(null);
  const stageRef = useRef(null);
  const exportStageRef = useRef(null);
  const padGroupRef = useRef(null);
  const glassOverlayRef = useRef(null);
  const [wrapSize, setWrapSize] = useState({ w: 960, h: 540 });
  const hasAdjustedViewRef = useRef(false);
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const r = wrapRef.current?.getBoundingClientRect();
      if (!r) return;
      const next = { w: r.width, h: Math.max(360, r.height) };
      setWrapSize((prev) =>
        prev.w !== next.w || prev.h !== next.h ? next : prev,
      );
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
  const [missingIcons, setMissingIcons] = useState({});

  const handleIconError = (action) => () => {
    setMissingIcons((prev) => (prev[action] ? prev : { ...prev, [action]: true }));
  };

  const pointerWorld = (stage) => {
    const pt = stage.getPointerPosition();
    const k = baseScale * viewScale;
    return { x: (pt.x - viewPos.x) / k, y: (pt.y - viewPos.y) / k };
  };
  const isOutsideWorkArea = (wp) =>
    wp.x < 0 || wp.y < 0 || wp.x > workCm.w || wp.y > workCm.h;

  const startPickColor = useCallback((cb) => {
    pickCallbackRef.current = cb;
    pickingColorRef.current = true;
    setIsPickingColor(true);
  }, []);

  // selección
  const imgRef = useRef(null);
  const trRef = useRef(null);
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

    if (pickingColorRef.current) {
      if (
        wp.x >= bleedCm &&
        wp.x <= bleedCm + wCm &&
        wp.y >= bleedCm &&
        wp.y <= bleedCm + hCm
      ) {
        const k = baseScale * viewScale;
        const px = Math.floor((wp.x - bleedCm) * k);
        const py = Math.floor((wp.y - bleedCm) * k);
        try {
          const canvas = exportStageRef.current?.toCanvas();
          const ctx = canvas?.getContext("2d");
          const data = ctx?.getImageData(px, py, 1, 1)?.data;
          if (data) {
            const hex = `#${[0, 1, 2]
              .map((i) => data[i].toString(16).padStart(2, "0"))
              .join("")}`;
            pickCallbackRef.current?.(hex);
            onPickedColor?.(hex);
          }
        } catch (err) {
          /* ignore */
        }
      }
      pickCallbackRef.current = null;
      pickingColorRef.current = false;
      setIsPickingColor(false);
      return;
    }

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
    if (dx !== 0 || dy !== 0) {
      hasAdjustedViewRef.current = true;
    }
    lastPointerRef.current = { x: clientX, y: clientY };
    setViewPos((p) => ({ x: p.x + dx, y: p.y + dy }));
  };
  const endPan = () => {
    isPanningRef.current = false;
  };

  const onStageWheel = (e) => {
    e.evt.preventDefault();
    const { shiftKey, deltaY } = e.evt;
    if (shiftKey) {
      const step = (deltaY / 2) | 0;
      hasAdjustedViewRef.current = true;
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
    hasAdjustedViewRef.current = true;
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
      w: (imgEl.naturalWidth / dpi) * CM_PER_INCH,
      h: (imgEl.naturalHeight / dpi) * CM_PER_INCH,
    };
  }, [imgEl, dpi]);

  const [imgTx, setImgTx] = useState({
    x_cm: 0,
    y_cm: 0,
    scaleX: 1,
    scaleY: 1,
    rotation_deg: 0,
  });
  const historyRef = useRef([]); // pila de estados para undo
  const [histIndex, setHistIndex] = useState(-1);
  const pushHistory = useCallback(
    (tx) => {
      historyRef.current = historyRef.current.slice(0, histIndex + 1);
      historyRef.current.push(tx);
      setHistIndex(historyRef.current.length - 1);
    },
    [histIndex],
  );
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
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo]);

  const [keepRatio, setKeepRatio] = useState(true);
  const keepRatioRef = useRef(true);
  const [mode, setMode] = useState("cover"); // 'cover' | 'contain' | 'stretch'
  const stickyFitRef = useRef(null);
  const skipStickyFitOnceRef = useRef(false);
  const [bgColor, setBgColor] = useState("#ffffff");
  const isTransformingRef = useRef(false);
  const setKeepRatioImmediate = useCallback(
    (value) => {
      keepRatioRef.current = value;
      setKeepRatio(value);
      if (trRef.current) {
        trRef.current.keepRatio(value);
        trRef.current.getLayer()?.batchDraw();
      }
    },
    [setKeepRatio],
  );

  const moveBy = useCallback(
    (dx, dy) => {
      pushHistory(imgTx);
      stickyFitRef.current = null;
      skipStickyFitOnceRef.current = false;
      setImgTx((tx) => ({ ...tx, x_cm: tx.x_cm + dx, y_cm: tx.y_cm + dy }));
    },
    [imgTx, pushHistory],
  );

  useEffect(() => {
    const handler = (e) => {
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key))
        return;
      e.preventDefault();
      const step = e.shiftKey ? 1 : 0.5;
      if (e.key === "ArrowUp") moveBy(0, -step);
      if (e.key === "ArrowDown") moveBy(0, step);
      if (e.key === "ArrowLeft") moveBy(-step, 0);
      if (e.key === "ArrowRight") moveBy(step, 0);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [moveBy]);

  const didInitRef = useRef(false);
  // Reiniciar al cargar una nueva imagen
  useEffect(() => {
    historyRef.current = [];
    setHistIndex(-1);
    stickyFitRef.current = null;
    skipStickyFitOnceRef.current = false;
    didInitRef.current = false;
    hasAdjustedViewRef.current = false;
    setViewScale(1);
    const stageW = workCm.w * baseScale;
    const stageH = workCm.h * baseScale;
    setViewPos({
      x: (wrapSize.w - stageW) / 2,
      y: (wrapSize.h - stageH) / 2,
    });
  }, [imageUrl, imageFile]);

  // Ajuste inicial: imagen contenida y centrada una sola vez por carga
  useEffect(() => {
    if (!imgBaseCm || didInitRef.current) return;
    const s = Math.min(workCm.w / imgBaseCm.w, workCm.h / imgBaseCm.h);
    const w = imgBaseCm.w * s,
      h = imgBaseCm.h * s;
    const initial = {
      x_cm: (workCm.w - w) / 2,
      y_cm: (workCm.h - h) / 2,
      scaleX: s,
      scaleY: s,
      rotation_deg: 0,
    };
    setImgTx(initial);
    pushHistory(initial);
    setMode("contain");
    stickyFitRef.current = "contain";
    skipStickyFitOnceRef.current = true;
    didInitRef.current = true;
  }, [imgBaseCm, workCm.w, workCm.h]);

  // medidas visuales (para offset centro)
  const dispW = imgBaseCm ? imgBaseCm.w * imgTx.scaleX : 0;
  const dispH = imgBaseCm ? imgBaseCm.h * imgTx.scaleY : 0;
  const hasGlassOverlay =
    material === "Glasspad" &&
    !!imgEl &&
    !!imgBaseCm &&
    dispW > 0 &&
    dispH > 0;

  useEffect(() => {
    const node = glassOverlayRef.current;
    if (!node) return;
    if (!hasGlassOverlay) {
      node.clearCache();
      node.filters([]);
      node.getLayer()?.batchDraw();
      return;
    }
    const pixelRatio = Math.max(1, 2 * baseScale * viewScale);
    node.cache({ pixelRatio });
    node.filters([Konva.Filters.Blur]);
    node.blurRadius(1);
    node.getLayer()?.batchDraw();
  }, [
    hasGlassOverlay,
    baseScale,
    viewScale,
    imgTx.x_cm,
    imgTx.y_cm,
    imgTx.rotation_deg,
    imgTx.scaleX,
    imgTx.scaleY,
  ]);

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
    stickyFitRef.current = null;
    skipStickyFitOnceRef.current = false;
  };
  const dragBoundFunc = useCallback(
    (pos) => {
      if (!imgBaseCm || isTransformingRef.current) return pos;

      let cx = pos.x;
      let cy = pos.y;

      const w = imgBaseCm.w * imgTx.scaleX;
      const h = imgBaseCm.h * imgTx.scaleY;
      const { halfW, halfH } = rotAABBHalf(w, h, theta);

      const releaseCm = Math.max(
        RELEASE_MIN_CM,
        RELEASE_BASE_CM / Math.max(viewScale, 1),
      );

      const dL = Math.abs(cx - halfW - 0);
      const dR = Math.abs(workCm.w - (cx + halfW));
      const dT = Math.abs(cy - halfH - 0);
      const dB = Math.abs(workCm.h - (cy + halfH));

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
          if (dL < 0.3) {
            cx = target;
            stickRef.current = {
              ...stickRef.current,
              activeX: true,
              x: target,
            };
          }
        } else if (eR > 0) {
          const target = workCm.w - halfW;
          cx = cx * (1 - eR) + target * eR;
          if (dR < 0.3) {
            cx = target;
            stickRef.current = {
              ...stickRef.current,
              activeX: true,
              x: target,
            };
          }
        }
      } else {
        const diff = cx - stickRef.current.x;
        if (Math.abs(diff) > releaseCm) {
          stickRef.current = { ...stickRef.current, activeX: false, x: null };
        } else {
          cx = stickRef.current.x + diff * 0.35;
        }
      }

      // Y
      if (!stickRef.current.activeY) {
        const eT = ease(dT);
        const eB = ease(dB);
        if (eT > 0 && eT >= eB) {
          const target = halfH;
          cy = cy * (1 - eT) + target * eT;
          if (dT < 0.3) {
            cy = target;
            stickRef.current = {
              ...stickRef.current,
              activeY: true,
              y: target,
            };
          }
        } else if (eB > 0) {
          const target = workCm.h - halfH;
          cy = cy * (1 - eB) + target * eB;
          if (dB < 0.3) {
            cy = target;
            stickRef.current = {
              ...stickRef.current,
              activeY: true,
              y: target,
            };
          }
        }
      } else {
        const diff = cy - stickRef.current.y;
        if (Math.abs(diff) > releaseCm) {
          stickRef.current = { ...stickRef.current, activeY: false, y: null };
        } else {
          cy = stickRef.current.y + diff * 0.35;
        }
      }

      return { x: cx, y: cy };
    },
    [
      imgBaseCm,
      imgTx.scaleX,
      imgTx.scaleY,
      theta,
      viewScale,
      workCm.w,
      workCm.h,
    ],
  );

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
    keepRatioRef.current = keepRatio;
    if (!trRef.current) return;
    trRef.current.keepRatio(keepRatio);
    if (showTransformer && imgRef.current)
      trRef.current.nodes([imgRef.current]);
    else trRef.current.nodes([]);
    trRef.current.getLayer()?.batchDraw();
  }, [imgEl, keepRatio, showTransformer]);

  // fin de resize por esquinas
  const onTransformStart = useCallback(() => {
    isTransformingRef.current = true;
    stickRef.current = { x: null, y: null, activeX: false, activeY: false };
    const anchorName = trRef.current?.getActiveAnchor();
    const shouldKeep =
      !anchorName ||
      anchorName === "rotater" ||
      CORNER_ANCHORS.has(anchorName);
    setKeepRatioImmediate(shouldKeep);
  }, [setKeepRatioImmediate]);

  const onTransformEnd = () => {
    isTransformingRef.current = false;
    stickRef.current = { x: null, y: null, activeX: false, activeY: false };
    if (!imgRef.current || !imgBaseCm) {
      setKeepRatioImmediate(true);
      return;
    }
    pushHistory(imgTx);
    stickyFitRef.current = null;
    skipStickyFitOnceRef.current = false;
    const n = imgRef.current;
    const nextScaleX = n.scaleX();
    const nextScaleY = n.scaleY();
    const nextW = n.width() * nextScaleX;
    const nextH = n.height() * nextScaleY;
    const rotation = n.rotation();
    const nextCenterX = n.x();
    const nextCenterY = n.y();
    const keepRatioAtRelease = keepRatioRef.current;
    setImgTx((prev) => {
      const prevW = imgBaseCm.w * prev.scaleX;
      const prevH = imgBaseCm.h * prev.scaleY;
      const cx = nextCenterX;
      const cy = nextCenterY;
      const ratioX =
        prevW !== 0 && Number.isFinite(nextW / prevW) ? nextW / prevW : 1;
      const ratioY =
        prevH !== 0 && Number.isFinite(nextH / prevH) ? nextH / prevH : 1;
      const shouldKeep = keepRatioAtRelease;
      // libre => sin límites superiores
      if (!shouldKeep) {
        const newSX = Math.max(prev.scaleX * ratioX, 0.01);
        const newSY = Math.max(prev.scaleY * ratioY, 0.01);
        const w = imgBaseCm.w * newSX;
        const h = imgBaseCm.h * newSY;
        return {
          x_cm: cx - w / 2,
          y_cm: cy - h / 2,
          scaleX: newSX,
          scaleY: newSY,
          rotation_deg: rotation,
        };
      }
      // mantener proporción con clamp razonable
      const uni = Math.max(
        0.01,
        Math.min(prev.scaleX * ratioX, IMG_ZOOM_MAX),
      );
      const w = imgBaseCm.w * uni;
      const h = imgBaseCm.h * uni;
      return {
        x_cm: cx - w / 2,
        y_cm: cy - h / 2,
        scaleX: uni,
        scaleY: uni,
        rotation_deg: rotation,
      };
    });
    n.scaleX(1);
    n.scaleY(1);
    setKeepRatioImmediate(true);
  };

  // centro actual
  const currentCenter = () => {
    const w = imgBaseCm.w * imgTx.scaleX;
    const h = imgBaseCm.h * imgTx.scaleY;
    return { cx: imgTx.x_cm + w / 2, cy: imgTx.y_cm + h / 2 };
  };

  // cover/contain/estirar con rotación
  const applyFit = useCallback(
    (mode, options = {}) => {
      if (!imgBaseCm) return;
      const fallbackCenter = currentCenter();
      const targetCx =
        options?.center?.x ??
        options?.center?.cx ??
        fallbackCenter.cx;
      const targetCy =
        options?.center?.y ??
        options?.center?.cy ??
        fallbackCenter.cy;
      const w = imgBaseCm.w,
        h = imgBaseCm.h;
      const c = Math.abs(Math.cos(theta));
      const s = Math.abs(Math.sin(theta));

      if (mode === "cover" || mode === "contain") {
        const denomW = w * c + h * s;
        const denomH = w * s + h * c;
        const scale =
          mode === "cover"
            ? Math.max(workCm.w / denomW, workCm.h / denomH)
            : Math.min(workCm.w / denomW, workCm.h / denomH);
        const newW = w * scale,
          newH = h * scale;
        pushHistory(imgTx);
        setImgTx((prev) => ({
          x_cm: targetCx - newW / 2,
          y_cm: targetCy - newH / 2,
          scaleX: scale,
          scaleY: scale,
          rotation_deg: prev.rotation_deg,
        }));
        setMode(mode);
        return;
      }

      if (mode === "stretch") {
        const A11 = w * c,
          A12 = h * s;
        const A21 = w * s,
          A22 = h * c;
        const det = A11 * A22 - A12 * A21;
        let sx = 1,
          sy = 1;
        if (Math.abs(det) > 1e-6) {
          sx = (workCm.w * A22 - A12 * workCm.h) / det;
          sy = (-A21 * workCm.w + A11 * workCm.h) / det;
        } else {
          const denomW = w * c + h * s;
          const denomH = w * s + h * c;
          const sCover = Math.max(workCm.w / denomW, workCm.h / denomH);
          sx = sy = sCover;
        }
        sx = Math.max(sx, 0.02);
        sy = Math.max(sy, 0.02);
        const newW = w * sx,
          newH = h * sy;
        pushHistory(imgTx);
        setImgTx((prev) => ({
          x_cm: targetCx - newW / 2,
          y_cm: targetCy - newH / 2,
          scaleX: sx,
          scaleY: sy,
          rotation_deg: prev.rotation_deg,
        }));
        setMode("stretch");
      }
    },
    [
      imgBaseCm?.w,
      imgBaseCm?.h,
      workCm.w,
      workCm.h,
      theta,
      imgTx.x_cm,
      imgTx.y_cm,
      imgTx.scaleX,
      imgTx.scaleY,
    ],
  );

  const fitCover = useCallback(() => {
    applyFit("cover");
    stickyFitRef.current = "cover";
  }, [applyFit]);
  const fitContain = useCallback(() => {
    applyFit("contain");
    stickyFitRef.current = "contain";
  }, [applyFit]);
  const fitStretchCentered = useCallback(() => {
    applyFit("stretch");
    stickyFitRef.current = "stretch";
  }, [applyFit]);

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

    let cx = imgTx.x_cm + w / 2;
    let cy = imgTx.y_cm + h / 2;

    if (edge === "left") cx = halfW;
    if (edge === "right") cx = workCm.w - halfW;
    if (edge === "top") cy = halfH;
    if (edge === "bottom") cy = workCm.h - halfH;

    pushHistory(imgTx);
    setImgTx((tx) => ({
      ...tx,
      x_cm: cx - (imgBaseCm.w * tx.scaleX) / 2,
      y_cm: cy - (imgBaseCm.h * tx.scaleY) / 2,
    }));
  };

  useEffect(() => {
    if (!stickyFitRef.current) return;
    if (skipStickyFitOnceRef.current) {
      skipStickyFitOnceRef.current = false;
      return;
    }
    applyFit(stickyFitRef.current, {
      center: { x: workCm.w / 2, y: workCm.h / 2 },
    });
  }, [material, wCm, hCm, workCm.w, workCm.h, imgBaseCm]);

  useEffect(() => {
    if (hasAdjustedViewRef.current) return;
    const stageW = workCm.w * baseScale;
    const stageH = workCm.h * baseScale;
    const targetX = (wrapSize.w - stageW) / 2;
    const targetY = (wrapSize.h - stageH) / 2;
    setViewScale((prev) => (prev === 1 ? prev : 1));
    setViewPos((prev) => {
      if (
        Math.abs(prev.x - targetX) < 0.5 &&
        Math.abs(prev.y - targetY) < 0.5
      ) {
        return prev;
      }
      return { x: targetX, y: targetY };
    });
  }, [
    baseScale,
    wrapSize.w,
    wrapSize.h,
    workCm.w,
    workCm.h,
    imageUrl,
    imageFile,
  ]);

  // calidad
  const dpiEffective = useMemo(() => {
    if (!imgEl || !imgBaseCm) return null;
    const printedWcm = imgBaseCm.w * imgTx.scaleX;
    const printedHcm = imgBaseCm.h * imgTx.scaleY;
    if (printedWcm <= 0 || printedHcm <= 0) return null;
    const printedWin = printedWcm / CM_PER_INCH;
    const printedHin = printedHcm / CM_PER_INCH;
    const dpiX = imgEl.naturalWidth / printedWin;
    const dpiY = imgEl.naturalHeight / printedHin;
    return Math.max(1, Math.min(1000, Math.min(dpiX, dpiY)));
  }, [imgEl, imgBaseCm, imgTx.scaleX, imgTx.scaleY]);

  const quality = useMemo(() => {
    if (dpiEffective == null) return { label: "—", color: "#9ca3af" };
    if (dpiEffective < 80)
      return { label: `Baja (${dpiEffective | 0} DPI)`, color: "#ef4444" };
    if (dpiEffective < 200)
      return { label: `Buena (${dpiEffective | 0} DPI)`, color: "#f59e0b" };
    return {
      label: `Excelente (${Math.min(300, dpiEffective | 0)} DPI)`,
      color: "#10b981",
    };
  }, [dpiEffective]);

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
    const cmPerPx = CM_PER_INCH / dpi;
    const canvas_px = {
      w: Math.round(workCm.w / cmPerPx),
      h: Math.round(workCm.h / cmPerPx),
    };
    const w = imgBaseCm.w * imgTx.scaleX;
    const h = imgBaseCm.h * imgTx.scaleY;
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
      fit_mode: mode,
      bg_hex: bgColor,
      w_cm: wCm,
      h_cm: hCm,
      bleed_mm: bleedMm,
      material,
    };
  };

  const padRectPx = getPadRectPx();
  const exportScale = padRectPx.w / wCm;

  const exportPadAsBlob = async () => {
    if (!exportStageRef.current) return null;
    const inner_w_px = Math.round((wCm * dpi) / CM_PER_INCH);
    const inner_h_px = Math.round((hCm * dpi) / CM_PER_INCH);
    const pad_px = getPadRectPx();
    const pixelRatioX = inner_w_px / pad_px.w;
    const pixelRatioY = inner_h_px / pad_px.h;
    const pixelRatio = Math.min(pixelRatioX, pixelRatioY);
    const baseCanvas = exportStageRef.current.toCanvas({ pixelRatio });
    let uploadCanvas = baseCanvas;
    if (material === "Glasspad") {
      uploadCanvas = renderGlasspadPNG(baseCanvas);
    }
    const blob = await new Promise((resolve) =>
      uploadCanvas.toBlob((b) => resolve(b), "image/png", 1)
    );
    const outBitmap = await new Promise((resolve) => {
      const i = new Image();
      i.onload = () => resolve({ width: i.width, height: i.height });
      i.src = URL.createObjectURL(blob);
    });
    return blob;
  };

  const exportPreviewDataURL = () => {
    if (padGroupRef.current) {
      try {
        return padGroupRef.current.toDataURL({
          pixelRatio: 0.5,
          mimeType: 'image/png',
        });
      } catch (e) {
        /* ignore */
      }
    }
    if (!exportStageRef.current) return null;
    try {
      return exportStageRef.current.toDataURL({ pixelRatio: 0.5 });
    } catch (e) {
      return null;
    }
  };

  const exportPadDataURL = (pixelRatio = 1) => {
    if (padGroupRef.current) {
      try {
        return padGroupRef.current.toDataURL({
          pixelRatio,
          mimeType: 'image/png',
          x: 0,
          y: 0,
          width: padRectPx.w,
          height: padRectPx.h,
        });
      } catch (e) {
        /* ignore */
      }
    }
    if (!exportStageRef.current) return null;
    try {
      return exportStageRef.current.toDataURL({
        pixelRatio,
        mimeType: 'image/png',
      });
    } catch (e) {
      return null;
    }
  };

  useImperativeHandle(ref, () => ({
    getRenderDescriptor: () => {
      if (!imgEl || !imgBaseCm) return null;
      const naturalW = imgEl.naturalWidth;
      const naturalH = imgEl.naturalHeight;
      const cmPerPx = CM_PER_INCH / dpi;
      const dispW = imgBaseCm.w * imgTx.scaleX;
      const dispH = imgBaseCm.h * imgTx.scaleY;
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
        const sx = (rx + dispW / 2) / (cmPerPx * imgTx.scaleX);
        const sy = (ry + dispH / 2) / (cmPerPx * imgTx.scaleY);
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
      let left = Math.max(0, Math.min(...pts.map((p) => p.sx)));
      let top = Math.max(0, Math.min(...pts.map((p) => p.sy)));
      let right = Math.min(naturalW, Math.max(...pts.map((p) => p.sx)));
      let bottom = Math.min(naturalH, Math.max(...pts.map((p) => p.sy)));
      left = Math.floor(left);
      top = Math.floor(top);
      const width = Math.ceil(right - left);
      const height = Math.ceil(bottom - top);
      return {
        src_px: { w: naturalW, h: naturalH },
        crop_px: { left, top, width, height },
        rotate_deg: ((imgTx.rotation_deg % 360) + 360) % 360,
        fit_mode: mode,
        bg: mode === "contain" ? bgColor : "#ffffff",
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
    exportPreviewDataURL,
    exportPadDataURL,
    startPickColor,
  }));

  // popover color
  const [colorOpen, setColorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastDiag, setLastDiag] = useState(null);
  const toggleContain = () => {
    fitContain();
    setColorOpen(true);
  };
  const closeColor = () => setColorOpen(false);
  // track latest callback to avoid effect loops when parent re-renders
  const layoutChangeRef = useRef(onLayoutChange);
  useEffect(() => {
    layoutChangeRef.current = onLayoutChange;
  }, [onLayoutChange]);

  // export layout
  useEffect(() => {
    layoutChangeRef.current?.({
      dpi,
      bleed_mm: bleedMm,
      size_cm: { w: wCm, h: hCm },
      image: imgEl
        ? { natural_px: { w: imgEl.naturalWidth, h: imgEl.naturalHeight } }
        : null,
      transform: {
        x_cm: imgTx.x_cm,
        y_cm: imgTx.y_cm,
        scaleX: imgTx.scaleX,
        scaleY: imgTx.scaleY,
        rotation_deg: imgTx.rotation_deg,
      },
      mode,
      background: mode === "contain" ? bgColor : "#ffffff",
      corner_radius_cm: cornerRadiusCm,
    });
  }, [dpi, bleedMm, wCm, hCm, imgEl, imgTx, mode, bgColor, cornerRadiusCm]);

  // Confirmar y crear job
  async function onConfirmSubmit() {
    try {
      const submitBody = buildSubmitJobBody({
        material: materialSelected,
        size: { w: sizeCm?.w, h: sizeCm?.h, bleed_mm: 3 },
        fit_mode: transform?.fitMode, // 'cover'|'contain'|'stretch'
        bg: bgColor || "#ffffff",
        dpi: Math.round(currentDpi || 300),
        uploads: {
          signed_url: uploadUrlResponse?.upload?.signed_url,
          object_key: uploadUrlResponse?.object_key,
          canonical: uploaded?.file_original_url,
        },
        file_hash: fileSha256,
        price: { amount: 45900, currency: "ARS" },
        customer: { email: customerEmail, name: customerName },
        notes: "",
        source: "web",
      });

      const pre = prevalidateSubmitBody(submitBody);
      if (!pre.ok) {
        console.error("[PREVALIDATE EditorCanvas]", pre, submitBody);
        alert(pre.problems.join("\n"));
        return;
      }

        const job = await submitJob(submitBody);

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
        <button
          type="button"
          onClick={fitCover}
          disabled={!imgEl}
          aria-label="Cubrir"
          title="Cubrir"
          className={styles.iconOnlyButton}
        >
          {missingIcons.cubrir ? (
            <span className={styles.iconFallback} aria-hidden="true" />
          ) : (
            <img
              src={ACTION_ICON_MAP.cubrir}
              alt="Cubrir"
              className={styles.iconOnlyButtonImage}
              onError={handleIconError("cubrir")}
            />
          )}
        </button>

        <div className={styles.colorWrapper}>
          <button
            type="button"
            onClick={toggleContain}
            disabled={!imgEl}
            aria-label="Contener"
            title="Contener"
            className={styles.iconOnlyButton}
          >
            {missingIcons.contener ? (
              <span className={styles.iconFallback} aria-hidden="true" />
            ) : (
              <img
                src={ACTION_ICON_MAP.contener}
                alt="Contener"
                className={styles.iconOnlyButtonImage}
                onError={handleIconError("contener")}
              />
            )}
          </button>
          {mode === "contain" && imgEl && (
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

        <button
          type="button"
          onClick={fitStretchCentered}
          disabled={!imgEl}
          aria-label="Estirar"
          title="Estirar"
          className={styles.iconOnlyButton}
        >
          {missingIcons.estirar ? (
            <span className={styles.iconFallback} aria-hidden="true" />
          ) : (
            <img
              src={ACTION_ICON_MAP.estirar}
              alt="Estirar"
              className={styles.iconOnlyButtonImage}
              onError={handleIconError("estirar")}
            />
          )}
        </button>

        <button
          type="button"
          onClick={centerHoriz}
          disabled={!imgEl}
          aria-label="Centrar horizontal"
          title="Centrar horizontal"
          className={styles.iconOnlyButton}
        >
          {missingIcons.centrado_h ? (
            <span className={styles.iconFallback} aria-hidden="true" />
          ) : (
            <img
              src={ACTION_ICON_MAP.centrado_h}
              alt="Centrar horizontal"
              className={styles.iconOnlyButtonImage}
              onError={handleIconError("centrado_h")}
            />
          )}
        </button>
        <button
          type="button"
          onClick={centerVert}
          disabled={!imgEl}
          aria-label="Centrar vertical"
          title="Centrar vertical"
          className={styles.iconOnlyButton}
        >
          {missingIcons.centrado_V ? (
            <span className={styles.iconFallback} aria-hidden="true" />
          ) : (
            <img
              src={ACTION_ICON_MAP.centrado_V}
              alt="Centrar vertical"
              className={styles.iconOnlyButtonImage}
              onError={handleIconError("centrado_V")}
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => alignEdge("left")}
          disabled={!imgEl}
          aria-label="Alinear a la izquierda"
          title="Alinear a la izquierda"
          className={styles.iconOnlyButton}
        >
          {missingIcons.izquierda ? (
            <span className={styles.iconFallback} aria-hidden="true" />
          ) : (
            <img
              src={ACTION_ICON_MAP.izquierda}
              alt="Izquierda"
              className={styles.iconOnlyButtonImage}
              onError={handleIconError("izquierda")}
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => alignEdge("right")}
          disabled={!imgEl}
          aria-label="Alinear a la derecha"
          title="Alinear a la derecha"
          className={styles.iconOnlyButton}
        >
          {missingIcons.derecha ? (
            <span className={styles.iconFallback} aria-hidden="true" />
          ) : (
            <img
              src={ACTION_ICON_MAP.derecha}
              alt="Derecha"
              className={styles.iconOnlyButtonImage}
              onError={handleIconError("derecha")}
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => alignEdge("top")}
          disabled={!imgEl}
          aria-label="Alinear arriba"
          title="Alinear arriba"
          className={styles.iconOnlyButton}
        >
          {missingIcons.arriba ? (
            <span className={styles.iconFallback} aria-hidden="true" />
          ) : (
            <img
              src={ACTION_ICON_MAP.arriba}
              alt="Arriba"
              className={styles.iconOnlyButtonImage}
              onError={handleIconError("arriba")}
            />
          )}
        </button>
        <button
          type="button"
          onClick={() => alignEdge("bottom")}
          disabled={!imgEl}
          aria-label="Alinear abajo"
          title="Alinear abajo"
          className={styles.iconOnlyButton}
        >
          {missingIcons.abajo ? (
            <span className={styles.iconFallback} aria-hidden="true" />
          ) : (
            <img
              src={ACTION_ICON_MAP.abajo}
              alt="Abajo"
              className={styles.iconOnlyButtonImage}
              onError={handleIconError("abajo")}
            />
          )}
        </button>
        <span
          className={`${styles.qualityBadge} ${
            quality.color === "#ef4444"
              ? styles.qualityBad
              : quality.color === "#f59e0b"
                ? styles.qualityWarn
                : quality.color === "#10b981"
                  ? styles.qualityOk
                  : styles.qualityUnknown
          }`}
        >
          Calidad: {quality.label}
        </span>
        {false && (
          <button
            onClick={onConfirmSubmit}
            disabled={busy || !imgEl || !imageFile}
            className={styles.confirmButton}
          >
            {busy ? "Creando…" : "Crear job"}
          </button>
        )}
      </div>

      {lastDiag && <p className={styles.errorBox}>{lastDiag}</p>}

      {/* Canvas */}
      <div
        ref={wrapRef}
        className={`${styles.canvasWrapper} ${isPanningRef.current ? styles.grabbing : ""} ${isPickingColor ? styles.picking : ""}`}
      >
        <button
          onClick={undo}
          disabled={histIndex <= 0}
          className={styles.undoButton}
        >
          ↺
        </button>
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
            <Rect
              x={-2000}
              y={-2000}
              width={4000}
              height={4000}
              fill={STAGE_BG}
            />

            {/* Mesa de trabajo (gris) con borde redondeado SIEMPRE */}
            <Rect
              x={0}
              y={0}
              width={workCm.w}
              height={workCm.h}
              fill="#f3f4f6"
              cornerRadius={cornerRadiusCm + bleedCm}
              listening={false}
            />

            {/* Si 'contain': pintamos el color de fondo SIEMPRE debajo del arte (también al deseleccionar) */}
            {mode === "contain" && (
              <Rect
                x={0}
                y={0}
                width={workCm.w}
                height={workCm.h}
                fill={bgColor}
                cornerRadius={cornerRadiusCm + bleedCm}
                listening={false}
              />
            )}

            {/* IMAGEN: seleccionada = sin recorte; deseleccionada = recortada con radio */}
            {imgEl &&
              imgBaseCm &&
              (showTransformer ? (
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
                      rotateAnchorOffset={40}
                      rotationSnaps={[0, 90, 180, 270]}
                      keepRatio={keepRatio}
                      enabledAnchors={[
                        "top-left",
                        "top-center",
                        "top-right",
                        "middle-left",
                        "middle-right",
                        "bottom-left",
                        "bottom-center",
                        "bottom-right",
                      ]}
                    boundBoxFunc={(oldBox, newBox) => {
                      const MIN_W = 0.02 * (imgBaseCm?.w || 1);
                      const MIN_H = 0.02 * (imgBaseCm?.h || 1);

                      if (!keepRatioRef.current) {
                        // ⟵ MODO LIBRE: sólo mínimo, SIN límites superiores
                        const w = Math.max(MIN_W, newBox.width);
                        const h = Math.max(MIN_H, newBox.height);
                        return { ...newBox, width: w, height: h };
                      }

                      // Mantener proporción: con topes razonables
                      const MAX_W = (imgBaseCm?.w || 1) * IMG_ZOOM_MAX;
                      const MAX_H = (imgBaseCm?.h || 1) * IMG_ZOOM_MAX;
                      const w = Math.max(MIN_W, Math.min(newBox.width, MAX_W));
                      const h = Math.max(MIN_H, Math.min(newBox.height, MAX_H));
                      return { ...newBox, width: w, height: h };
                    }}
                    onTransformStart={onTransformStart}
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
                >
                  <Rect
                    x={0}
                    y={0}
                    width={workCm.w}
                    height={workCm.h}
                    fill="transparent"
                  />
                  {/* si estás en 'contain', pintar el color debajo del arte */}
                  {mode === "contain" && (
                    <Rect
                      x={0}
                      y={0}
                      width={workCm.w}
                      height={workCm.h}
                      fill={bgColor}
                    />
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
              ))}

            {/* máscara fuera del área */}
          </Layer>
          {hasGlassOverlay && (
            <Layer id="glasspadOverlayLayer" listening={false}>
              <Group
                id="glassOverlayGroup"
                ref={glassOverlayRef}
                x={bleedCm}
                y={bleedCm}
                width={wCm}
                height={hCm}
                clipFunc={(ctx) => {
                  ctx.rect(0, 0, wCm, hCm);
                }}
              >
                <KonvaImage
                  image={imgEl}
                  x={imgTx.x_cm - bleedCm + dispW / 2}
                  y={imgTx.y_cm - bleedCm + dispH / 2}
                  width={dispW}
                  height={dispH}
                  offsetX={dispW / 2}
                  offsetY={dispH / 2}
                  rotation={imgTx.rotation_deg}
                  listening={false}
                />
              </Group>
            </Layer>
          )}
          <Layer listening={false}>
            {/* guías */}
            <Rect
              x={0}
              y={0}
              width={workCm.w}
              height={workCm.h}
              stroke="#ef4444"
              strokeWidth={0.04}
              cornerRadius={cornerRadiusCm + bleedCm}
            />
            <Rect
              x={bleedCm + PRIMARY_SAFE_MARGIN_CM}
              y={bleedCm + PRIMARY_SAFE_MARGIN_CM}
              width={Math.max(0, wCm - 2 * PRIMARY_SAFE_MARGIN_CM)}
              height={Math.max(0, hCm - 2 * PRIMARY_SAFE_MARGIN_CM)}
              stroke="#111827"
              dash={[0.4, 0.4]}
              strokeWidth={0.04}
              cornerRadius={Math.max(
                0,
                cornerRadiusCm - PRIMARY_SAFE_MARGIN_CM,
              )}
            />
            <Rect
              x={bleedCm + SECONDARY_SAFE_MARGIN_CM}
              y={bleedCm + SECONDARY_SAFE_MARGIN_CM}
              width={Math.max(0, wCm - 2 * SECONDARY_SAFE_MARGIN_CM)}
              height={Math.max(0, hCm - 2 * SECONDARY_SAFE_MARGIN_CM)}
              stroke="#6b7280"
              dash={[0.3, 0.3]}
              strokeWidth={0.03}
              cornerRadius={Math.max(
                0,
                cornerRadiusCm - SECONDARY_SAFE_MARGIN_CM,
              )}
            />
          </Layer>
        </Stage>
        <Stage
          ref={exportStageRef}
          width={padRectPx.w}
          height={padRectPx.h}
          style={{ display: "none" }}
        >
          <Layer>
            <Group
              ref={padGroupRef}
              clipX={0}
              clipY={0}
              clipWidth={padRectPx.w}
              clipHeight={padRectPx.h}
            >
              <Rect
                x={0}
                y={0}
                width={padRectPx.w}
                height={padRectPx.h}
                fill={mode === "contain" ? bgColor : "#ffffff"}
                listening={false}
              />
              {imgEl && imgBaseCm && (
                <KonvaImage
                  image={imgEl}
                  x={(imgTx.x_cm - bleedCm + dispW / 2) * exportScale}
                  y={(imgTx.y_cm - bleedCm + dispH / 2) * exportScale}
                  width={dispW * exportScale}
                  height={dispH * exportScale}
                  offsetX={(dispW * exportScale) / 2}
                  offsetY={(dispH * exportScale) / 2}
                  rotation={imgTx.rotation_deg}
                  listening={false}
                />
              )}
            </Group>
          </Layer>
        </Stage>
        {imageUrl && imgStatus !== "loaded" && (
          <div className={`spinner ${styles.spinnerOverlay}`} />
        )}
      </div>
    </div>
  );
});

export default EditorCanvas;
