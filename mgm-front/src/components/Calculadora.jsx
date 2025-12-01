import React, { useEffect, useMemo } from "react";

const rolloData = {
  Pro:    { width: 125, pricePerMeter: 36145, multiplier: 3.2, baselineArea: 0.26 },
  Clasic: { width: 140, pricePerMeter: 23820, multiplier: 2.7, baselineArea: 0.36 },
  Alfombra: { width: 140, pricePerMeter: 30000, multiplier: 2.5, baselineArea: 0.36 },
};

const STANDARD_SURCHARGE = 2000;
const GLASSPAD_TRANSFER_PRICE = 130000; // con transferencia (fijo)

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
  if (m.includes("alfombr")) return "Alfombra";
  return material; // fallback
}

const Calculadora = ({ width, height, material, setPrice, className, render }) => {
  const mode = mapMode(material);

  // Normalize sizes
  const normalizedWidthCm = Number(width) || 0;
  const normalizedHeightCm = Number(height) || 0;

  // Compute pricing memoized by inputs
  const computed = useMemo(() => {
    // Glasspad: fixed price
    if (mode === "Glasspad") {
      const transferPrice = GLASSPAD_TRANSFER_PRICE;
      const normalFromTransfer = Math.round(transferPrice * 1.25);
      return { valid: true, transfer: transferPrice, normal: normalFromTransfer };
    }

    // Pro / Clasic
    const rollo = rolloData[mode];
    if (!rollo) return { valid: false, transfer: 0, normal: 0 };

    const { width: rolloWidth, pricePerMeter, multiplier, baselineArea } = rollo;
    const rolloWidthM = rolloWidth / 100;

    const pieceWidthM = normalizedWidthCm / 100;
    const pieceHeightM = normalizedHeightCm / 100;
    if (pieceWidthM <= 0 || pieceHeightM <= 0) return { valid: true, transfer: 0, normal: 0 };

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

    const surchargeFactor = 5000;
    const extraArea = Math.max(0, area - baselineArea);
    const areaSurcharge = surchargeFactor * extraArea;

    if (normalizedWidthCm < 40 && normalizedHeightCm < 40) {
      baseFinalPrice *= 1.3;
    }

    const roundTo500 = (p) => Math.ceil(p / 500) * 500;
    const basePriceRounded = roundTo500(baseFinalPrice + areaSurcharge);

    const clientFinalPrice = Math.round(basePriceRounded * 1.25);
    const transferBase = Math.round(clientFinalPrice * 0.8);
    const transferWithExtra = transferBase + STANDARD_SURCHARGE;
    const normalFromTransfer = Math.round(transferWithExtra / 0.8);

    return { valid: true, transfer: transferWithExtra, normal: normalFromTransfer };
  }, [mode, normalizedWidthCm, normalizedHeightCm]);

  // Push price to parent AFTER render
  useEffect(() => {
    if (typeof setPrice === "function") {
      const v = computed.valid ? computed.transfer : 0;
      setPrice(v);
    }
  }, [setPrice, computed]);

  if (!computed.valid && mode !== "Glasspad") {
    return <p>Modo no válido</p>;
  }

  const payload = {
    valid: computed.valid,
    transfer: computed.transfer,
    normal: computed.normal,
    format: formatARS,
    className,
  };

  if (typeof render === "function") {
    return render(payload);
  }

  return (
    <div className={className}>
      <p className="p-calcu">${formatARS(computed.normal)}</p>
      <p className="minitext">20% OFF con transferencia: {formatARS(computed.transfer)}</p>
    </div>
  );
};

export default Calculadora;
