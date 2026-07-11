-- Alinea track_events con el esquema que espera mgm-api (tablas creadas a mano pueden faltar columnas).
alter table public.track_events add column if not exists event_name text;
alter table public.track_events add column if not exists rid text;
alter table public.track_events add column if not exists cta_type text;
alter table public.track_events add column if not exists design_slug text;
alter table public.track_events add column if not exists product_handle text;
alter table public.track_events add column if not exists extra jsonb;
alter table public.track_events add column if not exists user_agent text;
alter table public.track_events add column if not exists referer text;
alter table public.track_events add column if not exists origin text;
alter table public.track_events add column if not exists ip text;
alter table public.track_events add column if not exists diag_id text;
alter table public.track_events add column if not exists created_at timestamptz default now();

update public.track_events set created_at = now() where created_at is null;
alter table public.track_events alter column created_at set default now();
alter table public.track_events alter column created_at set not null;

create index if not exists track_events_created_at_idx
  on public.track_events (created_at desc);

create index if not exists track_events_event_name_created_at_idx
  on public.track_events (event_name, created_at desc);

create index if not exists track_events_rid_event_name_idx
  on public.track_events (rid, event_name);

create unique index if not exists track_events_rid_event_name_unique
  on public.track_events (rid, event_name)
  where rid is not null and event_name is not null;

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on table public.track_events to anon, authenticated, service_role;
alter table public.track_events disable row level security;

create or replace function public.analytics_fetch_track_events(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  rid text,
  event_name text,
  cta_type text,
  design_slug text,
  extra jsonb,
  user_agent text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    te.rid,
    te.event_name,
    te.cta_type,
    te.design_slug,
    te.extra,
    te.user_agent,
    te.created_at
  from public.track_events te
  where (p_from is null or te.created_at >= p_from)
    and (p_to is null or te.created_at <= p_to)
  order by te.created_at desc
  limit 10000;
$$;

grant execute on function public.analytics_fetch_track_events(timestamptz, timestamptz)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
select pg_notification_queue_usage();
