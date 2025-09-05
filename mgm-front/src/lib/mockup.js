export async function renderMockup1080(opts) {
  const size = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const background = opts.background || '#f5f5f5';
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;

  // Support two shapes of options: { composition: { image, ... } } OR { image, composition }
  const image = opts.image || (opts.composition && opts.composition.image);
  const comp = opts.composition || {};
  const offsetX = comp.offsetX || 0;
  const offsetY = comp.offsetY || 0;
  const scaleX = comp.scaleX || 1;
  const scaleY = comp.scaleY || 1;
  const rotation = comp.rotation || 0;

  if (image) {
    const iw = image.width || image.naturalWidth || 0;
    const ih = image.height || image.naturalHeight || 0;
    ctx.save();
    ctx.translate(cx + offsetX, cy + offsetY);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scaleX, scaleY);
    ctx.drawImage(image, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }

  if (opts.productType === 'glasspad') {
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.fillRect(0, 0, size, size);
  }

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png', 1));
  return blob;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
