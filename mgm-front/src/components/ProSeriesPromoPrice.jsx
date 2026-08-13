import { useMemo } from 'react';
import { formatARS } from '../lib/pricing.js';
import { buildAlfombraPromoDisplay } from '../lib/alfombraPromoDisplay.js';
import { buildSiteWidePromoDisplay } from '../lib/siteWidePromoDisplay.js';
import styles from './ProSeriesPromoPrice.module.css';

/**
 * Precio de lista con promos visuales:
 * - Alfombra: 2x1 (sin tachado)
 * - Classic/PRO 90×40 o 50×40: 20% OFF (lista tachada + precio nuevo + badge)
 * `transferPrice` es el precio de lista (+15% redondeado) antes del 20% OFF.
 */
export default function ProSeriesPromoPrice({
  material,
  transferPrice,
  widthCm,
  heightCm,
  variant = 'large',
  lightTheme = false,
  inline = false,
  className = '',
  showBadge = true,
}) {
  const listPrice = Math.round(Number(transferPrice) || 0);
  const formattedListPrice = listPrice > 0 ? formatARS(listPrice) : '0';

  const promo = useMemo(
    () => buildSiteWidePromoDisplay(material, listPrice, { widthCm, heightCm }),
    [heightCm, listPrice, material, widthCm],
  );
  const alfombraPromo = useMemo(
    () => buildAlfombraPromoDisplay(material, {
      short: variant === 'compact',
      drawerFooter: variant === 'medium',
      stepThree: variant === 'stepThree',
    }),
    [material, variant],
  );

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
    promo ? styles.rootPromoStack : '',
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
    alfombraPromo?.drawerFooter ? styles.alfombraPromoHeadlineDrawerFooter : '',
    alfombraPromo?.stepThree ? styles.alfombraPromoHeadlineStepThree : '',
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
      <div className={styles.promoHeader}>
        {showBadge ? (
          <span className={badgeClassName}>{promo.discountLabel}</span>
        ) : null}
      </div>
      <div className={styles.priceColumn}>
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
