alter table if exists public.publish_refs
  add column if not exists product_handle text;
alter table if exists public.publish_refs
  add column if not exists product_url text;
