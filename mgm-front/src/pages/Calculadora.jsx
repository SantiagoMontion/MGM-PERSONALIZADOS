import { useEffect, useMemo, useState } from 'react';
import Calculadora from '../components/Calculadora.jsx';
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

  const handleDimensionChange = (setter, { max }) => (event) => {
    const numericString = event.target.value.replace(/[^0-9]/g, '');

    if (numericString === '') {
      setter('');
      return;
    }

    const numericValue = Number(numericString);
    const clampedValue = Math.min(numericValue, max);
    setter(String(clampedValue));
  };

  const handleDimensionBlur = (setter, { min }) => (event) => {
    if (event.target.value === '') {
      return;
    }

    const numericValue = Number(event.target.value);

    if (Number.isNaN(numericValue) || numericValue >= min) {
      return;
    }

    setter(String(min));
  };

  const { width: widthConstraint, height: heightConstraint } =
    dimensionConstraints[material];

  useEffect(() => {
    if (width !== '') {
      const numericWidth = Number(width);
      const clampedWidth = Math.min(
        Math.max(numericWidth, widthConstraint.min),
        widthConstraint.max,
      );

      if (clampedWidth !== numericWidth) {
        setWidth(String(clampedWidth));
      }
    }

    if (height !== '') {
      const numericHeight = Number(height);
      const clampedHeight = Math.min(
        Math.max(numericHeight, heightConstraint.min),
        heightConstraint.max,
      );

      if (clampedHeight !== numericHeight) {
        setHeight(String(clampedHeight));
      }
    }
  }, [height, heightConstraint, width, widthConstraint]);

  return (
    <section className={styles.container}>
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
              onChange={handleDimensionChange(setWidth, widthConstraint)}
              onBlur={handleDimensionBlur(setWidth, widthConstraint)}
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
              onChange={handleDimensionChange(setHeight, heightConstraint)}
              onBlur={handleDimensionBlur(setHeight, heightConstraint)}
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
