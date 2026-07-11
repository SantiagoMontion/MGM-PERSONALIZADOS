-- Lectura de eventos vía RPC (mismo patrón que search_prints en /busqueda).
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
