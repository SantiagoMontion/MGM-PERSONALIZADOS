-- Agrega columna design_name a jobs
-- TODO: ejecutar esta migración cuando se quiera persistir design_name

alter table public.jobs
  add column if not exists design_name text;

-- Índice opcional para búsquedas por nombre
create index if not exists jobs_design_name_idx
  on public.jobs using gin (to_tsvector('spanish', coalesce(design_name,'')));

