-- =============================================================================
-- Backfill: insertar en public.prints los PDFs que ya están en Storage (outputs)
-- y todavía NO tienen fila en prints (por eso "desaparecieron" del buscador).
--
-- NO borra nada. Solo INSERT ... WHERE NOT EXISTS.
-- Ejecutar en Supabase → SQL Editor (una vez; podés repetir: idempotente por job_key).
--
-- Antes: revisá que el bucket se llame "outputs" (por defecto en el proyecto).
-- =============================================================================

-- Vista previa: cuántos PDFs en Storage sin fila en prints
select count(*) as pdfs_sin_indexar
from storage.objects o
where o.bucket_id = (select id from storage.buckets where name = 'outputs' limit 1)
  and o.name ilike '%.pdf'
  and not exists (
    select 1 from public.prints p where p.file_path = o.name
  );

-- Insertar (descomentá y ejecutá cuando el conteo te cierre)

/*
insert into public.prints (
  job_key,
  bucket,
  file_path,
  file_name,
  slug,
  material,
  created_at
)
select
  'backfill|' || md5(o.name::text),
  'outputs',
  o.name,
  (regexp_match(o.name, '([^/]+)$'))[1],
  nullif(
    lower(
      trim(
        split_part(
          regexp_replace((regexp_match(o.name, '([^/]+\.pdf)$', 'i'))[1], '\.pdf$', '', 'i'),
          '-',
          1
        )
      )
    ),
    ''
  ),
  'Classic',
  coalesce(o.created_at, now())
from storage.objects o
where o.bucket_id = (select id from storage.buckets where name = 'outputs' limit 1)
  and o.name ilike '%.pdf'
  and not exists (select 1 from public.prints p where p.file_path = o.name)
on conflict (job_key) do nothing;
*/
