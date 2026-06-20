import { useMemo } from 'react';
import { formatARS } from '../lib/pricing.js';
import { buildAlfombraPromoDisplay } from '../lib/alfombraPromoDisplay.js';
import { buildProSeriesPromoDisplay } from '../lib/proSeriesPromoDisplay.js';
import styles from './ProSeriesPromoPrice.module.css';

/**
 * Precio de lista con promos visuales por material (PRO 30% OFF, Alfombra 2x1).
 * No altera el monto enviado a Shopify (`transferPrice`).
 */
export default function ProSeriesPromoPrice({
  material,
  transferPrice,
  variant = 'large',
  lightTheme = false,
  inline = false,
  className = '',
  showBadge = false,
}) {
  const promo = useMemo(
    () => buildProSeriesPromoDisplay(material, transferPrice),
    [material, transferPrice],
  );
  const alfombraPromo = useMemo(
    () => buildAlfombraPromoDisplay(material, { short: variant === 'compact' }),
    [material, variant],
  );

  const listPrice = Math.round(Number(transferPrice) || 0);
  const formattedListPrice = listPrice > 0 ? formatARS(listPrice) : '0';

  const formattedPromoPrice = useMemo(() => {
    const amount = promo
      ? promo.displayPrice
      : listPrice;
    return amount > 0 ? formatARS(amount) : '0';
  }, [listPrice, promo]);

  const formattedCompare = promo ? formatARS(promo.compareAt) : '';

  const variantClassName = styles[`variant${variant.charAt(0).toUpperCase()}${variant.slice(1)}`];
  const rootClassName = [
    styles.root,
    inline ? styles.rootInline : '',
    variantClassName,
    alfombraPromo ? styles.rootAlfombra : '',
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

  const alfombraHeadlineClassName = [
    styles.alfombraPromoHeadline,
    lightTheme ? styles.alfombraPromoHeadlineLight : '',
  ]
    .filter(Boolean)
    .join(' ');

  if (alfombraPromo) {
    return (
      <div className={rootClassName}>
        <span className={transferClassName}>
          $
          {' '}
          {formattedListPrice}
        </span>
        <span className={alfombraHeadlineClassName}>{alfombraPromo.headline}</span>
      </div>
    );
  }

  if (!promo) {
    return (
      <div className={rootClassName}>
        <span className={transferClassName}>
          $
          {' '}
          {formattedListPrice}
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
          {formattedPromoPrice}
        </span>
      </div>
    </div>
  );
}
