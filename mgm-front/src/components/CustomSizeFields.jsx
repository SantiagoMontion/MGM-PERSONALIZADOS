import { useEffect, useRef, useState } from 'react';
import styles from './CustomSizeFields.module.css';

const INTEGER_PATTERN = /^[0-9]{0,3}$/;
const BLOCKED_DECIMAL_KEYS = new Set(['.', ',']);

const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));

const toInteger = (value) => {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value) : NaN;
  }

  const match = String(value)
    .trim()
    .replace(/\s+/g, '')
    .match(/\d+(?:[.,]\d+)?/);
  if (!match) return NaN;

  const parsed = Number.parseFloat(match[0].replace(',', '.'));
  return Number.isFinite(parsed) ? Math.round(parsed) : NaN;
};

const formatDisplayValue = (value) => {
  const numeric = toInteger(value);
  if (!Number.isFinite(numeric)) return '';
  return String(numeric);
};

const parseDimensionInput = (value) => toInteger(value);

export default function CustomSizeFields({
  size,
  limits,
  onChange,
  onEnterCommit,
  disabled = false,
  className = '',
  /** Menor altura y tipografía (p. ej. drawer paso 2). */
  compact = false,
}) {
  const [wText, setWText] = useState(() => formatDisplayValue(size?.w));
  const [hText, setHText] = useState(() => formatDisplayValue(size?.h));
  const wInputRef = useRef(null);
  const hInputRef = useRef(null);

  useEffect(() => {
    setWText(formatDisplayValue(size?.w));
  }, [size?.w]);

  useEffect(() => {
    setHText(formatDisplayValue(size?.h));
  }, [size?.h]);

  const getFieldBounds = (field) => ({
    min: Math.round(field === 'w' ? Number(limits?.minW) || 1 : Number(limits?.minH) || 1),
    max: Math.round(
      field === 'w'
        ? Number(limits?.maxW) || Number.POSITIVE_INFINITY
        : Number(limits?.maxH) || Number.POSITIVE_INFINITY,
    ),
  });

  const syncFieldText = (field, value) => {
    if (field === 'w') {
      setWText(value);
    } else {
      setHText(value);
    }
  };

  const commitSanitizedValue = (field, rawValue, { allowEmpty = false } = {}) => {
    if (disabled) return false;

    const parsed = parseDimensionInput(rawValue);
    const fallbackValue = field === 'w' ? size?.w : size?.h;
    if (!Number.isFinite(parsed)) {
      if (allowEmpty && String(rawValue ?? '').trim() === '') {
        syncFieldText(field, '');
        return false;
      }
      syncFieldText(field, formatDisplayValue(fallbackValue));
      return false;
    }

    const { min, max } = getFieldBounds(field);
    const nextValue = clampValue(parsed, min, max);
    const display = formatDisplayValue(nextValue);
    const currentValue = toInteger(fallbackValue);

    syncFieldText(field, display);

    if (!Number.isFinite(currentValue) || currentValue !== nextValue) {
      onChange?.({ [field]: nextValue });
    }

    return true;
  };

  const commitField = (field) => {
    const currentText = field === 'w' ? wText : hText;
    commitSanitizedValue(field, currentText);
  };

  const handleKeyDown = (field, ref) => (event) => {
    if (disabled) return;

    if (BLOCKED_DECIMAL_KEYS.has(event.key) || event.code === 'NumpadDecimal') {
      event.preventDefault();
      return;
    }

    if (event.key === 'Enter' && !event.nativeEvent?.isComposing) {
      event.preventDefault();
      commitField(field);
      if (field === 'w') {
        hInputRef.current?.focus?.({ preventScroll: true });
        return;
      }
      ref.current?.blur?.();
      onEnterCommit?.();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      const restored = formatDisplayValue(field === 'w' ? size?.w : size?.h);
      syncFieldText(field, restored);
      ref.current?.blur?.();
    }
  };

  const handleFieldChange = (field) => (event) => {
    if (disabled) return;

    const nextValue = event.target.value;
    if (nextValue === '' || INTEGER_PATTERN.test(nextValue)) {
      syncFieldText(field, nextValue);
      return;
    }

    commitSanitizedValue(field, nextValue, { allowEmpty: true });
  };

  const handleFieldPaste = (field) => (event) => {
    if (disabled) return;

    event.preventDefault();
    const pasted = event.clipboardData?.getData('text') ?? '';
    commitSanitizedValue(field, pasted);
  };

  const formatBound = (value) => formatDisplayValue(value) || '0';
  const panelClassName = [styles.panel, compact ? styles.compact : '', disabled ? styles.panelDisabled : '', className]
    .filter(Boolean)
    .join(' ');
  const widthInputShellClassName = [
    styles.inputShell,
    disabled ? styles.inputShellDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={panelClassName}>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span className={styles.label}>LARGO</span>
          <span className={widthInputShellClassName}>
            <input
              ref={wInputRef}
              className={styles.input}
              value={wText}
              onChange={handleFieldChange('w')}
              onPaste={handleFieldPaste('w')}
              onBlur={() => commitField('w')}
              onKeyDown={handleKeyDown('w', wInputRef)}
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Largo en centimetros"
              disabled={disabled}
            />
            <span className={styles.unit}>cm</span>
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.label}>ANCHO</span>
          <span className={widthInputShellClassName}>
            <input
              ref={hInputRef}
              className={styles.input}
              value={hText}
              onChange={handleFieldChange('h')}
              onPaste={handleFieldPaste('h')}
              onBlur={() => commitField('h')}
              onKeyDown={handleKeyDown('h', hInputRef)}
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label="Ancho en centimetros"
              disabled={disabled}
            />
            <span className={styles.unit}>cm</span>
          </span>
        </label>
      </div>

      <p className={styles.hint}>
        Min. {formatBound(limits?.minW)}x{formatBound(limits?.minH)} cm · Max. {formatBound(limits?.maxW)}x{formatBound(limits?.maxH)} cm
      </p>
    </div>
  );
}
