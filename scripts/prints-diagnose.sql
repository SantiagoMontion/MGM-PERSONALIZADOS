-- =============================================================================
-- Diagnóstico: tabla prints + función search_prints (ejecutar en Supabase SQL Editor)
-- =============================================================================

-- 1) Estructura de columnas
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'prints'
order by ordinal_position;

-- 2) Cantidad de filas
select count(*) as total_prints from public.prints;

-- 3) Últimos 15 registros (lo que debería verse en "recientes")
select id, created_at, design_name, file_name, file_path,
       length(coalesce(search_document, '')) as search_doc_len
from public.prints
order by created_at desc
limit 15;

-- 4) Filas que el RPC VIEJO excluía: path/nombre sin ".pdf" al final "limpio"
--    (ej. URL con ? o sin extensión)
select id, design_name, file_name, file_path
from public.prints
where position('.pdf' in lower(coalesce(file_path, '') || coalesce(file_name, ''))) = 0;

-- 5) Probar la búsqueda como el backend (ajustá el texto)
select * from public.search_prints('poka', 25, null, null);
select * from public.search_prints('mousepad', 25, null, null);
select * from public.search_prints(null, 25, null, null);

-- 6) Buscar por diseño concreto (sin RPC)
select id, design_name, file_name, file_path, search_document
from public.prints
where design_name ilike '%poka%'
   or coalesce(search_document, '') ilike '%poka%';

-- 7) Definición actual de search_prints (confirmar migración aplicada)
select pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'search_prints'
limit 1;
