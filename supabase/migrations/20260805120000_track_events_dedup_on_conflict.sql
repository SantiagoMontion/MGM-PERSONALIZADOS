-- ON CONFLICT no puede inferir un índice único parcial si no se repite su predicado, y PostgREST
-- solo envía columnas. Se reemplaza por un índice único equivalente: event_name es NOT NULL y en un
-- índice único los NULL de rid nunca colisionan, así que el predicado era redundante.
-- Con esto el insert puede usar ON CONFLICT DO NOTHING y Postgres deja de loguear un 23505 por cada
-- repetición normal del visitante.

-- Se crea antes de borrar el parcial para no quedar sin protección en ningún momento.
create unique index if not exists track_events_rid_event_name_key
  on public.track_events (rid, event_name);

drop index if exists public.track_events_rid_event_name_unique;

notify pgrst, 'reload schema';
