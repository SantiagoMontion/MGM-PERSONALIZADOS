import logger from '../logger';
// Keep a single lazy-loaded model instance in-memory across scans so repeated
// "Continuar" clicks don't keep downloading TFJS weights.
let modelPromise = null;

async function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      await import('@tensorflow/tfjs');
      const nsfwjs = await import('nsfwjs');
      return nsfwjs.load();
    })().catch(err => {
      modelPromise = null;
      throw err;
    });
  }
  return modelPromise;
}

function extractScores(predictions = []) {
  const scores = {
    hentai: 0,
    porn: 0,
    sexy: 0,
    drawing: 0,
    neutral: 0,
  };
  for (const pred of predictions) {
    const key = pred?.className?.toLowerCase();
    if (!key || !(key in scores)) continue;
    scores[key] = Math.max(scores[key], Number(pred?.probability) || 0);
  }
  return scores;
}

// Client-only nudity scan using dynamic imports to avoid bundling on server.
export async function scanNudityClient(dataUrl) {
  if (!dataUrl) {
    return { blocked: false, reason: 'no_image' };
  }
  try {
    const model = await loadModel();
    const img = new Image();
    img.src = dataUrl;
    await img.decode();

    const predictions = await model.classify(img);
    const scores = extractScores(predictions);

    const PORN_THRESHOLD = 0.72;
    const HENTAI_ALLOW_THRESHOLD = 0.6;
    const DRAWING_ALLOW_THRESHOLD = 0.55;
    const SEXY_ESCALATION_THRESHOLD = 0.9;
    const REAL_OVERRIDE_THRESHOLD = 0.55;

    const isAnimeDominant =
      scores.hentai >= HENTAI_ALLOW_THRESHOLD ||
      scores.drawing >= DRAWING_ALLOW_THRESHOLD;

    if (isAnimeDominant && scores.porn < REAL_OVERRIDE_THRESHOLD) {
      return { blocked: false, reason: 'client_hentai_allowed', scores };
    }

    const realPornLike = scores.porn >= PORN_THRESHOLD && scores.hentai < 0.55 && scores.drawing < 0.6;
    if (realPornLike) {
      return { blocked: true, reason: 'client_real_nudity', scores };
    }

    const explicitSexy = scores.sexy >= SEXY_ESCALATION_THRESHOLD && scores.porn >= REAL_OVERRIDE_THRESHOLD && scores.hentai < 0.4;
    if (explicitSexy) {
      return { blocked: true, reason: 'client_real_sexual', scores };
    }

    return { blocked: false, reason: 'client_clear', scores };
  } catch (e) {
    // On failure to load ML libs in browser, default to allow (server will gate as needed)
    logger.error('[scanNudityClient] failed', e?.message || e);
    return { blocked: false, reason: 'client_scan_failed' };
  }
}

export default { scanNudityClient };
