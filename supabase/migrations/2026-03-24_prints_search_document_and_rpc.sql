-- Búsqueda de prints: design_name, search_document, índices, RPC keyset (sin borrar datos).

create extension if not exists pg_trgm;

alter table public.prints
  add column if not exists design_name text;

alter table public.prints
  add column if not exists search_document text;

-- Backfill design_name (sin pisar valores ya cargados)
update public.prints p
set design_name = coalesce(
  nullif(trim(p.design_name), ''),
  nullif(
    trim(
      regexp_replace(
        split_part(coalesce(p.file_name, ''), '.', 1),
        '-[0-9]+x[0-9]+.*$',
        '',
        'i'
      )
    ),
    ''
  ),
  nullif(trim(replace(coalesce(p.slug, ''), '-', ' ')), '')
)
where p.design_name is null or trim(p.design_name) = '';

-- Backfill search_document
update public.prints p
set search_document = trim(
  regexp_replace(
    concat_ws(
      ' ',
      coalesce(p.design_name, ''),
      coalesce(p.slug, ''),
      coalesce(p.file_name, ''),
      coalesce(p.material::text, ''),
      coalesce(p.width_cm::text, ''),
      coalesce(p.height_cm::text, ''),
      coalesce(p.file_path, '')
    ),
    '\s+',
    ' ',
    'g'
  )
);

-- Un solo índice trigram sobre columna denormalizada (menos OR en queries)
create index if not exists idx_prints_search_document_trgm
  on public.prints using gin (search_document gin_trgm_ops);

-- Keyset pagination estable
create index if not exists idx_prints_created_at_id_desc
  on public.prints using btree (created_at desc, id desc);

-- Mantener search_document alineado en cada escritura
create or replace function public.prints_before_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'insert' and (new.design_name is null or btrim(new.design_name) = '') then
    new.design_name := nullif(
      trim(
        regexp_replace(
          split_part(coalesce(new.file_name, ''), '.', 1),
          '-[0-9]+x[0-9]+.*$',
          '',
          'i'
        )
      ),
      ''
    );
    if new.design_name is null or new.design_name = '' then
      new.design_name := nullif(trim(replace(coalesce(new.slug, ''), '-', ' ')), '');
    end if;
  end if;

  new.search_document := trim(
    regexp_replace(
      concat_ws(
        ' ',
        coalesce(new.design_name, ''),
        coalesce(new.slug, ''),
        coalesce(new.file_name, ''),
        coalesce(new.material::text, ''),
        coalesce(new.width_cm::text, ''),
        coalesce(new.height_cm::text, ''),
        coalesce(new.file_path, '')
      ),
      '\s+',
      ' ',
      'g'
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_prints_search_document on public.prints;

create trigger trg_prints_search_document
  before insert or update on public.prints
  for each row
  execute function public.prints_before_write();

-- RPC: recientes (q vacío) o búsqueda sobre search_document; keyset (created_at desc, id desc)
create or replace function public.search_prints(
  p_q text,
  p_limit int,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  created_at timestamptz,
  file_name text,
  file_path text,
  slug text,
  preview_url text,
  width_cm numeric,
  height_cm numeric,
  material text,
  file_size_bytes bigint,
  design_name text,
  job_key text,
  bucket text
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(trim(coalesce(p_q, '')), '') as q,
      least(greatest(coalesce(p_limit, 25), 1), 100) as lim
  )
  select
    p.id,
    p.created_at,
    p.file_name,
    p.file_path,
    p.slug,
    p.preview_url,
    p.width_cm,
    p.height_cm,
    p.material,
    p.file_size_bytes,
    p.design_name,
    p.job_key,
    p.bucket
  from public.prints p
  cross join params par
  where
    (
      lower(coalesce(p.file_path, '')) like '%.pdf'
      or lower(coalesce(p.file_name, '')) like '%.pdf'
    )
    and (
      par.q is null
      or (
        coalesce(p.search_document, '') <> ''
        and (
          p.search_document ilike '%' || par.q || '%'
          or p.search_document % par.q
        )
      )
    )
    and (
      p_cursor_created_at is null
      or p_cursor_id is null
      or (
        p.created_at < p_cursor_created_at
        or (p.created_at = p_cursor_created_at and p.id < p_cursor_id)
      )
    )
  order by p.created_at desc, p.id desc
  limit (select lim from params);
$$;

grant execute on function public.search_prints(text, int, timestamptz, uuid) to service_role;
