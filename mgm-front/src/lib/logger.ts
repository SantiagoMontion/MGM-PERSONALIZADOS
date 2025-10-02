const LEVELS: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MAX_LENGTH = 2048;

function resolveLevel(): keyof typeof LEVELS {
  const fromEnv = (import.meta as any)?.env?.VITE_LOG_LEVEL ?? (globalThis as any)?.LOG_LEVEL;
  const raw = typeof fromEnv === 'string' ? fromEnv : undefined;
  if (raw) {
    const normalized = raw.toLowerCase();
    if (normalized in LEVELS) {
      return normalized as keyof typeof LEVELS;
    }
  }

  const mode =
    (import.meta as any)?.env?.MODE ??
    (typeof process !== 'undefined' ? (process as any)?.env?.NODE_ENV : undefined);

  return mode === 'production' ? 'warn' : 'debug';
}

const currentLevel = resolveLevel();
const threshold = LEVELS[currentLevel];

function compact(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > MAX_LENGTH ? `${value.slice(0, MAX_LENGTH)}…` : value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? value.stack.split('\n').slice(0, 5).join('\n') : undefined,
    };
  }
  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value);
      if (json.length > MAX_LENGTH) {
        return { truncated: true, preview: `${json.slice(0, MAX_LENGTH)}…` };
      }
    } catch {
      return value;
    }
  }
  return value;
}

function logAt(level: keyof typeof LEVELS, args: unknown[]): void {
  if (LEVELS[level] < threshold) return;
  const method = console[level] ?? console.log;
  const payload = args.map(compact);
  try {
    method.apply(console, payload as []);
  } catch {
    try {
      method(String(payload));
    } catch {
      /* ignore */
    }
  }
}

const logger = {
  debug: (...args: unknown[]) => logAt('debug', args),
  info: (...args: unknown[]) => logAt('info', args),
  warn: (...args: unknown[]) => logAt('warn', args),
  error: (...args: unknown[]) => logAt('error', args),
};

export default logger;
