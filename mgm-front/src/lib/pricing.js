const ROLLO_DATA = {
  Pro: { width: 125, pricePerMeter: 36145, multiplier: 3.2, baselineArea: 0.26 },
  Clasic: { width: 140, pricePerMeter: 23820, multiplier: 2.7, baselineArea: 0.36 },
  Alfombra: { width: 140, pricePerMeter: 30000, multiplier: 2.5, baselineArea: 0.36 },
};

const STANDARD_SURCHARGE = 2000;
const AREA_SURCHARGE_FACTOR = 5000;
const BASE_MARKUP_FACTOR = 1.12;
const INFLATION_MARKUP_FACTOR = 1.07;
const NORMAL_PRICE_FACTOR = 1.25;
export const GLASSPAD_TRANSFER_PRICE = 130000;
export const ULTRA_TRANSFER_PRICE = 60000;

const roundToNearest500 = (price) => Math.round(price / 500) * 500;
const roundUpTo500 = (price) => Math.ceil(price / 500) * 500;

function applyHistoricalAndInflationMarkup(baseTransferPrice) {
  const transferWithBaseMarkup = Number(baseTransferPrice || 0) * BASE_MARKUP_FACTOR;
  const roundedHistoricalTransfer = roundToNearest500(transferWithBaseMarkup);
  const transferWithInflation = roundedHistoricalTransfer * INFLATION_MARKUP_FACTOR;
  return roundToNearest500(transferWithInflation);
}

function deriveNormalPrice(transferPrice) {
  return roundToNearest500(Number(transferPrice || 0) * NORMAL_PRICE_FACTOR);
}

export function formatARS(value) {
  return Number(value || 0).toLocaleString('es-AR', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

export function mapPricingMaterial(material) {
  if (!material) return '';
  const normalized = String(material).trim().toLowerCase();
  if (normalized === 'pro') return 'Pro';
  if (normalized === 'classic' || normalized === 'clasic') return 'Clasic';
  if (normalized === 'glasspad') return 'Glasspad';
  if (normalized === 'ultra') return 'Ultra';
  if (normalized.includes('alfombr')) return 'Alfombra';
  return material;
}

export function calculateTransferPricing({ width, height, material }) {
  const mode = mapPricingMaterial(material);
  const normalizedWidthCm = Number(width) || 0;
  const normalizedHeightCm = Number(height) || 0;

  if (mode === 'Glasspad') {
    const transferPrice = GLASSPAD_TRANSFER_PRICE;
    const roundedTransfer = applyHistoricalAndInflationMarkup(transferPrice);
    const normalPrice = deriveNormalPrice(roundedTransfer);
    return {
      valid: true,
      transfer: roundedTransfer,
      normal: normalPrice,
      mode,
      fixed: true,
    };
  }

  if (mode === 'Ultra') {
    const transferPrice = ULTRA_TRANSFER_PRICE;
    const roundedTransfer = applyHistoricalAndInflationMarkup(transferPrice);
    const normalPrice = deriveNormalPrice(roundedTransfer);
    return {
      valid: true,
      transfer: roundedTransfer,
      normal: normalPrice,
      mode,
      fixed: true,
    };
  }

  const rollo = ROLLO_DATA[mode];
  if (!rollo) {
    return { valid: false, transfer: 0, normal: 0, mode, fixed: false };
  }

  const { width: rolloWidth, pricePerMeter, multiplier, baselineArea } = rollo;
  const rolloWidthM = rolloWidth / 100;
  const pieceWidthM = normalizedWidthCm / 100;
  const pieceHeightM = normalizedHeightCm / 100;

  if (pieceWidthM <= 0 || pieceHeightM <= 0) {
    return { valid: true, transfer: 0, normal: 0, mode, fixed: false };
  }

  const unitsHorizontal = Math.floor(rolloWidthM / pieceWidthM) * Math.floor(1 / pieceHeightM);
  const unitsRotated = Math.floor(rolloWidthM / pieceHeightM) * Math.max(Math.floor(1 / pieceWidthM), 1);
  const unitsPerMeter = Math.max(unitsHorizontal, unitsRotated, 1);

  const defaultPricePerUnit = pricePerMeter / unitsPerMeter;
  const useRotatedModel = !(pieceWidthM === 1.4 && pieceHeightM === 1) && pieceWidthM > 1 && pieceWidthM < rolloWidthM;

  const finalCostPerUnit = useRotatedModel
    ? (() => {
        const piecesPerRow = Math.floor(rolloWidthM / pieceHeightM);
        const baseCostPerUnit = pricePerMeter / piecesPerRow;
        const extraCost = ((pieceWidthM - 1) * pricePerMeter) / piecesPerRow;
        return baseCostPerUnit + extraCost;
      })()
    : defaultPricePerUnit;

  const yieldPrice = finalCostPerUnit * multiplier;
  const costPerM2 = pricePerMeter / rolloWidthM;
  const area = pieceWidthM * pieceHeightM;
  const areaPrice = area * costPerM2 * multiplier;

  let baseFinalPrice = Math.min(yieldPrice, areaPrice);

  const extraArea = Math.max(0, area - baselineArea);
  const areaSurcharge = AREA_SURCHARGE_FACTOR * extraArea;

  if (normalizedWidthCm < 40 && normalizedHeightCm < 40) {
    baseFinalPrice *= 1.3;
  }

  const basePriceRounded = roundUpTo500(baseFinalPrice + areaSurcharge);

  const clientFinalPrice = Math.round(basePriceRounded * NORMAL_PRICE_FACTOR);
  const transferBase = Math.round(clientFinalPrice * 0.8);
  const surcharge = STANDARD_SURCHARGE + (mode === 'Clasic' ? STANDARD_SURCHARGE : 0);
  const transferWithExtra = transferBase + surcharge;
  const roundedTransfer = applyHistoricalAndInflationMarkup(transferWithExtra);
  const normalPrice = deriveNormalPrice(roundedTransfer);

  return {
    valid: true,
    transfer: roundedTransfer,
    normal: normalPrice,
    mode,
    fixed: false,
  };
}
