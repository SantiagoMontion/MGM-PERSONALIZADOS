-- Ejemplo para insertar UNA fila en public.prints cuando un pedido ya publicó
-- en Shopify pero no quedó indexado (caso antes del fix de publish).
--
-- 1) En Supabase → Storage → outputs, copiá la ruta del PDF (p. ej. pdf-2026-03/archivo.pdf).
-- 2) job_key debe ser único: podés generar uno nuevo o copiar el de la app si lo tenés en logs.
-- 3) El trigger trg_prints_search_document rellena search_document al insertar.
--
-- Ajustá valores y ejecutá en SQL Editor (una vez).

/*
insert into public.prints (
  job_key,
  bucket,
  file_path,
  file_name,
  slug,
  design_name,
  width_cm,
  height_cm,
  material,
  file_size_bytes
) values (
  'manual-' || gen_random_uuid()::text,
  'outputs',
  'pdf-2026-03/ejemplo.pdf',
  'ejemplo.pdf',
  'ejemplo',
  'Nombre del diseño para buscar',
  82,
  32,
  'Classic',
  null
)
on conflict (job_key) do nothing;
*/
