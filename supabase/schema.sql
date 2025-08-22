-- Supabase schema for MGM personalized orders

-- Table: jobs
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text unique not null,
  status text not null default 'CREATED',
  material text,
  w_cm numeric,
  h_cm numeric,
  bleed_mm numeric,
  fit_mode text,
  bg text,
  file_original_url text,
  file_hash text,
  dpi numeric,
  dpi_level text,
  low_quality_ack boolean default false,
  layout_json jsonb,
  design_name text,
  customer_email text,
  customer_name text,
  price_amount numeric,
  price_currency text,
  notes text,
  source text,
  print_jpg_url text,
  pdf_url text,
  preview_url text,
  cart_url text,
  checkout_url text,
  shopify_product_id text,
  shopify_variant_id text,
  shopify_product_url text,
  is_public boolean default false,
  created_at timestamptz default now()
);

create index if not exists jobs_job_id_idx on public.jobs(job_id);
create index if not exists jobs_file_hash_idx on public.jobs(file_hash);

-- Table: job_events
create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete cascade,
  event text not null,
  detail jsonb,
  created_at timestamptz default now()
);

create index if not exists job_events_job_id_idx on public.job_events(job_id);
