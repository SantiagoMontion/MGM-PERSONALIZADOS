-- Medidas tipo 115x45: incluir "WxH" en search_document y tratar NxM como dos tokens (115 + 45).
-- Normaliza × (Unicode) a x en la query.

create or replace function public.prints_before_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  w_txt text;
  h_txt text;
  wh_txt text;
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

  w_txt := null;
  h_txt := null;
  wh_txt := null;
  if new.width_cm is not null and new.height_cm is not null then
    w_txt := trim(to_char(new.width_cm::numeric, 'FM999999999990.9999999999999999'));
    h_txt := trim(to_char(new.height_cm::numeric, 'FM999999999990.9999999999999999'));
    wh_txt := w_txt || 'x' || h_txt;
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
        coalesce(w_txt, ''),
        coalesce(h_txt, ''),
        coalesce(wh_txt, ''),
        case
          when w_txt is not null and h_txt is not null then w_txt || ' x ' || h_txt
        end,
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
      case
        when p.width_cm is not null and p.height_cm is not null then
          trim(to_char(p.width_cm::numeric, 'FM999999999990.9999999999999999'))
      end,
      case
        when p.width_cm is not null and p.height_cm is not null then
          trim(to_char(p.height_cm::numeric, 'FM999999999990.9999999999999999'))
      end,
      case
        when p.width_cm is not null and p.height_cm is not null then
          trim(to_char(p.width_cm::numeric, 'FM999999999990.9999999999999999'))
            || 'x'
            || trim(to_char(p.height_cm::numeric, 'FM999999999990.9999999999999999'))
      end,
      case
        when p.width_cm is not null and p.height_cm is not null then
          trim(to_char(p.width_cm::numeric, 'FM999999999990.9999999999999999'))
            || ' x '
            || trim(to_char(p.height_cm::numeric, 'FM999999999990.9999999999999999'))
      end,
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
      regexp_replace(
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
        ),
        '[×✕⨉]',
        'x',
        'g'
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
      ) as token_arr_raw
    from params
  ),
  params3 as (
    select
      p2.q_raw,
      p2.q_lo,
      p2.lim,
      coalesce(
        array(
          select distinct btrim(inner_x::text)
          from unnest(p2.token_arr_raw) as u(raw_tok),
          lateral (
            select btrim(u.raw_tok) as rt
          ) r,
          lateral (
            select case
              when r.rt ~ '^[0-9]+(?:\.[0-9]+)?[x][0-9]+(?:\.[0-9]+)?$'
              then regexp_replace(
                r.rt,
                '^([0-9]+(?:\.[0-9]+)?)[x]([0-9]+(?:\.[0-9]+)?)$',
                '\1 \2'
              )
              else r.rt
            end as expanded
          ) e,
          lateral unnest(string_to_array(e.expanded, ' ')) as ix(inner_x)
          where coalesce(r.rt, '') <> ''
            and coalesce(btrim(ix.inner_x::text), '') <> ''
        ),
        array[]::text[]
      ) as token_arr
    from params2 p2
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
  cross join params3 par
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
  limit (select lim from params3);
$$;

grant execute on function public.search_prints(text, int, timestamptz, uuid) to service_role;
