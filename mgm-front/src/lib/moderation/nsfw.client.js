// Client-only nudity scan using dynamic imports to avoid bundling on server.
export async function scanNudityClient(dataUrl) {
  try {
    const nsfwjs = await import('nsfwjs');
    await import('@tensorflow/tfjs');

    const img = new Image();
    img.src = dataUrl;
    await img.decode();

    const model = await nsfwjs.load();
    const preds = await model.classify(img);
    preds.sort((a,b) => b.probability - a.probability);
    const top = preds[0] || { className: '', probability: 0 };
    const hentai = preds.find(p => p.className === 'Hentai')?.probability || 0;
    if (top.className === 'Porn' && top.probability >= 0.85 && hentai < 0.60) {
      return { blocked: true, reason: 'client_real_nudity' };
    }
    if (hentai >= 0.60) {
      return { blocked: false, reason: 'client_hentai_allowed' };
    }
    return { blocked: false };
  } catch (e) {
    // On failure to load ML libs in browser, default to allow (server will gate as needed)
    console.warn('[scanNudityClient] failed', e?.message || e);
    return { blocked: false, reason: 'client_scan_failed' };
  }
}

export default { scanNudityClient };

