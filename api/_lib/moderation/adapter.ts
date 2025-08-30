import { Buffer } from 'node:buffer';

export interface ScanResult {
  provider: string;
  scores: Record<string, number>;
  labels: string[];
}

function normalizeLabel(label: string): string {
  switch (label) {
    case 'sexual':
    case 'adult':
    case 'explicit_nudity':
      return 'sexual_explicit';
    case 'nudity':
    case 'nudity_adult':
      return 'nudity_adult';
    case 'nudity_minor':
    case 'sexual_minor':
      return 'nudity_minor';
    case 'hate':
    case 'hate_symbols':
    case 'extremist':
      return 'hate_symbol';
    case 'hentai':
      return 'hentai';
    case 'sexy':
    case 'racy':
      return 'sexy';
    case 'violence':
      return 'violence';
    default:
      return label;
  }
}

export async function scanImage(bufOrUrl: Buffer | string): Promise<ScanResult> {
  const provider = process.env.MOD_PROVIDER || 'none';
  try {
    if (provider === 'none') {
      return { provider: 'none', scores: {}, labels: [] };
    }

    if (provider === 'openai') {
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error('missing_api_key');
      const form = new FormData();
      if (typeof bufOrUrl === 'string') form.append('image', bufOrUrl);
      else form.append('file', new Blob([bufOrUrl]), 'image.jpg');
      const resp = await fetch('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      const data = await resp.json();
      const result = data?.results?.[0] || {};
      const categories = result.categories || {};
      const scores = result.category_scores || {};
      const labels: string[] = [];
      for (const [k, v] of Object.entries(categories)) {
        if (v) labels.push(normalizeLabel(k));
      }
      const normScores: Record<string, number> = {};
      for (const [k, v] of Object.entries(scores)) {
        normScores[normalizeLabel(k)] = Number(v);
      }
      return { provider: 'openai', scores: normScores, labels };
    }

    // other providers not implemented, fallthrough
    return { provider, scores: {}, labels: [] };
  } catch (e) {
    console.error('scanImage error', e);
    return { provider, scores: {}, labels: ['provider_error'] };
  }
}
