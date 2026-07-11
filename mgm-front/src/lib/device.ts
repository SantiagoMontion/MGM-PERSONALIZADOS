export const isTouchDevice = () =>
  typeof window !== 'undefined'
  && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

export type DeviceCategory = 'mobile' | 'desktop';

export function getDeviceCategory(): DeviceCategory {
  if (typeof window === 'undefined') return 'desktop';

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const mobileUa = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
  const tabletUa = /iPad|Tablet|PlayBook|Silk/i.test(ua);
  const narrowViewport = typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 900px)').matches;

  if (mobileUa || tabletUa || (isTouchDevice() && narrowViewport)) {
    return 'mobile';
  }

  return 'desktop';
}
