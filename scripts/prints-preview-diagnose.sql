-- =============================================================================
-- Diagnóstico: vistas previas en búsqueda (prints + Storage)
-- Ejecutar en Supabase → SQL Editor (rol que pueda leer public.prints y storage.objects)
--
-- El backend arma la URL pública así (si preview_url está vacío):
--   bucket por defecto: outputs
--   pdf/YYYY/MM/archivo.pdf  →  outputs/preview/YYYY/MM/archivo.jpg
--   pdf-YYYY-MM/...pdf       →  outputs/mockups-YYYY-MM/....png  (legacy)
--
-- Si todo el SQL abajo se ve "bien" pero en la app sigue "Sin vista previa",
-- revisá en el servidor (Vercel): SUPABASE_URL definido; y que exista el objeto
-- .jpg/.png en Storage (o que el bucket sea público para esas rutas).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A) Resumen: preview_url en DB vs derivación desde file_path
-- -----------------------------------------------------------------------------
select
  count(*) as total,
  count(*) filter (where coalesce(trim(preview_url), '') <> '') as con_preview_url_en_db,
  count(*) filter (where coalesce(trim(preview_url), '') = '') as sin_preview_url_en_db,
  count(*) filter (where position('.pdf' in lower(coalesce(file_path, '') || coalesce(file_name, ''))) > 0) as con_pdf_en_path_o_nombre
from public.prints;

-- -----------------------------------------------------------------------------
-- B) Distribución de bucket (debe ser coherente con file_path)
-- -----------------------------------------------------------------------------
select coalesce(nullif(trim(bucket), ''), '(null)') as bucket, count(*) as n
from public.prints
group by 1
order by n desc;

-- -----------------------------------------------------------------------------
-- C) Tipos de ruta en file_path (lo que usa el API para derivar miniatura)
--    "rel" = ruta dentro del bucket, sin prefijo https ni outputs/
-- -----------------------------------------------------------------------------
with raw as (
  select
    id,
    coalesce(file_path, '') as fp,
    coalesce(file_name, '') as fn,
    coalesce(bucket, 'outputs') as bkt,
    preview_url
  from public.prints
),
norm as (
  select
    *,
    regexp_replace(
      regexp_replace(
        fp,
        '^https?://[^/]+/storage/v1/object/public/[^/]+/',
        '',
        'i'
      ),
      '^outputs/',
      '',
      'i'
    ) as rel_path
  from raw
),
typed as (
  select
    *,
    case
      when position('.pdf' in lower(fp)) = 0 and position('.pdf' in lower(fn)) = 0
        then 'sin_pdf_en_path'
      when lower(fp) ~ '^https?://' then 'url_completa'
      when lower(rel_path) ~ '^pdf/' then 'layout_nuevo_pdf_slash'
      when rel_path ~* '^pdf-' then 'layout_legacy_pdf_guion'
      else 'otro_patron'
    end as path_kind
  from norm
)
select path_kind, count(*) as n
from typed
group by 1
order by n desc;

-- -----------------------------------------------------------------------------
-- D) Ruta derivada esperada (misma lógica que printsSearch.js / preview.js)
--    + comprobación en Storage si tenés acceso a storage.objects
-- -----------------------------------------------------------------------------
with norm as (
  select
    p.id,
    p.created_at,
    p.design_name,
    p.file_name,
    p.file_path,
    coalesce(nullif(trim(p.bucket), ''), 'outputs') as bucket,
    p.preview_url,
    regexp_replace(
      regexp_replace(
        coalesce(p.file_path, ''),
        '^https?://[^/]+/storage/v1/object/public/[^/]+/',
        '',
        'i'
      ),
      '^outputs/',
      '',
      'i'
    ) as rel_path
  from public.prints p
),
derived as (
  select
    n.*,
    case
      when lower(n.rel_path) like 'pdf/%' and lower(n.rel_path) like '%.pdf%'
        then regexp_replace(
          regexp_replace(n.rel_path, '^pdf/', 'preview/', 'i'),
          '\.pdf($|[?#])',
          '.jpg',
          'i'
        )
      when n.rel_path ~* '^pdf-\d{4}-\d{2}/.+\.pdf'
        then
          concat(
            'preview/',
            (regexp_match(split_part(n.rel_path, '?', 1), '^pdf-(\d{4})-(\d{2})/(.+)$'))[1],
            '/',
            (regexp_match(split_part(n.rel_path, '?', 1), '^pdf-(\d{4})-(\d{2})/(.+)$'))[2],
            '/',
            regexp_replace(
              regexp_replace(
                regexp_replace(lower((regexp_match(split_part(n.rel_path, '?', 1), '^pdf-\d{4}-\d{2}/(.+)$'))[1]), '\.pdf$', '.jpg'),
                '[^a-z0-9._-]+',
                '-',
                'gi'
              ),
              '^-+',
              ''
            )
          )
      else null
    end as expected_preview_jpg,
    case
      when n.rel_path ~* '^pdf-.*\.pdf'
        then regexp_replace(
          regexp_replace(split_part(n.rel_path, '?', 1), '^pdf-', 'mockups-', 'i'),
          '\.pdf($|[?#])',
          '.png',
          'i'
        )
      else null
    end as expected_preview_mockups_png,
    case
      when lower(n.rel_path) like 'pdf/%' then 'jpg_en_outputs_preview'
      when n.rel_path ~* '^pdf-' then 'jpg_preview_o_png_mockups_legacy'
      else 'no_derivable'
    end as derivacion
  from norm n
)
select
  d.id,
  d.created_at,
  d.design_name,
  left(d.file_path, 120) as file_path_corto,
  d.derivacion,
  d.expected_preview_jpg,
  d.expected_preview_mockups_png,
  (o_jpg.id is not null or o_png.id is not null) as existe_en_storage_outputs,
  left(coalesce(d.preview_url, ''), 80) as preview_url_db
from derived d
left join storage.objects o_jpg
  on o_jpg.bucket_id = (select id from storage.buckets where name = 'outputs' limit 1)
 and o_jpg.name = d.expected_preview_jpg
left join storage.objects o_png
  on o_png.bucket_id = (select id from storage.buckets where name = 'outputs' limit 1)
 and o_png.name = d.expected_preview_mockups_png
where d.created_at > now() - interval '30 days'
order by d.created_at desc
limit 40;

-- -----------------------------------------------------------------------------
-- E) Filas donde no existe NINGÚN preview esperado (ni .jpg en preview/ ni .png mockups)
--    Antes solo se buscaba mockups-.png para pdf-…; el código real usa preview/YYYY/MM/.jpg
-- -----------------------------------------------------------------------------
with norm as (
  select
    p.id,
    p.file_path,
    regexp_replace(
      regexp_replace(
        coalesce(p.file_path, ''),
        '^https?://[^/]+/storage/v1/object/public/[^/]+/',
        '',
        'i'
      ),
      '^outputs/',
      '',
      'i'
    ) as rel_path
  from public.prints p
),
derived as (
  select
    n.id,
    n.file_path,
    n.rel_path,
    case
      when lower(n.rel_path) like 'pdf/%' and lower(n.rel_path) like '%.pdf%'
        then regexp_replace(
          regexp_replace(n.rel_path, '^pdf/', 'preview/', 'i'),
          '\.pdf($|[?#])',
          '.jpg',
          'i'
        )
      when n.rel_path ~* '^pdf-\d{4}-\d{2}/.+\.pdf'
        then
          concat(
            'preview/',
            (regexp_match(split_part(n.rel_path, '?', 1), '^pdf-(\d{4})-(\d{2})/(.+)$'))[1],
            '/',
            (regexp_match(split_part(n.rel_path, '?', 1), '^pdf-(\d{4})-(\d{2})/(.+)$'))[2],
            '/',
            regexp_replace(
              regexp_replace(
                regexp_replace(lower((regexp_match(split_part(n.rel_path, '?', 1), '^pdf-\d{4}-\d{2}/(.+)$'))[1]), '\.pdf$', '.jpg'),
                '[^a-z0-9._-]+',
                '-',
                'gi'
              ),
              '^-+',
              ''
            )
          )
      else null
    end as expected_preview_jpg,
    case
      when n.rel_path ~* '^pdf-.*\.pdf'
        then regexp_replace(
          regexp_replace(split_part(n.rel_path, '?', 1), '^pdf-', 'mockups-', 'i'),
          '\.pdf($|[?#])',
          '.png',
          'i'
        )
      else null
    end as expected_preview_mockups_png
  from norm n
),
bucket_ref as (
  select id as bucket_id from storage.buckets where name = 'outputs' limit 1
)
select count(*) as filas_sin_ningun_preview_en_storage
from derived d, bucket_ref b
where coalesce(d.expected_preview_jpg, d.expected_preview_mockups_png) is not null
  and not (
    (d.expected_preview_jpg is not null and exists (
      select 1 from storage.objects o where o.bucket_id = b.bucket_id and o.name = d.expected_preview_jpg
    ))
    or
    (d.expected_preview_mockups_png is not null and exists (
      select 1 from storage.objects o where o.bucket_id = b.bucket_id and o.name = d.expected_preview_mockups_png
    ))
  );

-- Detalle (primeras 25): rutas que el código intenta (jpg y/o mockups)
with norm as (
  select
    p.id,
    p.file_path,
    regexp_replace(
      regexp_replace(
        coalesce(p.file_path, ''),
        '^https?://[^/]+/storage/v1/object/public/[^/]+/',
        '',
        'i'
      ),
      '^outputs/',
      '',
      'i'
    ) as rel_path
  from public.prints p
),
derived as (
  select
    n.id,
    n.file_path,
    n.rel_path,
    case
      when lower(n.rel_path) like 'pdf/%' and lower(n.rel_path) like '%.pdf%'
        then regexp_replace(
          regexp_replace(n.rel_path, '^pdf/', 'preview/', 'i'),
          '\.pdf($|[?#])',
          '.jpg',
          'i'
        )
      when n.rel_path ~* '^pdf-\d{4}-\d{2}/.+\.pdf'
        then
          concat(
            'preview/',
            (regexp_match(split_part(n.rel_path, '?', 1), '^pdf-(\d{4})-(\d{2})/(.+)$'))[1],
            '/',
            (regexp_match(split_part(n.rel_path, '?', 1), '^pdf-(\d{4})-(\d{2})/(.+)$'))[2],
            '/',
            regexp_replace(
              regexp_replace(
                regexp_replace(lower((regexp_match(split_part(n.rel_path, '?', 1), '^pdf-\d{4}-\d{2}/(.+)$'))[1]), '\.pdf$', '.jpg'),
                '[^a-z0-9._-]+',
                '-',
                'gi'
              ),
              '^-+',
              ''
            )
          )
      else null
    end as expected_preview_jpg,
    case
      when n.rel_path ~* '^pdf-.*\.pdf'
        then regexp_replace(
          regexp_replace(split_part(n.rel_path, '?', 1), '^pdf-', 'mockups-', 'i'),
          '\.pdf($|[?#])',
          '.png',
          'i'
        )
      else null
    end as expected_preview_mockups_png
  from norm n
),
bucket_ref as (
  select id as bucket_id from storage.buckets where name = 'outputs' limit 1
)
select
  d.id,
  left(d.file_path, 100) as file_path,
  d.expected_preview_jpg,
  d.expected_preview_mockups_png
from derived d, bucket_ref b
where coalesce(d.expected_preview_jpg, d.expected_preview_mockups_png) is not null
  and not (
    (d.expected_preview_jpg is not null and exists (
      select 1 from storage.objects o where o.bucket_id = b.bucket_id and o.name = d.expected_preview_jpg
    ))
    or
    (d.expected_preview_mockups_png is not null and exists (
      select 1 from storage.objects o where o.bucket_id = b.bucket_id and o.name = d.expected_preview_mockups_png
    ))
  )
order by d.id
limit 25;

-- -----------------------------------------------------------------------------
-- F) RPC: qué devuelve la búsqueda (mismas columnas que consume el API)
-- -----------------------------------------------------------------------------
select
  id,
  left(file_name, 60) as file_name,
  left(file_path, 100) as file_path,
  left(coalesce(preview_url, ''), 80) as preview_url,
  bucket
from public.search_prints(null, 15, null, null);

-- -----------------------------------------------------------------------------
-- G) Opcional: objetos preview en bucket outputs (debería haber .jpg bajo preview/)
-- -----------------------------------------------------------------------------
select
  count(*) filter (where name ilike 'preview/%') as objetos_bajo_preview_slash,
  count(*) filter (where name ilike 'mockups-%') as objetos_mockups_legacy,
  count(*) filter (where name ilike 'pdf/%') as pdfs_bajo_pdf_slash
from storage.objects
where bucket_id = (select id from storage.buckets where name = 'outputs' limit 1);
