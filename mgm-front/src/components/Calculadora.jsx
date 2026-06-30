import React, { useEffect, useMemo } from 'react';
import { calculateTransferPricing, formatARS, mapPricingMaterial } from '../lib/pricing.js';
import { applyFrontendDisplayPriceMarkup } from '../lib/frontendDisplayPricing.js';

const Calculadora = ({ width, height, material, setPrice, className, render }) => {
  const mode = mapPricingMaterial(material);
  const normalizedWidthCm = Number(width) || 0;
  const normalizedHeightCm = Number(height) || 0;

  const computed = useMemo(
    () => calculateTransferPricing({
      width: normalizedWidthCm,
      height: normalizedHeightCm,
      material: mode,
    }),
    [mode, normalizedHeightCm, normalizedWidthCm],
  );

  const shopifyListPrice = useMemo(
    () => (computed.valid ? applyFrontendDisplayPriceMarkup(computed.transfer) : 0),
    [computed.transfer, computed.valid],
  );

  useEffect(() => {
    if (typeof setPrice === 'function') {
      setPrice(shopifyListPrice);
    }
  }, [setPrice, shopifyListPrice]);

  if (!computed.valid && mode !== 'Glasspad' && mode !== 'Ultra') {
    return <p>Modo no válido</p>;
  }

  const payload = {
    valid: computed.valid,
    transfer: shopifyListPrice,
    normal: shopifyListPrice,
    format: formatARS,
    className,
  };

  if (typeof render === 'function') {
    return render(payload);
  }

  return (
    <div className={className}>
      <p className="p-calcu">${formatARS(shopifyListPrice)}</p>
    </div>
  );
};

export default Calculadora;
