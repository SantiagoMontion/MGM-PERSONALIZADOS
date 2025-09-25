import { shopifyAdmin } from '../shopify.js';
import { buildProductUrl } from '../publicStorefront.js';
import { publishToOnlineStore, resolveOnlineStorePublicationId } from '../shopify/publication.js';

const DEFAULT_VENDOR = 'MgMGamers';
const ONLINE_STORE_MISSING_MESSAGE = [
  'No pudimos encontrar el canal Online Store para publicar este producto.',
  'Revisá: 1) que el canal esté instalado, 2) que la app tenga el scope write_publications.',
  'Luego probá de nuevo.',
].join('\n');
const ONLINE_STORE_DISABLED_MESSAGE = 'Tu tienda no tiene el canal Online Store habilitado. Instalalo o bien omití la publicación y usa Storefront para el carrito.';

function ensureBody(body) {
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string') {
    try { return JSON.parse(body) || {}; } catch { return {}; }
  }
  return {};
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return null;
  const normalized = Math.round(value * 100) / 100;
  return normalized.toFixed(2);
}

function pickProductType(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'glasspad' || v === 'glass') {
    return { key: 'glasspad', label: 'Glasspad' };
  }
  return { key: 'mousepad', label: 'Mousepad' };
}

function formatDimension(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const rounded = Math.round(value * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 1e-6) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(1).replace(/\.0+$/, '');
}

function buildMeasurement(widthCm, heightCm) {
  const w = formatDimension(widthCm);
  const h = formatDimension(heightCm);
  if (!w || !h) return null;
  return `${w}x${h}`;
}

function buildGlasspadTitle({ designName, measurement }) {
  const sections = ['Glasspad'];
  const normalizedName = typeof designName === 'string' ? designName.trim() : '';
  if (normalizedName) sections.push(normalizedName);
  const normalizedMeasurement = typeof measurement === 'string' ? measurement.trim() : '';
  if (normalizedMeasurement) sections.push(normalizedMeasurement);
  return `${sections.join(' ')} | PERSONALIZADO`;
}

function buildDefaultTitle({ productTypeLabel, designName, measurement, materialLabel }) {
  const parts = [productTypeLabel];
  if (designName) parts.push(designName);
  if (measurement) parts.push(measurement);
  if (materialLabel) parts.push(materialLabel);
  return `${parts.join(' ')} | PERSONALIZADO`;
}

function buildMetaDescription({ productTypeLabel, designName, widthCm, heightCm, materialLabel }) {
  const measurement = buildMeasurement(widthCm, heightCm);
  const baseLabel = productTypeLabel === 'Glasspad'
    ? 'Glasspad gamer personalizado'
    : 'Mousepad gamer personalizado';
  const sections = [baseLabel];
  if (designName) sections.push(`Diseño ${designName}`);
  if (measurement) sections.push(`Medida ${measurement} cm`);
  if (materialLabel) sections.push(`Material ${materialLabel}`);
  return `${sections.join('. ')}.`;
}

function buildProductMeta(product, variant) {
  const handle = typeof product?.handle === 'string' ? product.handle : undefined;
  const productUrl = handle ? buildProductUrl(handle) : undefined;
  const productId = product?.id ? String(product.id) : undefined;
  const variantId = variant?.id ? String(variant.id) : undefined;
  const variantAdminId = variant?.admin_graphql_api_id || undefined;
  const productAdminId = product?.admin_graphql_api_id || undefined;
  return {
    productId,
    productHandle: handle,
    productUrl,
    productAdminId,
    variantId,
    variantAdminId,
  };
}

function respondWithPublicationIssue(res, meta, reason, message, options = {}) {
  const payload = {
    ok: false,
    reason,
    message,
    recoverable: true,
    retryable: true,
    allowSkipPublication: Boolean(options.allowSkipPublication),
    publicationId: options.publicationId || null,
    publicationSource: options.publicationSource || null,
    ...meta,
  };
  if (Array.isArray(options.missing) && options.missing.length) {
    payload.missing = options.missing;
  }
  if (Array.isArray(options.publishAttempts)) {
    payload.publishAttempts = options.publishAttempts.length;
    payload.requestIds = options.publishAttempts.filter(Boolean);
  } else if (Array.isArray(options.requestIds)) {
    payload.requestIds = options.requestIds.filter(Boolean);
  }
  return res.status(200).json(payload);
}

function logPublicationAbort(meta, cause, extra = {}) {
  try {
    console.warn('publish_product_publication_abort', {
      cause,
      productId: meta?.productId || null,
      variantId: meta?.variantId || null,
      ...extra,
    });
  } catch {}
}

function isActiveStatus(product) {
  const raw = typeof product?.status === 'string' ? product.status.trim().toUpperCase() : '';
  return raw === 'ACTIVE';
}

function hasVariant(product) {
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  return variants.length > 0 && variants[0] && typeof variants[0] === 'object';
}

function detectMissingScope(errorDetail) {
  const list = Array.isArray(errorDetail) ? errorDetail : [];
  return list.some((err) => {
    const code = typeof err?.code === 'string' ? err.code.toUpperCase()
      : typeof err?.extensions?.code === 'string' ? err.extensions.code.toUpperCase()
        : '';
    if (code.includes('ACCESS') || code.includes('PERMISSION')) return true;
    const message = typeof err?.message === 'string' ? err.message.toLowerCase() : '';
    if (!message) return false;
    return message.includes('permission') || message.includes('scope') || message.includes('access');
  });
}

export async function publishProduct(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.json({ ok: false, error: 'method_not_allowed' });
  }
  try {
    const body = ensureBody(req.body);

    const mockupDataUrl = typeof body.mockupDataUrl === 'string' ? body.mockupDataUrl : '';
    const filename = typeof body.filename === 'string' && body.filename ? body.filename : 'mockup.png';

    if (!mockupDataUrl) {
      return res.status(400).json({ ok: false, reason: 'missing_mockup_dataurl' });
    }
    const b64 = (mockupDataUrl.split(',')[1] || '').trim();
    if (!b64) return res.status(400).json({ ok: false, reason: 'invalid_mockup_dataurl' });

    const designNameRaw = typeof body.designName === 'string' ? body.designName.trim() : '';
    const { key: productTypeKey, label: productTypeLabel } = pickProductType(body.productType);
    const approxDpi = toNumber(body.approxDpi ?? body.approx_dpi);
    const widthCm = toNumber(body.widthCm ?? body.width_cm);
    const heightCm = toNumber(body.heightCm ?? body.height_cm);
    const measurementLabel = buildMeasurement(widthCm, heightCm);
    const materialRaw = typeof body.material === 'string' ? body.material.trim() : '';
    const materialLabel = materialRaw || (productTypeKey === 'glasspad' ? 'Glasspad' : '');

    const baseTitle = typeof body.title === 'string' ? body.title.trim() : '';
    const fallbackTitle = productTypeKey === 'glasspad'
      ? buildGlasspadTitle({ designName: designNameRaw, measurement: measurementLabel })
      : buildDefaultTitle({
        productTypeLabel,
        designName: designNameRaw,
        measurement: measurementLabel,
        materialLabel,
      });
    const title = (baseTitle || fallbackTitle).slice(0, 254);

    const priceTransfer = toNumber(body.priceTransfer ?? body.price);
    const priceNormal = toNumber(body.priceNormal ?? body.compareAtPrice ?? body.priceNormalAmount);
    const priceCurrency = typeof body.priceCurrency === 'string' && body.priceCurrency.trim()
      ? body.priceCurrency.trim().toUpperCase()
      : 'ARS';

    const description = typeof body.description === 'string' ? body.description : '';

    const metaDescriptionRaw = typeof body.seoDescription === 'string' ? body.seoDescription.trim() : '';
    const generatedMeta = buildMetaDescription({
      productTypeLabel,
      designName: designNameRaw,
      widthCm,
      heightCm,
      materialLabel,
    });
    const metaDescription = (metaDescriptionRaw || generatedMeta || '').trim().slice(0, 320);

    const visibilityRaw = typeof body.visibility === 'string' ? body.visibility.trim().toLowerCase() : '';
    const visibility = visibilityRaw === 'private' || visibilityRaw === 'draft' ? 'private' : 'public';
    const publishStatus = visibility === 'private' ? 'draft' : 'active';
    const publishedScope = visibility === 'private' ? 'global' : 'web';

    const priceValue = Number.isFinite(priceTransfer) && priceTransfer > 0 ? formatPrice(priceTransfer) : '0.00';
    const compareAt = Number.isFinite(priceNormal) && priceNormal > (priceTransfer || 0)
      ? formatPrice(priceNormal)
      : null;

    const imageAlt = typeof body.imageAlt === 'string' && body.imageAlt.trim()
      ? body.imageAlt.trim().slice(0, 254)
      : title;

    const variant = {
      price: priceValue,
      ...(compareAt ? { compare_at_price: compareAt } : {}),
      requires_shipping: true,
      taxable: true,
      inventory_management: 'shopify',
      inventory_policy: 'continue',
      inventory_quantity: 9999,
      option1: 'Default Title',
    };
    if (body.sku) {
      variant.sku = String(body.sku).slice(0, 64);
    }

    const templateSuffix = typeof process.env.SHOPIFY_TEMPLATE_SUFFIX === 'string'
      && process.env.SHOPIFY_TEMPLATE_SUFFIX.trim()
      ? process.env.SHOPIFY_TEMPLATE_SUFFIX.trim()
      : 'mousepads';

    const payload = {
      product: {
        title,
        body_html: description,
        product_type: productTypeLabel,
        status: publishStatus,
        published_scope: publishedScope,
        tags: '',
        vendor: DEFAULT_VENDOR,
        template_suffix: templateSuffix,
        metafields_global_title_tag: title,
        ...(metaDescription ? { metafields_global_description_tag: metaDescription } : {}),
        variants: [variant],
        images: [
          {
            attachment: b64,
            filename,
            alt: imageAlt,
          },
        ],
        metafields: [
          ...(designNameRaw
            ? [{ key: 'design_name', value: designNameRaw.slice(0, 250), type: 'single_line_text_field', namespace: 'custom' }]
            : []),
          ...(Number.isFinite(widthCm) && widthCm > 0
            ? [{ key: 'width_cm', value: String(widthCm), type: 'single_line_text_field', namespace: 'custom' }]
            : []),
          ...(Number.isFinite(heightCm) && heightCm > 0
            ? [{ key: 'height_cm', value: String(heightCm), type: 'single_line_text_field', namespace: 'custom' }]
            : []),
          ...(materialLabel
            ? [{ key: 'material', value: materialLabel.slice(0, 60), type: 'single_line_text_field', namespace: 'custom' }]
            : []),
          ...(Number.isFinite(approxDpi) && approxDpi > 0
            ? [{ key: 'approx_dpi', value: String(Math.round(approxDpi)), type: 'single_line_text_field', namespace: 'custom' }]
            : []),
          ...(priceCurrency
            ? [{ key: 'price_currency', value: priceCurrency, type: 'single_line_text_field', namespace: 'custom' }]
            : []),
        ],
      },
    };

    const resp = await shopifyAdmin('products.json', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      return res.status(502).json({ ok: false, reason: 'shopify_error', status: resp.status, body: text.slice(0, 2000) });
    }
    const data = await resp.json().catch(() => ({}));
    const product = data?.product || {};
    const variantResp = Array.isArray(product?.variants) ? product.variants[0] || {} : {};
    const meta = buildProductMeta(product, variantResp);

    if (!isActiveStatus(product)) {
      return res.status(400).json({
        ok: false,
        reason: 'product_not_active',
        message: 'El producto creado no quedó activo en Shopify. Revisá la visibilidad configurada y volvé a intentarlo.',
        ...meta,
        visibility,
      });
    }

    if (!hasVariant(product)) {
      return res.status(400).json({
        ok: false,
        reason: 'product_missing_variant',
        message: 'Shopify no devolvió variantes para el producto creado.',
        ...meta,
        visibility,
      });
    }

    let publicationInfo;
    try {
      publicationInfo = await resolveOnlineStorePublicationId({ preferEnv: true });
      if (publicationInfo?.id) {
        try {
          console.info('publish_product_publication_resolved', {
            id: publicationInfo.id,
            source: publicationInfo.source || 'unknown',
            name: publicationInfo.name || null,
          });
        } catch {}
      }
    } catch (err) {
      if (err?.message === 'online_store_publication_empty') {
        logPublicationAbort(meta, 'no_publications');
        return respondWithPublicationIssue(res, { ...meta, visibility }, 'online_store_publication_empty', ONLINE_STORE_DISABLED_MESSAGE, {
          allowSkipPublication: true,
          missing: ['online_store_channel'],
        });
      }
      if (err?.message === 'online_store_publication_missing') {
        logPublicationAbort(meta, 'missing_scope');
        return respondWithPublicationIssue(res, { ...meta, visibility }, 'online_store_publication_missing', ONLINE_STORE_MISSING_MESSAGE, {
          missing: ['write_publications'],
        });
      }
      throw err;
    }

    const publishResult = await publishToOnlineStore(product?.admin_graphql_api_id, publicationInfo?.id, {
      maxAttempts: 5,
      initialDelayMs: 200,
      maxDelayMs: 3200,
      preferEnv: publicationInfo?.source === 'env' || publicationInfo?.source === 'override',
    });

    if (!publishResult?.ok) {
      const requestIds = Array.isArray(publishResult?.requestIds) ? publishResult.requestIds : [];
      if (publishResult.reason === 'publication_missing') {
        logPublicationAbort(meta, 'still_missing_after_retries', { requestIds });
        return respondWithPublicationIssue(res, { ...meta, visibility }, 'online_store_publication_missing', ONLINE_STORE_MISSING_MESSAGE, {
          publicationId: publicationInfo?.id || null,
          publicationSource: publicationInfo?.source || null,
          requestIds,
          missing: ['write_publications'],
        });
      }
      if (publishResult.reason === 'graphql_errors' || publishResult.reason === 'user_errors') {
        const combined = publishResult.errors || publishResult.userErrors || [];
        if (detectMissingScope(combined)) {
          logPublicationAbort(meta, 'missing_scope', { requestIds });
          return respondWithPublicationIssue(res, { ...meta, visibility }, 'online_store_publication_missing', ONLINE_STORE_MISSING_MESSAGE, {
            publicationId: publicationInfo?.id || null,
            publicationSource: publicationInfo?.source || null,
            requestIds,
            missing: ['write_publications'],
          });
        }
      }

      logPublicationAbort(meta, publishResult.reason || 'publish_failed', { requestIds });
      return res.status(502).json({
        ok: false,
        reason: publishResult.reason || 'publish_failed',
        message: 'Shopify rechazó la publicación del producto.',
        detail: publishResult,
        ...meta,
        visibility,
      });
    }

    return res.status(200).json({
      ok: true,
      ...meta,
      status: product?.status,
      visibility,
      publicationId: publishResult.publicationId,
      publicationSource: publicationInfo?.source || null,
      requestIds: publishResult.requestIds || null,
    });
  } catch (e) {
    if (e?.message === 'SHOPIFY_ENV_MISSING') {
      const missing = Array.isArray(e?.missing) && e.missing.length
        ? e.missing
        : ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_TOKEN'];
      return res.status(400).json({
        ok: false,
        reason: 'shopify_env_missing',
        missing,
        message: `Faltan variables de entorno para Shopify: ${missing.join(', ')}.`,
      });
    }
    console.error('publish_product_error', e);
    return res.status(500).json({ ok: false, reason: 'internal_error' });
  }
}

export default publishProduct;

