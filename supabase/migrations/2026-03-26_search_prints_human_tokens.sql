-- Búsqueda más humana: varias palabras (AND), normalización de | y guiones;
-- search_document incluye slug con espacios para matchear "max verstappen" etc.

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
        regexp_replace(coalesce(new.slug, ''), '-', ' ', 'g'),
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

-- Refrescar search_document en filas existentes (misma fórmula que el trigger)
update public.prints p
set search_document = trim(
  regexp_replace(
    concat_ws(
      ' ',
      coalesce(p.design_name, ''),
      coalesce(p.slug, ''),
      regexp_replace(coalesce(p.slug, ''), '-', ' ', 'g'),
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
      nullif(trim(coalesce(p_q, '')), '') as q_raw,
      lower(
        btrim(
          regexp_replace(
            regexp_replace(
              trim(regexp_replace(trim(coalesce(p_q, '')), '\s+', ' ', 'g')),
              '\|',
              ' ',
              'g'
            ),
            '[-–—]+',
            ' ',
            'g'
          )
        )
      ) as q_lo,
      least(greatest(coalesce(p_limit, 25), 1), 100) as lim
  ),
  params2 as (
    select
      q_raw,
      q_lo,
      lim,
      regexp_split_to_array(
        btrim(regexp_replace(coalesce(q_lo, ''), '[^a-z0-9áéíóúñüäëïöüàèìòùâêîôûãõç ]+', ' ', 'g')),
        '\s+'
      ) as token_arr
    from params
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
  cross join params2 par
  where
    (
      lower(coalesce(p.file_path, '')) like '%.pdf'
      or lower(coalesce(p.file_name, '')) like '%.pdf'
    )
    and (
      par.q_raw is null
      or (
        coalesce(p.search_document, '') <> ''
        and (
          p.search_document ilike '%' || par.q_raw || '%'
          or p.search_document ilike '%' || par.q_lo || '%'
          or p.search_document % par.q_raw
          or p.search_document % par.q_lo
          or (
            exists (
              select 1
              from unnest(par.token_arr) as x(t)
              where length(btrim(t)) >= 2
            )
            and not exists (
              select 1
              from unnest(par.token_arr) as x(t)
              where length(btrim(t)) >= 2
                and btrim(t) <> ''
                and p.search_document not ilike ('%' || btrim(t) || '%')
            )
          )
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
  limit (select lim from params2);
$$;

grant execute on function public.search_prints(text, int, timestamptz, uuid) to service_role;
