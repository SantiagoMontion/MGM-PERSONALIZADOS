export interface ModerationInput {
  labels: string[];
  scores: Record<string, number>;
}

export function decideModeration(input: ModerationInput): { action: 'allow'|'warn'|'block', reason: string } {
  const { labels, scores } = input;
  if (labels.includes('provider_error')) return { action: 'warn', reason: 'provider_error' };
  if (labels.includes('nudity_minor') || labels.includes('sexual_minor')) return { action: 'block', reason: 'nudity_minor' };

  const isHentai = labels.includes('hentai') || labels.includes('drawing');
  const explicitScore = scores.sexual_explicit || 0;
  const explicitThreshold = Number(process.env.MOD_EXPLICIT_THRESHOLD || '0.75');
  const hateScore = Math.max(scores.hate_symbol || 0, scores.extremist_content || 0);
  const hateThreshold = Number(process.env.MOD_HATE_THRESHOLD || '0.6');
  const blockHate = (process.env.MOD_BLOCK_HATE || 'true') !== 'false';

  if (explicitScore >= explicitThreshold && !isHentai) {
    return { action: 'block', reason: 'sexual_explicit' };
  }

  if (blockHate && hateScore >= hateThreshold) {
    return { action: 'block', reason: 'hate_symbol' };
  }

  const nudityAdult = scores.nudity_adult || 0;
  if (nudityAdult >= 0.5 && nudityAdult <= 0.7 && !isHentai) {
    return { action: 'warn', reason: 'nudity_adult' };
  }

  return { action: 'allow', reason: '' };
}
