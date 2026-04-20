-- ═══════════════════════════════════════════════════════════════════════════
-- IMPORTANTE (Supabase → SQL Editor):
-- Copiá y ejecutá TODO este archivo de una sola vez (Run completo).
-- Si solo corrés el INSERT, falla porque la tabla todavía no existe.
--
-- Las funciones se crean con DO ... EXECUTE $...$ porque el editor a veces
-- parte el script en cada ";" y rompe el PL/pgSQL (error tipo "relation vote_count does not exist").
--
-- Crea: tablas + índices + RLS + filas foto_1 … foto_600 + funciones RPC.
-- Para más fotos, cambiá el 600 en generate_series más abajo y volvé a ejecutar
-- solo el bloque INSERT (ON CONFLICT no duplica filas).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.votacion_galeria_fotos (
  id text PRIMARY KEY,
  sort_order int NOT NULL,
  votos bigint NOT NULL DEFAULT 0 CHECK (votos >= 0)
);

CREATE TABLE IF NOT EXISTS public.votacion_galeria_votos (
  voter_uuid uuid NOT NULL,
  foto_id text NOT NULL REFERENCES public.votacion_galeria_fotos (id) ON DELETE CASCADE,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (voter_uuid, foto_id)
);

CREATE INDEX IF NOT EXISTS votacion_galeria_votos_voter ON public.votacion_galeria_votos (voter_uuid);

CREATE UNIQUE INDEX IF NOT EXISTS votacion_galeria_ip_por_foto
  ON public.votacion_galeria_votos (ip_hash, foto_id)
  WHERE ip_hash IS NOT NULL AND length(btrim(ip_hash)) > 0;

ALTER TABLE public.votacion_galeria_fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votacion_galeria_votos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "votacion_galeria_fotos_select" ON public.votacion_galeria_fotos;
CREATE POLICY "votacion_galeria_fotos_select"
  ON public.votacion_galeria_fotos FOR SELECT
  USING (true);

ALTER TABLE public.votacion_galeria_fotos
ADD COLUMN IF NOT EXISTS participante text;

COMMENT ON COLUMN public.votacion_galeria_fotos.participante IS
  'Nombre/handle legible (ej. aagus13). Opcional. Los votos usan id foto_N.';

INSERT INTO public.votacion_galeria_fotos (id, sort_order, votos)
SELECT 'foto_' || n, n, 0
FROM generate_series(1, 600) AS n
ON CONFLICT (id) DO NOTHING;

DO $wrp_votar$
BEGIN
  EXECUTE $ddl_votar$
CREATE OR REPLACE FUNCTION public.votacion_galeria_votar(
  p_voter_uuid uuid,
  p_foto_id text,
  p_ip_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn_votar$
DECLARE
  vote_count int;
  new_total bigint;
  ip_clean text;
BEGIN
  IF p_voter_uuid IS NULL THEN
    RAISE EXCEPTION 'voter_invalido';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.votacion_galeria_fotos WHERE id = p_foto_id) THEN
    RAISE EXCEPTION 'foto_invalida';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.votacion_galeria_votos
    WHERE voter_uuid = p_voter_uuid AND foto_id = p_foto_id
  ) THEN
    RAISE EXCEPTION 'ya_votaste_esta_foto';
  END IF;

  SELECT count(*)::int INTO vote_count FROM public.votacion_galeria_votos WHERE voter_uuid = p_voter_uuid;
  IF vote_count >= 5 THEN
    RAISE EXCEPTION 'max_votos';
  END IF;

  ip_clean := nullif(btrim(coalesce(p_ip_hash, '')), '');

  IF ip_clean IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.votacion_galeria_votos
      WHERE foto_id = p_foto_id AND ip_hash IS NOT NULL AND ip_hash = ip_clean
    ) THEN
      RAISE EXCEPTION 'ip_ya_voto';
    END IF;
  END IF;

  INSERT INTO public.votacion_galeria_votos (voter_uuid, foto_id, ip_hash)
  VALUES (p_voter_uuid, p_foto_id, ip_clean);

  UPDATE public.votacion_galeria_fotos
  SET votos = votos + 1
  WHERE id = p_foto_id
  RETURNING votos INTO new_total;

  RETURN jsonb_build_object(
    'votos', new_total,
    'mis_votos', vote_count + 1
  );
END;
$fn_votar$;
$ddl_votar$;
END;
$wrp_votar$;

REVOKE ALL ON FUNCTION public.votacion_galeria_votar(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.votacion_galeria_votar(uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.votacion_galeria_votar(uuid, text, text) TO authenticated;

DO $wrp_mis$
BEGIN
  EXECUTE $ddl_mis$
CREATE OR REPLACE FUNCTION public.votacion_galeria_mis_votos(p_voter_uuid uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn_mis$
  SELECT coalesce(
    jsonb_agg(foto_id ORDER BY foto_id),
    '[]'::jsonb
  )
  FROM public.votacion_galeria_votos
  WHERE voter_uuid = p_voter_uuid
$fn_mis$;
$ddl_mis$;
END;
$wrp_mis$;

REVOKE ALL ON FUNCTION public.votacion_galeria_mis_votos(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.votacion_galeria_mis_votos(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.votacion_galeria_mis_votos(uuid) TO authenticated;

DO $wrp_cnt$
BEGIN
  EXECUTE $ddl_cnt$
CREATE OR REPLACE FUNCTION public.votacion_galeria_mi_cuenta(p_voter_uuid uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn_cnt$
  SELECT count(*)::int FROM public.votacion_galeria_votos WHERE voter_uuid = p_voter_uuid
$fn_cnt$;
$ddl_cnt$;
END;
$wrp_cnt$;

REVOKE ALL ON FUNCTION public.votacion_galeria_mi_cuenta(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.votacion_galeria_mi_cuenta(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.votacion_galeria_mi_cuenta(uuid) TO authenticated;
