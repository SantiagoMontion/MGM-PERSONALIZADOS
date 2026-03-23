import React, { useEffect, useMemo } from 'react';
import { calculateTransferPricing, formatARS, mapPricingMaterial } from '../lib/pricing.js';

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

  useEffect(() => {
    if (typeof setPrice === 'function') {
      setPrice(computed.valid ? computed.transfer : 0);
    }
  }, [computed, setPrice]);

  if (!computed.valid && mode !== 'Glasspad' && mode !== 'Ultra') {
    return <p>Modo no válido</p>;
  }

  const payload = {
    valid: computed.valid,
    transfer: computed.transfer,
    normal: computed.normal,
    format: formatARS,
    className,
  };

  if (typeof render === 'function') {
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
