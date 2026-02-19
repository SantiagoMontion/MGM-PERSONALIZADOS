-- Crea tabla prints para indexar PDFs generados
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table if not exists public.prints (
  id uuid primary key default gen_random_uuid(),
  job_key text not null unique,
  bucket text not null default 'outputs',
  file_path text not null,
  file_name text not null,
  preview_url text,
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

create index if not exists idx_prints_filepath_trgm
  on public.prints using gin (file_path gin_trgm_ops);

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
