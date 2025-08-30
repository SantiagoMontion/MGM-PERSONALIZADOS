-- Agrega columnas para registrar aceptación de términos
alter table public.jobs
  add column if not exists legal_version text,
  add column if not exists legal_accepted_at timestamptz;
