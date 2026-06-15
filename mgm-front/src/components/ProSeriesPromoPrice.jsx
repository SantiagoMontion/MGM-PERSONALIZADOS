import { useMemo } from 'react';
import { formatARS } from '../lib/pricing.js';
import { buildProSeriesPromoDisplay } from '../lib/proSeriesPromoDisplay.js';
import styles from './ProSeriesPromoPrice.module.css';

/**
 * Muestra el precio de lista; PRO puede mostrar promo visual si está habilitada en proSeriesPromoDisplay.
 */
export default function ProSeriesPromoPrice({
  material,
  transferPrice,
  variant = 'large',
  lightTheme = false,
  inline = false,
  className = '',
  showBadge = true,
}) {
  const promo = useMemo(
    () => buildProSeriesPromoDisplay(material, transferPrice),
    [material, transferPrice],
  );

  const formattedTransfer = useMemo(() => {
    const amount = promo
      ? promo.displayPrice
      : Math.round(Number(transferPrice) || 0);
    return amount > 0 ? formatARS(amount) : '0';
  }, [promo, transferPrice]);

  const formattedCompare = promo ? formatARS(promo.compareAt) : '';

  const variantClassName = styles[`variant${variant.charAt(0).toUpperCase()}${variant.slice(1)}`];
  const rootClassName = [
    styles.root,
    inline ? styles.rootInline : '',
    variantClassName,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const compareClassName = [
    styles.comparePrice,
    lightTheme ? styles.comparePriceLight : '',
  ]
    .filter(Boolean)
    .join(' ');

  const transferClassName = [
    styles.transferPrice,
    lightTheme ? styles.transferPriceLight : '',
  ]
    .filter(Boolean)
    .join(' ');

  const badgeClassName = [
    styles.badge,
    lightTheme ? styles.badgeLight : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (!promo) {
    return (
      <div className={rootClassName}>
        <span className={transferClassName}>
          $
          {' '}
          {formattedTransfer}
        </span>
      </div>
    );
  }

  return (
    <div className={rootClassName}>
      {showBadge ? (
        <span className={badgeClassName}>{promo.discountLabel}</span>
      ) : null}
      <div className={styles.priceRow}>
        <span className={compareClassName}>
          $
          {' '}
          {formattedCompare}
        </span>
        <span className={transferClassName}>
          $
          {' '}
          {formattedTransfer}
        </span>
      </div>
    </div>
  );
}
