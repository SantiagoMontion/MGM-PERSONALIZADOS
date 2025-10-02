const DEFAULT_THRESHOLDS = {
  SWASTIKA_DET_THRESH: 0.6,
  REALNESS_THRESH: 0.6,
  PERSON_DET_THRESH: 0.5,
  NSFW_THRESH: 0.7,
  SKIN_RATIO_IN_PERSON: 0.12,
  SKIN_LARGE_REGION: 20000,
  SKIN_INTERSECTION: 0.6,
  PINK_DOMINANCE: 0.55,
  OCR_TOKEN_MIN: 100,
  OCR_GEOS_MIN: 5,
};

const GEO_KEYWORDS = [
  'Argentina',
  'Brazil',
  'Canada',
  'United',
  'Ocean',
  'Pacific',
  'Atlantic',
  'Africa',
  'Europe',
  'Asia',
  'Oceania',
];

function parseBoolean(value, defaultValue = true) {
  if (value == null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function parseNumber(value, fallback) {
  if (value == null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const ENV_MAP = {
  SWASTIKA_DET_THRESH: 'MOD_SWASTIKA_DET_THRESH',
  REALNESS_THRESH: 'MOD_REALNESS_THRESH',
  PERSON_DET_THRESH: 'MOD_PERSON_DET_THRESH',
  NSFW_THRESH: 'MOD_NSFW_THRESH',
  SKIN_RATIO_IN_PERSON: 'MOD_SKIN_RATIO_IN_PERSON',
  SKIN_LARGE_REGION: 'MOD_SKIN_LARGE_REGION',
  SKIN_INTERSECTION: 'MOD_SKIN_INTERSECTION',
  PINK_DOMINANCE: 'MOD_PINK_DOMINANCE',
  OCR_TOKEN_MIN: 'MOD_OCR_TOKEN_MIN',
  OCR_GEOS_MIN: 'MOD_OCR_GEOS_MIN',
};

export function getModerationConfig(overrides = {}) {
  const config = { ...DEFAULT_THRESHOLDS, ...overrides };

  for (const [key, envName] of Object.entries(ENV_MAP)) {
    if (!envName) continue;
    const envValue = process.env[envName];
    if (envValue != null) {
      config[key] = parseNumber(envValue, config[key]);
    }
  }

  const strict = parseBoolean(process.env.MODERATION_STRICT, true);

  config.strict = strict;
  if (!strict) {
    config.NSFW_THRESH = Math.max(config.NSFW_THRESH, 0.75);
  }

  config.GEO_KEYWORDS = overrides.GEO_KEYWORDS || GEO_KEYWORDS;

  return config;
}

export { DEFAULT_THRESHOLDS, GEO_KEYWORDS };

export default { getModerationConfig, DEFAULT_THRESHOLDS, GEO_KEYWORDS };

