export const GLASSPAD_SIZE_CM = { w: 49, h: 42 };

export const LIMITS = {
  Classic: { maxW: 140, maxH: 100 },
  PRO: { maxW: 120, maxH: 60 },
  Glasspad: { maxW: GLASSPAD_SIZE_CM.w, maxH: GLASSPAD_SIZE_CM.h },
};

export const STANDARD = {
  Classic: [
    { w: 25, h: 25 },
    { w: 82, h: 32 },
    { w: 90, h: 40 },
    { w: 100, h: 60 },
    { w: 140, h: 100 },
  ],
  PRO: [
    { w: 25, h: 25 },
    { w: 50, h: 40 },
    { w: 90, h: 40 },
    { w: 120, h: 60 },
  ],
  Glasspad: [GLASSPAD_SIZE_CM],
};
