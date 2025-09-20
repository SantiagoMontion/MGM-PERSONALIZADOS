import { shopifyAdmin } from '../shopify.js';

const DEFAULT_VENDOR = 'MGM Personalizados';

function ensureBody(body) {
  if (body && typeof body === 'object') return body;
  if (typeof body === 'string') {
    try { return JSON.parse(body) || {}; } catch { return {}; }
  }
  return {};
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugifyTag(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toLowerCase();
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

function buildDescription({ description, designName, productTypeLabel, widthCm, heightCm, approxDpi }) {
  if (description) return description;
  const sections = [
    '<p>Producto personalizado generado con el configurador de MGM.</p>',
  ];
  if (designName) {
    sections.push(`<p><strong>Diseño:</strong> ${escapeHtml(designName)}</p>`);
  }
  if (Number.isFinite(widthCm) && Number.isFinite(heightCm) && widthCm > 0 && heightCm > 0) {
    const dim = `${widthCm.toFixed(1)} × ${heightCm.toFixed(1)} cm`;
    sections.push(`<p><strong>Medidas:</strong> ${escapeHtml(dim)}</p>`);
  }
  sections.push(`<p><strong>Tipo:</strong> ${escapeHtml(productTypeLabel)}</p>`);
  if (Number.isFinite(approxDpi) && approxDpi > 0) {
    sections.push(`<p><strong>Resolución aproximada:</strong> ${Math.round(approxDpi)}</p>`);
  }
  return sections.join('');
}

function buildTags({ baseTags, productTypeKey, designName, widthCm, heightCm }) {
  const tags = new Set(['configurador', 'personalizado']);
  if (productTypeKey) tags.add(`tipo-${productTypeKey}`);
  if (Number.isFinite(widthCm) && Number.isFinite(heightCm) && widthCm > 0 && heightCm > 0) {
    const sizeTag = `size-${Math.round(widthCm)}x${Math.round(heightCm)}cm`;
    tags.add(sizeTag);
  }
  if (designName) {
    const slug = slugifyTag(designName);
    if (slug) tags.add(`design-${slug}`);
  }
  if (Array.isArray(baseTags)) {
    baseTags.map((t) => String(t || '').trim()).filter(Boolean).forEach((t) => tags.add(t));
  } else if (typeof baseTags === 'string') {
    baseTags.split(',').map((t) => t.trim()).filter(Boolean).forEach((t) => tags.add(t));
  }
  return Array.from(tags).filter(Boolean);
}

function buildProductUrl(handle) {
  if (!handle) return undefined;
  const base =
    process.env.SHOPIFY_PUBLIC_BASE
    || (process.env.SHOPIFY_STOREFRONT_DOMAIN ? `https://${process.env.SHOPIFY_STOREFRONT_DOMAIN}` : '')
    || (process.env.SHOPIFY_STORE_DOMAIN ? `https://${process.env.SHOPIFY_STORE_DOMAIN}` : '');
  if (!base) return undefined;
  return `${base.replace(/\/$/, '')}/products/${handle}`;
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

    const baseTitle = typeof body.title === 'string' ? body.title.trim() : '';
    const fallbackTitle = designNameRaw
      ? `${productTypeLabel} personalizado - ${designNameRaw}`
      : `${productTypeLabel} personalizado`;
    const title = (baseTitle || fallbackTitle).slice(0, 254);

    const priceTransfer = toNumber(body.priceTransfer ?? body.price);
    const priceNormal = toNumber(body.priceNormal ?? body.compareAtPrice ?? body.priceNormalAmount);
    const priceCurrency = typeof body.priceCurrency === 'string' && body.priceCurrency.trim()
      ? body.priceCurrency.trim().toUpperCase()
      : 'ARS';

    const description = buildDescription({
      description: typeof body.description === 'string' ? body.description : '',
      designName: designNameRaw,
      productTypeLabel,
      widthCm,
      heightCm,
      approxDpi,
    });

    const tags = buildTags({
      baseTags: body.tags,
      productTypeKey,
      designName: designNameRaw,
      widthCm,
      heightCm,
    });

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
      inventory_management: null,
      inventory_policy: 'continue',
      option1: 'Default Title',
    };
    if (body.sku) {
      variant.sku = String(body.sku).slice(0, 64);
    }

    const payload = {
      product: {
        title,
        body_html: description,
        product_type: productTypeLabel,
        status: 'active',
        published_scope: 'web',
        tags: tags.join(', '),
        vendor: typeof body.vendor === 'string' && body.vendor.trim() ? body.vendor.trim() : DEFAULT_VENDOR,
        template_suffix: '',
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

    return res.status(200).json({
      ok: true,
      productId: product?.id ? String(product.id) : undefined,
      productHandle: product?.handle || undefined,
      productAdminId: product?.admin_graphql_api_id,
      variantId: variantResp?.id ? String(variantResp.id) : undefined,
      variantAdminId: variantResp?.admin_graphql_api_id,
      productUrl: product?.handle ? buildProductUrl(product.handle) : undefined,
      status: product?.status,
    });
  } catch (e) {
    if (e?.message === 'SHOPIFY_ENV_MISSING') {
      return res.status(400).json({ ok: false, reason: 'shopify_env_missing', missing: e?.missing || ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ADMIN_TOKEN'] });
    }
    console.error('publish_product_error', e);
    return res.status(500).json({ ok: false, reason: 'internal_error' });
  }
}

export default publishProduct;

