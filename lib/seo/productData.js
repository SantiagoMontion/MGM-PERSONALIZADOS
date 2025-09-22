import { z } from 'zod';
import { supa } from '../supa.js';

const JobSchema = z.object({
  job_id: z.string(),
  design_name: z.string().nullable(),
  material: z.string().nullable(),
  w_cm: z.coerce.number().nullable(),
  h_cm: z.coerce.number().nullable(),
  price_amount: z.coerce.number().nullable(),
  price_currency: z.string().nullable(),
  preview_url: z.string().nullable(),
  print_jpg_url: z.string().nullable(),
  checkout_url: z.string().nullable(),
  shopify_product_url: z.string().nullable(),
  is_public: z.boolean().nullable(),
  status: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable().optional(),
});

export async function fetchJobForSeo(jobId) {
  if (!jobId) return null;
  const { data, error } = await supa
    .from('jobs')
    .select('job_id,design_name,material,w_cm,h_cm,price_amount,price_currency,preview_url,print_jpg_url,checkout_url,shopify_product_url,is_public,status,created_at,updated_at')
    .eq('job_id', jobId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const parsed = JobSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }

  const job = parsed.data;
  const isPublic = job.is_public === true || job.shopify_product_url != null;
  const hasPreview = typeof job.preview_url === 'string' && job.preview_url.trim().length > 0;
  if (!isPublic && !hasPreview) {
    return null;
  }
  return job;
}
