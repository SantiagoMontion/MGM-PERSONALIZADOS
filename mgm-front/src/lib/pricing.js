import {
  applyEquilibriumListPrice,
  LIST_PRICE_EQUILIBRIUM_FACTOR,
  PRO_SERIES_NET_LIST_FACTOR,
  resolveCustomerPriceFromNetBase,
  roundToNearestFifty,
  roundDownToNearestFifty,
  ULTRA_FINAL_LIST_PRICE,
} from '../../../lib/pricing/equilibrium.js';

const ROLLO_DATA = {
  Pro: { width: 125, pricePerMeter: 36145, multiplier: 3.2, baselineArea: 0.26 },
  Clasic: { width: 140, pricePerMeter: 23820, multiplier: 2.7, baselineArea: 0.36 },
  Alfombra: { width: 140, pricePerMeter: 30000, multiplier: 2.5, baselineArea: 0.36 },
};

const STANDARD_SURCHARGE = 2000;
const AREA_SURCHARGE_FACTOR = 5000;
const BASE_MARKUP_FACTOR = 1.12;
const INFLATION_MARKUP_FACTOR = 1.07;
/** Precio neto fijo Glasspad antes de markups históricos. */
export const GLASSPAD_TRANSFER_PRICE = 130000;
/** Precio neto fijo Ultra antes de markups históricos. */
export const ULTRA_TRANSFER_PRICE = 60100;

export {
  applyEquilibriumListPrice,
  LIST_PRICE_EQUILIBRIUM_FACTOR,
  PRO_SERIES_NET_LIST_FACTOR,
  resolveCustomerPriceFromNetBase,
  roundToNearestFifty,
  roundDownToNearestFifty,
  ULTRA_FINAL_LIST_PRICE,
};

const roundToNearest500 = (price) => Math.round(price / 500) * 500;
const roundUpTo500 = (price) => Math.ceil(price / 500) * 500;

function applyHistoricalAndInflationMarkup(baseNetPrice) {
  const withBaseMarkup = Number(baseNetPrice || 0) * BASE_MARKUP_FACTOR;
  const roundedHistorical = roundToNearest500(withBaseMarkup);
  const withInflation = roundedHistorical * INFLATION_MARKUP_FACTOR;
  return roundToNearest500(withInflation);
}

function buildListPricingResult({ valid, netBasePrice, mode, fixed, customerPrice }) {
  const resolvedCustomerPrice = Number.isFinite(Number(customerPrice)) && Number(customerPrice) > 0
    ? Math.round(Number(customerPrice))
    : resolveCustomerPriceFromNetBase(netBasePrice, {
      isProSeries: mode === 'Pro',
    }).customerPrice;
  return {
    valid,
    transfer: resolvedCustomerPrice,
    normal: resolvedCustomerPrice,
    price: resolvedCustomerPrice,
    netBase: netBasePrice,
    mode,
    fixed,
  };
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
    const netBasePrice = applyHistoricalAndInflationMarkup(GLASSPAD_TRANSFER_PRICE);
    return buildListPricingResult({
      valid: true,
      netBasePrice,
      mode,
      fixed: true,
    });
  }

  if (mode === 'Ultra') {
    const netBasePrice = applyHistoricalAndInflationMarkup(ULTRA_TRANSFER_PRICE);
    return buildListPricingResult({
      valid: true,
      netBasePrice,
      mode,
      fixed: true,
      customerPrice: ULTRA_FINAL_LIST_PRICE,
    });
  }

  const rollo = ROLLO_DATA[mode];
  if (!rollo) {
    return buildListPricingResult({
      valid: false,
      netBasePrice: 0,
      mode,
      fixed: false,
    });
  }

  const { width: rolloWidth, pricePerMeter, multiplier, baselineArea } = rollo;
  const rolloWidthM = rolloWidth / 100;
  const pieceWidthM = normalizedWidthCm / 100;
  const pieceHeightM = normalizedHeightCm / 100;

  if (pieceWidthM <= 0 || pieceHeightM <= 0) {
    return buildListPricingResult({
      valid: true,
      netBasePrice: 0,
      mode,
      fixed: false,
    });
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
  const clientFinalPrice = Math.round(basePriceRounded * 1.25);
  const transferBase = Math.round(clientFinalPrice * 0.8);
  const surcharge = STANDARD_SURCHARGE + (mode === 'Clasic' ? STANDARD_SURCHARGE : 0);
  const transferWithExtra = transferBase + surcharge;
  const netBasePrice = applyHistoricalAndInflationMarkup(transferWithExtra);

  return buildListPricingResult({
    valid: true,
    netBasePrice,
    mode,
    fixed: false,
  });
}
