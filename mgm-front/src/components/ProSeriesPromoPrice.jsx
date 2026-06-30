import { useMemo } from 'react';
import { formatARS } from '../lib/pricing.js';
import {
  resolveFrontendShippingCaption,
} from '../lib/frontendDisplayPricing.js';
import { buildAlfombraPromoDisplay } from '../lib/alfombraPromoDisplay.js';
import { buildProSeriesPromoDisplay } from '../lib/proSeriesPromoDisplay.js';
import styles from './ProSeriesPromoPrice.module.css';

/**
 * Precio de lista con promos visuales por material (Alfombra 2x1).
 * `transferPrice` es el precio final de lista (+15% redondeado) que va a Shopify.
 */
export default function ProSeriesPromoPrice({
  material,
  transferPrice,
  variant = 'large',
  lightTheme = false,
  inline = false,
  className = '',
  showBadge = false,
  showFreeShippingCaption = false,
}) {
  const listPrice = Math.round(Number(transferPrice) || 0);
  const formattedListPrice = listPrice > 0 ? formatARS(listPrice) : '0';

  const promo = useMemo(
    () => buildProSeriesPromoDisplay(material, listPrice),
    [listPrice, material],
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

  const displayedCustomerPrice = promo?.displayPrice > 0 ? promo.displayPrice : listPrice;

  const shippingCaption = useMemo(() => {
    if (!showFreeShippingCaption) return null;
    return resolveFrontendShippingCaption(displayedCustomerPrice);
  }, [displayedCustomerPrice, showFreeShippingCaption]);

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
    alfombraPromo?.drawerFooter ? styles.alfombraPromoHeadlineDrawerFooter : '',
    alfombraPromo?.stepThree ? styles.alfombraPromoHeadlineStepThree : '',
    lightTheme ? styles.alfombraPromoHeadlineLight : '',
  ]
    .filter(Boolean)
    .join(' ');

  const freeShippingClassName = [
    styles.freeShippingCaption,
    lightTheme ? styles.freeShippingCaptionLight : '',
    variant === 'stepThree' ? styles.freeShippingCaptionStepThree : '',
  ]
    .filter(Boolean)
    .join(' ');

  const priceStackClassName = [
    styles.priceStack,
    variant === 'stepThree' ? styles.priceStackStepThree : '',
  ]
    .filter(Boolean)
    .join(' ');

  const priceBody = alfombraPromo ? (
    <>
      <span className={transferClassName}>
        $
        {' '}
        {formattedListPrice}
      </span>
      <span className={alfombraHeadlineClassName}>{alfombraPromo.headline}</span>
    </>
  ) : !promo ? (
    <span className={transferClassName}>
      $
      {' '}
      {formattedListPrice}
    </span>
  ) : (
    <>
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
    </>
  );

  return (
    <div className={priceStackClassName}>
      <div className={rootClassName}>
        {priceBody}
      </div>
      {shippingCaption ? (
        <span className={freeShippingClassName}>
          {shippingCaption.lines.map((line) => (
            <span key={line} className={styles.freeShippingCaptionLine}>
              {line}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}
