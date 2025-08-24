// /api/submit-job.js
// Requiere: "type": "module" en package.json y @supabase/supabase-js v2
import { z } from 'zod';
import { supa } from '../lib/supa.js';
import { cors } from '../lib/cors.js';
import { randomUUID } from 'crypto';

const LIMITS = { Classic: { maxW: 140, maxH: 100 }, PRO: { maxW: 120, maxH: 60 } };

function generateJobId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const uuid8 = randomUUID().split('-')[0];
  return `job_${date}_${uuid8}`;
}

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
  layout: z.object({
    dpi: z.number(),
    bleed_mm: z.number(),
    size_cm: z.object({ w: z.number(), h: z.number() }),
    image: z.object({ natural_px: z.object({ w: z.number(), h: z.number() }) }).nullable(),
    transform: z.object({
      x_cm: z.number(),
      y_cm: z.number(),
      scaleX: z.number(),
      scaleY: z.number(),
      rotation_deg: z.number(),
    }),
    mode: z.enum(['cover','contain']),
    background: z.string(),
    corner_radius_cm: z.number(),
  }).optional(),

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
    amount: z.number().positive()
  }),
  source: z.string().default('web')
});

export default async function handler(req, res) {
  // CORS / preflight
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  // Idempotencia básica
  const idem = req.headers['idempotency-key'];
  if (!idem) return res.status(400).json({ error: 'missing_idempotency_key' });

  try {
    const body = Body.parse(req.body);

    if (!body.price.amount || body.price.amount <= 0) {
      return res.status(400).json({ error: 'invalid_price' });
    }

    // Límites por material
    const lim = LIMITS[body.material];
    if (body.size_cm.w > lim.maxW || body.size_cm.h > lim.maxH) {
      return res.status(400).json({ error: 'size_out_of_bounds', limits: lim });
    }

    // DPI bajo sin aceptación → bloquear
    if (body.dpi_report.level === 'bad' && !body.dpi_report.customer_ack) {
      return res.status(400).json({ error: 'bad_dpi_requires_ack' });
    }

    // La URL del original debe provenir del bucket 'uploads' (carpeta original/)
    // y puede o no incluir el segmento "/sign" antes del bucket.
    if (!/\/storage\/v1\/object(?:\/sign)?\/uploads\/original\//.test(body.file_original_url)) {
      return res.status(400).json({ error: 'invalid_original_url' });
    }

    // DEDUPE: ¿ya existe mismo archivo+material+tamaño con salidas listas?
    const { data: dupRows, error: dupErr } = await supa
      .from('jobs')
      .select('id,job_id,print_jpg_url,pdf_url,preview_url,checkout_url')
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
        reused: true
      });
    }

    // INSERT de job nuevo
    const insertPayload = {
      job_id: generateJobId(),
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
      layout_json: body.layout || null,

      price_amount: body.price.amount,
      price_currency: body.price.currency || 'ARS',
      notes: body.notes || null,
      design_name: body.design_name || null,

      source: body.source || 'web',
      is_public: !!body.publish_to_shopify
    };

    const { data: jobIns, error: jobErr } = await supa
      .from('jobs')
      .insert(insertPayload)
      .select('id,job_id,status')
      .single();

    if (jobErr) {
      console.error('insert_job_error', jobErr);
      return res.status(500).json({ error: 'insert_failed' });
    }

    // Evento CREATED (no cortamos si falla)
    const { error: evErr } = await supa.from('job_events').insert({
      job_id: jobIns.id, // FK uuid de la tabla jobs
      event: 'CREATED',
      detail: { idem, low_dpi: body.dpi_report.level === 'bad', is_public: !!body.publish_to_shopify }
    });
    if (evErr) console.error('insert_event_error', evErr);

    // Listo: el worker tomará este job y generará JPG/PDF/preview y (si is_public) producto/checkout
    try {
  await fetch(`${process.env.API_BASE_URL}/api/worker-process`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.WORKER_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ job_id_uuid: jobIns.id })
  });
} catch (_) { /* no bloqueamos la respuesta */ }

    return res.status(202).json({
      job_id: jobIns.job_id,
      status: 'PROCESSING',
      message: 'Estamos generando tus archivos.'
    });

  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: 'invalid_body', details: e.issues });
    console.error('submit_job_internal', e);
    return res.status(500).json({ error: 'internal_error' });
  }
}
