-- Ensure prints table stores direct public thumbnail URL and has search index on file_path
create extension if not exists pg_trgm;

alter table public.prints
  add column if not exists preview_url text;

create index if not exists idx_prints_filepath_trgm
  on public.prints using gin (file_path gin_trgm_ops);
