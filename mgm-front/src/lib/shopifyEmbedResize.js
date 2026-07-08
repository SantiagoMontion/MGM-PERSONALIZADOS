const MESSAGE_TYPE_RESIZE = 'mgm:embed:resize';
const MESSAGE_TYPE_WHEEL = 'mgm:embed:wheel';
const MESSAGE_SOURCE = 'mgm-personalizados';
const MIN_POST_INTERVAL_MS = 64;
const EMBED_HEIGHT_FLOOR_PX = 420;

let rafId = 0;
let lastSentAt = 0;
let lastPostedHeight = 0;

export function measureShopifyEmbedHeight() {
  if (typeof document === 'undefined') return 0;

  const measureEnd = document.getElementById('mgm-embed-measure-end');
  if (measureEnd) {
    const rect = measureEnd.getBoundingClientRect();
    const scrollTop = window.pageYOffset
      || document.documentElement?.scrollTop
      || document.body?.scrollTop
      || 0;
    return Math.ceil(rect.bottom + scrollTop);
  }

  const measureRoot = document.getElementById('mgm-embed-measure-root');
  if (measureRoot) {
    return Math.ceil(measureRoot.getBoundingClientRect().height);
  }

  const root = document.getElementById('root');
  return Math.ceil(root?.getBoundingClientRect().height || 0);
}

function resolveParentOrigin() {
  try {
    if (document.referrer) {
      return new URL(document.referrer).origin;
    }
  } catch {
    // noop
  }
  return '*';
}

function postToParent(payload) {
  if (typeof window === 'undefined' || window.self === window.top) return;
  try {
    window.parent.postMessage(
      { ...payload, source: MESSAGE_SOURCE },
      resolveParentOrigin(),
    );
  } catch {
    // noop
  }
}

export function postShopifyEmbedHeight(height) {
  const nextHeight = Math.max(EMBED_HEIGHT_FLOOR_PX, Math.round(height));
  if (nextHeight === lastPostedHeight) return;
  lastPostedHeight = nextHeight;

  postToParent({
    type: MESSAGE_TYPE_RESIZE,
    height: nextHeight,
  });
}

export function scheduleShopifyEmbedResize() {
  if (typeof window === 'undefined' || window.self === window.top) return;

  if (rafId) {
    cancelAnimationFrame(rafId);
  }

  rafId = requestAnimationFrame(() => {
    rafId = 0;

    const publish = () => {
      lastSentAt = Date.now();
      postShopifyEmbedHeight(measureShopifyEmbedHeight());
    };

    const elapsed = Date.now() - lastSentAt;
    if (elapsed < MIN_POST_INTERVAL_MS) {
      window.setTimeout(publish, MIN_POST_INTERVAL_MS - elapsed);
      return;
    }

    publish();
  });
}

function bindShopifyEmbedWheelPassthrough() {
  const onWheel = (event) => {
    postToParent({
      type: MESSAGE_TYPE_WHEEL,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
    });
  };

  window.addEventListener('wheel', onWheel, { passive: true });
  return () => window.removeEventListener('wheel', onWheel);
}

export function bindShopifyEmbedResize() {
  if (typeof window === 'undefined' || window.self === window.top) {
    return () => {};
  }

  scheduleShopifyEmbedResize();

  const handleResize = () => scheduleShopifyEmbedResize();
  window.addEventListener('resize', handleResize);
  window.addEventListener('load', handleResize);

  let observer;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(handleResize);
    const measureRoot = document.getElementById('mgm-embed-measure-root');
    if (measureRoot) observer.observe(measureRoot);
    const measureEnd = document.getElementById('mgm-embed-measure-end');
    if (measureEnd) observer.observe(measureEnd);
    if (document.body) observer.observe(document.body);
  }

  const pollId = window.setInterval(handleResize, 2000);
  const unbindWheel = bindShopifyEmbedWheelPassthrough();

  return () => {
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('load', handleResize);
    observer?.disconnect();
    window.clearInterval(pollId);
    unbindWheel();
    if (rafId) cancelAnimationFrame(rafId);
  };
}
