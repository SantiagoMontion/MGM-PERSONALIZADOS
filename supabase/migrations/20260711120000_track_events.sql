-- Tabla de eventos de analytics del personalizador
create table if not exists public.track_events (
  id bigserial primary key,
  event_name text not null,
  rid text,
  cta_type text,
  design_slug text,
  product_handle text,
  extra jsonb,
  user_agent text,
  referer text,
  origin text,
  ip text,
  diag_id text,
  created_at timestamptz not null default now()
);

create index if not exists track_events_created_at_idx
  on public.track_events (created_at desc);

create index if not exists track_events_event_name_created_at_idx
  on public.track_events (event_name, created_at desc);

create index if not exists track_events_rid_event_name_idx
  on public.track_events (rid, event_name);

create unique index if not exists track_events_rid_event_name_unique
  on public.track_events (rid, event_name)
  where rid is not null and event_name is not null;

-- La API (PostgREST / supabase-js) necesita grants explícitos en proyectos Supabase 2026+.
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on table public.track_events to anon, authenticated, service_role;

alter table public.track_events disable row level security;

notify pgrst, 'reload schema';
select pg_notification_queue_usage();
