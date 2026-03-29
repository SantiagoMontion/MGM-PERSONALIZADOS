-- Buscar una fila en public.prints por nombre de archivo (ej. diseño dragon-lore)
-- Ejecutar en Supabase → SQL Editor

-- Por coincidencia parcial en file_name o en file_path
select id, job_key, bucket, file_name, file_path, preview_url, created_at
from public.prints
where file_name ilike '%dragon-lore%'
   or file_path ilike '%dragon-lore%';

-- Por nombre exacto de archivo (ajustá si tu extensión o sufijo difiere)
select *
from public.prints
where file_name = 'dragon-lore-90x40-pro-mn84agq0-7pazhs.pdf'
   or file_path ilike '%dragon-lore-90x40-pro-mn84agq0-7pazhs.pdf%';

-- Ver si file_path viene como URL larga vs ruta corta (pdf/...) y el bucket guardado
select
  bucket,
  file_path,
  length(file_path) as len,
  file_path ~ '^https?://' as es_url_completa,
  file_path ~ '^storage/v1/' as tiene_prefijo_storage
from public.prints
where file_name ilike '%dragon-lore%';

-- Los PDFs de imprenta deben estar en bucket outputs; si bucket <> 'outputs', la firma fallaba antes del fallback en API.
