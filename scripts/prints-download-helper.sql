-- =============================================================================
-- Ayuda para descargar un PDF indexado en public.prints cuando el buscador
-- no muestra el botón (firmas, path, etc.)
--
-- SQL NO descarga el binario: solo arma texto (URL o ruta) para usar en el panel,
-- en el navegador o en curl.
-- =============================================================================

-- 1) Datos de la fila (reemplazá el filtro si querés otro archivo)
select id, bucket, file_name, file_path, created_at
from public.prints
where file_path ilike '%dragon-lore%'
   or file_name ilike '%dragon-lore%';

-- 2) URL pública (solo funciona si el bucket `outputs` tiene lectura pública
--    para ese objeto; si al abrir da 403, el PDF es privado → usá el panel o curl)
--
--    Reemplazá:
--    - YOUR_PROJECT_REF → Settings → API → Project URL → ej. abcdefghijklmnop
--
select
  file_path,
  bucket,
  concat(
    'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/',
    bucket,
    '/',
    file_path
  ) as url_publica_a_probar_en_el_navegador
from public.prints
where file_path ilike '%dragon-lore%';

-- 3) Si la URL pública da 403: descarga manual
--    Supabase Dashboard → Storage → bucket indicado en `bucket` (ej. outputs)
--    → navegá la carpeta según `file_path` (ej. pdf-2026-03/) → clic en el PDF → Download
--
-- 4) Variante de ruta (pdf-YYYY-MM/... → pdf/YYYY/MM/...) por si el archivo en Storage
--    está en la convención nueva y en prints quedó la vieja
select
  file_path as path_en_prints,
  regexp_replace(
    file_path,
    '^pdf-(\d{4})-(\d{2})/',
    'pdf/\1/\2/',
    'i'
  ) as path_alternativo,
  concat(
    'https://YOUR_PROJECT_REF.supabase.co/storage/v1/object/public/',
    bucket,
    '/',
    regexp_replace(file_path, '^pdf-(\d{4})-(\d{2})/', 'pdf/\1/\2/', 'i')
  ) as url_publica_variante
from public.prints
where file_path ~ '^pdf-\d{4}-\d{2}/'
  and file_path ilike '%dragon-lore%';
