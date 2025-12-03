import { error, warn } from '@/lib/log';
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
  Shape,
  Image as KonvaImage,
  Transformer,
  Line,
} from "react-konva";
import Konva from "konva";
import useImage from "use-image";
import styles from "./EditorCanvas.module.css";
import ColorPopover from "./ColorPopover";

import { buildSubmitJobBody, prevalidateSubmitBody } from "../lib/jobPayload";
import { submitJob } from "../lib/submitJob";
import { renderGlasspadPNG } from "../lib/renderGlasspadPNG";
import {
  dpiLevel,
  DPI_WARN_THRESHOLD,
  DPI_LOW_THRESHOLD,
} from "../lib/dpi";
import { resolveIconAsset } from "@/lib/iconRegistry.js";
import { isTouchDevice } from "@/lib/device.ts";
import { useMobileSelectedNodeGestures } from "@/hooks/useMobileSelectedNodeGestures";

const CM_PER_INCH = 2.54;
const mmToCm = (mm) => mm / 10;

const VIEW_ZOOM_MIN = 0.3;
const VIEW_ZOOM_MAX = 12;
const IMG_ZOOM_MAX = 400; // límite amplio cuando mantengo proporción
const STAGE_BG = "#181818";
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

const drawRoundedPath = (ctx, w, h, radius) => {
  const rr = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
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
};



const isTypingTarget = (el) => {
  if (!el) return false;
  if (el.getAttribute?.('data-allow-arrows') === 'true') return false;
  const tag = el.tagName?.toLowerCase();
  if (el.isContentEditable) return true;
  const role = el.getAttribute?.('role');
  if (role === 'textbox') return true;
  if (tag === 'textarea') return true;
  if (tag === 'input') {
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (!type || ['text', 'search', 'email', 'url', 'password', 'number', 'tel'].includes(type)) {
      return true;
    }
  }
  return false;
};

const ACTION_ICON_MAP = {
  izquierda: resolveIconAsset("izquierda.svg"),
  centrado_V: resolveIconAsset("centrado_V.svg"),
  derecha: resolveIconAsset("derecha.svg"),
  arriba: resolveIconAsset("arriba.svg"),
  centrado_h: resolveIconAsset("centrado_h.svg"),
  abajo: resolveIconAsset("abajo.svg"),
  rotar: resolveIconAsset("rotar.svg"),
  espejo_v: resolveIconAsset("espejo_h.svg"),
  espejo_h: resolveIconAsset("espejo_v.svg"),
  cubrir: resolveIconAsset("cubrir.svg"),
  contener: resolveIconAsset("contener.svg"),
  estirar: resolveIconAsset("estirar.svg"),
  circular: resolveIconAsset("shape-circle.svg"),
  cuadrado: resolveIconAsset("shape-square.svg"),

};

const DEFAULT_BG_COLOR = "#ffffff";

const normalizeHexColor = (value) => {
  if (typeof value !== "string") {
    if (value == null) return null;
    value = String(value);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
};

const HISTORY_ICON_SPECS = {
  undo: { src: resolveIconAsset("undo.svg"), fallbackLabel: "↶" },
  redo: { src: resolveIconAsset("redo.svg"), fallbackLabel: "↷" },
  delete: { src: resolveIconAsset("delete.svg"), fallbackLabel: "✕" },
};


const ToolbarTooltip = ({ label, children, disabled = false }) => {
  const [isVisible, setIsVisible] = useState(false);
  const delayRef = useRef(null);

  const clearDelay = useCallback(() => {
    if (delayRef.current) {
      clearTimeout(delayRef.current);
      delayRef.current = null;
    }
  }, []);

  const hideTooltip = useCallback(() => {
    clearDelay();
    setIsVisible(false);
  }, [clearDelay]);

  const showWithDelay = useCallback(() => {
    if (disabled || delayRef.current || isVisible) return;
    delayRef.current = setTimeout(() => {
      setIsVisible(true);
      delayRef.current = null;
    }, 500);
  }, [disabled, isVisible]);

  useEffect(() => {
    return () => {
      clearDelay();
    };
  }, [clearDelay]);

  useEffect(() => {
    if (disabled) {
      hideTooltip();
    }
  }, [disabled, hideTooltip]);

  return (
    <div
      className={styles.iconButtonWithTooltip}
      data-tooltip-disabled={disabled ? "true" : undefined}
      onPointerEnter={showWithDelay}
      onPointerLeave={hideTooltip}
      onPointerDown={showWithDelay}
      onPointerUp={hideTooltip}
      onFocus={showWithDelay}
      onBlur={hideTooltip}
    >
      {children}
      <span
        className={`${styles.toolbarTooltip} ${
          isVisible ? styles.toolbarTooltipVisible : ""
        }`}
        role="tooltip"
        aria-hidden={!isVisible}
      >
        {label}
      </span>
    </div>
  );
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
    isCircular = false,
    onToggleCircular,
    onPickedColor,
    onClearImage,
    showCanvas = true,
    showHistoryControls = true,
    onHistoryChange,
    topLeftOverlay,
    lienzoHeight,
  },
  ref,
) {
  const wCm = Number(sizeCm?.w ?? 90);
  const hCm = Number(sizeCm?.h ?? 40);
  const bleedCm = mmToCm(bleedMm);
  const BASE_CORNER_RADIUS_CM = 0;
  const workCm = useMemo(
    () => ({ w: wCm + 2 * bleedCm, h: hCm + 2 * bleedCm }),
    [wCm, hCm, bleedCm],
  );

  const cornerRadiusCm = useMemo(
    () => (isCircular ? Math.min(wCm, hCm) / 2 : BASE_CORNER_RADIUS_CM),
    [BASE_CORNER_RADIUS_CM, isCircular, wCm, hCm],
  );
  const workCornerRadiusCm = useMemo(
    () => (isCircular ? Math.min(workCm.w, workCm.h) / 2 : 0),
    [isCircular, workCm.h, workCm.w],
  );
  const primarySafeRadiusCm = Math.max(0, cornerRadiusCm - PRIMARY_SAFE_MARGIN_CM);
  const secondarySafeRadiusCm = Math.max(0, cornerRadiusCm - SECONDARY_SAFE_MARGIN_CM);

  // viewport
  const wrapRef = useRef(null);
  const stageRef = useRef(null);
  const exportStageRef = useRef(null);
  const padGroupRef = useRef(null);
  const glassOverlayRef = useRef(null);
  const [wrapSize, setWrapSize] = useState({ w: 960, h: 540 });
  const isTouch = useMemo(() => isTouchDevice(), []);
  const hasAdjustedViewRef = useRef(false);
  useEffect(() => {
    if (!isTouch) return;
    const stage = stageRef.current;
    const container = stage?.container();
    if (!container) return;

    const getCanvases = () => Array.from(container.querySelectorAll("canvas"));
    const restore = () => {
      container.style.pointerEvents = "";
      container.style.touchAction = "";
      getCanvases().forEach((c) => {
        c.style.pointerEvents = "";
        c.style.touchAction = "";
      });
    };

    const forceScrollPassThrough = () => {
      container.style.pointerEvents = "none";
      container.style.touchAction = "pan-y pinch-zoom";
      getCanvases().forEach((c) => {
        c.style.pointerEvents = "none";
        c.style.touchAction = "pan-y pinch-zoom";
      });
    };

    forceScrollPassThrough();

    const observer = new MutationObserver(forceScrollPassThrough);
    observer.observe(container, {
      attributes: true,
      attributeFilter: ["style"],
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      restore();
    };
  }, [isTouch]);
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
  const viewScaleRef = useRef(viewScale);
  const viewPosRef = useRef(viewPos);

  useEffect(() => {
    viewScaleRef.current = viewScale;
  }, [viewScale]);

  useEffect(() => {
    viewPosRef.current = viewPos;
  }, [viewPos]);

  // pan
  const isPanningRef = useRef(false);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const pickingColorRef = useRef(false);
  const pickCallbackRef = useRef(null);
  const [isPickingColor, setIsPickingColor] = useState(false);
  const [missingIcons, setMissingIcons] = useState({});
  const [missingHistoryIcons, setMissingHistoryIcons] = useState({});


  const handleIconError = (action) => () => {
    setMissingIcons((prev) => (prev[action] ? prev : { ...prev, [action]: true }));
  };

  const handleHistoryIconError = (action) => () => {
    setMissingHistoryIcons((prev) =>
      prev[action] ? prev : { ...prev, [action]: true },
    );
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
  const transformerAnchors = isTouch
    ? []
    : [
        "top-left",
        "top-center",
        "top-right",
        "middle-left",
        "middle-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
      ];

  const getSelectedNode = useCallback(() => {
    if (showTransformer && imgRef.current) {
      return imgRef.current;
    }

    const nodes = trRef.current?.nodes?.();
    if (nodes && nodes.length > 0) return nodes[0];
    return null;
  }, [showTransformer]);

  useMobileSelectedNodeGestures(stageRef, getSelectedNode);

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

  const clearSelection = useCallback(() => {
    setShowTransformer(false);
    if (trRef.current) {
      trRef.current.nodes([]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, []);

  const handleBackgroundClick = useCallback(() => {
    clearSelection();
  }, [clearSelection]);

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
        clearSelection();
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
      setViewPos((p) => {
        const next = { ...p, x: p.x - step };
        viewPosRef.current = next;
        return next;
      });
      return;
    }
    const stage = e.target.getStage();
    const pt = stage.getPointerPosition();
    if (!pt) return;
    const scaleBy = 1.08;
    const oldScale = viewScaleRef.current;
    const nextScale = deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
    const clamped = Math.max(VIEW_ZOOM_MIN, Math.min(nextScale, VIEW_ZOOM_MAX));
    const prevPos = viewPosRef.current;
    const worldXPrev = (pt.x - prevPos.x) / (baseScale * oldScale);
    const worldYPrev = (pt.y - prevPos.y) / (baseScale * oldScale);
    const nextPos = {
      x: pt.x - worldXPrev * (baseScale * clamped),
      y: pt.y - worldYPrev * (baseScale * clamped),
    };
    hasAdjustedViewRef.current = true;
    viewScaleRef.current = clamped;
    viewPosRef.current = nextPos;
    setViewScale(clamped);
    setViewPos(nextPos);
  };

  const clampViewScale = useCallback(
    (next) => Math.max(VIEW_ZOOM_MIN, Math.min(next, VIEW_ZOOM_MAX)),
    [],
  );

  const adjustViewScaleAtPoint = useCallback(
    (nextScaleOrUpdater, anchor = { x: wrapSize.w / 2, y: wrapSize.h / 2 }) => {
      setViewScale((prevScale) => {
        const target =
          typeof nextScaleOrUpdater === "function"
            ? nextScaleOrUpdater(prevScale)
            : nextScaleOrUpdater;
        const clamped = clampViewScale(target);
        setViewPos((prevPos) => {
          const worldX = (anchor.x - prevPos.x) / (baseScale * prevScale);
          const worldY = (anchor.y - prevPos.y) / (baseScale * prevScale);
          return {
            x: anchor.x - worldX * (baseScale * clamped),
            y: anchor.y - worldY * (baseScale * clamped),
          };
        });
        return clamped;
      });
    },
    [baseScale, clampViewScale, wrapSize.w, wrapSize.h],
  );

  const handleZoomIn = useCallback(() => {
    adjustViewScaleAtPoint((prev) => prev + 0.1);
  }, [adjustViewScaleAtPoint]);

  const handleZoomOut = useCallback(() => {
    adjustViewScaleAtPoint((prev) => prev - 0.1);
  }, [adjustViewScaleAtPoint]);

  const handleCenterCanvas = useCallback(() => {
    const stage = stageRef.current;
    const container = stage?.container?.();

    if (!stage || !container) return;

    const rect = container.getBoundingClientRect();
    const viewportCenterX = rect.width / 2;
    const viewportCenterY = rect.height / 2;

    const scale = stage.scaleX() || baseScale * viewScaleRef.current;
    const canvasCenterX = workCm.w / 2;
    const canvasCenterY = workCm.h / 2;

    const nextPos = {
      x: viewportCenterX - canvasCenterX * scale,
      y: viewportCenterY - canvasCenterY * scale,
    };

    stage.position(nextPos);
    stage.batchDraw();
    viewPosRef.current = nextPos;
    setViewPos(nextPos);
  }, [baseScale, workCm.h, workCm.w]);

  useEffect(() => {
    if (!stageRef.current) return;
    handleCenterCanvas();
  }, [handleCenterCanvas, isCircular]);

  const selectMainImage = useCallback(() => {
    setShowTransformer(true);
    if (trRef.current && imgRef.current) {
      trRef.current.nodes([imgRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, []);

  // imagen
  const [imgEl, imgStatus] = useImage(imageUrl || undefined);
  const imgBaseCm = useMemo(() => {
    if (!imgEl) return null;
    return {
      w: (imgEl.naturalWidth / dpi) * CM_PER_INCH,
      h: (imgEl.naturalHeight / dpi) * CM_PER_INCH,
    };
  }, [imgEl, dpi]);

  const readNodeTransform = useCallback(
    (nodeArg = imgRef.current) => {
      if (!nodeArg || !imgBaseCm) return null;

      const node = nodeArg;
      const baseW = imgBaseCm.w || 1;
      const baseH = imgBaseCm.h || 1;
      const nodeScaleX = node.scaleX();
      const nodeScaleY = node.scaleY();
      const width = node.width() * Math.abs(nodeScaleX);
      const height = node.height() * Math.abs(nodeScaleY);
      const scaleX = (node.width() / baseW) * nodeScaleX;
      const scaleY = (node.height() / baseH) * nodeScaleY;

      return {
        tx: {
          x_cm: node.x() - width / 2,
          y_cm: node.y() - height / 2,
          scaleX,
          scaleY,
          rotation_deg: node.rotation(),
          flipX: scaleX < 0,
          flipY: scaleY < 0,
        },
        width,
        height,
        cx: node.x(),
        cy: node.y(),
      };
    },
    [imgBaseCm?.w, imgBaseCm?.h],
  );

  const getLiveNodeTransform = useCallback(
    () => readNodeTransform() ?? null,
    [readNodeTransform],
  );

  const [imgTx, setImgTx] = useState({
    x_cm: 0,
    y_cm: 0,
    scaleX: 1,
    scaleY: 1,
    rotation_deg: 0,
    flipX: false,
    flipY: false,
  });
  const undoStackRef = useRef([]); // pila de estados anteriores
  const redoStackRef = useRef([]); // pila de estados para rehacer
  const [historyCounts, setHistoryCounts] = useState({ undo: 0, redo: 0 });
  const updateHistoryCounts = useCallback(() => {
    setHistoryCounts((prev) => {
      const undo = undoStackRef.current.length;
      const redo = redoStackRef.current.length;
      if (prev.undo === undo && prev.redo === redo) return prev;
      return { undo, redo };
    });
  }, []);
  const pushHistory = useCallback(
    (tx) => {
      if (!tx) return;
      undoStackRef.current.push({ ...tx });
      redoStackRef.current = [];
      updateHistoryCounts();
    },
    [updateHistoryCounts],
  );
  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push({ ...imgTx });
    setImgTx({ ...prev });
    updateHistoryCounts();
  }, [imgTx, updateHistoryCounts]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push({ ...imgTx });
    setImgTx({ ...next });
    updateHistoryCounts();
  }, [imgTx, updateHistoryCounts]);

  useEffect(() => {
    onHistoryChange?.(historyCounts);
  }, [historyCounts, onHistoryChange]);

  useEffect(() => {
    const handler = (e) => {
      const key = typeof e.key === 'string' ? e.key.toLowerCase() : '';
      if (!((e.ctrlKey || e.metaKey) && key === 'z')) return;
      if (isTypingTarget(document.activeElement) || isTypingTarget(e.target)) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo]);

  const [keepRatio, setKeepRatio] = useState(true);
  const keepRatioRef = useRef(true);
  const [mode, setMode] = useState("cover"); // 'cover' | 'contain' | 'stretch'
  const stickyFitRef = useRef(null);
  const skipStickyFitOnceRef = useRef(false);
  const [bgColor, setBgColor] = useState(DEFAULT_BG_COLOR);
  const lastCommittedBgColorRef = useRef(DEFAULT_BG_COLOR);
  const [activeAlign, setActiveAlign] = useState({ horizontal: null, vertical: null });
  const isTransformingRef = useRef(false);
  const cornerScaleRef = useRef({ prev: null });
  const cornerFirstFrameRef = useRef(false);

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
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      if (isTypingTarget(document.activeElement) || isTypingTarget(e.target)) return;
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

  const didInitRef = useRef(false);
  // Reiniciar al cargar una nueva imagen
  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    updateHistoryCounts();
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
  }, [imageUrl, imageFile, updateHistoryCounts]);

  useEffect(() => {
    setActiveAlign({ horizontal: null, vertical: null });
  }, [imageUrl, imageFile]);

  // Ajuste inicial: imagen contenida y centrada una sola vez por carga
  useEffect(() => {
    if (!imgBaseCm || !imgEl || didInitRef.current) return;

    const containerWidth = wrapRef.current?.clientWidth ?? wrapSize.w;
    const containerHeight = wrapRef.current?.clientHeight ?? wrapSize.h;

    if (!(containerWidth > 0 && containerHeight > 0)) return;

    const baseContainScale = Math.min(
      workCm.w / imgBaseCm.w,
      workCm.h / imgBaseCm.h,
    );

    if (!Number.isFinite(baseContainScale) || baseContainScale <= 0) return;

    const dispWcm = imgBaseCm.w * baseContainScale;
    const dispHcm = imgBaseCm.h * baseContainScale;

    const initial = {
      x_cm: (workCm.w - dispWcm) / 2,
      y_cm: (workCm.h - dispHcm) / 2,
      scaleX: baseContainScale,
      scaleY: baseContainScale,
      rotation_deg: 0,
      flipX: false,
      flipY: false,
    };

    const padding = 0.22;
    const usableW = Math.max(0, containerWidth * (1 - 2 * padding));
    const usableH = Math.max(0, containerHeight * (1 - 2 * padding));

    const dispWpx = dispWcm * baseScale;
    const dispHpx = dispHcm * baseScale;

    let nextViewScale = 1;
    if (dispWpx > 0 && dispHpx > 0 && usableW > 0 && usableH > 0) {
      const containScalePx = Math.min(usableW / dispWpx, usableH / dispHpx);
      const safeContain = Math.max(0, Math.min(containScalePx, 1));
      const clamped = Math.max(
        VIEW_ZOOM_MIN,
        Math.min(safeContain, VIEW_ZOOM_MAX),
      );
      if (Number.isFinite(clamped)) {
        nextViewScale = clamped;
      }
    }

    setImgTx(initial);
    setMode("contain");
    stickyFitRef.current = "contain";
    skipStickyFitOnceRef.current = true;
    setViewScale(nextViewScale);

    const stageW = workCm.w * baseScale * nextViewScale;
    const stageH = workCm.h * baseScale * nextViewScale;

    setViewPos({
      x: (containerWidth - stageW) / 2,
      y: (containerHeight - stageH) / 2,
    });

    didInitRef.current = true;
  }, [
    imgBaseCm,
    imgEl,
    workCm.w,
    workCm.h,
    baseScale,
    wrapSize.w,
    wrapSize.h,
  ]);

  // medidas visuales (para offset centro)
  const dispW = imgBaseCm ? imgBaseCm.w * Math.abs(imgTx.scaleX) : 0;
  const dispH = imgBaseCm ? imgBaseCm.h * Math.abs(imgTx.scaleY) : 0;
  const selectionStrokeColor = "rgba(255, 255, 255, 0.9)";
  const selectionStrokeWidth = 0.14;
  const selectionCornerSize = Math.max(Math.min(dispW, dispH) * 0.08, 0.35);
  const hasGlassOverlay =
    material === "Glasspad" &&
    !!imgEl &&
    !!imgBaseCm &&
    dispW > 0 &&
    dispH > 0;

  useEffect(() => {
    const node = glassOverlayRef.current;
    if (!node) return;
    node.clearCache();
    node.filters([]);
    node.blurRadius(0);
    node.getLayer()?.batchDraw();
  }, [hasGlassOverlay]);

  const theta = (imgTx.rotation_deg * Math.PI) / 180;
  const rotAABBHalf = (w, h, ang) => ({
    halfW: (Math.abs(w * Math.cos(ang)) + Math.abs(h * Math.sin(ang))) / 2,
    halfH: (Math.abs(w * Math.sin(ang)) + Math.abs(h * Math.cos(ang))) / 2,
  });

  // imán fuerte (centro + AABB rotado)
  const stickRef = useRef({ x: null, y: null, activeX: false, activeY: false });
  const transformBaseRef = useRef(null);
  const updateTransformBase = useCallback(() => {
    if (!imgRef.current) return;

    const node = imgRef.current;
    const clientRect = node.getClientRect({ skipStroke: true });
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    const baseBoxW = clientRect?.width ?? null;
    const baseBoxH = clientRect?.height ?? null;
    const baseUniformScale = Math.max(Math.abs(scaleX), Math.abs(scaleY));

    transformBaseRef.current = {
      rotation: node.rotation(),
      boundBaseW: baseBoxW,
      boundBaseH: baseBoxH,
      liveBoundW: baseBoxW,
      liveBoundH: baseBoxH,
      baseScaleX: scaleX,
      baseScaleY: scaleY,
      baseBoxW,
      baseBoxH,
      baseWidth: node.width(),
      baseHeight: node.height(),
      baseUniformScale,
    };
  }, []);
  const onImgDragStart = () => {
    stickRef.current = { x: null, y: null, activeX: false, activeY: false };
    const live = getLiveNodeTransform();
    pushHistory(live?.tx ?? imgTx);
    stickyFitRef.current = null;
    skipStickyFitOnceRef.current = false;
  };
  const dragBoundFunc = useCallback(
    (pos) => {
      const live = getLiveNodeTransform();
      const baseTx = live?.tx ?? imgTx;

      if (!imgBaseCm || isTransformingRef.current || !baseTx) return pos;

      let cx = pos.x;
      let cy = pos.y;

      const w = live?.width ?? imgBaseCm.w * Math.abs(baseTx.scaleX);
      const h = live?.height ?? imgBaseCm.h * Math.abs(baseTx.scaleY);
      const rotationRad = ((live?.tx.rotation_deg ?? imgTx.rotation_deg) * Math.PI) / 180;
      const { halfW, halfH } = rotAABBHalf(w, h, rotationRad);

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
      getLiveNodeTransform,
      imgBaseCm,
      imgTx,
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
    const live = readNodeTransform(e.target);
    if (live?.tx) {
      setImgTx((prev) => ({ ...prev, ...live.tx }));
    }
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
    if (isTouch) return;

    isTransformingRef.current = true;
    stickRef.current = { x: null, y: null, activeX: false, activeY: false };
    const anchorName = trRef.current?.getActiveAnchor();
    const shouldKeep =
      !anchorName ||
      anchorName === "rotater" ||
      CORNER_ANCHORS.has(anchorName);
    cornerFirstFrameRef.current = CORNER_ANCHORS.has(anchorName);
    cornerScaleRef.current = { prev: null };
    updateTransformBase();
    if (shouldKeep && imgRef.current && imgBaseCm) {
      const baseBoundW = transformBaseRef.current?.boundBaseW;
      const baseBoundH = transformBaseRef.current?.boundBaseH;
      const currentBoundW = transformBaseRef.current?.liveBoundW;
      const currentBoundH = transformBaseRef.current?.liveBoundH;
      let prevScale = null;
      if (baseBoundW > 0 && baseBoundH > 0 && currentBoundW > 0 && currentBoundH > 0) {
        const widthScale = currentBoundW / baseBoundW;
        const heightScale = currentBoundH / baseBoundH;
        if (widthScale > 0 && heightScale > 0) {
          prevScale = Math.sqrt(widthScale * heightScale);
        } else if (widthScale > 0) {
          prevScale = widthScale;
        } else if (heightScale > 0) {
          prevScale = heightScale;
        }
      }

      const node = imgRef.current;
      const absScaleX = Math.abs(node.scaleX());
      const absScaleY = Math.abs(node.scaleY());
      const fallbackScale = Math.max(absScaleX, absScaleY, 0.01);
      cornerScaleRef.current.prev =
        prevScale && Number.isFinite(prevScale) && prevScale > 0
          ? prevScale
          : fallbackScale;
    }
    setKeepRatioImmediate(shouldKeep);
  }, [imgBaseCm, isTouch, setKeepRatioImmediate, updateTransformBase]);

  const onTransformEnd = () => {
    if (isTouch) return;

    isTransformingRef.current = false;
    cornerFirstFrameRef.current = false;
    stickRef.current = { x: null, y: null, activeX: false, activeY: false };
    cornerScaleRef.current = { prev: null };
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
    const nextSignX = nextScaleX < 0 ? -1 : 1;
    const nextSignY = nextScaleY < 0 ? -1 : 1;
    const nextW = n.width() * Math.abs(nextScaleX);
    const nextH = n.height() * Math.abs(nextScaleY);
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
          flipX: nextSignX < 0,
          flipY: nextSignY < 0,
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
        flipX: nextSignX < 0,
        flipY: nextSignY < 0,
      };
    });
    n.scaleX(nextSignX);
    n.scaleY(nextSignY);
    setKeepRatioImmediate(true);
    updateTransformBase();
  };

  // centro actual
  const currentCenter = () => {
    const live = getLiveNodeTransform();
    if (live) return { cx: live.cx, cy: live.cy };
    const w = imgBaseCm.w * Math.abs(imgTx.scaleX);
    const h = imgBaseCm.h * Math.abs(imgTx.scaleY);
    return { cx: imgTx.x_cm + w / 2, cy: imgTx.y_cm + h / 2 };
  };

    const syncNodeToFit = useCallback((tx, width, height) => {
      const node = imgRef.current;
      if (!node || !(width > 0) || !(height > 0)) return;

      node.width(width);
      node.height(height);
      node.scaleX(tx.flipX ? -1 : 1);
      node.scaleY(tx.flipY ? -1 : 1);
      node.rotation(tx.rotation_deg);
      node.position({ x: tx.x_cm + width / 2, y: tx.y_cm + height / 2 });
      node.getLayer()?.batchDraw();
    }, []);

    // cover/contain/estirar con rotación
    const applyFit = useCallback(
      (mode, options = {}) => {
        if (!imgBaseCm) return;
        const node = imgRef.current;
        const liveState = (() => {
          if (!node) return null;
          const liveScaleX = node.scaleX();
          const liveScaleY = node.scaleY();
          const liveW = node.width() * Math.abs(liveScaleX);
          const liveH = node.height() * Math.abs(liveScaleY);
          if (!(liveW > 0) || !(liveH > 0)) return null;
          return {
            cx: node.x(),
            cy: node.y(),
            rotation_deg: node.rotation(),
            flipX: liveScaleX < 0,
            flipY: liveScaleY < 0,
          };
        })();

        const fallbackCenter = liveState ?? currentCenter();
        const targetCx =
          options?.center?.x ??
          options?.center?.cx ??
          fallbackCenter.cx;
        const targetCy =
          options?.center?.y ??
          options?.center?.cy ??
          fallbackCenter.cy;
        const currentRotation = liveState?.rotation_deg ?? imgTx.rotation_deg;
        const currentFlipX = liveState?.flipX ?? imgTx.flipX;
        const currentFlipY = liveState?.flipY ?? imgTx.flipY;
        const w = imgBaseCm.w,
          h = imgBaseCm.h;
        const rotationRad = (currentRotation * Math.PI) / 180;
        const c = Math.abs(Math.cos(rotationRad));
        const s = Math.abs(Math.sin(rotationRad));

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
          setImgTx((prev) => {
            const next = {
              x_cm: targetCx - newW / 2,
              y_cm: targetCy - newH / 2,
              scaleX: scale,
              scaleY: scale,
              rotation_deg: currentRotation,
              flipX: currentFlipX,
              flipY: currentFlipY,
            };
            syncNodeToFit(next, newW, newH);
            return next;
          });
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
          setImgTx((prev) => {
            const next = {
              x_cm: targetCx - newW / 2,
              y_cm: targetCy - newH / 2,
              scaleX: sx,
              scaleY: sy,
              rotation_deg: currentRotation,
              flipX: currentFlipX,
              flipY: currentFlipY,
            };
            syncNodeToFit(next, newW, newH);
            return next;
          });
          setMode("stretch");
        }
      },
      [
        imgBaseCm?.w,
        imgBaseCm?.h,
        workCm.w,
        workCm.h,
        imgTx.x_cm,
        imgTx.y_cm,
        imgTx.scaleX,
        imgTx.scaleY,
        imgTx.flipX,
        imgTx.flipY,
        imgTx.rotation_deg,
        getLiveNodeTransform,
        syncNodeToFit,
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
    const live = getLiveNodeTransform();
    if (!imgBaseCm) return;
    const scaleX = live?.tx.scaleX ?? imgTx.scaleX;
    const w = imgBaseCm.w * Math.abs(scaleX);
    pushHistory(live?.tx ?? imgTx);
    setImgTx((tx) => ({
      ...tx,
      ...(live?.tx ?? {}),
      x_cm: (workCm.w - w) / 2,
    }));
  }, [getLiveNodeTransform, imgBaseCm?.w, workCm.w, imgTx]);

  const centerVert = useCallback(() => {
    const live = getLiveNodeTransform();
    if (!imgBaseCm) return;
    const scaleY = live?.tx.scaleY ?? imgTx.scaleY;
    const h = imgBaseCm.h * Math.abs(scaleY);
    pushHistory(live?.tx ?? imgTx);
    setImgTx((tx) => ({
      ...tx,
      ...(live?.tx ?? {}),
      y_cm: (workCm.h - h) / 2,
    }));
  }, [getLiveNodeTransform, imgBaseCm?.h, workCm.h, imgTx]);

  const alignEdge = (edge) => {
    if (!imgBaseCm) return;
    const live = getLiveNodeTransform();
    const scaleX = live?.tx.scaleX ?? imgTx.scaleX;
    const scaleY = live?.tx.scaleY ?? imgTx.scaleY;
    const rotationDeg = live?.tx.rotation_deg ?? imgTx.rotation_deg;
    const w = imgBaseCm.w * Math.abs(scaleX);
    const h = imgBaseCm.h * Math.abs(scaleY);
    const rotationRad = (rotationDeg * Math.PI) / 180;
    const { halfW, halfH } = rotAABBHalf(w, h, rotationRad);

    let cx = (live?.cx ?? imgTx.x_cm + w / 2);
    let cy = (live?.cy ?? imgTx.y_cm + h / 2);

    if (edge === "left") cx = halfW;
    if (edge === "right") cx = workCm.w - halfW;
    if (edge === "top") cy = halfH;
    if (edge === "bottom") cy = workCm.h - halfH;

    pushHistory(live?.tx ?? imgTx);
    setImgTx((tx) => ({
      ...tx,
      ...(live?.tx ?? {}),
      x_cm: cx - (imgBaseCm.w * Math.abs(scaleX)) / 2,
      y_cm: cy - (imgBaseCm.h * Math.abs(scaleY)) / 2,
    }));
  };

  const flipHorizontal = useCallback(() => {
    if (!imgEl) return;
    pushHistory(imgTx);
    stickyFitRef.current = null;
    skipStickyFitOnceRef.current = false;
    setImgTx((tx) => ({
      ...tx,
      flipX: !tx.flipX,
    }));
  }, [imgEl, imgTx, pushHistory]);

  const flipVertical = useCallback(() => {
    if (!imgEl) return;
    pushHistory(imgTx);
    stickyFitRef.current = null;
    skipStickyFitOnceRef.current = false;
    setImgTx((tx) => ({
      ...tx,
      flipY: !tx.flipY,
    }));
  }, [imgEl, imgTx, pushHistory]);

  const rotate90 = useCallback(() => {
    if (!imgEl) return;
    pushHistory(imgTx);
    stickyFitRef.current = null;
    skipStickyFitOnceRef.current = false;
    setImgTx((tx) => ({
      ...tx,
      rotation_deg: (tx.rotation_deg + 90) % 360,
    }));
  }, [imgEl, imgTx, pushHistory]);

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
    if (isTouch) return;
    updateTransformBase();
  }, [imgTx.rotation_deg, updateTransformBase, isTouch]);

  const autoCenterStateRef = useRef({
    wrapW: wrapSize.w,
    wrapH: wrapSize.h,
    workW: workCm.w,
    workH: workCm.h,
    base: baseScale,
    material,
  });

  useEffect(() => {
    const prev = autoCenterStateRef.current;
    const wrapChanged = prev.wrapW !== wrapSize.w || prev.wrapH !== wrapSize.h;
    const workChanged = prev.workW !== workCm.w || prev.workH !== workCm.h;
    const baseChanged = prev.base !== baseScale;
    const materialChanged = prev.material !== material;

    autoCenterStateRef.current = {
      wrapW: wrapSize.w,
      wrapH: wrapSize.h,
      workW: workCm.w,
      workH: workCm.h,
      base: baseScale,
      material,
    };

    if (!wrapChanged && (workChanged || baseChanged || materialChanged)) {
      return;
    }

    if (hasAdjustedViewRef.current && !wrapChanged) return;

    const stageW = workCm.w * baseScale;
    const stageH = workCm.h * baseScale;
    const targetX = (wrapSize.w - stageW) / 2;
    const targetY = (wrapSize.h - stageH) / 2;
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
    material,
  ]);

  // calidad
  const dpiEffective = useMemo(() => {
    if (!imgEl || !imgBaseCm) return null;
    const printedWcm = imgBaseCm.w * Math.abs(imgTx.scaleX);
    const printedHcm = imgBaseCm.h * Math.abs(imgTx.scaleY);
    if (printedWcm <= 0 || printedHcm <= 0) return null;
    const printedWin = printedWcm / CM_PER_INCH;
    const printedHin = printedHcm / CM_PER_INCH;
    const dpiX = imgEl.naturalWidth / printedWin;
    const dpiY = imgEl.naturalHeight / printedHin;
    return Math.max(1, Math.min(1000, Math.min(dpiX, dpiY)));
  }, [imgEl, imgBaseCm, imgTx.scaleX, imgTx.scaleY]);

  const quality = useMemo(() => {
    if (dpiEffective == null) {
      return { label: "—", color: "#9ca3af", level: null };
    }
    const level = dpiLevel(
      dpiEffective,
      DPI_WARN_THRESHOLD,
      DPI_LOW_THRESHOLD,
    );
    if (level === "bad") {
      return {
        label: `Baja (${dpiEffective | 0} DPI)`,
        color: "#ef4444",
        level,
      };
    }
    if (level === "warn") {
      return {
        label: `Buena (${dpiEffective | 0} DPI)`,
        color: "#f59e0b",
        level,
      };
    }
    return {
      label: `Excelente (${Math.min(300, dpiEffective | 0)} DPI)`,
      color: "#10b981",
      level,
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
    const scaleXMag = Math.abs(imgTx.scaleX);
    const scaleYMag = Math.abs(imgTx.scaleY);
    const w = imgBaseCm.w * scaleXMag;
    const h = imgBaseCm.h * scaleYMag;
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
      shape: isCircular ? "circle" : "rounded_rect",
      w_cm: wCm,
      h_cm: hCm,
      bleed_mm: bleedMm,
      material,
      flip_x: Boolean(imgTx.flipX),
      flip_y: Boolean(imgTx.flipY),
    };
  };

  const padRectPx = getPadRectPx();
  const exportScale = padRectPx.w / wCm;
  const shouldRenderCanvas = showCanvas && Boolean(imageUrl);
  const canUndo = historyCounts.undo > 0;
  const canRedo = historyCounts.redo > 0;

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

    const decodeBlob = async (candidate) => {
      if (!candidate) return { ok: false };
      const objectUrl = URL.createObjectURL(candidate);
      try {
        const { ok, width, height } = await new Promise((resolve, reject) => {
          const probe = new Image();
          probe.onload = () => {
            resolve({
              ok: true,
              width: probe.naturalWidth || probe.width || 0,
              height: probe.naturalHeight || probe.height || 0,
            });
          };
          probe.onerror = () => reject(new Error("decode_failed"));
          probe.src = objectUrl;
        });
        return { ok, width, height };
      } catch (err) {
        warn('[exportPadAsBlob] decode check failed', err);
        return { ok: false };
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };

    const encodeCanvasAsPng = async (canvas) => {
      const toPngBlob = async () => new Promise((resolve) => {
        try {
          canvas.toBlob((b) => resolve(b), "image/png", 1);
        } catch (err) {
          warn('[exportPadAsBlob] toBlob threw', err);
          resolve(null);
        }
      });

      let blob = await toPngBlob();
      let info = await decodeBlob(blob);

      if (!info.ok) {
        try {
          const fallbackDataUrl = canvas.toDataURL("image/png", 1);
          const fallbackBlob = await fetch(fallbackDataUrl).then((r) => r.blob());
          const fallbackInfo = await decodeBlob(fallbackBlob);
          if (fallbackInfo.ok) {
            blob = fallbackBlob;
            info = fallbackInfo;
          }
        } catch (err) {
          warn('[exportPadAsBlob] fallback dataURL failed', err);
        }
      }

      return { blob, info };
    };

    let { blob, info } = await encodeCanvasAsPng(uploadCanvas);

    if (!info?.ok) {
      throw new Error('No se pudo generar la imagen para validar.');
    }

    if (isTouch && blob) {
      try {
        const reloadFromBlob = async () => new Promise((resolve, reject) => {
          const objectUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            const width = img.naturalWidth || img.width || 0;
            const height = img.naturalHeight || img.height || 0;
            URL.revokeObjectURL(objectUrl);
            resolve({ img, width, height });
          };
          img.onerror = (err) => {
            URL.revokeObjectURL(objectUrl);
            reject(err || new Error('decode_failed'));
          };
          img.src = objectUrl;
        });

        const { img, width, height } = await reloadFromBlob();
        if (width && height) {
          const cleanCanvas = document.createElement('canvas');
          cleanCanvas.width = width;
          cleanCanvas.height = height;
          const cleanCtx = cleanCanvas.getContext('2d');
          cleanCtx.drawImage(img, 0, 0, width, height);
          const reencoded = await encodeCanvasAsPng(cleanCanvas);
          if (reencoded.info?.ok && reencoded.blob) {
            blob = reencoded.blob;
            info = reencoded.info;
          }
        }
      } catch (err) {
        warn('[exportPadAsBlob] mobile re-encode failed', err);
      }
    }

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
      const scaleXMag = Math.abs(imgTx.scaleX);
      const scaleYMag = Math.abs(imgTx.scaleY);
      const dispW = imgBaseCm.w * scaleXMag;
      const dispH = imgBaseCm.h * scaleYMag;
      const originX = imgTx.x_cm + dispW / 2;
      const originY = imgTx.y_cm + dispH / 2;
      const theta = (imgTx.rotation_deg * Math.PI) / 180;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      const flipSignX = imgTx.flipX ? -1 : 1;
      const flipSignY = imgTx.flipY ? -1 : 1;
      function canvasToSrc(cx, cy) {
        const dx = cx - originX;
        const dy = cy - originY;
        const rx = dx * cos + dy * sin;
        const ry = -dx * sin + dy * cos;
        const rxFlipped = rx * flipSignX;
        const ryFlipped = ry * flipSignY;
        const sx = (rxFlipped + dispW / 2) / (cmPerPx * imgTx.scaleX);
        const sy = (ryFlipped + dispH / 2) / (cmPerPx * imgTx.scaleY);
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
        flip_x: Boolean(imgTx.flipX),
        flip_y: Boolean(imgTx.flipY),
        shape: isCircular ? "circle" : "rounded_rect",
      };
    },
    getRenderDescriptorV2,
    getPadRect,
    getPadRectPx,
    exportPadAsBlob,
    exportPreviewDataURL,
    exportPadDataURL,
    startPickColor,
    undo,
    redo,
    getHistoryCounts: () => ({ ...historyCounts }),
  }));

  // popover color
  const containButtonRef = useRef(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const pickerInteractionLockRef = useRef(false);
  const pickerLockTimeoutRef = useRef(null);
  const colorOpen = isPickerOpen;
  const setPickerOpen = useCallback(
    (nextOpen) => {
      setIsPickerOpen((prev) => {
        if (prev === nextOpen) return prev;
        if (pickerLockTimeoutRef.current) {
          clearTimeout(pickerLockTimeoutRef.current);
        }
        pickerInteractionLockRef.current = true;
        pickerLockTimeoutRef.current = setTimeout(() => {
          pickerInteractionLockRef.current = false;
          pickerLockTimeoutRef.current = null;
        }, 250);
        return nextOpen;
      });
    },
    [setIsPickerOpen],
  );

  useEffect(() => {
    return () => {
      if (pickerLockTimeoutRef.current) {
        clearTimeout(pickerLockTimeoutRef.current);
        pickerLockTimeoutRef.current = null;
      }
      pickerInteractionLockRef.current = false;
    };
  }, []);

  const [busy, setBusy] = useState(false);
  const [lastDiag, setLastDiag] = useState(null);

  const closeColor = useCallback(() => {
    setPickerOpen(false);
  }, [setPickerOpen]);

  const handleContainButtonClick = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!imgEl || pickerInteractionLockRef.current) return;
      if (!isPickerOpen) {
        if (mode !== "contain") {
          fitContain();
        }
        setPickerOpen(true);
        return;
      }
      setPickerOpen(false);
    },
    [imgEl, isPickerOpen, mode, fitContain, setPickerOpen],
  );

  useEffect(() => {
    if (isPickerOpen && mode !== "contain") {
      setPickerOpen(false);
    }
  }, [isPickerOpen, mode, setPickerOpen]);

  useEffect(() => {
    if (isPickerOpen && !imgEl) {
      setPickerOpen(false);
    }
  }, [isPickerOpen, imgEl, setPickerOpen]);

  const applyBgColor = useCallback(
    (hex, { notify = false } = {}) => {
      const normalized = normalizeHexColor(hex) || DEFAULT_BG_COLOR;
      let didChange = false;
      setBgColor((prev) => {
        if (prev?.toLowerCase() === normalized.toLowerCase()) {
          return prev;
        }
        didChange = true;
        return normalized;
      });
      if (notify) {
        const lastCommitted = lastCommittedBgColorRef.current;
        if (
          didChange ||
          !lastCommitted ||
          lastCommitted.toLowerCase() !== normalized.toLowerCase()
        ) {
          lastCommittedBgColorRef.current = normalized;
          onPickedColor?.(normalized);
        }
      }
      return normalized;
    },
    [onPickedColor],
  );

  const handleBgColorPreview = useCallback(
    (hex) => {
      applyBgColor(hex);
    },
    [applyBgColor],
  );

  const handleBgColorCommit = useCallback(
    (hex) => {
      applyBgColor(hex, { notify: true });
    },
    [applyBgColor],
  );
  const iconButtonClass = (isActive) =>
    isActive
      ? `${styles.iconOnlyButton} ${styles.iconOnlyButtonActive}`
      : styles.iconOnlyButton;
  const setActiveAlignAxis = (axis, value) => {
    setActiveAlign((prev) => {
      if (prev[axis] === value) return prev;
      return { ...prev, [axis]: value };
    });
  };
  const wrapperClassName = [
    styles.canvasWrapper,
    isPanningRef.current ? styles.grabbing : '',
    isPickingColor ? styles.picking : '',
    !shouldRenderCanvas ? styles.canvasWrapperInactive : '',
  ]
    .filter(Boolean)
    .join(' ');
  const lienzoStyle = lienzoHeight != null ? { height: `${lienzoHeight}px` } : undefined;
  const canvasSurfaceStyle = useMemo(() => ({ height: '100%' }), []);
  // track latest callback to avoid effect loops when parent re-renders
  const layoutChangeRef = useRef(onLayoutChange);
  useEffect(() => {
    layoutChangeRef.current = onLayoutChange;
  }, [onLayoutChange]);

  // export layout
  useEffect(() => {
    if (!imgEl) {
      layoutChangeRef.current?.(null);
      return;
    }
    layoutChangeRef.current?.({
      dpi,
      bleed_mm: bleedMm,
      size_cm: { w: wCm, h: hCm },
      image: {
        natural_px: { w: imgEl.naturalWidth, h: imgEl.naturalHeight },
      },
      transform: {
        x_cm: imgTx.x_cm,
        y_cm: imgTx.y_cm,
        scaleX: imgTx.scaleX,
        scaleY: imgTx.scaleY,
        rotation_deg: imgTx.rotation_deg,
        flipX: imgTx.flipX,
        flipY: imgTx.flipY,
      },
      mode,
      background: mode === "contain" ? bgColor : "#ffffff",
      corner_radius_cm: cornerRadiusCm,
      shape: isCircular ? "circle" : "rounded_rect",
    });
  }, [
    dpi,
    bleedMm,
    wCm,
    hCm,
    imgEl,
    imgTx,
    mode,
    bgColor,
    cornerRadiusCm,
    isCircular,
  ]);

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
        error("[PREVALIDATE EditorCanvas]", pre, submitBody);
        alert(pre.problems.join("\n"));
        return;
      }

        const job = await submitJob(submitBody);

      onDone?.(job);
    } catch (err) {
      error(err);
      alert(String(err?.message || err));
    }
  }

  return (
    <>
      <div className={styles.editorRoot}>
      <div className={styles.lienzo} style={lienzoStyle}>
        {/* Canvas */}
        <div ref={wrapRef} className={wrapperClassName} style={canvasSurfaceStyle}>
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
            style={{ display: shouldRenderCanvas ? 'block' : 'none' }}
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

              <Rect
                name="background-hit-area"
                x={0}
                y={0}
                width={workCm.w}
                height={workCm.h}
                fill="transparent"
                listening
                onClick={handleBackgroundClick}
                onTap={handleBackgroundClick}
              />

              {/* Mesa de trabajo (gris) con borde redondeado SIEMPRE */}
              <Group
                clipFunc={(ctx) => drawRoundedPath(ctx, workCm.w, workCm.h, workCornerRadiusCm)}
              >
              <Rect
                x={0}
                y={0}
                width={workCm.w}
                height={workCm.h}
                fill="#f3f4f6"
                listening={false}
              />
            </Group>

            {/* Si 'contain': pintamos el color de fondo SIEMPRE debajo del arte (también al deseleccionar) */}
            {mode === "contain" && (
              <Group
                clipFunc={(ctx) => drawRoundedPath(ctx, workCm.w, workCm.h, workCornerRadiusCm)}
              >
                <Rect
                  x={0}
                  y={0}
                  width={workCm.w}
                  height={workCm.h}
                  fill={bgColor}
                  listening={false}
                />
              </Group>
            )}

            {/* IMAGEN: seleccionada = sin recorte; deseleccionada = recortada con radio */}
            {imgEl &&
              imgBaseCm &&
              (showTransformer && !isTouch ? (
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
                    scaleX={imgTx.flipX ? -1 : 1}
                    scaleY={imgTx.flipY ? -1 : 1}
                    rotation={imgTx.rotation_deg}
                    draggable={!isTouch}
                    dragBoundFunc={!isTouch ? dragBoundFunc : undefined}
                    onDragStart={!isTouch ? onImgDragStart : undefined}
                    onMouseDown={onImgMouseDown}
                    onClick={onImgMouseDown}
                    onTap={onImgMouseDown}
                    onDragMove={onImgDragMove}
                    onDragEnd={onImgDragEnd}
                    listening={true}
                  />
                  {!isTouch && (
                    <Transformer
                      ref={trRef}
                      visible={showTransformer}
                      rotateEnabled={!isTouch}
                      rotateAnchorOffset={40}
                      rotationSnaps={[0, 90, 180, 270]}
                      keepRatio={keepRatio}
                      enabledAnchors={transformerAnchors}
                      boundBoxFunc={(oldBox, newBox) => {
                        const widthDelta = Math.abs(newBox.width - oldBox.width);
                        const heightDelta = Math.abs(newBox.height - oldBox.height);

                        const baseW = imgBaseCm?.w || 1;
                        const baseH = imgBaseCm?.h || 1;
                        const MIN_W = 0.02 * baseW;
                        const MIN_H = 0.02 * baseH;

                        if (
                          cornerFirstFrameRef.current &&
                          widthDelta <= 1e-6 &&
                          heightDelta <= 1e-6
                        ) {
                          return oldBox;
                        }

                        cornerFirstFrameRef.current = false;

                        const baseScaleX = transformBaseRef.current?.baseScaleX ?? imgTx.scaleX;
                        const baseScaleY = transformBaseRef.current?.baseScaleY ?? imgTx.scaleY;
                        const baseUniformScale =
                          transformBaseRef.current?.baseUniformScale ??
                          Math.max(Math.abs(baseScaleX ?? 1), Math.abs(baseScaleY ?? 1));
                        const baseBoxW =
                          transformBaseRef.current?.baseBoxW ?? oldBox.width ?? newBox.width;
                        const baseBoxH =
                          transformBaseRef.current?.baseBoxH ?? oldBox.height ?? newBox.height;

                        const ratioX = oldBox.width > 0 ? newBox.width / oldBox.width : 1;
                        const ratioY = oldBox.height > 0 ? newBox.height / oldBox.height : 1;

                        if (!keepRatioRef.current) {
                          const nextScaleX = Math.max(0.02, (baseScaleX ?? 1) * ratioX);
                          const nextScaleY = Math.max(0.02, (baseScaleY ?? 1) * ratioY);
                          const width =
                            baseBoxW * (Math.abs(nextScaleX) / Math.max(Math.abs(baseScaleX ?? 1), 1e-6));
                          const height =
                            baseBoxH * (Math.abs(nextScaleY) / Math.max(Math.abs(baseScaleY ?? 1), 1e-6));
                          return { ...newBox, width: Math.max(MIN_W, width), height: Math.max(MIN_H, height) };
                        }

                        const MIN_SCALE = 0.02;
                        const MAX_SCALE = IMG_ZOOM_MAX;
                        const primaryRatio = widthDelta >= heightDelta ? ratioX : ratioY;
                        const unclampedScale = baseUniformScale * primaryRatio;
                        const clampedScale = Math.max(
                          MIN_SCALE,
                          Math.min(unclampedScale, MAX_SCALE),
                        );

                        const scaleDivisor = Math.max(baseUniformScale, 1e-6);
                        const width = baseBoxW * (clampedScale / scaleDivisor);
                        const height = baseBoxH * (clampedScale / scaleDivisor);

                        cornerScaleRef.current.prev = clampedScale;

                        return {
                          ...newBox,
                          width: Math.max(MIN_W, width),
                          height: Math.max(MIN_H, height),
                        };
                      }}
                      onTransformStart={onTransformStart}
                      onTransformEnd={onTransformEnd}
                    />
                  )}
                </>
                ) : (
                  <Group
                    clipFunc={(ctx) => drawRoundedPath(ctx, workCm.w, workCm.h, workCornerRadiusCm)}
                  >
                    <Rect
                      x={0}
                      y={0}
                      width={workCm.w}
                      height={workCm.h}
                      fill="transparent"
                      onClick={handleBackgroundClick}
                      onTap={handleBackgroundClick}
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
                    scaleX={imgTx.flipX ? -1 : 1}
                    scaleY={imgTx.flipY ? -1 : 1}
                    rotation={imgTx.rotation_deg}
                    draggable={!isTouch}
                    dragBoundFunc={!isTouch ? dragBoundFunc : undefined}
                    onDragStart={!isTouch ? onImgDragStart : undefined}
                    onMouseDown={onImgMouseDown}
                    onClick={onImgMouseDown}
                    onTap={onImgMouseDown}
                    onDragMove={!isTouch ? onImgDragMove : undefined}
                    onDragEnd={!isTouch ? onImgDragEnd : undefined}
                    listening={true}
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
                  scaleX={imgTx.flipX ? -1 : 1}
                  scaleY={imgTx.flipY ? -1 : 1}
                  rotation={imgTx.rotation_deg}
                  listening={false}
                />
              </Group>
            </Layer>
          )}
          <Layer listening={false}>
            {/* guías */}
            <Shape
              sceneFunc={(ctx, shape) => {
                ctx.save();
                ctx.setLineDash([]);
                drawRoundedPath(ctx, workCm.w, workCm.h, workCornerRadiusCm);
                ctx.strokeStyle = "#ef4444";
                ctx.lineWidth = shape.strokeWidth();
                ctx.stroke();
                ctx.restore();
              }}
              strokeWidth={0.04}
            />
            <Shape
              sceneFunc={(ctx, shape) => {
                ctx.save();
                ctx.translate(
                  bleedCm + PRIMARY_SAFE_MARGIN_CM,
                  bleedCm + PRIMARY_SAFE_MARGIN_CM,
                );
                drawRoundedPath(
                  ctx,
                  Math.max(0, wCm - 2 * PRIMARY_SAFE_MARGIN_CM),
                  Math.max(0, hCm - 2 * PRIMARY_SAFE_MARGIN_CM),
                  primarySafeRadiusCm,
                );
                ctx.strokeStyle = "#111827";
                ctx.setLineDash([0.4, 0.4]);
                ctx.lineWidth = shape.strokeWidth();
                ctx.stroke();
                ctx.restore();
              }}
              strokeWidth={0.04}
            />
              <Shape
                sceneFunc={(ctx, shape) => {
                  ctx.save();
                  ctx.translate(
                    bleedCm + SECONDARY_SAFE_MARGIN_CM,
                    bleedCm + SECONDARY_SAFE_MARGIN_CM,
                  );
                  drawRoundedPath(
                    ctx,
                    Math.max(0, wCm - 2 * SECONDARY_SAFE_MARGIN_CM),
                    Math.max(0, hCm - 2 * SECONDARY_SAFE_MARGIN_CM),
                    secondarySafeRadiusCm,
                  );
                  ctx.strokeStyle = "#6b7280";
                  ctx.setLineDash([0.3, 0.3]);
                  ctx.lineWidth = shape.strokeWidth();
                  ctx.stroke();
                  ctx.restore();
                }}
                strokeWidth={0.03}
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
                clipFunc={(ctx) =>
                  drawRoundedPath(
                    ctx,
                    padRectPx.w,
                    padRectPx.h,
                    isCircular ? padRectPx.w / 2 : padRectPx.radius_px,
                  )
                }
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
                    scaleX={imgTx.flipX ? -1 : 1}
                    scaleY={imgTx.flipY ? -1 : 1}
                    rotation={imgTx.rotation_deg}
                    listening={false}
                  />
                )}
              </Group>
            </Layer>
          </Stage>
          {isTouch && (
            <div className={styles.touchScrollOverlay} aria-hidden="true" />
          )}
          {imageUrl && imgStatus !== "loaded" && (
            <div className={`spinner ${styles.spinnerOverlay}`} />
          )}
          {isTouch && (
            <div className={styles.mobileCanvasControls}>
              <button type="button" onClick={handleZoomOut} aria-label="Alejar">
                −
              </button>
              <button type="button" onClick={handleZoomIn} aria-label="Acercar">
                +
              </button>
            </div>
          )}
        </div>

        {showHistoryControls && (
        <div className={`${styles.overlayTopRight} ${styles.historyControls}`}>
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className={styles.historyButton}
            aria-label="Deshacer"
          >
            {missingHistoryIcons.undo ? (
              <span className={styles.historyFallback} aria-hidden="true">
                {HISTORY_ICON_SPECS.undo.fallbackLabel}
              </span>
            ) : (
              <img
                src={HISTORY_ICON_SPECS.undo.src}
                alt=""
                className={styles.historyIcon}
                draggable="false"
                onError={handleHistoryIconError("undo")}
              />
            )}
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={!canRedo}
            className={styles.historyButton}
            aria-label="Rehacer"
          >
            {missingHistoryIcons.redo ? (
              <span className={styles.historyFallback} aria-hidden="true">
                {HISTORY_ICON_SPECS.redo.fallbackLabel}
              </span>
            ) : (
              <img
                src={HISTORY_ICON_SPECS.redo.src}
                alt=""
                className={styles.historyIcon}
                draggable="false"
                onError={handleHistoryIconError("redo")}
              />
            )}
          </button>
          <button
            type="button"
            onClick={() => onClearImage?.()}
            disabled={!onClearImage || !imageUrl}
            className={`${styles.historyButton} ${styles.historyButtonDanger}`}
            aria-label="Eliminar"
          >
            {missingHistoryIcons.delete ? (
              <span className={styles.historyFallback} aria-hidden="true">
                {HISTORY_ICON_SPECS.delete.fallbackLabel}
              </span>
            ) : (
              <img
                src={HISTORY_ICON_SPECS.delete.src}
                alt=""
                className={styles.historyIcon}
                draggable="false"
                onError={handleHistoryIconError("delete")}
              />
            )}
          </button>
        </div>
      )}

      <div className={styles.overlayBottomCenter}>
        {/* Toolbar */}
        <div className={styles.toolbarScroller}>
          <div className={styles.toolbar}>
          <ToolbarTooltip label="Alinear a la izquierda">
            <button
              type="button"
              onClick={() => {
                alignEdge("left");
                setActiveAlignAxis("horizontal", "left");
              }}
              disabled={!imgEl}
              aria-label="Alinear a la izquierda"
              className={iconButtonClass(activeAlign.horizontal === "left")}
            >
              {missingIcons.izquierda ? (
                <span className={styles.iconFallback} aria-hidden="true" />
              ) : (
                <img
                  src={ACTION_ICON_MAP.izquierda}
                  alt="Alinear a la izquierda"
                  className={styles.iconOnlyButtonImage}
                  onError={handleIconError("izquierda")}
                />
              )}
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip label="Centrar horizontal">
            <button
              type="button"
              onClick={() => {
                centerHoriz();
                setActiveAlignAxis("horizontal", "center");
              }}
              disabled={!imgEl}
              aria-label="Centrar horizontal"
              className={iconButtonClass(activeAlign.horizontal === "center")}
            >
              {missingIcons.centrado_V ? (
                <span className={styles.iconFallback} aria-hidden="true" />
              ) : (
                <img
                  src={ACTION_ICON_MAP.centrado_V}
                  alt="Centrar horizontal"
                  className={styles.iconOnlyButtonImage}
                  onError={handleIconError("centrado_V")}
                />
              )}
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip label="Alinear a la derecha">
            <button
              type="button"
              onClick={() => {
                alignEdge("right");
                setActiveAlignAxis("horizontal", "right");
              }}
              disabled={!imgEl}
              aria-label="Alinear a la derecha"
              className={iconButtonClass(activeAlign.horizontal === "right")}
            >
              {missingIcons.derecha ? (
                <span className={styles.iconFallback} aria-hidden="true" />
              ) : (
                <img
                  src={ACTION_ICON_MAP.derecha}
                  alt="Alinear a la derecha"
                  className={styles.iconOnlyButtonImage}
                  onError={handleIconError("derecha")}
                />
              )}
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip label="Alinear arriba">
            <button
              type="button"
              onClick={() => {
                alignEdge("top");
                setActiveAlignAxis("vertical", "top");
              }}
              disabled={!imgEl}
              aria-label="Alinear arriba"
              className={iconButtonClass(activeAlign.vertical === "top")}
            >
              {missingIcons.arriba ? (
                <span className={styles.iconFallback} aria-hidden="true" />
              ) : (
                <img
                  src={ACTION_ICON_MAP.arriba}
                  alt="Alinear arriba"
                  className={styles.iconOnlyButtonImage}
                  onError={handleIconError("arriba")}
                />
              )}
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip label="Centrar vertical">
            <button
              type="button"
              onClick={() => {
                centerVert();
                setActiveAlignAxis("vertical", "center");
              }}
              disabled={!imgEl}
              aria-label="Centrar vertical"
              className={iconButtonClass(activeAlign.vertical === "center")}
            >
              {missingIcons.centrado_h ? (
                <span className={styles.iconFallback} aria-hidden="true" />
              ) : (
                <img
                  src={ACTION_ICON_MAP.centrado_h}
                  alt="Centrar vertical"
                  className={styles.iconOnlyButtonImage}
                  onError={handleIconError("centrado_h")}
                />
              )}
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip label="Alinear abajo">
            <button
              type="button"
              onClick={() => {
                alignEdge("bottom");
                setActiveAlignAxis("vertical", "bottom");
              }}
              disabled={!imgEl}
              aria-label="Alinear abajo"
              className={iconButtonClass(activeAlign.vertical === "bottom")}
            >
              {missingIcons.abajo ? (
                <span className={styles.iconFallback} aria-hidden="true" />
              ) : (
                <img
                  src={ACTION_ICON_MAP.abajo}
                  alt="Alinear abajo"
                  className={styles.iconOnlyButtonImage}
                  onError={handleIconError("abajo")}
                />
              )}
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip label="Rotar 90°">
            <button
              type="button"
              onClick={rotate90}
              disabled={!imgEl}
              aria-label="Rotar 90°"
              className={styles.iconOnlyButton}
            >
              {missingIcons.rotar ? (
                <span className={styles.iconFallback} aria-hidden="true" />
              ) : (
                <img
                  src={ACTION_ICON_MAP.rotar}
                  alt="Rotar"
                  className={styles.iconOnlyButtonImage}
                  onError={handleIconError("rotar")}
                />
              )}
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip label="Espejo vertical">
            <button
              type="button"
              onClick={flipVertical}
              disabled={!imgEl}
              aria-label="Espejo vertical"
              className={iconButtonClass(Boolean(imgTx.flipY))}
            >
              {missingIcons.espejo_v ? (
                <span className={styles.iconFallback} aria-hidden="true" />
              ) : (
                <img
                  src={ACTION_ICON_MAP.espejo_v}
                  alt="Espejo vertical"
                  className={styles.iconOnlyButtonImage}
                  onError={handleIconError("espejo_v")}
                />
              )}
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip label="Espejo horizontal">
            <button
              type="button"
              onClick={flipHorizontal}
              disabled={!imgEl}
              aria-label="Espejo horizontal"
              className={iconButtonClass(Boolean(imgTx.flipX))}
            >
              {missingIcons.espejo_h ? (
                <span className={styles.iconFallback} aria-hidden="true" />
              ) : (
                <img
                  src={ACTION_ICON_MAP.espejo_h}
                  alt="Espejo horizontal"
                  className={styles.iconOnlyButtonImage}
                  onError={handleIconError("espejo_h")}
                />
              )}
            </button>
          </ToolbarTooltip>
          <ToolbarTooltip label="Cubrir superficie">
            <button
              type="button"
              onClick={fitCover}
              disabled={!imgEl}
              aria-label="Cubrir"
              className={iconButtonClass(mode === "cover")}
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
          </ToolbarTooltip>

          <ToolbarTooltip label="Diseño completo" disabled={!imgEl}>
            <div className={styles.colorWrapper}>
              <button
                type="button"
                ref={containButtonRef}
                onClick={handleContainButtonClick}
                disabled={!imgEl}
                aria-label="Contener"
                aria-expanded={colorOpen}
                aria-pressed={colorOpen}
                className={iconButtonClass(mode === "contain")}
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
              {mode === "contain" && colorOpen && (
                <div className={styles.colorPopoverWrap}>
                  <ColorPopover
                    value={bgColor}
                    onChange={handleBgColorPreview}
                    onChangeComplete={handleBgColorCommit}
                    open={colorOpen}
                    onClose={closeColor}
                    anchorRef={containButtonRef}
                    onPickFromCanvas={() =>
                      startPickColor((hex) => {
                        handleBgColorCommit(hex);
                      })
                    }
                  />
                </div>

              )}
            </div>
          </ToolbarTooltip>
          <ToolbarTooltip label="Estirar imagen">
            <button
              type="button"
              onClick={fitStretchCentered}
              disabled={!imgEl}
              aria-label="Estirar"
              className={iconButtonClass(mode === "stretch")}
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
          </ToolbarTooltip>

          {material !== "Glasspad" && onToggleCircular && (
            <ToolbarTooltip
              label={isCircular ? "Volver a rectangular" : "Lienzo circular"}
              disabled={!imgEl}
            >
              <button
                type="button"
                onClick={onToggleCircular}
                disabled={!imgEl}
                aria-label={isCircular ? "Volver a rectangular" : "Lienzo circular"}
                aria-pressed={isCircular}
                className={iconButtonClass(isCircular)}
              >
                {missingIcons[isCircular ? "cuadrado" : "circular"] ? (
                  <span className={styles.iconFallback} aria-hidden="true" />
                ) : (
                  <img
                    src={
                      isCircular
                        ? ACTION_ICON_MAP.cuadrado
                        : ACTION_ICON_MAP.circular
                    }
                    alt={isCircular ? "Volver a rectangular" : "Lienzo circular"}
                    className={styles.iconOnlyButtonImage}
                    onError={handleIconError(isCircular ? "cuadrado" : "circular")}
                  />
                )}
              </button>
            </ToolbarTooltip>
          )}

        <span
          className={`${styles.qualityBadge} ${
            quality.level === "bad"
              ? styles.qualityBad
              : quality.level === "warn"
                ? styles.qualityWarn
                : quality.level === "ok"
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
          </div>
        </div>
      </div>

      {topLeftOverlay ? (
        <div className={styles.overlayTopLeft}>{topLeftOverlay}</div>
      ) : null}
    </div>

      {lastDiag && <p className={styles.errorBox}>{lastDiag}</p>}
    </>
  );
});

export default EditorCanvas;