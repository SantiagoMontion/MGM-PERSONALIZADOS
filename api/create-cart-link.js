// /api/create-cart-link.js
// Endpoint idempotente para crear/reutilizar producto y variante en Shopify.
import crypto from 'node:crypto';
import { supa } from '../lib/supa.js';
import { shopifyAdmin, shopifyAdminGraphQL } from '../lib/shopify.js';
import { cors } from './_lib/cors.js';

function slugify(s){ return String(s).toLowerCase().trim()
  .replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').replace(/-+/g,'-').replace(/^-|-$/g,''); }
function parseDesignNameFromNotes(notes) {
  if (!notes) return null;
  const m = String(notes).match(/design_name\s*[:=]\s*([^|]+)$/i);
  return m ? m[1].trim() : null;
}
function qs(obj) {
  return Object.entries(obj).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`).join('&');
}

export default async function handler(req, res) {
  const diagId = crypto.randomUUID?.() ?? require('node:crypto').randomUUID();
  res.setHeader('X-Diag-Id', String(diagId));

  if (cors(req, res)) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, diag_id: diagId, message: 'method_not_allowed' });
  }

  try {
    const { job_id } = req.body || {};
    if (!job_id) return res.status(400).json({ error: 'missing_job_id' });

    // 1) Cargar job
    const { data: job, error } = await supa.from('jobs').select('*').eq('job_id', job_id).single();
    if (error || !job) return res.status(404).json({ error: 'job_not_found' });
    if (!job.print_jpg_url || !job.pdf_url) return res.status(409).json({ error: 'assets_not_ready' });
    if (!job.price_amount || job.price_amount <= 0) return res.status(400).json({ error: 'invalid_price' });

    const dn = job.design_name || parseDesignNameFromNotes(job.notes) || 'Personalizado';
    const w = Number(job.w_cm), h = Number(job.h_cm);
    const mat = String(job.material || 'Classic');
    const designSlug = slugify(dn);
    const job8 = String(job.job_id).replace(/[^a-z0-9]/ig,'').slice(0,8) || 'custom';

    const title = `Mousepad ${dn} ${w}x${h} ${mat} | PERSONALIZADO`;
    const handle = `mousepad-${designSlug}-${w}x${h}-${mat.toLowerCase()}-${job8}`;

    const optMaterial = mat;
    const optSize = `${w}x${h} cm`;
    const baseTags = `custom-upload,job:${job.job_id},material:${optMaterial},size:${optSize}`;

    // precios: transferencia recibido del front y lista +25%
    const priceTransfer = Math.round(Number(job.price_amount));
    const priceLista = Math.round(priceTransfer * 1.25);

    let productId = job.shopify_product_id || null;
    let variantId = job.shopify_variant_id || null;

    if (!(productId && variantId)) {
      // 3) Buscar en Shopify antes de crear
      const qByTag = `\nquery($q: String!) {\n  products(first: 1, query: $q) {\n    edges { node { id handle title variants(first: 50) { edges { node { id option1 option2 } } } } }\n  }\n}`;
      const qByHandle = `\nquery($h: String!) {\n  products(first: 1, query: $h) {\n    edges { node { id handle title variants(first: 50) { edges { node { id option1 option2 } } } } }\n  }\n}`;

      async function findProduct() {
        let q = `tag:'job:${job.job_id}'`;
        let r = await shopifyAdminGraphQL(qByTag, { q });
        let edge = r?.data?.products?.edges?.[0];
        if (edge) return edge.node;

        q = `handle:${handle}`;
        r = await shopifyAdminGraphQL(qByHandle, { h: q });
        edge = r?.data?.products?.edges?.[0];
        return edge?.node || null;
      }

      const found = await findProduct();
      if (found) {
        productId = String(found.id).replace('gid://shopify/Product/','');
        const v = (found.variants?.edges || []).map(e => e.node)
          .find(v => v.option1 === optMaterial && v.option2 === optSize);
        if (v) variantId = String(v.id).replace('gid://shopify/ProductVariant/','');
      }

      // 4) Crear sólo si no existe
      if (!productId) {
        const payload = {
          product: {
            title,
            handle,
            body_html: `<p>Diseño personalizado subido por el cliente.</p>`,
            tags: baseTags,
            images: job.preview_url ? [{ src: job.preview_url }] : [],
            options: [{ name: 'Material' }, { name: 'Tamaño' }],
            variants: [{
              option1: optMaterial,
              option2: optSize,
              price: priceTransfer.toFixed(2),
              compare_at_price: priceLista.toFixed(2),
              sku: `MP-${optMaterial === 'Classic' ? 'CL':'PR'}-${String(w).padStart(3,'0')}x${String(h).padStart(3,'0')}`
            }],
            status: 'active'
          }
        };
        try {
          const { product } = await shopifyAdmin(`/products.json`, { method:'POST', body: JSON.stringify(payload) });
          productId = String(product.id);
          variantId = String(product.variants?.[0]?.id || '');
        } catch (e) {
          const msg = String(e?.message || '');
          if (msg.includes('422') || msg.toLowerCase().includes('handle')) {
            const again = await findProduct();
            if (again) {
              productId = String(again.id).replace('gid://shopify/Product/','');
              const v = (again.variants?.edges || []).map(e => e.node)
                .find(v => v.option1 === optMaterial && v.option2 === optSize);
              if (v) variantId = String(v.id).replace('gid://shopify/ProductVariant/','');
            } else {
              throw e;
            }
          } else {
            throw e;
          }
        }
      }

      // si existe product pero falta variante exacta, crear variante
      if (productId && !variantId) {
        const { product } = await shopifyAdmin(`/products/${productId}.json`, { method:'GET' });
        const foundVar = (product.variants || []).find(v =>
          (v.option1 === optMaterial) && (v.option2 === optSize)
        );
        if (foundVar) {
          variantId = String(foundVar.id);
        } else {
          const payloadVar = { variant: {
            option1: optMaterial,
            option2: optSize,
            price: priceTransfer.toFixed(2),
            compare_at_price: priceLista.toFixed(2),
            sku: `MP-${optMaterial === 'Classic' ? 'CL':'PR'}-${String(w).padStart(3,'0')}x${String(h).padStart(3,'0')}`
          }};
          const { variant } = await shopifyAdmin(`/products/${productId}/variants.json`, { method:'POST', body: JSON.stringify(payloadVar) });
          variantId = String(variant.id);
        }
      }
    }

    // Guardar en DB con update condicional
    if (productId) {
      await supa.from('jobs')
        .update({ shopify_product_id: productId })
        .eq('id', job.id)
        .is('shopify_product_id', null);
    }
    if (variantId) {
      await supa.from('jobs')
        .update({ shopify_variant_id: variantId })
        .eq('id', job.id)
        .is('shopify_variant_id', null);
    }
    if (!variantId) return res.status(500).json({ error: 'missing_variant_id' });

    // actualizar precios de la variante
    await shopifyAdmin(`/variants/${variantId}.json`, {
      method: 'PUT',
      body: JSON.stringify({
        variant: {
          id: variantId,
          price: priceTransfer.toFixed(2),
          compare_at_price: priceLista.toFixed(2),
        }
      })
    });

    console.log('pricing', { job_id: job.job_id, priceTransfer, priceLista, variantId, productId });

    // Construir URLs
    const pubBase = process.env.SHOPIFY_PUBLIC_BASE || `https://${process.env.SHOPIFY_STORE_DOMAIN}`;
    const props = {
      'items[0][id]': variantId,
      'items[0][quantity]': 1,
      'items[0][properties][jobId]': job.job_id,
      'items[0][properties][material]': optMaterial,
      'items[0][properties][size_cm]': `${w}x${h}`,
      'items[0][properties][print_jpg_url]': job.print_jpg_url,
      'items[0][properties][pdf_url]': job.pdf_url,
    };
    const query = qs(props);
    const cart_url_follow  = `${pubBase}/cart/add?${query}&return_to=%2Fcart`;
    const checkout_url_now = `${pubBase}/cart/add?${query}&return_to=%2Fcheckout`;
    const cart_plain = `${pubBase}/cart`;
    const checkout_plain = `${pubBase}/checkout`;

    await supa.from('jobs').update({ cart_url: cart_url_follow }).eq('id', job.id);

    return res.status(200).json({
      ok: true,
      job_id: job.job_id,
      product_id: productId,
      variant_id: variantId,
      cart_url: cart_url_follow,
      cart_url_follow,
      checkout_url_now,
      cart_plain,
      checkout_plain,
    });
  } catch (e) {
    console.error('create_cart_link_error', e);
    return res.status(500).json({ error: 'create_cart_link_failed', detail: String(e?.message || e) });
  }
}

