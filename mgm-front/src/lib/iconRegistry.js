const iconModules = import.meta.glob("../icons/*.{svg,png}", {
  eager: true,
  import: "default",
});

export function resolveIconAsset(fileName, options = {}) {
  const { fallbackToPublic = true } = options;
  const normalized = `../icons/${fileName}`;
  const directMatch = iconModules[normalized];
  if (directMatch) return directMatch;

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".svg")) {
    const pngKey = normalized.replace(/\.svg$/i, ".png");
    const pngAsset = iconModules[pngKey];
    if (pngAsset) {
      return pngAsset;
    }
  } else if (lower.endsWith(".png")) {
    const svgKey = normalized.replace(/\.png$/i, ".svg");
    const svgAsset = iconModules[svgKey];
    if (svgAsset) {
      return svgAsset;
    }
  }

  if (fallbackToPublic) {
    return `/icons/${fileName}`;
  }

  return null;
}

export function getIconAsset(fileName, options) {
  return resolveIconAsset(fileName, options);
}
