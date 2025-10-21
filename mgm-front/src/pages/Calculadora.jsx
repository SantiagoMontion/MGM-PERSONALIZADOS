import { useEffect, useMemo, useState } from 'react';
import Calculadora from '../components/Calculadora.jsx';
import mobileAdvisoryStyles from '../components/MobileAdvisoryBanner.module.css';
import styles from './Calculadora.module.css';

const priceFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const CalculadoraPage = () => {
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [material, setMaterial] = useState('Classic');
  const [transferPrice, setTransferPrice] = useState(0);
  const [showMobilePopup, setShowMobilePopup] = useState(false);

  useEffect(() => {
    // Sólo móviles (coarse pointer) y si no fue descartado en esta sesión
    const isMobile =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(pointer: coarse)').matches;
    const dismissed =
      typeof window !== 'undefined' &&
      window.sessionStorage &&
      window.sessionStorage.getItem('mobile_info_dismissed') === '1';

    if (isMobile && !dismissed) setShowMobilePopup(true);
  }, []);

  const closeMobilePopup = () => {
    try {
      window.sessionStorage.setItem('mobile_info_dismissed', '1');
    } catch {}
    setShowMobilePopup(false);
  };

  const materialOptions = useMemo(
    () => [
      { label: 'Glasspad', value: 'Glasspad' },
      { label: 'Pro', value: 'Pro' },
      { label: 'Classic', value: 'Classic' },
    ],
    [],
  );

  const dimensionConstraints = useMemo(
    () => ({
      Classic: {
        width: { min: 20, max: 140 },
        height: { min: 20, max: 100 },
      },
      Pro: {
        width: { min: 20, max: 120 },
        height: { min: 20, max: 60 },
      },
      Glasspad: {
        width: { min: 20, max: 49 },
        height: { min: 20, max: 42 },
      },
    }),
    [],
  );

  const sanitizeNumericInput = (value) => value.replace(/[^0-9]/g, '');

  const clampValue = (value, { min, max }) => {
    if (value === '') {
      return '';
    }

    const numericValue = Number(value);

    if (Number.isNaN(numericValue)) {
      return '';
    }

    const clampedValue = Math.min(Math.max(numericValue, min), max);
    return String(clampedValue);
  };

  const handleDimensionChange = (setter) => (event) => {
    const numericString = sanitizeNumericInput(event.target.value);
    setter(numericString);
  };

  const handleDimensionBlur = (setter, constraint) => (event) => {
    const clampedValue = clampValue(event.target.value, constraint);
    setter(clampedValue);
  };

  const handleDimensionKeyDown = (setter, constraint) => (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    const clampedValue = clampValue(event.currentTarget.value, constraint);
    setter(clampedValue);
    event.currentTarget.blur();
  };

  const { width: widthConstraint, height: heightConstraint } =
    dimensionConstraints[material];

  useEffect(() => {
    setWidth((current) => {
      const clamped = clampValue(current, widthConstraint);
      return clamped === current ? current : clamped;
    });

    setHeight((current) => {
      const clamped = clampValue(current, heightConstraint);
      return clamped === current ? current : clamped;
    });
  }, [heightConstraint, widthConstraint]);

  return (
    <section className={styles.container}>
      {showMobilePopup && (
        <section
          className={mobileAdvisoryStyles.overlay}
          role="dialog"
          aria-modal="true"
          aria-label="Aviso para móviles"
          style={{ zIndex: 9999 }}
        >
          <div className={mobileAdvisoryStyles.card} style={{ position: 'relative' }}>
            {/* Botón X para cerrar */}
            <button
              type="button"
              aria-label="Cerrar"
              onClick={closeMobilePopup}
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                width: '36px',
                height: '36px',
                display: 'grid',
                placeItems: 'center',
                fontSize: '22px',
                lineHeight: 1,
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.25)',
                borderRadius: '8px',
                color: '#EEECE4',
              }}
            >
              ×
            </button>

            <h1 className={mobileAdvisoryStyles.title}>Versión móvil en camino 🚧</h1>
            <p className={mobileAdvisoryStyles.message}>
              Por ahora usá la web desde una computadora para personalizar y comprar sin problemas.
            </p>
          </div>
        </section>
      )}
      {/*
      <section className="_overlay_e1zwy_1" role="region" aria-live="polite">
        <div className="_card_e1zwy_15">
          <h1 className="_title_e1zwy_25">Versíon móvil en camino 🚧</h1>
          <p className="_message_e1zwy_31">Por ahora usá la web desde una computadora para personalizar y comprar sin problemas.</p>
        </div>
      </section>
      */}
      <div className={styles.content}>
        <h1 className={styles.title}>Calculadora de precios</h1>
        <p className={styles.subtitle}>
          Ingresá las medidas en centímetros para obtener el precio con transferencia.
        </p>

        <form className={styles.form}>
          <label className={styles.label}>
            Largo (cm)
            <input
              type="number"
              min={widthConstraint.min}
              max={widthConstraint.max}
              step={1}
              inputMode="numeric"
              value={width}
              onChange={handleDimensionChange(setWidth)}
              onBlur={handleDimensionBlur(setWidth, widthConstraint)}
              onKeyDown={handleDimensionKeyDown(setWidth, widthConstraint)}
              placeholder="Ej: 90"
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            Ancho (cm)
            <input
              type="number"
              min={heightConstraint.min}
              max={heightConstraint.max}
              step={1}
              inputMode="numeric"
              value={height}
              onChange={handleDimensionChange(setHeight)}
              onBlur={handleDimensionBlur(setHeight, heightConstraint)}
              onKeyDown={handleDimensionKeyDown(setHeight, heightConstraint)}
              placeholder="Ej: 45"
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            Tipo de material
            <select
              className={styles.input}
              value={material}
              onChange={(event) => setMaterial(event.target.value)}
            >
              {materialOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </form>

        <Calculadora
          width={width}
          height={height}
          material={material}
          setPrice={setTransferPrice}
          render={() => null}
        />

        <div className={styles.result}>
          <h2 className={styles.resultTitle}>Precio con transferencia</h2>
          <p className={styles.resultValue}>
            {transferPrice > 0 ? `$${priceFormatter.format(transferPrice)}` : 'Ingresá medidas válidas'}
          </p>
          <p className={styles.resultDetails}>
            ({`${material || 'Classic'} / ${width || '--'}x${height || '--'}`})
          </p>
        </div>
      </div>
    </section>
  );
};

export default CalculadoraPage;
