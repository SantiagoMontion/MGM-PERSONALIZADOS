import { error, warn } from '@/lib/log';
/* eslint-disable */
import {
  useEffect,
  useLayoutEffect,
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
import { isFixedPad49x42Material } from "../lib/material.js";
import {
  intrinsicImageQualityLevel,
} from "../lib/dpi";
import { resolveIconAsset } from "@/lib/iconRegistry.js";
import { isTouchDevice } from "@/lib/device.ts";

const CM_PER_INCH = 2.54;
const mmToCm = (mm) => mm / 10;

const PREVIEW_CORNER_RADIUS_PX = 12;
const IMG_ZOOM_MAX = 400; // lÃ­mite amplio cuando mantengo proporciÃ³n
const ABSOLUTE_DRAG_SYNC_EPSILON_CM = 0.01;
const COVER_AXIS_LOCK_EPSILON_CM = 0.01;
const INITIAL_DRAG_JUMP_GUARD_PX = 100;
const KEYBOARD_NUDGE_STEP_CM = 0.25;
const KEYBOARD_FAST_NUDGE_STEP_CM = 0.5;
const PRIMARY_SAFE_MARGIN_CM = 1.1;
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

const readViewportSize = (element, fallback = {}) => {
  const rect = element?.getBoundingClientRect?.();
  const fallbackWidth = Number(fallback?.width ?? fallback?.w);
  const fallbackHeight = Number(fallback?.height ?? fallback?.h);
  return {
    width:
      rect?.width > 0
        ? rect.width
        : Number.isFinite(fallbackWidth) && fallbackWidth > 0
          ? fallbackWidth
          : 600,
    height:
      rect?.height > 0
        ? rect.height
        : Number.isFinite(fallbackHeight) && fallbackHeight > 0
          ? fallbackHeight
          : 360,
  };
};

const getCenteredStagePosition = ({
  viewportWidth,
  viewportHeight,
  workWidth,
  workHeight,
  scale,
}) => ({
  x: Math.round((viewportWidth - workWidth * scale) / 2),
  y: Math.round((viewportHeight - workHeight * scale) / 2),
});

const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));

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

const readRootCssVar = (name, fallback = "") => {
  if (typeof window === "undefined" || !window.document?.documentElement) {
    return fallback;
  }
  const value = window.getComputedStyle(window.document.documentElement).getPropertyValue(name);
  return value?.trim() || fallback;
};

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
  undo: { src: resolveIconAsset("undo.svg"), fallbackLabel: "â†¶" },
  redo: { src: resolveIconAsset("redo.svg"), fallbackLabel: "â†·" },
  delete: { src: resolveIconAsset("delete.svg"), fallbackLabel: "âœ•" },
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
    externalImageUrl: externalImageUrlProp,
    imageFile,
    sizeCm = { w: 90, h: 40 }, // tamaÃ±o final SIN sangrado (cm)
    bleedMm = 3,
    dpi = 300,
    onLayoutChange,
    material,
    isCircular = false,
    straightEdges = false,
    onToggleCircular,
    onPickedColor,
    onClearImage,
    showCanvas = true,
    showHistoryControls = true,
    showToolbar = true,
    onHistoryChange,
    isReplacing = false,
    onReplaceSettled,
    onUnmountCleanup,
    topLeftOverlay,
    lienzoHeight,
    editorRootClassName,
    lienzoClassName,
    lienzoStyle: lienzoStyleProp,
    canvasWrapperClassName,
    allowCanvasPan = true,
    onImageDragStart,
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
  const coverReferenceCm = useMemo(
    () => ({ w: workCm.w, h: workCm.h }),
    [workCm.h, workCm.w],
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
  const resolvedImageUrl = useMemo(() => {
    const primary = typeof imageUrl === "string" ? imageUrl.trim() : "";
    if (primary) return primary;
    const fallback = typeof externalImageUrlProp === "string" ? externalImageUrlProp.trim() : "";
    return fallback || null;
  }, [externalImageUrlProp, imageUrl]);

  // viewport
  const wrapRef = useRef(null);
  const stageRef = useRef(null);
  const exportStageRef = useRef(null);
  const padGroupRef = useRef(null);
  const glassOverlayRef = useRef(null);
  const [wrapSize, setWrapSize] = useState({ w: 960, h: 540 });
  const isTouch = useMemo(() => isTouchDevice(), []);
  const isTouchImageDragEnabled = isTouch && !allowCanvasPan;
  const hasAdjustedViewRef = useRef(false);
  useEffect(() => {
    if (!isTouch) return undefined;
    const stage = stageRef.current;
    const container = stage?.container();
    if (!container) return undefined;

    const getCanvases = () => Array.from(container.querySelectorAll("canvas"));
    const previousCanvasStyles = new Map();
    const previousContainerPointerEvents = container.style.pointerEvents;
    const previousContainerTouchAction = container.style.touchAction;
    const restore = () => {
      container.style.pointerEvents = previousContainerPointerEvents || "";
      container.style.touchAction = previousContainerTouchAction || "";
      getCanvases().forEach((c) => {
        const previous = previousCanvasStyles.get(c);
        c.style.pointerEvents = previous?.pointerEvents || "";
        c.style.touchAction = previous?.touchAction || "";
      });
    };

    const applyTouchInteractionMode = () => {
      container.style.pointerEvents = "auto";
      container.style.touchAction = isTouchImageDragEnabled ? "none" : "pan-y";
      getCanvases().forEach((c) => {
        if (!previousCanvasStyles.has(c)) {
          previousCanvasStyles.set(c, {
            pointerEvents: c.style.pointerEvents,
            touchAction: c.style.touchAction,
          });
        }
        c.style.pointerEvents = isTouchImageDragEnabled ? "auto" : "none";
        c.style.touchAction = isTouchImageDragEnabled ? "none" : "pan-y";
      });
    };

    applyTouchInteractionMode();

    const observer = new MutationObserver(applyTouchInteractionMode);
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
  }, [isTouch, isTouchImageDragEnabled]);
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const viewport = readViewportSize(wrapRef.current, { width: 600, height: 360 });
      const next = {
        w: viewport.width,
        h: viewport.height,
      };
      setWrapSize((prev) =>
        prev.w !== next.w || prev.h !== next.h ? next : prev,
      );
    });
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);
  const baseScale = useMemo(() => {
    const s = Math.min(wrapSize.w / workCm.w, wrapSize.h / workCm.h);
    return s;
  }, [wrapSize.w, wrapSize.h, workCm.w, workCm.h]);
  const [viewScale, setViewScale] = useState(1);
  const [viewPos, setViewPos] = useState(() => {
    const W = workCm.w * baseScale;
    const H = workCm.h * baseScale;
    return { x: (wrapSize.w - W) / 2, y: (wrapSize.h - H) / 2 };
  });
  const previewCornerRadiusCm = useMemo(() => {
    if (isCircular) return Math.min(workCm.w, workCm.h) / 2;
    if (straightEdges) return 0;
    const pixelsPerCm = Math.max(baseScale * viewScale, 0.0001);
    return Math.min(
      Math.min(workCm.w, workCm.h) / 2,
      PREVIEW_CORNER_RADIUS_PX / pixelsPerCm,
    );
  }, [baseScale, isCircular, straightEdges, viewScale, workCm.h, workCm.w]);
  const previewPadCornerRadiusCm = useMemo(() => {
    if (isCircular) return Math.min(wCm, hCm) / 2;
    if (straightEdges) return 0;
    const pixelsPerCm = Math.max(baseScale * viewScale, 0.0001);
    return Math.min(
      Math.min(wCm, hCm) / 2,
      PREVIEW_CORNER_RADIUS_PX / pixelsPerCm,
    );
  }, [baseScale, hCm, isCircular, straightEdges, viewScale, wCm]);
  const previewOutlineStrokeCm = useMemo(
    () => 1.35 / Math.max(baseScale * viewScale, 0.0001),
    [baseScale, viewScale],
  );
  const previewOutlineInsetCm = useMemo(
    () => previewOutlineStrokeCm * (straightEdges ? 0.8 : 1.45),
    [previewOutlineStrokeCm, straightEdges],
  );
  const previewOutlineBottomInsetCm = useMemo(
    () => previewOutlineInsetCm + (straightEdges ? previewOutlineStrokeCm * 0.25 : previewOutlineStrokeCm * 0.95),
    [previewOutlineInsetCm, previewOutlineStrokeCm, straightEdges],
  );
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

  const getStagePointerPosition = useCallback(
    (stage) => stage?.getPointerPosition?.() ?? null,
    [],
  );

  const pointerWorld = (stage) => {
    const pt = getStagePointerPosition(stage);
    if (!pt) return { x: 0, y: 0 };
    const k = baseScale * viewScaleRef.current;
    const currentViewPos = viewPosRef.current;
    return {
      x: (pt.x - currentViewPos.x) / k,
      y: (pt.y - currentViewPos.y) / k,
    };
  };
  const isOutsideWorkArea = (wp) =>
    wp.x < 0 || wp.y < 0 || wp.x > workCm.w || wp.y > workCm.h;

  const startPickColor = useCallback((cb) => {
    pickCallbackRef.current = cb;
    pickingColorRef.current = true;
    setIsPickingColor(true);
  }, []);

  // selecciÃ³n
  const imgRef = useRef(null);
  const trRef = useRef(null);
  const [showTransformer, setShowTransformer] = useState(true);

  const getSelectedNode = useCallback(() => {
    if (showTransformer && imgRef.current) {
      return imgRef.current;
    }

    const nodes = trRef.current?.nodes?.();
    if (nodes && nodes.length > 0) return nodes[0];
    return null;
  }, [showTransformer]);

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
      isPanningRef.current = allowCanvasPan;
      if (allowCanvasPan) {
        const stagePointer = getStagePointerPosition(stage);
        if (stagePointer) {
          lastPointerRef.current = stagePointer;
        }
      }
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
    const stage = e.target.getStage();
    const stagePointer = getStagePointerPosition(stage);
    if (!stagePointer) return;
    const dx = stagePointer.x - lastPointerRef.current.x;
    const dy = stagePointer.y - lastPointerRef.current.y;
    if (dx !== 0 || dy !== 0) {
      hasAdjustedViewRef.current = true;
    }
    lastPointerRef.current = stagePointer;
    setViewPos((p) => ({ x: p.x + dx, y: p.y + dy }));
  };
  const endPan = () => {
    isPanningRef.current = false;
  };
  const onStageTouchStart = (e) => {
    e?.evt?.preventDefault?.();
    onStageMouseDown(e);
  };
  const onStageTouchMove = (e) => {
    e?.evt?.preventDefault?.();
    onStageMouseMove(e);
  };
  const onStageTouchEnd = (e) => {
    e?.evt?.preventDefault?.();
    endPan();
  };

  const handleCenterCanvas = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const viewportWidth = stage.width() || wrapSize.w;
    const viewportHeight = stage.height() || wrapSize.h;
    const viewportCenterX = viewportWidth / 2;
    const viewportCenterY = viewportHeight / 2;

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
  }, [baseScale, workCm.h, workCm.w, wrapSize.h, wrapSize.w]);

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
  const [imgEl, imgStatus] = useImage(resolvedImageUrl || undefined);
  const previousResolvedImageUrlRef = useRef(resolvedImageUrl || null);
  const replaceTargetUrlRef = useRef(null);
  const replaceSettledRef = useRef(false);
  const replaceTimeoutRef = useRef(null);
  const replaceImageRef = useRef(null);
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
      const localCenter = { x: node.x(), y: node.y() };
      let absoluteCenter = null;

      try {
        const parentTransform = node.getParent?.()?.getAbsoluteTransform?.();
        const absolutePosition = node.getAbsolutePosition?.();
        if (
          absolutePosition &&
          parentTransform &&
          typeof parentTransform.copy === "function"
        ) {
          absoluteCenter = parentTransform.copy().invert().point(absolutePosition);
        }
      } catch (err) {
        absoluteCenter = null;
      }

      const cx = Number.isFinite(absoluteCenter?.x)
        ? absoluteCenter.x
        : localCenter.x;
      const cy = Number.isFinite(absoluteCenter?.y)
        ? absoluteCenter.y
        : localCenter.y;

      return {
        tx: {
          x_cm: cx - width / 2,
          y_cm: cy - height / 2,
          scaleX,
          scaleY,
          rotation_deg: node.rotation(),
          flipX: scaleX < 0,
          flipY: scaleY < 0,
        },
        width,
        height,
        cx,
        cy,
        localCenter,
        absoluteCenter,
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

  const defaultBgColor = readRootCssVar('--nm-canvas-bg-light');
  const previewOutlineColor = readRootCssVar('--foreground');
  const selectionStrokeColor = readRootCssVar('--nm-selection-stroke');
  const guidePrimaryColor = readRootCssVar('--nm-guide-primary');
  const qualityUnknownColor = readRootCssVar('--nm-slate-400');
  const qualityBadColor = readRootCssVar('--error');
  const qualityWarnColor = readRootCssVar('--warning');
  const qualityOkColor = readRootCssVar('--success');
  const [keepRatio, setKeepRatio] = useState(true);
  const keepRatioRef = useRef(true);
  const [mode, setMode] = useState("cover"); // 'cover' | 'contain' | 'stretch'
  const canTransformImage = !isTouch && mode === "contain";
  const transformerAnchors = canTransformImage
    ? [
        "top-left",
        "top-center",
        "top-right",
        "middle-left",
        "middle-right",
        "bottom-left",
        "bottom-center",
        "bottom-right",
      ]
    : [];
  const shouldShowTransformerOverlay = showTransformer && canTransformImage;
  const stickyFitRef = useRef(null);
  const pendingRotateRefitModeRef = useRef(null);
  const skipStickyFitOnceRef = useRef(false);
  const [bgColor, setBgColor] = useState(defaultBgColor);
  const lastCommittedBgColorRef = useRef(defaultBgColor);
  const [activeAlign, setActiveAlign] = useState({ horizontal: null, vertical: null });
  const isTransformingRef = useRef(false);
  const cornerScaleRef = useRef({ prev: null });
  const transformStateRef = useRef(null);
  const dragJumpGuardRef = useRef({ awaitingFirstMove: false });
  const getClampedPositionRef = useRef((x, y) => ({ x_cm: x, y_cm: y }));

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
      const clampedPosition = getClampedPositionRef.current(
        imgTx.x_cm + dx,
        imgTx.y_cm + dy,
        { tx: imgTx },
      );
      if (
        clampedPosition.x_cm === imgTx.x_cm
        && clampedPosition.y_cm === imgTx.y_cm
      ) {
        return;
      }
      pushHistory(imgTx);
      stickyFitRef.current = null;
      skipStickyFitOnceRef.current = false;
      setImgTx((tx) => ({ ...tx, ...clampedPosition }));
    },
    [imgTx, pushHistory],
  );

  useEffect(() => {
    const handler = (e) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      if (isTypingTarget(document.activeElement) || isTypingTarget(e.target)) return;
      e.preventDefault();
      const step = e.shiftKey ? KEYBOARD_FAST_NUDGE_STEP_CM : KEYBOARD_NUDGE_STEP_CM;
      if (e.key === 'ArrowUp') moveBy(0, -step);
      if (e.key === 'ArrowDown') moveBy(0, step);
      if (e.key === 'ArrowLeft') moveBy(-step, 0);
      if (e.key === 'ArrowRight') moveBy(step, 0);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [moveBy]);

  const clearImageNodeCache = useCallback((redraw = false) => {
    const node = imgRef.current;
    if (!node || typeof node.clearCache !== "function") return;
    node.clearCache();
    if (redraw) {
      node.getLayer()?.batchDraw();
    }
  }, []);

  const didInitRef = useRef(false);
  const hasSyncedInitialNodeRef = useRef(false);
  const hasForcedInitialNodeSyncRef = useRef(false);
  const postLoadBatchDrawTimeoutRef = useRef(null);
  const schedulePostLoadBatchDraw = useCallback(() => {
    if (postLoadBatchDrawTimeoutRef.current) {
      clearTimeout(postLoadBatchDrawTimeoutRef.current);
    }
    postLoadBatchDrawTimeoutRef.current = setTimeout(() => {
      postLoadBatchDrawTimeoutRef.current = null;
      imgRef.current?.getLayer()?.batchDraw?.();
      stageRef.current?.batchDraw?.();
    }, 100);
  }, []);
  const forceSyncDimensions = useCallback(() => {
    if (!imgEl || imgStatus !== "loaded") return false;

    const naturalWidth = Number(imgEl.naturalWidth);
    const naturalHeight = Number(imgEl.naturalHeight);
    if (!(naturalWidth > 0) || !(naturalHeight > 0)) return false;

    const realWidthCm = (naturalWidth / dpi) * CM_PER_INCH;
    const realHeightCm = (naturalHeight / dpi) * CM_PER_INCH;
    if (!(realWidthCm > 0) || !(realHeightCm > 0)) return false;

    const viewport = readViewportSize(wrapRef.current, {
      width: wrapSize.w,
      height: wrapSize.h,
    });
    const stage = stageRef.current;
    const stageWidth = stage?.width?.() || viewport.width;
    const stageHeight = stage?.height?.() || viewport.height;
    if (!(stageWidth > 0) || !(stageHeight > 0)) return false;

    const stageScale = Math.max(baseScale, 0.0001);
    const initialCoverToleranceCm = 2 / stageScale;
    const baseCoverScale = Math.max(
      (coverReferenceCm.w + initialCoverToleranceCm * 2) / realWidthCm,
      (coverReferenceCm.h + initialCoverToleranceCm * 2) / realHeightCm,
    );
    if (!Number.isFinite(baseCoverScale) || baseCoverScale <= 0) return false;

    const syncedWidth = realWidthCm * baseCoverScale;
    const syncedHeight = realHeightCm * baseCoverScale;
    const nextTx = {
      x_cm: (coverReferenceCm.w - syncedWidth) / 2,
      y_cm: (coverReferenceCm.h - syncedHeight) / 2,
      scaleX: baseCoverScale,
      scaleY: baseCoverScale,
      rotation_deg: 0,
      flipX: false,
      flipY: false,
    };
    const nextViewPos = {
      x: stageWidth / 2 - (coverReferenceCm.w / 2) * baseScale,
      y: stageHeight / 2 - (coverReferenceCm.h / 2) * baseScale,
    };

    const node = imgRef.current;
    if (node) {
      const centerX = nextTx.x_cm + syncedWidth / 2;
      const centerY = nextTx.y_cm + syncedHeight / 2;
      node.width(syncedWidth);
      node.height(syncedHeight);
      node.offsetX(node.width() / 2);
      node.offsetY(node.height() / 2);
      node.scaleX(1);
      node.scaleY(1);
      node.rotation(0);
      node.position({ x: centerX, y: centerY });
      clearImageNodeCache(true);
    }

    if (stage) {
      stage.scale({ x: baseScale, y: baseScale });
      stage.position(nextViewPos);
      stage.batchDraw();
    }

    schedulePostLoadBatchDraw();

    viewScaleRef.current = 1;
    viewPosRef.current = nextViewPos;
    setViewScale(1);
    setViewPos(nextViewPos);
    setImgTx(nextTx);
    setMode("cover");
    stickyFitRef.current = "cover";
    skipStickyFitOnceRef.current = true;
    hasAdjustedViewRef.current = false;
    hasSyncedInitialNodeRef.current = true;
    hasForcedInitialNodeSyncRef.current = true;
    didInitRef.current = true;
    return true;
  }, [
    baseScale,
    clearImageNodeCache,
    coverReferenceCm.h,
    coverReferenceCm.w,
    dpi,
    imgEl,
    imgStatus,
    schedulePostLoadBatchDraw,
    wrapSize.h,
    wrapSize.w,
  ]);
  // Reiniciar al cargar una nueva imagen
  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    updateHistoryCounts();
    stickyFitRef.current = null;
    skipStickyFitOnceRef.current = false;
    didInitRef.current = false;
    hasSyncedInitialNodeRef.current = false;
    hasForcedInitialNodeSyncRef.current = false;
    hasAdjustedViewRef.current = false;
    if (postLoadBatchDrawTimeoutRef.current) {
      clearTimeout(postLoadBatchDrawTimeoutRef.current);
      postLoadBatchDrawTimeoutRef.current = null;
    }
    setViewScale(1);
    const viewport = readViewportSize(wrapRef.current, {
      width: wrapSize.w,
      height: wrapSize.h,
    });
    const nextViewPos = getCenteredStagePosition({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      workWidth: coverReferenceCm.w,
      workHeight: coverReferenceCm.h,
      scale: baseScale,
    });
    viewScaleRef.current = 1;
    viewPosRef.current = nextViewPos;
    setViewPos(nextViewPos);
  }, [baseScale, coverReferenceCm.h, coverReferenceCm.w, imageFile, resolvedImageUrl, updateHistoryCounts]);

  useEffect(() => {
    return () => {
      if (postLoadBatchDrawTimeoutRef.current) {
        clearTimeout(postLoadBatchDrawTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setActiveAlign({ horizontal: null, vertical: null });
  }, [resolvedImageUrl, imageFile]);

  const clearReplaceWatchdog = useCallback(() => {
    if (replaceTimeoutRef.current) {
      clearTimeout(replaceTimeoutRef.current);
      replaceTimeoutRef.current = null;
    }
    if (replaceImageRef.current) {
      replaceImageRef.current.onload = null;
      replaceImageRef.current.onerror = null;
      replaceImageRef.current = null;
    }
  }, []);

  const settleReplace = useCallback((status = "loaded", expectedUrl = null) => {
    if (replaceSettledRef.current) return;
    if (
      expectedUrl
      && replaceTargetUrlRef.current
      && expectedUrl !== replaceTargetUrlRef.current
    ) {
      return;
    }
    replaceSettledRef.current = true;
    clearReplaceWatchdog();
    onReplaceSettled?.(status);
  }, [clearReplaceWatchdog, onReplaceSettled]);

  useEffect(() => {
    const previousUrl = previousResolvedImageUrlRef.current || null;
    const currentUrl = resolvedImageUrl || null;

    if (!isReplacing) {
      previousResolvedImageUrlRef.current = currentUrl;
      replaceTargetUrlRef.current = null;
      replaceSettledRef.current = false;
      clearReplaceWatchdog();
      return;
    }

    if (!currentUrl || currentUrl === previousUrl) return undefined;

    replaceTargetUrlRef.current = currentUrl;
    replaceSettledRef.current = false;
    clearReplaceWatchdog();

    const newImage = new Image();
    const settleLoaded = () => settleReplace("loaded", currentUrl);
    const settleFailed = () => settleReplace("failed", currentUrl);

    newImage.onload = settleLoaded;
    newImage.onerror = settleFailed;
    replaceImageRef.current = newImage;
    replaceTimeoutRef.current = setTimeout(() => {
      settleReplace("timeout", currentUrl);
    }, 10000);
    newImage.src = currentUrl;

    if (newImage.complete) {
      if (newImage.naturalWidth > 0) {
        settleLoaded();
      } else {
        settleFailed();
      }
    }

    previousResolvedImageUrlRef.current = currentUrl;

    return () => {
      if (replaceImageRef.current === newImage) {
        newImage.onload = null;
        newImage.onerror = null;
        replaceImageRef.current = null;
      }
      if (replaceTimeoutRef.current) {
        clearTimeout(replaceTimeoutRef.current);
        replaceTimeoutRef.current = null;
      }
    };
  }, [clearReplaceWatchdog, isReplacing, resolvedImageUrl, settleReplace]);

  useEffect(() => () => {
    clearReplaceWatchdog();
  }, [clearReplaceWatchdog]);

  useEffect(() => {
    if (!isReplacing || replaceSettledRef.current) return;
    if (!replaceTargetUrlRef.current || resolvedImageUrl !== replaceTargetUrlRef.current) return;
    if (imgStatus !== "loaded" && imgStatus !== "failed") return;
    settleReplace(imgStatus, resolvedImageUrl);
  }, [imgStatus, isReplacing, resolvedImageUrl, settleReplace]);

  // Ajuste inicial: reiniciamos offset, escala y viewport apenas termina la carga.
  useLayoutEffect(() => {
    if (didInitRef.current) return;
    forceSyncDimensions();
  }, [forceSyncDimensions]);

  // medidas visuales (para offset centro)
  const dispW = imgBaseCm ? imgBaseCm.w * Math.abs(imgTx.scaleX) : 0;
  const dispH = imgBaseCm ? imgBaseCm.h * Math.abs(imgTx.scaleY) : 0;
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
  // imÃ¡n fuerte (centro + AABB rotado)
  const getClampedPosition = useCallback(
    (proposedX, proposedY, options = {}) => {
      const txSource = options?.tx ?? imgTx;
      const width = Number(
        options?.width
        ?? (imgBaseCm ? imgBaseCm.w * Math.abs(txSource?.scaleX ?? 0) : 0),
      );
      const height = Number(
        options?.height
        ?? (imgBaseCm ? imgBaseCm.h * Math.abs(txSource?.scaleY ?? 0) : 0),
      );
      const rotationDeg = Number.isFinite(Number(options?.rotationDeg))
        ? Number(options.rotationDeg)
        : Number(txSource?.rotation_deg) || 0;
      const targetMode = options?.mode ?? mode;

      if (!(width > 0) || !(height > 0)) {
        return { x_cm: proposedX, y_cm: proposedY };
      }

      if (targetMode === "contain") {
        return { x_cm: proposedX, y_cm: proposedY };
      }

      const centeredX = (workCm.w - width) / 2;
      const centeredY = (workCm.h - height) / 2;
      if (targetMode === "stretch") {
        return { x_cm: centeredX, y_cm: centeredY };
      }

      const centerX = proposedX + width / 2;
      const centerY = proposedY + height / 2;
      const rotationRad = (rotationDeg * Math.PI) / 180;
      const { halfW, halfH } = rotAABBHalf(width, height, rotationRad);
      const aabbWidth = halfW * 2;
      const aabbHeight = halfH * 2;
      const widthDelta = Math.abs(aabbWidth - workCm.w);
      const heightDelta = Math.abs(aabbHeight - workCm.h);
      const lockX =
        (widthDelta <= COVER_AXIS_LOCK_EPSILON_CM && heightDelta > COVER_AXIS_LOCK_EPSILON_CM)
        || (widthDelta <= COVER_AXIS_LOCK_EPSILON_CM && heightDelta <= COVER_AXIS_LOCK_EPSILON_CM)
        || (widthDelta > COVER_AXIS_LOCK_EPSILON_CM && heightDelta > COVER_AXIS_LOCK_EPSILON_CM && widthDelta <= heightDelta);
      const lockY =
        (!lockX && heightDelta <= COVER_AXIS_LOCK_EPSILON_CM)
        || (!lockX && heightDelta > COVER_AXIS_LOCK_EPSILON_CM);
      const minCenterX = workCm.w - halfW;
      const maxCenterX = halfW;
      const minCenterY = workCm.h - halfH;
      const maxCenterY = halfH;
      const clampedCenterX =
        lockX
          ? workCm.w / 2
          : minCenterX <= maxCenterX
            ? clampValue(centerX, minCenterX, maxCenterX)
            : workCm.w / 2;
      const clampedCenterY =
        lockY
          ? workCm.h / 2
          : minCenterY <= maxCenterY
            ? clampValue(centerY, minCenterY, maxCenterY)
            : workCm.h / 2;

      return {
        x_cm: clampedCenterX - width / 2,
        y_cm: clampedCenterY - height / 2,
      };
    },
    [imgBaseCm, imgTx, mode, workCm.h, workCm.w],
  );
  getClampedPositionRef.current = getClampedPosition;

  const resolveDragTransform = useCallback(
    (nodeArg = imgRef.current) => {
      const live = readNodeTransform(nodeArg);
      if (!live?.tx) return null;

      const absoluteCenter = live.absoluteCenter;
      const stateCenter = {
        x: imgTx.x_cm + live.width / 2,
        y: imgTx.y_cm + live.height / 2,
      };
      const shouldPrioritizeAbsolute =
        Number.isFinite(absoluteCenter?.x) &&
        Number.isFinite(absoluteCenter?.y) &&
        Math.hypot(
          absoluteCenter.x - stateCenter.x,
          absoluteCenter.y - stateCenter.y,
        ) > ABSOLUTE_DRAG_SYNC_EPSILON_CM;

      if (!shouldPrioritizeAbsolute) return live;

      return {
        ...live,
        cx: absoluteCenter.x,
        cy: absoluteCenter.y,
        tx: {
          ...live.tx,
          x_cm: absoluteCenter.x - live.width / 2,
          y_cm: absoluteCenter.y - live.height / 2,
        },
      };
    },
    [imgTx.x_cm, imgTx.y_cm, readNodeTransform],
  );

  const onImgDragStart = (e) => {
    const node = e?.target ?? imgRef.current;
    if (node && dispW > 0 && dispH > 0) {
      const centerX = imgTx.x_cm + dispW / 2;
      const centerY = imgTx.y_cm + dispH / 2;
      node.width(dispW);
      node.height(dispH);
      node.offsetX(node.width() / 2);
      node.offsetY(node.height() / 2);
      node.scaleX(imgTx.flipX ? -1 : 1);
      node.scaleY(imgTx.flipY ? -1 : 1);
      node.rotation(imgTx.rotation_deg);
      node.position({ x: centerX, y: centerY });
      clearImageNodeCache(true);
    }
    dragJumpGuardRef.current = { awaitingFirstMove: true };
    const live = resolveDragTransform(node);
    if (live?.tx) {
      setImgTx((prev) => ({ ...prev, ...live.tx }));
    }
    pushHistory(live?.tx ?? imgTx);
    stickyFitRef.current = null;
    skipStickyFitOnceRef.current = false;
    onImageDragStart?.();
  };
  const dragBoundFunc = useCallback(
    function (pos) {
      const node = this ?? imgRef.current;
      const live = node ? resolveDragTransform(node) : getLiveNodeTransform();
      const baseTx = live?.tx ?? imgTx;

      if (!imgBaseCm || isTransformingRef.current || !baseTx || !node) return pos;

      const parentTransform = node.getParent?.()?.getAbsoluteTransform?.();
      const toLocalPoint = (point) => {
        if (!parentTransform || typeof parentTransform.copy !== "function") {
          return { x: point.x, y: point.y };
        }
        return parentTransform.copy().invert().point(point);
      };
      const toAbsolutePoint = (point) => {
        if (!parentTransform || typeof parentTransform.copy !== "function") {
          return { x: point.x, y: point.y };
        }
        return parentTransform.copy().point(point);
      };

      const currentAbsPos = node.getAbsolutePosition?.() ?? pos;
      if (dragJumpGuardRef.current.awaitingFirstMove) {
        dragJumpGuardRef.current.awaitingFirstMove = false;
        const jumpX = Math.abs(pos.x - currentAbsPos.x);
        const jumpY = Math.abs(pos.y - currentAbsPos.y);
        if (
          jumpX > INITIAL_DRAG_JUMP_GUARD_PX ||
          jumpY > INITIAL_DRAG_JUMP_GUARD_PX
        ) {
          return currentAbsPos;
        }
      }

      const proposedLocal = toLocalPoint(pos);
      const w = live?.width ?? imgBaseCm.w * Math.abs(baseTx.scaleX);
      const h = live?.height ?? imgBaseCm.h * Math.abs(baseTx.scaleY);
      const rotationDeg = live?.tx.rotation_deg ?? imgTx.rotation_deg;
      const clampedTx = getClampedPosition(
        proposedLocal.x - w / 2,
        proposedLocal.y - h / 2,
        {
          tx: baseTx,
          width: w,
          height: h,
          rotationDeg,
          mode,
        },
      );
      const clampedLocal = {
        x: clampedTx.x_cm + w / 2,
        y: clampedTx.y_cm + h / 2,
      };

      return toAbsolutePoint(clampedLocal);
    },
    [
      getLiveNodeTransform,
      getClampedPosition,
      imgBaseCm,
      imgTx,
      mode,
      resolveDragTransform,
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
  const onImgTouchStart = (e) => {
    e?.evt?.preventDefault?.();
    onImgMouseDown();
  };
  const onImgTouchMove = (e) => {
    e?.evt?.preventDefault?.();
  };
  const onImgTouchEnd = (e) => {
    e?.evt?.preventDefault?.();
  };
  const onImgDragMove = (e) => {
    e?.evt?.preventDefault?.();
    isPanningRef.current = false;
    const live = resolveDragTransform(e.target);
    if (live?.tx) {
      setImgTx((prev) => ({ ...prev, ...live.tx }));
    }
    clearImageNodeCache();
  };
  const onImgDragEnd = (e) => {
    e?.evt?.preventDefault?.();
    dragJumpGuardRef.current = { awaitingFirstMove: false };
    const live = resolveDragTransform();
    if (live?.tx) {
      setImgTx((prev) => ({ ...prev, ...live.tx }));
    }
    clearImageNodeCache(true);
  };

  // transformer
  useEffect(() => {
    keepRatioRef.current = keepRatio;
    if (!trRef.current) return;
    trRef.current.keepRatio(keepRatio);
    if (shouldShowTransformerOverlay && imgRef.current)
      trRef.current.nodes([imgRef.current]);
    else trRef.current.nodes([]);
    trRef.current.getLayer()?.batchDraw();
  }, [imgEl, keepRatio, shouldShowTransformerOverlay]);

  // fin de resize por esquinas
  const onTransformStart = useCallback(() => {
    if (isTouch) return;

    isTransformingRef.current = true;
    const anchorName = trRef.current?.getActiveAnchor();
    const shouldKeep =
      !anchorName ||
      anchorName === "rotater" ||
      CORNER_ANCHORS.has(anchorName);
    cornerScaleRef.current = { prev: null };

    if (imgRef.current) {
      const node = imgRef.current;
      const rotationDeg = ((node.rotation() % 360) + 360) % 360;
      transformStateRef.current = {
        rotationDeg,
        startScaleX: node.scaleX(),
        startScaleY: node.scaleY(),
        clientRect: node.getClientRect({ skipShadow: true, skipStroke: true }),
      };
    }

    if (shouldKeep && imgRef.current && imgBaseCm) {
      const node = imgRef.current;
      const rotationDeg = transformStateRef.current?.rotationDeg ?? node.rotation();
      const rotationRad = (rotationDeg * Math.PI) / 180;
      const isRightAngle = rotationDeg === 90 || rotationDeg === 270;
      const absScaleX = Math.abs(node.scaleX());
      const absScaleY = Math.abs(node.scaleY());

      const baseRect = transformStateRef.current?.clientRect;
      const rectW = baseRect?.width ?? imgBaseCm.w;
      const rectH = baseRect?.height ?? imgBaseCm.h;
      const baseBoundW = isRightAngle
        ? rectH
        : imgBaseCm.w * Math.abs(Math.cos(rotationRad)) +
          imgBaseCm.h * Math.abs(Math.sin(rotationRad));
      const baseBoundH = isRightAngle
        ? rectW
        : imgBaseCm.w * Math.abs(Math.sin(rotationRad)) +
          imgBaseCm.h * Math.abs(Math.cos(rotationRad));

      const scaledW = imgBaseCm.w * absScaleX;
      const scaledH = imgBaseCm.h * absScaleY;
      const currentBoundW = isRightAngle
        ? rectH
        : scaledW * Math.abs(Math.cos(rotationRad)) +
          scaledH * Math.abs(Math.sin(rotationRad));
      const currentBoundH = isRightAngle
        ? rectW
        : scaledW * Math.abs(Math.sin(rotationRad)) +
          scaledH * Math.abs(Math.cos(rotationRad));

      const widthScale = baseBoundW > 0 ? currentBoundW / baseBoundW : null;
      const heightScale = baseBoundH > 0 ? currentBoundH / baseBoundH : null;
      let prevScale = null;
      if (widthScale > 0 && heightScale > 0) {
        prevScale = Math.sqrt(widthScale * heightScale);
      } else if (widthScale > 0) {
        prevScale = widthScale;
      } else if (heightScale > 0) {
        prevScale = heightScale;
      }
      const fallbackScale = Math.max(absScaleX, absScaleY, 0.01);
      cornerScaleRef.current.prev =
        prevScale && Number.isFinite(prevScale) && prevScale > 0
          ? prevScale
          : fallbackScale;
    }
    setKeepRatioImmediate(shouldKeep);
  }, [imgBaseCm, isTouch, setKeepRatioImmediate]);

  const onTransformEnd = () => {
    if (isTouch) return;

    isTransformingRef.current = false;
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
      // libre => sin lÃ­mites superiores
      if (!shouldKeep) {
        const newSX = Math.max(prev.scaleX * ratioX, 0.01);
        const newSY = Math.max(prev.scaleY * ratioY, 0.01);
        const w = imgBaseCm.w * newSX;
        const h = imgBaseCm.h * newSY;
        const nextTx = {
          x_cm: cx - w / 2,
          y_cm: cy - h / 2,
          scaleX: newSX,
          scaleY: newSY,
          rotation_deg: rotation,
          flipX: nextSignX < 0,
          flipY: nextSignY < 0,
        };
        const clampedPosition = getClampedPosition(nextTx.x_cm, nextTx.y_cm, {
          tx: nextTx,
          width: w,
          height: h,
          rotationDeg: rotation,
          mode,
        });
        return { ...nextTx, ...clampedPosition };
      }
      // mantener proporciÃ³n con clamp razonable
      const uni = Math.max(
        0.01,
        Math.min(prev.scaleX * ratioX, IMG_ZOOM_MAX),
      );
      const w = imgBaseCm.w * uni;
      const h = imgBaseCm.h * uni;
      const nextTx = {
        x_cm: cx - w / 2,
        y_cm: cy - h / 2,
        scaleX: uni,
        scaleY: uni,
        rotation_deg: rotation,
        flipX: nextSignX < 0,
        flipY: nextSignY < 0,
      };
      const clampedPosition = getClampedPosition(nextTx.x_cm, nextTx.y_cm, {
        tx: nextTx,
        width: w,
        height: h,
        rotationDeg: rotation,
        mode,
      });
      return { ...nextTx, ...clampedPosition };
    });
    n.scaleX(nextSignX);
    n.scaleY(nextSignY);
    clearImageNodeCache(true);
    setKeepRatioImmediate(true);
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
      const centerX = tx.x_cm + width / 2;
      const centerY = tx.y_cm + height / 2;

      node.width(width);
      node.height(height);
      node.offsetX(node.width() / 2);
      node.offsetY(node.height() / 2);
      node.scaleX(tx.flipX ? -1 : 1);
      node.scaleY(tx.flipY ? -1 : 1);
      node.rotation(tx.rotation_deg);
      node.position({ x: centerX, y: centerY });
      clearImageNodeCache();
      node.getLayer()?.batchDraw();
    }, [clearImageNodeCache]);

    useLayoutEffect(() => {
      if (hasSyncedInitialNodeRef.current) return;
      if (!imgEl || !imgBaseCm || !(dispW > 0) || !(dispH > 0)) return;

      syncNodeToFit(imgTx, dispW, dispH);
      hasSyncedInitialNodeRef.current = true;
    }, [
      dispH,
      dispW,
      imgBaseCm,
      imgEl,
      imgTx.flipX,
      imgTx.flipY,
      imgTx.rotation_deg,
      imgTx.x_cm,
      imgTx.y_cm,
      syncNodeToFit,
    ]);

    // cover/contain/estirar con rotaciÃ³n
    useEffect(() => {
      if (hasForcedInitialNodeSyncRef.current) return;
      if (!didInitRef.current || !imgEl || !imgBaseCm || !(dispW > 0) || !(dispH > 0)) return;

      syncNodeToFit(imgTx, dispW, dispH);
      stageRef.current?.batchDraw?.();
      hasForcedInitialNodeSyncRef.current = true;
    }, [
      dispH,
      dispW,
      imgBaseCm,
      imgEl,
      imgTx.flipX,
      imgTx.flipY,
      imgTx.rotation_deg,
      imgTx.x_cm,
      imgTx.y_cm,
      mode,
      syncNodeToFit,
    ]);

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
        const defaultCenter =
          mode === "cover" || mode === "stretch"
            ? { cx: workCm.w / 2, cy: workCm.h / 2 }
            : fallbackCenter;
        const targetCx =
          options?.center?.x ??
          options?.center?.cx ??
          defaultCenter.cx;
        const targetCy =
          options?.center?.y ??
          options?.center?.cy ??
          defaultCenter.cy;
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

  useLayoutEffect(() => {
    const pendingMode = pendingRotateRefitModeRef.current;
    if (!pendingMode || !imgEl || !imgBaseCm) return;

    pendingRotateRefitModeRef.current = null;
    const rafId = window.requestAnimationFrame(() => {
      applyFit(pendingMode, {
        center: { x: workCm.w / 2, y: workCm.h / 2 },
      });
    });

    return () => window.cancelAnimationFrame(rafId);
  }, [applyFit, imgBaseCm, imgEl, imgTx.rotation_deg, workCm.h, workCm.w]);

  const updatePositionWithModeClamp = useCallback(
    (proposedX, proposedY, options = {}) => {
      if (!imgBaseCm) return;
      const live = options.live ?? getLiveNodeTransform();
      const liveTx = live?.tx ?? imgTx;
      const width = Number(
        options?.width ?? (imgBaseCm.w * Math.abs(liveTx.scaleX)),
      );
      const height = Number(
        options?.height ?? (imgBaseCm.h * Math.abs(liveTx.scaleY)),
      );
      const rotationDeg = Number.isFinite(Number(options?.rotationDeg))
        ? Number(options.rotationDeg)
        : liveTx.rotation_deg;
      const clampedPosition = getClampedPosition(proposedX, proposedY, {
        tx: liveTx,
        width,
        height,
        rotationDeg,
        mode: options?.mode ?? mode,
      });

      if (
        clampedPosition.x_cm === liveTx.x_cm &&
        clampedPosition.y_cm === liveTx.y_cm
      ) {
        return;
      }

      pushHistory(liveTx);
      stickyFitRef.current = null;
      skipStickyFitOnceRef.current = false;
      setImgTx((tx) => ({
        ...tx,
        ...liveTx,
        ...clampedPosition,
      }));
    },
    [getClampedPosition, getLiveNodeTransform, imgBaseCm, imgTx, mode, pushHistory],
  );

  const centerHoriz = useCallback(() => {
    const live = getLiveNodeTransform();
    if (!imgBaseCm) return;
    const liveTx = live?.tx ?? imgTx;
    const width = imgBaseCm.w * Math.abs(liveTx.scaleX);
    const height = imgBaseCm.h * Math.abs(liveTx.scaleY);
    updatePositionWithModeClamp((workCm.w - width) / 2, liveTx.y_cm, {
      live,
      width,
      height,
      rotationDeg: liveTx.rotation_deg,
    });
  }, [getLiveNodeTransform, imgBaseCm, imgTx, updatePositionWithModeClamp, workCm.w]);

  const centerVert = useCallback(() => {
    const live = getLiveNodeTransform();
    if (!imgBaseCm) return;
    const liveTx = live?.tx ?? imgTx;
    const width = imgBaseCm.w * Math.abs(liveTx.scaleX);
    const height = imgBaseCm.h * Math.abs(liveTx.scaleY);
    updatePositionWithModeClamp(liveTx.x_cm, (workCm.h - height) / 2, {
      live,
      width,
      height,
      rotationDeg: liveTx.rotation_deg,
    });
  }, [getLiveNodeTransform, imgBaseCm, imgTx, updatePositionWithModeClamp, workCm.h]);

  const alignEdge = useCallback((edge) => {
    if (!imgBaseCm) return;
    const live = getLiveNodeTransform();
    const liveTx = live?.tx ?? imgTx;
    const width = imgBaseCm.w * Math.abs(liveTx.scaleX);
    const height = imgBaseCm.h * Math.abs(liveTx.scaleY);
    const rotationDeg = liveTx.rotation_deg;
    const rotationRad = (rotationDeg * Math.PI) / 180;
    const { halfW, halfH } = rotAABBHalf(width, height, rotationRad);

    let cx = live?.cx ?? liveTx.x_cm + width / 2;
    let cy = live?.cy ?? liveTx.y_cm + height / 2;

    if (edge === "left") cx = halfW;
    if (edge === "right") cx = workCm.w - halfW;
    if (edge === "top") cy = halfH;
    if (edge === "bottom") cy = workCm.h - halfH;

    updatePositionWithModeClamp(cx - width / 2, cy - height / 2, {
      live,
      width,
      height,
      rotationDeg,
    });
  }, [getLiveNodeTransform, imgBaseCm, imgTx, updatePositionWithModeClamp, workCm.h, workCm.w]);

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
    const shouldRefit = mode === "cover" || mode === "stretch";
    pushHistory(imgTx);
    pendingRotateRefitModeRef.current = shouldRefit ? mode : null;
    stickyFitRef.current = shouldRefit ? mode : null;
    skipStickyFitOnceRef.current = false;
    setImgTx((tx) => ({
      ...tx,
      rotation_deg: (tx.rotation_deg + 90) % 360,
    }));
  }, [imgEl, imgTx, mode, pushHistory]);

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

    const viewport = readViewportSize(wrapRef.current, {
      width: wrapSize.w,
      height: wrapSize.h,
    });
    const centeredPos = getCenteredStagePosition({
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      workWidth: workCm.w,
      workHeight: workCm.h,
      scale: baseScale,
    });
    const targetX = centeredPos.x;
    const targetY = centeredPos.y;
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
    resolvedImageUrl,
    imageFile,
    material,
  ]);

  // Calidad: solo resolución del archivo (px), no tamaño del pad ni zoom en el lienzo.
  const quality = useMemo(() => {
    if (!imgEl?.naturalWidth || !imgEl?.naturalHeight) {
      return { label: '—', color: qualityUnknownColor, level: null };
    }
    const nw = imgEl.naturalWidth;
    const nh = imgEl.naturalHeight;
    const level = intrinsicImageQualityLevel(nw, nh);
    const pxLabel = `${nw}×${nh} px`;
    if (level === 'bad') {
      return {
        label: `Pocas píxeles (${pxLabel}) — subí una más grande si podés`,
        color: qualityBadColor,
        level,
      };
    }
    if (level === 'warn') {
      return {
        label: `Buena (${pxLabel})`,
        color: qualityWarnColor,
        level,
      };
    }
    return {
      label: `Alta resolución (${pxLabel})`,
      color: qualityOkColor,
      level,
    };
  }, [
    imgEl?.naturalHeight,
    imgEl?.naturalWidth,
    qualityBadColor,
    qualityOkColor,
    qualityUnknownColor,
    qualityWarnColor,
  ]);

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
  const shouldRenderCanvas = showCanvas && Boolean(resolvedImageUrl);
  const canUndo = historyCounts.undo > 0;
  const canRedo = historyCounts.redo > 0;

  const exportPadAsBlob = async (options = {}) => {
    if (!exportStageRef.current) return null;
    const inner_w_px = Math.round((wCm * dpi) / CM_PER_INCH);
    const inner_h_px = Math.round((hCm * dpi) / CM_PER_INCH);
    const pad_px = getPadRectPx();
    const pixelRatioX = inner_w_px / pad_px.w;
    const pixelRatioY = inner_h_px / pad_px.h;
    const basePixelRatio = Math.min(pixelRatioX, pixelRatioY);
    const maxDimension = Number(options?.maxDimension);
    const requestedPixelRatio = Number(options?.pixelRatio);
    let pixelRatio = basePixelRatio;
    if (Number.isFinite(requestedPixelRatio) && requestedPixelRatio > 0) {
      pixelRatio = Math.min(pixelRatio, requestedPixelRatio);
    }
    if (Number.isFinite(maxDimension) && maxDimension > 0) {
      const maxStageDimension = Math.max(pad_px.w, pad_px.h);
      const cappedRatio = maxDimension / Math.max(1, maxStageDimension);
      pixelRatio = Math.min(pixelRatio, cappedRatio);
    }
    const safePixelRatio = Math.max(0.05, pixelRatio || 0);
    const baseCanvas = exportStageRef.current.toCanvas({ pixelRatio: safePixelRatio });
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

  const exportPadPreviewBlob = async (options = {}) => {
    const { maxWidth = 1080, pixelRatio = 1 } = options || {};
    const dataUrl = exportPadDataURL(pixelRatio);
    if (!dataUrl) return null;

    const blobFromDataUrl = async () => {
      try {
        const res = await fetch(dataUrl);
        return await res.blob();
      } catch (err) {
        warn('[exportPadPreviewBlob] blob from dataURL failed', err);
        return null;
      }
    };

    const sourceBlob = await blobFromDataUrl();
    if (!sourceBlob) return null;

    const downscaleIfNeeded = async (blob) => {
      if (!maxWidth || maxWidth <= 0) return blob;
      const objectUrl = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = objectUrl;
        await img.decode();
        const { naturalWidth: w = 0, naturalHeight: h = 0 } = img;
        if (!w || w <= maxWidth) return blob;
        const scale = Math.min(1, maxWidth / w);
        const targetW = Math.max(1, Math.round(w * scale));
        const targetH = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return blob;
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const scaled = await new Promise((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/png', 0.92),
        );
        return scaled || blob;
      } catch (err) {
        warn('[exportPadPreviewBlob] downscale failed', err);
        return blob;
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };

    return downscaleIfNeeded(sourceBlob);
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
        bg: mode === "contain" ? bgColor : defaultBgColor,
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
    exportPadPreviewBlob,
    exportPreviewDataURL,
    exportPadDataURL,
    startPickColor,
    undo,
    redo,
    fitCover,
    fitContain,
    fitStretchCentered,
    centerHoriz,
    centerVert,
    alignLeft: () => alignEdge("left"),
    alignRight: () => alignEdge("right"),
    alignTop: () => alignEdge("top"),
    alignBottom: () => alignEdge("bottom"),
    flipHorizontal,
    flipVertical,
    rotate90,
    openArMeasure,
    getHistoryCounts: () => ({ ...historyCounts }),
    getBackgroundColor: () => bgColor,
    previewBackgroundColor: (hex) => {
      const normalized = normalizeHexColor(hex) || defaultBgColor;
      setBgColor((prev) => {
        if (prev?.toLowerCase() === normalized.toLowerCase()) return prev;
        return normalized;
      });
    },
    commitBackgroundColor: (hex) => {
      const normalized = normalizeHexColor(hex) || defaultBgColor;
      setBgColor((prev) => {
        if (prev?.toLowerCase() === normalized.toLowerCase()) return prev;
        return normalized;
      });
      lastCommittedBgColorRef.current = normalized;
      onPickedColor?.(normalized);
    },
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
      const normalized = normalizeHexColor(hex) || defaultBgColor;
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

  const openArMeasure = useCallback(() => {
    const ancho = Number.isFinite(wCm) ? wCm : Number(sizeCm?.w ?? 0);
    const largo = Number.isFinite(hCm) ? hCm : Number(sizeCm?.h ?? 0);
    const params = new URLSearchParams({
      l: String(largo),
      w: String(ancho),
      h: "0.3",
      units: "cm",
    });
    const arUrl = `https://size.link/?${params.toString()}`;
    window.open(arUrl, "_blank", "noopener,noreferrer");
  }, [hCm, sizeCm?.h, sizeCm?.w, wCm]);

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
    isTouchImageDragEnabled ? styles.canvasWrapperTouchDrag : '',
    isPanningRef.current ? styles.grabbing : '',
    isPickingColor ? styles.picking : '',
    !shouldRenderCanvas ? styles.canvasWrapperInactive : '',
    canvasWrapperClassName || '',
  ]
    .filter(Boolean)
    .join(' ');
  const showReplacingOverlay = isReplacing;
  const isImageDraggable = mode !== "stretch" && (!isTouch || isTouchImageDragEnabled);
  const imageDragBoundFunc =
    isImageDraggable && mode === "cover" ? dragBoundFunc : undefined;
  const editorRootClasses = [styles.editorRoot, editorRootClassName || '']
    .filter(Boolean)
    .join(' ');
  const lienzoClasses = [styles.lienzo, lienzoClassName || '']
    .filter(Boolean)
    .join(' ');
  const lienzoStyle = useMemo(() => {
    const nextStyle = { ...(lienzoStyleProp || {}) };
    if (lienzoHeight != null) {
      nextStyle.height = `${lienzoHeight}px`;
    }
    return Object.keys(nextStyle).length ? nextStyle : undefined;
  }, [lienzoHeight, lienzoStyleProp]);
  // track latest callback to avoid effect loops when parent re-renders
  const layoutChangeRef = useRef(onLayoutChange);
  useEffect(() => {
    layoutChangeRef.current = onLayoutChange;
  }, [onLayoutChange]);
  const unmountCleanupRef = useRef(onUnmountCleanup);
  useEffect(() => {
    unmountCleanupRef.current = onUnmountCleanup;
  }, [onUnmountCleanup]);
  useEffect(() => {
    return () => {
      layoutChangeRef.current?.(null);
      unmountCleanupRef.current?.();
    };
  }, []);

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
      background: mode === "contain" ? bgColor : defaultBgColor,
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
        bg: bgColor || defaultBgColor,
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
      <div className={editorRootClasses}>
      <div className={lienzoClasses} style={lienzoStyle}>
        {/* Canvas */}
        <div ref={wrapRef} className={wrapperClassName}>
          {showReplacingOverlay ? (
            <div className={styles.replacingOverlay} role="status" aria-live="polite">
              <div className={styles.replacingSpinner} aria-hidden="true" />
              <span className={styles.visuallyHidden}>Procesando nueva imagen</span>
            </div>
          ) : null}
          <Stage
          ref={stageRef}
          width={wrapSize.w}
          height={wrapSize.h}
          scaleX={baseScale * viewScale}
          scaleY={baseScale * viewScale}
          x={viewPos.x}
          y={viewPos.y}
          draggable={false}
          onMouseDown={onStageMouseDown}
          onMouseMove={onStageMouseMove}
          onMouseUp={endPan}
          onMouseLeave={endPan}
          onTouchStart={isTouchImageDragEnabled ? onStageTouchStart : undefined}
          onTouchMove={isTouchImageDragEnabled ? onStageTouchMove : undefined}
          onTouchEnd={isTouchImageDragEnabled ? onStageTouchEnd : undefined}
          onTouchCancel={isTouchImageDragEnabled ? onStageTouchEnd : undefined}
            style={{
              display: shouldRenderCanvas ? 'block' : 'none',
              width: '100%',
              height: '100%',
              maxWidth: 'none',
              background: 'transparent',
              touchAction: isTouchImageDragEnabled ? 'none' : 'auto',
            }}
          >
            <Layer>
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
                clipFunc={(ctx) => drawRoundedPath(ctx, workCm.w, workCm.h, previewCornerRadiusCm)}
              >
              <Rect
                x={0}
                y={0}
                width={workCm.w}
                height={workCm.h}
                fill="transparent"
                listening={false}
              />
            </Group>

            {/* Si 'contain': pintamos el color de fondo SIEMPRE debajo del arte (tambiÃ©n al deseleccionar) */}
            {mode === "contain" && (
              <Group
                clipFunc={(ctx) => drawRoundedPath(ctx, workCm.w, workCm.h, previewCornerRadiusCm)}
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
              (shouldShowTransformerOverlay ? (
                <>
                  <Group
                    clipFunc={(ctx) => drawRoundedPath(ctx, workCm.w, workCm.h, previewCornerRadiusCm)}
                  >
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
                      draggable={isImageDraggable}
                      dragBoundFunc={imageDragBoundFunc}
                      onDragStart={isImageDraggable ? onImgDragStart : undefined}
                      onMouseDown={onImgMouseDown}
                      onTouchStart={isImageDraggable ? onImgTouchStart : undefined}
                      onTouchMove={isImageDraggable ? onImgTouchMove : undefined}
                      onTouchEnd={isImageDraggable ? onImgTouchEnd : undefined}
                      onTouchCancel={isImageDraggable ? onImgTouchEnd : undefined}
                      onClick={onImgMouseDown}
                      onTap={onImgMouseDown}
                      onDragMove={isImageDraggable ? onImgDragMove : undefined}
                      onDragEnd={isImageDraggable ? onImgDragEnd : undefined}
                      listening={true}
                    />
                  </Group>
                  <Transformer
                    ref={trRef}
                    visible={shouldShowTransformerOverlay}
                    rotateEnabled={canTransformImage}
                    rotateAnchorOffset={40}
                    rotationSnaps={[0, 90, 180, 270]}
                    keepRatio={keepRatio}
                    enabledAnchors={transformerAnchors}
                    boundBoxFunc={(oldBox, newBox) => {
                        const rotationDeg = transformStateRef.current?.rotationDeg ??
                          ((imgTx.rotation_deg % 360) + 360) % 360;
                        const isRightAngle = rotationDeg === 90 || rotationDeg === 270;
                        const rectW = transformStateRef.current?.clientRect?.width;
                        const rectH = transformStateRef.current?.clientRect?.height;
                        const baseW = (isRightAngle ? rectH : imgBaseCm?.w || rectW) || 1;
                        const baseH = (isRightAngle ? rectW : imgBaseCm?.h || rectH) || 1;
                        const MIN_W = 0.02 * baseW;
                        const MIN_H = 0.02 * baseH;

                        if (!keepRatioRef.current) {
                          // âŸµ MODO LIBRE: sÃ³lo mÃ­nimo, SIN lÃ­mites superiores
                          const w = Math.max(MIN_W, newBox.width);
                          const h = Math.max(MIN_H, newBox.height);
                          return { ...newBox, width: w, height: h };
                        }

                        // Mantener proporciÃ³n original incluso si venimos de "estirar"
                        const MIN_SCALE = 0.02;
                        const MAX_SCALE = IMG_ZOOM_MAX;
                        const thetaDeg = isRightAngle ? rotationDeg : imgTx.rotation_deg;
                        const thetaRad = (thetaDeg * Math.PI) / 180;
                        const cos = isRightAngle ? 1 : Math.abs(Math.cos(thetaRad));
                        const sin = isRightAngle ? 0 : Math.abs(Math.sin(thetaRad));
                        const boundBaseW = isRightAngle
                          ? baseW
                          : baseW * cos + baseH * sin;
                        const boundBaseH = isRightAngle
                          ? baseH
                          : baseW * sin + baseH * cos;

                        if (!(boundBaseW > 0) || !(boundBaseH > 0)) {
                          const fallbackW = Math.max(
                            MIN_W,
                            Math.min(newBox.width, baseW * MAX_SCALE),
                          );
                          const fallbackH = Math.max(
                            MIN_H,
                            Math.min(newBox.height, baseH * MAX_SCALE),
                          );
                          return { ...newBox, width: fallbackW, height: fallbackH };
                        }

                        const widthDelta = Math.abs(newBox.width - oldBox.width);
                        const heightDelta = Math.abs(newBox.height - oldBox.height);
                        const scaleFromWidth =
                          boundBaseW > 0 && Number.isFinite(newBox.width / boundBaseW)
                            ? newBox.width / boundBaseW
                            : null;
                        const scaleFromHeight =
                          boundBaseH > 0 && Number.isFinite(newBox.height / boundBaseH)
                            ? newBox.height / boundBaseH
                            : null;

                        const prevScale = cornerScaleRef.current?.prev ?? null;
                        let targetScale = prevScale ?? 1;

                        if (scaleFromWidth != null && scaleFromHeight != null) {
                          if (prevScale != null && Number.isFinite(prevScale)) {
                            const diffW = Math.abs(scaleFromWidth - prevScale);
                            const diffH = Math.abs(scaleFromHeight - prevScale);
                            targetScale = diffW <= diffH ? scaleFromWidth : scaleFromHeight;
                          } else {
                            targetScale =
                              widthDelta >= heightDelta ? scaleFromWidth : scaleFromHeight;
                          }
                        } else if (scaleFromWidth != null) {
                          targetScale = scaleFromWidth;
                        } else if (scaleFromHeight != null) {
                          targetScale = scaleFromHeight;
                        }

                        if (!Number.isFinite(targetScale) || !(targetScale > 0)) {
                          targetScale =
                            prevScale && Number.isFinite(prevScale) && prevScale > 0
                              ? prevScale
                              : 1;
                        }

                        const clampedScale = Math.max(
                          MIN_SCALE,
                          Math.min(targetScale, MAX_SCALE),
                        );

                        const width = boundBaseW * clampedScale;
                        const height = boundBaseH * clampedScale;

                        cornerScaleRef.current.prev = clampedScale;

                        return { ...newBox, width, height };
                    }}
                    onTransformStart={onTransformStart}
                    onTransformEnd={onTransformEnd}
                  />
                </>
                ) : (
                  <Group
                    clipFunc={(ctx) => drawRoundedPath(ctx, workCm.w, workCm.h, previewCornerRadiusCm)}
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
                    {/* si estÃ¡s en 'contain', pintar el color debajo del arte */}
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
                    draggable={isImageDraggable}
                    dragBoundFunc={imageDragBoundFunc}
                    onDragStart={isImageDraggable ? onImgDragStart : undefined}
                    onMouseDown={onImgMouseDown}
                    onTouchStart={isImageDraggable ? onImgTouchStart : undefined}
                    onTouchMove={isImageDraggable ? onImgTouchMove : undefined}
                    onTouchEnd={isImageDraggable ? onImgTouchEnd : undefined}
                    onTouchCancel={isImageDraggable ? onImgTouchEnd : undefined}
                    onClick={onImgMouseDown}
                    onTap={onImgMouseDown}
                    onDragMove={isImageDraggable ? onImgDragMove : undefined}
                    onDragEnd={isImageDraggable ? onImgDragEnd : undefined}
                    listening={true}
                  />
                </Group>
              ))}

            {/* mÃ¡scara fuera del Ã¡rea */}
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
                  drawRoundedPath(ctx, wCm, hCm, previewPadCornerRadiusCm);
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
            <Shape
              sceneFunc={(ctx, shape) => {
                ctx.save();
                ctx.translate(previewOutlineInsetCm, previewOutlineInsetCm);
                drawRoundedPath(
                  ctx,
                  Math.max(0, workCm.w - previewOutlineInsetCm * 2),
                  Math.max(0, workCm.h - previewOutlineInsetCm - previewOutlineBottomInsetCm),
                  previewCornerRadiusCm,
                );
                ctx.strokeStyle = previewOutlineColor;
                ctx.lineWidth = shape.strokeWidth();
                ctx.lineJoin = 'round';
                ctx.lineCap = 'round';
                ctx.stroke();
                ctx.restore();
              }}
              strokeWidth={previewOutlineStrokeCm}
              listening={false}
            />
            {/* guÃ­as */}
            <Shape
              sceneFunc={(ctx, shape) => {
                ctx.save();
                ctx.setLineDash([]);
                drawRoundedPath(ctx, workCm.w, workCm.h, previewCornerRadiusCm);
                ctx.strokeStyle = "transparent";
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
                ctx.strokeStyle = guidePrimaryColor;
                ctx.setLineDash([0.4, 0.4]);
                ctx.lineWidth = shape.strokeWidth();
                ctx.stroke();
                ctx.restore();
              }}
              strokeWidth={0.04}
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
                  fill={mode === "contain" ? bgColor : defaultBgColor}
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
          {isTouch && !isTouchImageDragEnabled && (
            <div className={styles.touchScrollOverlay} aria-hidden="true" />
          )}
          {!showReplacingOverlay && resolvedImageUrl && imgStatus !== "loaded" && (
            <div className={`spinner ${styles.spinnerOverlay}`} />
          )}
          {false && isTouch && (
            <div className={styles.mobileCanvasControls}>
              <button type="button" onClick={handleZoomOut} aria-label="Alejar">
                âˆ’
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
            disabled={!onClearImage || !resolvedImageUrl}
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

      {showToolbar && (
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
          <ToolbarTooltip label="Rotar 90Â°">
            <button
              type="button"
              onClick={rotate90}
              disabled={!imgEl}
              aria-label="Rotar 90Â°"
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

          <ToolbarTooltip label="DiseÃ±o completo" disabled={!imgEl}>
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

          {!isFixedPad49x42Material(material) && onToggleCircular && (
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

          {isTouch && (
            <ToolbarTooltip label="Ver medida RA">
              <button
                type="button"
                onClick={openArMeasure}
                aria-label="Ver medida RA"
                className={`${styles.iconOnlyButton} ${styles.arMeasureButton}`}
              >
                <span className={styles.arMeasureIcon} aria-hidden="true">
                  ðŸ“
                </span>
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
            {busy ? "Creandoâ€¦" : "Crear job"}
          </button>
        )}
            </div>
          </div>
        </div>
      )}
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

