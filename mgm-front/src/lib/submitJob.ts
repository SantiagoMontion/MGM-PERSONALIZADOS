import { error } from '@/lib/log';
// src/lib/submitJob.ts
export interface SubmitJobBody {
  job_id: string;
  material: string;
  w_cm: number;
  h_cm: number;
  bleed_mm: number;
  fit_mode: "cover" | "contain" | "stretch";
  bg: string;
  dpi: number;
  file_original_url: string;
  customer_email?: string;
  customer_name?: string;
  file_hash?: string;
  price_amount?: number;
  price_currency?: string;
  design_name?: string;
  notes?: string;
  source?: string;
  low_quality_ack?: boolean;
}

import { apiFetch } from "./api";

export async function submitJob(body: SubmitJobBody): Promise<any> {
  const res = await apiFetch("/api/submit-job", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": body.job_id,
    },
    body: JSON.stringify(body),
  });

  const diagId = res.headers.get("X-Diag-Id") || "(sin diag)";
  let data: any = null;
  try {
    data = await res.json();
  } catch (err) {}

  if (!res.ok) {
    error("[submit-job FAILED]", {
      status: res.status,
      diagId,
      ...data,
      payloadSent: body,
    });
    throw new Error(
      `submit-job ${res.status} diag:${diagId} stage:${data?.stage || "unknown"} ${
        data?.supabase?.message || ""
      }`,
    );
  }

  return data?.job;
}

// También default para que cualquier import antiguo siga funcionando
export default submitJob;