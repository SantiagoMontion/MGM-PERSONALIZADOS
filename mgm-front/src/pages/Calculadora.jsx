import { useMemo, useState } from 'react';
import Calculadora from '../components/Calculadora.jsx';
import styles from './Calculadora.module.css';

const CalculadoraPage = () => {
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [material, setMaterial] = useState('Pro');

  const materialOptions = useMemo(
    () => [
      { label: 'Glasspad', value: 'Glasspad' },
      { label: 'Pro', value: 'Pro' },
      { label: 'Classic', value: 'Classic' },
    ],
    [],
  );

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
              min="0"
              step="0.1"
              value={width}
              onChange={(event) => setWidth(event.target.value)}
              placeholder="Ej: 90"
              className={styles.input}
            />
          </label>

          <label className={styles.label}>
            Ancho (cm)
            <input
              type="number"
              min="0"
              step="0.1"
              value={height}
              onChange={(event) => setHeight(event.target.value)}
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
          render={({ valid, transfer, format }) => (
            <div className={styles.result}>
              <h2 className={styles.resultTitle}>Precio con transferencia</h2>
              <p className={styles.resultValue}>
                {valid && transfer > 0 ? `$${format(transfer)}` : 'Ingresá medidas válidas'}
              </p>
            </div>
          )}
        />
      </div>
    </section>
  );
};

export default CalculadoraPage;
