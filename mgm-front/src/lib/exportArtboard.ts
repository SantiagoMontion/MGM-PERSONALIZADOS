import type Konva from 'konva';

interface ExportOpts {
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
  mime?: string;
  quality?: number;
  pixelRatio?: number;
  backgroundColor?: string;
  asBlob?: boolean;
}

/**
 * Export a region of the stage. Returns a DataURL or Blob.
 */
export async function exportArtboard(stage: Konva.Stage, {
  x,
  y,
  width,
  height,
  scale = 1,
  mime = 'image/png',
  quality = 1,
  pixelRatio = 1,
  backgroundColor,
  asBlob = false,
}: ExportOpts) {
  const url = stage.toDataURL({
    x,
    y,
    width,
    height,
    pixelRatio: scale * pixelRatio,
    mimeType: mime,
    quality,
    backgroundColor,
  });
  if (asBlob) {
    const res = await fetch(url);
    return await res.blob();
  }
  return url;
}
