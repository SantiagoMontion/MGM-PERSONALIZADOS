// /api/create-cart-link.js
// Crea (o reutiliza) un producto/variante y devuelve un link que agrega el ítem al carrito con properties.
import { supa } from '../lib/supa.js';
import { shopifyAdmin } from '../lib/shopify.js';

function sizeLabel(w, h) {
  return `${Number(w)}x${Number(h)} cm`;
}
function slugify(s){ return s.toString().toLowerCase().trim()
  .replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').replace(/-+/g,'-').replace(/^-|-$/g,''); }
function qs(obj) {
  return Object.entries(obj).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`).join('&');
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    const { job_id } = req.body || {};
    if (!job_id) return res.status(400).json({ error: 'missing_job_id' });

    // 1) Cargar job (necesita assets y precio)
    const { data: job, error } = await supa.from('jobs').select('*').eq('job_id', job_id).single();
    if (error || !job) return res.status(404).json({ error: 'job_not_found' });
    if (!job.print_jpg_url || !job.pdf_url) return res.status(409).json({ error: 'assets_not_ready' });
    if (!job.price_amount || job.price_amount <= 0) return res.status(400).json({ error: 'invalid_price' });

    // 2) Buscar/crear PRODUCTO y VARIANTE
    let productId = job.shopify_product_id || null;
    let variantId = job.shopify_variant_id || null;
    const optMaterial = job.material;
    const optSize = sizeLabel(job.w_cm, job.h_cm);

    async function ensureProductAndVariant() {
      // Si ya tenemos product + variant guardados, listo
      if (productId && variantId) return;

      if (!productId && job.is_public && job.preview_url) {
        // Si es público y no hay product: crear uno sencillo con 1 variante
        const hash8 = (job.file_hash || '').slice(0,8) || 'custom';
        const handle = `${slugify(job.design_name || job.notes || 'diseno')}-${hash8}`;
        const title = `Mousepad "${job.design_name || 'Diseño'}" Medida ${optSize} ${optMaterial} | PERSONALIZADO`;
        const payload = {
          product: {
            title,
            body_html: `<p>Diseño personalizado subido por un cliente.</p>`,
            handle,
            tags: `custom-upload,hash:${hash8},material:${optMaterial},size:${optSize}`,
            images: job.preview_url ? [{ src: job.preview_url }] : [],
            options: [{ name: 'Material' }, { name: 'Tamaño' }],
            variants: [{
              option1: optMaterial,
              option2: optSize,
              price: Number(job.price_amount).toFixed(2),
              sku: `MP-${optMaterial === 'Classic' ? 'CL':'PR'}-${String(Number(job.w_cm)).padStart(3,'0')}x${String(Number(job.h_cm)).padStart(3,'0')}`
            }],
            status: 'active'
          }
        };
        const { product } = await shopifyAdmin(`/products.json`, { method: 'POST', body: JSON.stringify(payload) });
        productId = String(product.id);
        variantId = String(product.variants?.[0]?.id || '');
      }

      // Si hay productId pero falta la variante exacta, crear variante
      if (productId && !variantId) {
        // Traer producto para ver si existe esa variante
        const { product } = await shopifyAdmin(`/products/${productId}.json`, { method: 'GET' });
        const found = (product.variants || []).find(v =>
          (v.option1 === optMaterial) && (v.option2 === optSize)
        );
        if (found) {
          variantId = String(found.id);
        } else {
          const payloadVar = {
            variant: {
              option1: optMaterial,
              option2: optSize,
              price: Number(job.price_amount).toFixed(2),
              sku: `MP-${optMaterial === 'Classic' ? 'CL':'PR'}-${String(Number(job.w_cm)).padStart(3,'0')}x${String(Number(job.h_cm)).padStart(3,'0')}`
            }
          };
          const { variant } = await shopifyAdmin(`/products/${productId}/variants.json`, { method: 'POST', body: JSON.stringify(payloadVar) });
          variantId = String(variant.id);
        }
      }

      // Si no teníamos producto (privado): crear producto “oculto” con 1 variante (visible pero sin enlazar)
      if (!productId) {
        const handle = `personalizado-${slugify(job.job_id)}`;
        const title = `Mousepad "${job.design_name || 'Personalizado'}" Medida ${optSize} ${optMaterial} | PERSONALIZADO`;
        const payload = {
          product: {
            title,
            body_html: `<p>Diseño personalizado.</p>`,
            handle,
            tags: `custom-upload,job:${job.job_id},material:${optMaterial},size:${optSize}`,
            images: job.preview_url ? [{ src: job.preview_url }] : [],
            options: [{ name: 'Material' }, { name: 'Tamaño' }],
            variants: [{
              option1: optMaterial,
              option2: optSize,
              price: Number(job.price_amount).toFixed(2),
              sku: `MP-${optMaterial === 'Classic' ? 'CL':'PR'}-${String(Number(job.w_cm)).padStart(3,'0')}x${String(Number(job.h_cm)).padStart(3,'0')}`
            }],
            status: 'active'
          }
        };
        const { product } = await shopifyAdmin(`/products.json`, { method: 'POST', body: JSON.stringify(payload) });
        productId = String(product.id);
        variantId = String(product.variants?.[0]?.id || '');
      }

      // Guardar en DB
      await supa.from('jobs').update({
        shopify_product_id: productId,
        shopify_variant_id: variantId
      }).eq('id', job.id);
    }

    await ensureProductAndVariant();
    if (!variantId) return res.status(500).json({ error: 'missing_variant_id' });

    // 3) Construir el permalink para agregar al carrito con properties y volver a /cart
    const pubBase = process.env.SHOPIFY_PUBLIC_BASE || `https://${process.env.SHOPIFY_STORE_DOMAIN}`;
    // Usamos /cart/add con items[0] para poder pasar properties y redirigir a /cart
    const props = {
      'items[0][id]': variantId,
      'items[0][quantity]': 1,
      'items[0][properties][jobId]': job.job_id,
      'items[0][properties][material]': job.material,
      'items[0][properties][size_cm]': `${Number(job.w_cm)}x${Number(job.h_cm)}`,
      'items[0][properties][print_jpg_url]': job.print_jpg_url,
      'items[0][properties][pdf_url]': job.pdf_url,
      // si te preocupa la longitud, puedes comentar uno de los dos URLs
    };
    const cartUrl = `${pubBase}/cart/add?${qs(props)}&return_to=%2Fcart`;

    // 4) Guardar y devolver
    await supa.from('jobs').update({ cart_url: cartUrl }).eq('id', job.id);

    return res.status(200).json({
      ok: true,
      job_id: job.job_id,
      product_id: productId,
      variant_id: variantId,
      cart_url: cartUrl
    });
  } catch (e) {
    console.error('create_cart_link_error', e);
    return res.status(500).json({ error: 'create_cart_link_failed', detail: String(e?.message || e) });
  }
}
