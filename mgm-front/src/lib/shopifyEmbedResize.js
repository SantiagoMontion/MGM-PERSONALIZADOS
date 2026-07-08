const MESSAGE_TYPE = 'mgm:embed:resize';
const MESSAGE_SOURCE = 'mgm-personalizados';
const MIN_POST_INTERVAL_MS = 64;

let rafId = 0;
let lastSentAt = 0;
let lastPostedHeight = 0;

export function measureShopifyEmbedHeight() {
  if (typeof document === 'undefined') return 0;

  const docEl = document.documentElement;
  const body = document.body;
  const root = document.getElementById('root');

  return Math.ceil(Math.max(
    docEl?.scrollHeight || 0,
    docEl?.offsetHeight || 0,
    body?.scrollHeight || 0,
    body?.offsetHeight || 0,
    root?.scrollHeight || 0,
    root?.offsetHeight || 0,
  ));
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

export function postShopifyEmbedHeight(height) {
  if (typeof window === 'undefined' || window.self === window.top) return;

  const nextHeight = Math.max(0, Math.round(height));
  if (nextHeight === lastPostedHeight) return;
  lastPostedHeight = nextHeight;

  try {
    window.parent.postMessage(
      {
        type: MESSAGE_TYPE,
        source: MESSAGE_SOURCE,
        height: nextHeight,
      },
      resolveParentOrigin(),
    );
  } catch {
    // noop
  }
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
    if (document.documentElement) observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
    const root = document.getElementById('root');
    if (root) observer.observe(root);
  }

  const pollId = window.setInterval(handleResize, 2000);

  return () => {
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('load', handleResize);
    observer?.disconnect();
    window.clearInterval(pollId);
    if (rafId) cancelAnimationFrame(rafId);
  };
}
