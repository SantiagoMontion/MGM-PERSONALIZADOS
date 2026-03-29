-- =============================================================================
-- Encontrar un PDF en Storage sin abrir carpetas a mano (miles de archivos)
-- Ejecutar en Supabase → SQL Editor (rol con acceso a schema storage)
-- =============================================================================

-- --- Qué dato usar ---
-- Lo más único del caso: parte del nombre del archivo, por ejemplo:
--   dragon-lore
--   mn84agq0
--   dragon-lore-90x40-pro-mn84agq0-7pazhs.pdf
-- También podés pegar el job_key o file_path desde public.prints.

-- 1) Buscar en TODOS los buckets por nombre de objeto (ruta completa incluida)
select
  b.name as bucket_name,
  o.name as object_key,
  o.id as object_id,
  o.created_at,
  round(coalesce(o.metadata->>'size', '0')::numeric / 1024.0 / 1024.0, 2) as size_mb_approx
from storage.objects o
join storage.buckets b on b.id = o.bucket_id
where o.name ilike '%dragon-lore%'
  and o.name ilike '%.pdf'
order by o.created_at desc;

-- 2) Si el nombre tiene un id corto único (ej. mn84agq0), probá solo eso (menos falsos positivos)
select b.name as bucket_name, o.name as object_key, o.created_at
from storage.objects o
join storage.buckets b on b.id = o.bucket_id
where o.name ilike '%mn84agq0%'
  and o.name ilike '%.pdf'
order by o.created_at desc;

-- 3) Comparar con lo que dice public.prints (si el PDF está en otro path, acá se ve)
select
  p.file_path as path_en_prints,
  p.file_name,
  o.name as path_real_en_storage,
  (p.file_path = o.name) as coincide_exacto
from public.prints p
left join storage.objects o
  on o.bucket_id = (select id from storage.buckets where name = coalesce(nullif(trim(p.bucket), ''), 'outputs') limit 1)
 and o.name = p.file_path
where p.file_path ilike '%dragon-lore%';

-- 4) Si (3) no encuentra fila en storage.objects con el mismo path, buscar candidatos sueltos
select b.name as bucket_name, o.name
from storage.objects o
join storage.buckets b on b.id = o.bucket_id
where b.name = 'outputs'
  and o.name ilike '%dragon-lore-90x40%'
  and o.name ilike '%.pdf';
