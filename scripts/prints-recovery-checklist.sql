-- =============================================================================
-- Checklist: "no encuentro mis últimos productos" — la migración NO borra datos.
-- Solo cambió cómo se FILTRAN las filas al buscar (función search_prints).
-- =============================================================================

-- PASO 1 — ¿Hay filas nuevas en la tabla? (si el máximo created_at es viejo,
--           el problema es que publish NO está insertando en prints, no el buscador)
select
  count(*) as total,
  max(created_at) as ultimo_insert
from public.prints;

-- PASO 2 — Últimos 10 diseños guardados (compará con lo que esperás ver)
select id, created_at, design_name, file_name, left(file_path, 80) as path_corto
from public.prints
order by created_at desc
limit 10;

-- PASO 3 — Lo mismo que usa el backend para "recientes" (sin texto de búsqueda)
select id, created_at, design_name
from public.search_prints(null::text, 25, null::timestamptz, null::uuid);

-- PASO 4 — Si el PASO 2 muestra tus pedidos pero el PASO 3 NO, avisá:
--           puede haber dos versiones de la función o error en el RPC.
--           Listar funciones llamadas search_prints:
select p.oid::regprocedure as funcion
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'search_prints';

-- PASO 5 — Probar búsqueda por una palabra de un pedido reciente (cambiá 'poka')
select id, design_name
from public.search_prints('poka', 25, null::timestamptz, null::uuid);

-- PASO 6 — Filas SIN ".pdf" en path ni nombre (no entran al buscador ni con el fix
--          si realmente no hay extensión; revisar Storage y corregir path a mano)
select id, design_name, file_path, file_name
from public.prints
where position('.pdf' in lower(coalesce(file_path, '') || coalesce(file_name, ''))) = 0
order by created_at desc
limit 20;
