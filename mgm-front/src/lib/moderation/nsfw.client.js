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
    const pornish = preds.some(p => (p.className === 'Porn' || p.className === 'Hentai') && p.probability >= 0.75);
    const sexy = preds.some(p => p.className === 'Sexy' && p.probability >= 0.85);
    const blocked = pornish || sexy;
    return blocked ? { blocked: true, reason: 'nsfw_real' } : { blocked: false };
  } catch (e) {
    // On failure to load ML libs in browser, default to allow (server will gate as needed)
    console.warn('[scanNudityClient] failed', e?.message || e);
    return { blocked: false, reason: 'client_scan_failed' };
  }
}

export default { scanNudityClient };

