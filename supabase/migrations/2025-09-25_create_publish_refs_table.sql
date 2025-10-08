-- Crea tabla publish_refs para mapear productos publicados con assets originales
create extension if not exists pgcrypto;

create table if not exists public.publish_refs (
  id uuid primary key default gen_random_uuid(),
  rid text not null unique,
  product_id text not null,
  original_object_key text,
  original_url text,
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
