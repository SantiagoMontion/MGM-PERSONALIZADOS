const LEVELS = new Map([
  ['debug', 10],
  ['info', 20],
  ['warn', 30],
  ['error', 40],
]);

const DEFAULT_LEVEL = 'info';
const MAX_SERIALIZED_LENGTH = 2048;

function resolveLevel() {
  const raw = process.env.LOG_LEVEL;
  if (!raw) return DEFAULT_LEVEL;
  const normalized = String(raw).toLowerCase();
  if (LEVELS.has(normalized)) return normalized;
  return DEFAULT_LEVEL;
}

const currentLevel = resolveLevel();
const currentThreshold = LEVELS.get(currentLevel) ?? LEVELS.get(DEFAULT_LEVEL);

function sanitizeObject(value) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > MAX_SERIALIZED_LENGTH ? `${value.slice(0, MAX_SERIALIZED_LENGTH)}…` : value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? String(value.stack).split('\n').slice(0, 5).join('\n') : undefined,
    };
  }
  if (typeof value === 'object') {
    const seen = new WeakSet();
    const json = (() => {
      try {
        return JSON.stringify(
          value,
          (key, val) => {
            if (typeof val === 'object' && val !== null) {
              if (seen.has(val)) return '[Circular]';
              seen.add(val);
            }
            return val;
          },
        );
      } catch {
        return null;
      }
    })();
    if (json && json.length > MAX_SERIALIZED_LENGTH) {
      return {
        truncated: true,
        preview: `${json.slice(0, MAX_SERIALIZED_LENGTH)}…`,
      };
    }
  }
  return value;
}

function logAt(level, args) {
  const targetLevel = LEVELS.get(level) ?? LEVELS.get(DEFAULT_LEVEL);
  if (targetLevel < currentThreshold) return;
  const target = console[level] || console.log;
  const sanitized = Array.from(args, sanitizeObject);
  try {
    target.apply(console, sanitized);
  } catch {
    try {
      target(String(sanitized));
    } catch {
      // ignore
    }
  }
}

const logger = {
  debug: (...args) => logAt('debug', args),
  info: (...args) => logAt('info', args),
  warn: (...args) => logAt('warn', args),
  error: (...args) => logAt('error', args),
};

export default logger;
