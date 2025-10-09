type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

type CompositionOptions = {
  canvas?: HTMLCanvasElement;
  image?: ImageSource;
  widthPx?: number;
  heightPx?: number;
  width_px?: number;
  height_px?: number;
  widthMm?: number;
  heightMm?: number;
  width_mm?: number;
  height_mm?: number;
  widthCm?: number;
  heightCm?: number;
  width_cm?: number;
  height_cm?: number;
  material?: string;
  dpi?: number;
};

export type MockupOptions = {
  material?: string;
  widthPx?: number;
  heightPx?: number;
  width_px?: number;
  height_px?: number;
  widthMm?: number;
  heightMm?: number;
  width_mm?: number;
  height_mm?: number;
  widthCm?: number;
  heightCm?: number;
  width_cm?: number;
  height_cm?: number;
  dpi?: number;
  approxDpi?: number;
  productType?: 'mousepad' | 'glasspad';
  image?: ImageSource;
  composition?: CompositionOptions;
};

function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

export async function renderMockup1080(
  imageOrOptions: ImageSource | MockupOptions,
  maybeOptions?: MockupOptions,
): Promise<Blob> {
  let image: ImageSource | undefined;
  let options: MockupOptions | undefined = maybeOptions;

  if (!maybeOptions && (imageOrOptions as MockupOptions)?.image !== undefined) {
    options = imageOrOptions as MockupOptions;
    image = options?.composition?.canvas ?? options?.composition?.image ?? options?.image;
  } else if (!maybeOptions && (imageOrOptions as MockupOptions)?.composition !== undefined) {
    options = imageOrOptions as MockupOptions;
    image = options?.composition?.canvas ?? options?.composition?.image ?? options?.image;
  } else if (!maybeOptions && (imageOrOptions as MockupOptions)?.productType !== undefined) {
    options = imageOrOptions as MockupOptions;
    image = options?.composition?.canvas ?? options?.composition?.image ?? options?.image;
  } else {
    image = imageOrOptions as ImageSource;
  }

  options = options ?? maybeOptions ?? {};

  const CANVAS_SIZE = 1080;
  const MAX_LONG_PX = Number(import.meta.env?.VITE_MOCKUP_MAX_LONG_PX) || 990;
  const MIN_LONG_PX = Number(import.meta.env?.VITE_MOCKUP_MIN_LONG_PX) || 400;
  const REF_MIN_CM = Number(import.meta.env?.VITE_REF_MIN_CM) || 20;
  const RADIUS_PX = Number(import.meta.env?.VITE_MOCKUP_PAD_RADIUS_PX) || 8;

  function roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  const REF_MAX_CM_MAP = {
    classic: Number(import.meta.env?.VITE_REF_MAX_CM_CLASSIC) || 140,
    pro: Number(import.meta.env?.VITE_REF_MAX_CM_PRO) || 140,
    glass: Number(import.meta.env?.VITE_REF_MAX_CM_GLASS) || 49,
  } as const;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2d context unavailable');
  }

  if (!image) {
    const empty = await toPngBlob(canvas);
    return empty ?? new Blob([], { type: 'image/png' });
  }

  const compositionSource = options?.composition?.canvas ?? options?.composition?.image ?? null;
  const drawSource: ImageSource | HTMLCanvasElement = compositionSource ?? image;
  const anySource = drawSource as any;
  const fallbackWidth = Number(
    anySource?.width ?? anySource?.naturalWidth ?? anySource?.videoWidth ?? 0,
  );
  const fallbackHeight = Number(
    anySource?.height ?? anySource?.naturalHeight ?? anySource?.videoHeight ?? 0,
  );

  const compWidthPx = Number(
    options?.composition?.widthPx ??
    options?.composition?.width_px ??
    options?.widthPx ??
    options?.width_px ??
    fallbackWidth,
  );
  const compHeightPx = Number(
    options?.composition?.heightPx ??
    options?.composition?.height_px ??
    options?.heightPx ??
    options?.height_px ??
    fallbackHeight,
  );

  let widthMm = Number(
    options?.composition?.widthMm ??
    options?.composition?.width_mm ??
    options?.widthMm ??
    options?.width_mm ??
    0,
  );
  let heightMm = Number(
    options?.composition?.heightMm ??
    options?.composition?.height_mm ??
    options?.heightMm ??
    options?.height_mm ??
    0,
  );

  const legacyWidthCm = Number(
    options?.composition?.widthCm ??
    options?.composition?.width_cm ??
    options?.widthCm ??
    options?.width_cm ??
    0,
  );
  const legacyHeightCm = Number(
    options?.composition?.heightCm ??
    options?.composition?.height_cm ??
    options?.heightCm ??
    options?.height_cm ??
    0,
  );
  if ((!Number.isFinite(widthMm) || widthMm <= 0) && Number.isFinite(legacyWidthCm) && legacyWidthCm > 0) {
    widthMm = legacyWidthCm * 10;
  }
  if ((!Number.isFinite(heightMm) || heightMm <= 0) && Number.isFinite(legacyHeightCm) && legacyHeightCm > 0) {
    heightMm = legacyHeightCm * 10;
  }

  const dpiCandidates = [
    options?.composition?.dpi,
    options?.dpi,
    options?.approxDpi,
  ];
  const dpi = dpiCandidates.find((value) => {
    const num = Number(value);
    return Number.isFinite(num) && num > 0;
  });
  const safeDpi = dpi ?? 300;
  const pxToMm = (px: number) => ((Number(px) || 0) / safeDpi) * 25.4;

  if (!Number.isFinite(widthMm) || widthMm <= 0) {
    widthMm = pxToMm(compWidthPx || fallbackWidth);
  }
  if (!Number.isFinite(heightMm) || heightMm <= 0) {
    heightMm = pxToMm(compHeightPx || fallbackHeight);
  }

  const widthCm = Number.isFinite(widthMm) ? widthMm / 10 : 0;
  const heightCm = Number.isFinite(heightMm) ? heightMm / 10 : 0;
  const longestCm = Math.max(widthCm, heightCm, 0);

  const materialText = String(
    options?.material ?? options?.composition?.material ?? options?.productType ?? '',
  ).toLowerCase();
  const refMaxCm = materialText.includes('glass')
    ? REF_MAX_CM_MAP.glass
    : materialText.includes('pro')
      ? REF_MAX_CM_MAP.pro
      : REF_MAX_CM_MAP.classic;

  const aspect = compWidthPx > 0 && compHeightPx > 0
    ? compWidthPx / compHeightPx
    : fallbackWidth > 0 && fallbackHeight > 0
      ? fallbackWidth / fallbackHeight
      : 1;
  const denom = Math.max(1, refMaxCm - REF_MIN_CM);
  const tLin = Math.max(0, Math.min(1, (longestCm - REF_MIN_CM) / denom));
  let longPx = Math.round(MIN_LONG_PX + (MAX_LONG_PX - MIN_LONG_PX) * tLin);
  if (!Number.isFinite(longPx) || longPx <= 0) {
    longPx = MIN_LONG_PX;
  }
  longPx = Math.max(1, Math.min(longPx, MAX_LONG_PX));

  let targetW: number;
  let targetH: number;
  if (aspect >= 1) {
    targetW = longPx;
    targetH = Math.max(1, Math.round(longPx / Math.max(aspect, 1e-6)));
  } else {
    targetH = longPx;
    targetW = Math.max(1, Math.round(longPx * aspect));
  }
  if (targetW > CANVAS_SIZE) {
    const scale = CANVAS_SIZE / targetW;
    targetW = CANVAS_SIZE;
    targetH = Math.max(1, Math.round(targetH * scale));
  }
  if (targetH > CANVAS_SIZE) {
    const scale = CANVAS_SIZE / targetH;
    targetH = CANVAS_SIZE;
    targetW = Math.max(1, Math.round(targetW * scale));
  }

  const offsetX = Math.round((CANVAS_SIZE - targetW) / 2);
  const offsetY = Math.round((CANVAS_SIZE - targetH) / 2);

  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const sourceWidth = compWidthPx > 0 ? compWidthPx : fallbackWidth || targetW;
  const sourceHeight = compHeightPx > 0 ? compHeightPx : fallbackHeight || targetH;
  ctx.save();
  roundRectPath(ctx, offsetX, offsetY, targetW, targetH, RADIUS_PX);
  ctx.clip();
  ctx.drawImage(
    drawSource,
    0,
    0,
    sourceWidth,
    sourceHeight,
    offsetX,
    offsetY,
    targetW,
    targetH,
  );
  ctx.restore();

  const blob = await toPngBlob(canvas);
  return blob ?? new Blob([], { type: 'image/png' });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
