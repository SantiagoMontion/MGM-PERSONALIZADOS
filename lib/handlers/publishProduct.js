import { shopifyAdminGraphQL } from '../shopify.js';
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

const BANKERS_EPSILON = 1e-9;

function bankersRound(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  const scaled = value * factor;
  if (!Number.isFinite(scaled)) return null;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  if (diff > 0.5 + BANKERS_EPSILON) {
    return (floor + 1) / factor;
  }
  if (diff < 0.5 - BANKERS_EPSILON) {
    return floor / factor;
  }
  if (floor % 2 === 0) {
    return floor / factor;
  }
  return (floor + 1) / factor;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = bankersRound(value, 2);
  if (!Number.isFinite(rounded)) return null;
  return rounded.toFixed(2);
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

function extractRequestId(resp) {
  if (!resp || typeof resp !== 'object' || typeof resp.headers?.get !== 'function') return '';
  return resp.headers.get('x-request-id') || resp.headers.get('X-Request-ID') || '';
}

function logRequestId(event, resp, extra = {}) {
  const requestId = extractRequestId(resp);
  if (requestId) {
    try {
      console.info(event, { requestId, ...extra });
    } catch {}
  }
  return requestId;
}

function parseDataUrlMeta(dataUrl) {
  if (typeof dataUrl !== 'string') {
    return { mimeType: 'image/png' };
  }
  const match = /^data:([^;,]+)(;base64)?,/.exec(dataUrl);
  if (!match) {
    return { mimeType: 'image/png' };
  }
  const mimeType = match[1] ? match[1].trim() : 'image/png';
  return { mimeType: mimeType || 'image/png' };
}

function normalizeTags(value) {
  const list = Array.isArray(value) ? value : [];
  const result = [];
  const seen = new Set();
  for (const entry of list) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const normalized = trimmed.slice(0, 60);
    const dedupe = normalized.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    result.push(normalized);
    if (result.length >= 45) break;
  }
  return result;
}

const STAGED_UPLOADS_CREATE_MUTATION = `mutation StagedUploads($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets {
      url
      resourceUrl
      parameters {
        name
        value
      }
    }
    userErrors {
      field
      message
      code
    }
  }
}`;

const PRODUCT_CREATE_MUTATION = `mutation ProductCreate($input: ProductInput!) {
  productCreate(input: $input) {
    product {
      id
      legacyResourceId
      handle
      status
      variants(first: 5) {
        nodes {
          id
          legacyResourceId
          title
        }
      }
    }
    userErrors {
      field
      message
      code
    }
  }
}`;

async function stagedUploadImage({ filename, buffer, mimeType }) {
  if (!buffer || !(buffer instanceof Buffer) || buffer.length === 0) {
    throw new Error('staged_upload_empty_buffer');
  }
  const input = [{
    resource: 'IMAGE',
    filename,
    mimeType: mimeType || 'image/png',
    fileSize: buffer.length,
    httpMethod: 'POST',
  }];
  const resp = await shopifyAdminGraphQL(STAGED_UPLOADS_CREATE_MUTATION, { input });
  const requestId = logRequestId('staged_upload_request', resp, { filename });
  const json = await resp.json().catch(() => null);
  if (!resp.ok) {
    const err = new Error('staged_upload_request_failed');
    err.status = resp.status;
    err.body = json;
    err.requestId = requestId;
    throw err;
  }
  const errors = Array.isArray(json?.errors) ? json.errors : [];
  if (errors.length) {
    const err = new Error('staged_upload_graphql_errors');
    err.errors = errors;
    err.requestId = requestId;
    throw err;
  }
  const payload = json?.data?.stagedUploadsCreate;
  const userErrors = Array.isArray(payload?.userErrors)
    ? payload.userErrors.filter((error) => error && (error.code || error.message))
    : [];
  if (userErrors.length) {
    const err = new Error('staged_upload_user_errors');
    err.userErrors = userErrors;
    err.requestId = requestId;
    throw err;
  }
  const target = Array.isArray(payload?.stagedTargets) ? payload.stagedTargets[0] : null;
  if (!target?.url || !target?.resourceUrl) {
    const err = new Error('staged_upload_target_missing');
    err.requestId = requestId;
    throw err;
  }
  const form = new FormData();
  const parameters = Array.isArray(target.parameters) ? target.parameters : [];
  for (const param of parameters) {
    if (!param || typeof param !== 'object') continue;
    const name = typeof param.name === 'string' ? param.name : '';
    if (!name) continue;
    const value = typeof param.value === 'string' ? param.value : '';
    form.append(name, value);
  }
  const blob = new Blob([buffer], { type: mimeType || 'image/png' });
  form.append('file', blob, filename);
  const uploadResp = await fetch(target.url, { method: 'POST', body: form });
  if (!uploadResp.ok) {
    const text = await uploadResp.text().catch(() => '');
    const err = new Error('staged_upload_failed');
    err.status = uploadResp.status;
    err.body = text.slice(0, 2000);
    err.requestId = requestId;
    throw err;
  }
  try {
    console.info('staged_upload_success', { requestId, filename });
  } catch {}
  return { originalSource: target.resourceUrl, requestId };
}

function buildProductMeta(product, variant) {
  const handle = typeof product?.handle === 'string' ? product.handle : undefined;
  const productUrl = handle ? buildProductUrl(handle) : undefined;
  const productAdminId = typeof product?.admin_graphql_api_id === 'string'
    ? product.admin_graphql_api_id
    : typeof product?.id === 'string'
      ? product.id
      : undefined;
  const variantAdminId = typeof variant?.admin_graphql_api_id === 'string'
    ? variant.admin_graphql_api_id
    : typeof variant?.id === 'string'
      ? variant.id
      : undefined;
  const productLegacyId = product?.legacyResourceId ?? product?.legacy_resource_id ?? product?.id;
  const variantLegacyId = variant?.legacyResourceId ?? variant?.legacy_resource_id ?? variant?.id;
  const productId = productLegacyId != null ? String(productLegacyId) : productAdminId;
  const variantId = variantLegacyId != null ? String(variantLegacyId) : variantAdminId;
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
  if (!product || typeof product !== 'object') return false;
  if (Array.isArray(product?.variants)) {
    const legacyVariants = product.variants;
    return legacyVariants.length > 0 && legacyVariants[0] && typeof legacyVariants[0] === 'object';
  }
  const nodes = Array.isArray(product?.variants?.nodes) ? product.variants.nodes : [];
  return nodes.length > 0 && nodes[0] && typeof nodes[0] === 'object';
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
    const isPrivateExplicit = typeof body.isPrivate === 'boolean' ? body.isPrivate : null;
    const visibility = isPrivateExplicit === true || visibilityRaw === 'private' || visibilityRaw === 'draft'
      ? 'private'
      : 'public';
    const isPrivate = visibility === 'private';

    const imageAlt = typeof body.imageAlt === 'string' && body.imageAlt.trim()
      ? body.imageAlt.trim().slice(0, 254)
      : title;

    const { mimeType } = parseDataUrlMeta(mockupDataUrl);
    const imageBuffer = Buffer.from(b64, 'base64');
    if (!imageBuffer.length) {
      return res.status(400).json({ ok: false, reason: 'invalid_mockup_dataurl' });
    }

    let stagedImage;
    try {
      stagedImage = await stagedUploadImage({ filename, buffer: imageBuffer, mimeType });
    } catch (err) {
      const status = typeof err?.status === 'number' ? err.status : 502;
      const payload = {
        ok: false,
        reason: err?.message || 'staged_upload_failed',
        status,
        detail: err?.body || err?.errors || err?.userErrors || null,
        requestId: err?.requestId || null,
        message: 'No se pudo subir la imagen del producto a Shopify.',
      };
      return res.status(status >= 400 && status < 600 ? status : 502).json(payload);
    }

    const templateSuffix = typeof process.env.SHOPIFY_TEMPLATE_SUFFIX === 'string'
      && process.env.SHOPIFY_TEMPLATE_SUFFIX.trim()
      ? process.env.SHOPIFY_TEMPLATE_SUFFIX.trim()
      : 'mousepads';

    const tags = normalizeTags(body.tags);

    const basePrice = Number.isFinite(priceTransfer) ? Math.max(priceTransfer, 0) : 0;
    const computedPrice = isPrivate ? basePrice * 1.25 : basePrice;
    const priceValue = formatMoney(computedPrice) || '0.00';

    const variantInput = {
      price: priceValue,
      requiresShipping: true,
      taxable: true,
      inventoryPolicy: 'CONTINUE',
      inventoryManagement: 'NOT_MANAGED',
      options: ['Default Title'],
    };
    if (body.sku) {
      variantInput.sku = String(body.sku).slice(0, 64);
    }

    const productMetafields = [
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
      { key: 'price_source', value: 'transferencia', type: 'single_line_text_field', namespace: 'mgm' },
      { key: 'is_private', value: isPrivate ? 'true' : 'false', type: 'boolean', namespace: 'mgm' },
    ];

    const mediaEntries = stagedImage?.originalSource
      ? [{ mediaContentType: 'IMAGE', originalSource: stagedImage.originalSource, alt: imageAlt }]
      : [];

    const seoInput = {
      title,
      ...(metaDescription ? { description: metaDescription } : {}),
    };

    const productInput = {
      title,
      descriptionHtml: description,
      productType: productTypeLabel,
      status: 'ACTIVE',
      vendor: DEFAULT_VENDOR,
      templateSuffix,
      options: ['Title'],
      variants: [variantInput],
      ...(mediaEntries.length ? { media: mediaEntries } : {}),
      ...(productMetafields.length ? { metafields: productMetafields } : {}),
      ...(tags.length ? { tags } : {}),
      ...(seoInput ? { seo: seoInput } : {}),
    };

    const productResp = await shopifyAdminGraphQL(PRODUCT_CREATE_MUTATION, { input: productInput });
    const productRequestId = logRequestId('product_create_request', productResp, { filename });
    const productJson = await productResp.json().catch(() => null);
    if (!productResp.ok) {
      return res.status(502).json({
        ok: false,
        reason: 'shopify_error',
        status: productResp.status,
        body: productJson,
        requestId: productRequestId || null,
        message: 'Shopify devolvió un error al crear el producto.',
      });
    }
    const productErrors = Array.isArray(productJson?.errors) ? productJson.errors : [];
    if (productErrors.length) {
      return res.status(502).json({
        ok: false,
        reason: 'shopify_graphql_errors',
        errors: productErrors,
        requestId: productRequestId || null,
        message: 'Shopify devolvió un error al crear el producto.',
      });
    }
    const productPayload = productJson?.data?.productCreate;
    if (!productPayload) {
      return res.status(502).json({
        ok: false,
        reason: 'product_create_failed',
        detail: productJson,
        requestId: productRequestId || null,
        message: 'Shopify devolvió un error al crear el producto.',
      });
    }
    const userErrors = Array.isArray(productPayload.userErrors)
      ? productPayload.userErrors.filter((error) => error && (error.message || error.code))
      : [];
    if (userErrors.length) {
      return res.status(400).json({
        ok: false,
        reason: 'product_create_user_errors',
        message: 'Shopify rechazó la creación del producto.',
        detail: userErrors,
        requestId: productRequestId || null,
      });
    }
    const product = productPayload.product || {};
    const variantsList = Array.isArray(product?.variants?.nodes)
      ? product.variants.nodes
      : Array.isArray(product?.variants)
        ? product.variants
        : [];
    const variantResp = variantsList[0] || {};
    const meta = buildProductMeta(product, variantResp);
    try {
      console.info('product_create_success', { requestId: productRequestId || null, productId: meta.productAdminId || null });
    } catch {}

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

    const publishResult = await publishToOnlineStore(meta.productAdminId, publicationInfo?.id, {
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
        publishAttempts: typeof publishResult.attempt === 'number' ? publishResult.attempt : undefined,
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
      publishAttempts: typeof publishResult.attempt === 'number' ? publishResult.attempt : undefined,
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

