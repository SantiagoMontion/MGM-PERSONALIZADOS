-- Supabase schema for MGM personalized orders

-- Function to generate default job_id: job_YYYYMMDD_uuid8
create or replace function public.default_job_id()
returns text
language sql
as $$
  select 'job_' || to_char(now(), 'YYYYMMDD') || '_' || substr(gen_random_uuid()::text, 1, 8);
$$;

-- Table: jobs
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text unique not null default public.default_job_id(),
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

-- Optional full-text search index for jobs (design_name + material)
-- create extension if not exists pg_trgm;
-- create index if not exists jobs_design_material_fts on public.jobs using gin (
--   (to_tsvector('spanish', coalesce(design_name,'')) || to_tsvector('simple', coalesce(material,'')))
-- );

-- Table: prints
create table if not exists public.prints (
  id uuid primary key default gen_random_uuid(),
  job_key text not null unique,
  bucket text not null default 'outputs',
  file_path text not null,
  file_name text not null,
  slug text,
  width_cm numeric,
  height_cm numeric,
  material text,
  bg_color text,
  job_id text,
  image_hash text,
  file_size_bytes bigint,
  shopify_product_id text,
  shopify_variant_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_prints_created_at_desc
  on public.prints using btree (created_at desc, file_name asc);

create index if not exists idx_prints_slug_trgm
  on public.prints using gin (slug gin_trgm_ops);

create index if not exists idx_prints_filename_trgm
  on public.prints using gin (file_name gin_trgm_ops);

create or replace function public.set_prints_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_prints_updated_at
  before update on public.prints
  for each row
  execute function public.set_prints_updated_at();

-- Table: publish_refs para mapear productos publicados y sus assets
create table if not exists public.publish_refs (
  id uuid primary key default gen_random_uuid(),
  rid text not null unique,
  product_id text not null,
  product_handle text,
  product_url text,
  design_slug text,
  size_mm jsonb,
  material text,
  margin_mm numeric,
  original_object_key text,
  original_url text,
  original_mime text,
  mockup_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists publish_refs_product_id_idx
  on public.publish_refs using btree (product_id);

create or replace function public.set_publish_refs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_publish_refs_updated_at
  before update on public.publish_refs
  for each row
  execute function public.set_publish_refs_updated_at();
