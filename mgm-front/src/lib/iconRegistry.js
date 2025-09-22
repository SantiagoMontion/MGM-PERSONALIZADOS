const iconModules = import.meta.glob('../icons/*.{svg,png}', {
  eager: true,
  import: 'default',
});

export function resolveIconAsset(fileName) {
  const normalized = `../icons/${fileName}`;
  const directMatch = iconModules[normalized];
  if (directMatch) return directMatch;

  const lower = fileName.toLowerCase();
  if (lower.endsWith('.svg')) {
    const pngKey = normalized.replace(/\.svg$/i, '.png');
    if (iconModules[pngKey]) {
      return iconModules[pngKey];
    }
  } else if (lower.endsWith('.png')) {
    const svgKey = normalized.replace(/\.png$/i, '.svg');
    if (iconModules[svgKey]) {
      return iconModules[svgKey];
    }
  }

  return `/icons/${fileName}`;
}

export function getIconAsset(fileName) {
  return resolveIconAsset(fileName);
}
