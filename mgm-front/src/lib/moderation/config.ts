export const MODERATION = {
  quick: {
    enable: true,
    maxMs: 120,
    minSizePx: 128,
    allowFranchises: [/roblox/i, /mario/i, /pokemon/i, /marvel/i, /dc/i],
  },
  deep: {
    enable: true,
    maxMs: 1500,
    escalateIfRisk: 0.35,
    blockIfRealNudity: 0.8,
    blockIfHateSymbol: 0.7,
  },
  policy: {
    allowAnimeNudity: true,
    blockRealPersonNudity: true,
    blockHateSymbols: true,
  },
  debug: false,
};
