alter table if exists public.publish_refs
  add column if not exists design_slug text;
alter table if exists public.publish_refs
  add column if not exists size_mm jsonb;
alter table if exists public.publish_refs
  add column if not exists material text;
alter table if exists public.publish_refs
  add column if not exists margin_mm numeric;
alter table if exists public.publish_refs
  add column if not exists original_mime text;
