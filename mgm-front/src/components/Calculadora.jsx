import React from "react";

const rolloData = {
  Pro:    { width: 125, pricePerMeter: 36145, multiplier: 3.2, baselineArea: 0.26 },
  Clasic: { width: 140, pricePerMeter: 23820, multiplier: 2.7, baselineArea: 0.36 },
};

const GLASSPAD_TRANSFER_PRICE = 110000; // con transferencia (fijo)

function formatARS(n) {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 0, minimumFractionDigits: 0 });
}

// Mapea materiales del UI a los keys internos de la calculadora
function mapMode(material) {
  if (!material) return "";
  const m = String(material).toLowerCase();
  if (m === "pro") return "Pro";
  if (m === "classic") return "Clasic";
  if (m === "glasspad") return "Glasspad";
  return material; // fallback
}

const Calculadora = ({ width, height, material, setPrice }) => {
  const mode = mapMode(material);

  // --- Glasspad: precio fijo ---
  if (mode === "Glasspad") {
    const transferPrice = GLASSPAD_TRANSFER_PRICE;               // $110.000 con transferencia
    const normalFromTransfer = Math.round(transferPrice * 1.25); // +25% → $137.500 lista
    if (typeof setPrice === "function") setPrice(normalFromTransfer);

    return (
      <div>
        <p className="p-calcu">${formatARS(normalFromTransfer)}</p>
        <p className="minitext">20% OFF con transferencia: {formatARS(transferPrice)}</p>
      </div>
    );
  }

  // --- Pro / Clasic ---
  if (!rolloData[mode]) {
    if (typeof setPrice === "function") setPrice(0);
    return <p>Modo no válido</p>;
  }

  const { width: rolloWidth, pricePerMeter, multiplier, baselineArea } = rolloData[mode];
  const rolloWidthM = rolloWidth / 100;

  const normalizedWidthCm  = Number(width)  || 0;
  const normalizedHeightCm = Number(height) || 0;

  const pieceWidthM  = normalizedWidthCm / 100;
  const pieceHeightM = normalizedHeightCm / 100;

  const unitsHorizontal =
    Math.floor(rolloWidthM / pieceWidthM) * Math.floor(1 / pieceHeightM);
  const unitsRotated =
    Math.floor(rolloWidthM / pieceHeightM) * Math.max(Math.floor(1 / pieceWidthM), 1);
  const unitsPerMeter = Math.max(unitsHorizontal, unitsRotated, 1);

  const defaultPricePerUnit = pricePerMeter / unitsPerMeter;

  // Modelo rotado si conviene
  const useRotatedModel =
    !(pieceWidthM === 1.4 && pieceHeightM === 1) &&
    pieceWidthM > 1 &&
    pieceWidthM < rolloWidthM;

  let finalCostPerUnit;
  if (useRotatedModel) {
    const piecesPerRow = Math.floor(rolloWidthM / pieceHeightM);
    const baseCostPerUnit = pricePerMeter / piecesPerRow;
    const extraCost = ((pieceWidthM - 1) * pricePerMeter) / piecesPerRow;
    finalCostPerUnit = baseCostPerUnit + extraCost;
  } else {
    finalCostPerUnit = defaultPricePerUnit;
  }

  const yieldPrice = finalCostPerUnit * multiplier;
  const costPerM2  = pricePerMeter / rolloWidthM;
  const area       = pieceWidthM * pieceHeightM;
  const areaPrice  = area * costPerM2 * multiplier;

  let baseFinalPrice = Math.min(yieldPrice, areaPrice);

  const surchargeFactor = 5000;
  const extraArea = Math.max(0, area - baselineArea);
  const areaSurcharge = surchargeFactor * extraArea;

  // recargos menores
  if (normalizedWidthCm < 40 && normalizedHeightCm < 40) {
    baseFinalPrice *= 1.3;
  }

  const roundTo500 = (p) => Math.ceil(p / 500) * 500;
  const basePriceRounded = roundTo500(baseFinalPrice + areaSurcharge);

  // Lista (tarjeta) = transferencia * 1.25; transferencia = lista * 0.8
  let clientFinalPrice = Math.round(basePriceRounded * 1.25);

  // Ajuste transferencia: +$2.000 para Classic
  const isClassic = mode === "Clasic";
  const transferBase = Math.round(clientFinalPrice * 0.8);
  const transferWithExtra = isClassic ? transferBase + 2000 : transferBase;
  const normalFromTransfer = Math.round(transferWithExtra / 0.8);

  if (typeof setPrice === "function") setPrice(normalFromTransfer);

  return (
    <div>
      <p className="p-calcu">${formatARS(normalFromTransfer)}</p>
      <p className="minitext">20% OFF con transferencia: {formatARS(transferWithExtra)}</p>
    </div>
  );
};

export default Calculadora;
