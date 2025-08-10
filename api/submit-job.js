// /api/submit-job.js
import { z } from 'zod';
import { supa } from '../lib/supa.js';
import { cors } from '../lib/cors.js';

const LOW = Number(process.env.QUALITY_LOW_DPI || 220);

const Body = z.object({
  customer: z.object({
    email: z.string().email().optional(),
    name: z.string().optional()
  }).optional(),
  design_name: z.string().max(200).optional(),
  publish_to_shopify: z.boolean().optional().default(false),

  material: z.enum(['Classic','PRO']),
  size_cm: z.object({
    w: z.number().positive(),
    h: z.number().positive(),
    bleed_mm: z.number().min(0).max(10).optional().default(3)
  }),
  fit_mode: z.enum(['cover','contain']),
  bg: z.string().optional(),

  file_original_url: z.string().url(),
  file_hash: z.string().regex(/^[a-f0-9]{64}$/),

  dpi_report: z.object({
    dpi: z.number().positive(),
    level: z.enum(['ok','warn','bad']),
    customer_ack: z.boolean().optional().default(false)
  }),

  notes: z.string().max(1000).optional(),
  price: z.object({
    currency: z.string().default('ARS'),
    amount: z.number().nonnegative()
  }),
  source: z.string().default('web')
});

const LIMITS = { Classic: { maxW: 140, maxH: 100 }, PRO: { maxW: 120, maxH: 60 } };

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // Idempotencia (simple pero útil)
  const idem = req.headers['idempotency-key'];
  if (!idem) return res.status(400).json({ error: 'missing_idempotency_key' });

  try {
    const body = Body.parse(req.body);

    // Límites por material
    const lim = LIMITS[body.material];
    if (body.size_cm.w > lim.maxW || body.size_cm.h > lim.maxH) {
      return res.status(400).json({ error: 'size_out_of_bounds', limits: lim });
    }

    // Bad DPI sin aceptación => bloquear
    if (body.dpi_report.level === 'bad' && !body.dpi_report.customer_ack) {
      return res.status(400).json({ error: 'bad_dpi_requires_ack' });
    }

    // La URL del original debe pertenecer a tu bucket 'uploads'
    if (!/\/storage\/v1\/object\/.+\/uploads\/original\//.test(body.file_original_url)) {
      return res.status(400).json({ error: 'invalid_original_url' });
    }

    // DEDUPE: ¿ya existe un job con este mismo archivo y medida/material y con salidas listas?
    const { data: dupRows, error: dupErr } = await supa
      .from('jobs')
      .select('id,job_id,print_jpg_url,pdf_url,preview_url,checkout_url,shopify_product_url')
      .eq('file_hash', body.file_hash)
      .eq('material', body.material)
      .eq('w_cm', body.size_cm.w)
      .eq('h_cm', body.size_cm.h)
      .order('created_at', { ascending: false })
      .limit(1);

    if (dupErr) {
      console.error('dedupe_error', dupErr);
      return res.status(500).json({ error: 'dedupe_failed' });
    }

    const dup = dupRows?.[0];
    if (dup && dup.print_jpg_url && dup.pdf_url) {
      // Reusar activos existentes
      return res.status(200).json({
        job_id: dup.job_id,
        status: 'READY_FOR_PRODUCTION',
        assets: {
          print_jpg_url: dup.print_jpg_url,
          pdf_url: dup.pdf_url,
          preview_url: dup.preview_url || null
        },
        checkout_url: dup.checkout_url || null,
        product_url: dup.shopify_product_url || null,
        reused: true
      });
    }

    // INSERT nuevo job
    const insertPayload = {
      customer_email: body.customer?.email || null,
      customer_name: body.customer?.name || null,
      material: body.material,
      w_cm: body.size_cm.w,
      h_cm: body.size_cm.h,
      bleed_mm: body.size_cm.bleed_mm,
      fit_mode: body.fit_mode,
      bg: body.bg || '#ffffff',
      dpi: Math.round(body.dpi_report.dpi),
      dpi_level: body.dpi_report.level,
      low_quality_ack: !!body.dpi_report.customer_ack,
      file_original_url: body.file_original_url,
      file_hash: body.file_hash,
      price_amount: body.price.amount,
      price_currency: body.price.currency || 'ARS',
      notes: body.notes || null,
      source: body.source || 'web',
      is_public: !!body.publish_to_shopify
    };

    // Guardamos idempotencia como evento (simple)
    const { data: jobIns, error: jobErr } = await supa
      .from('jobs')
      .insert(insertPayload)
      .select('id,job_id,status')
      .single();

    if (jobErr) {
      console.error('insert_job_error', jobErr);
      return res.status(500).json({ error: 'insert_failed' });
    }

    // Guardar evento CREATED + idempotency-key (opcional)
    await supa.from('job_events').insert({
      order_id: jobIns.id, // columna se llama job_id (uuid) en la tabla job_events
      // Si tu columna es "job_id" y referencia al uuid, usa:
      job_id: jobIns.id,
      event: 'CREATED',
      detail: { idem, low_dpi: body.dpi_report.level === 'bad', is_public: !!body.publish_to_shopify }
    }).catch(()=>{});

    // Por ahora devolvemos PROCESSING: el worker generará JPG/PDF/preview y (según is_public) producto/checkout
    return res.status(202).json({
      job_id: jobIns.job_id,
      status: 'PROCESSING',
      message: 'Estamos generando tus archivos.'
    });

  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: 'invalid_body', details: e.issues });
    console.error(e);
    return res.status(500).json({ error: 'internal_error' });
  }
}
