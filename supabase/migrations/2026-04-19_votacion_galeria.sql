-- Galería de votación (~30 fotos): 1 voto por foto por usuario, máx. 5 fotos por usuario.
-- Refuerzo: hash de IP por foto (misma IP no puede votar dos veces la misma foto aunque cambie el navegador).
-- Ejecutar en Supabase SQL Editor o vía migración.

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

-- Sin SELECT directo sobre votos individuales (solo RPC).

INSERT INTO public.votacion_galeria_fotos (id, sort_order, votos)
SELECT v.id, v.n, 0
FROM (
  VALUES
    ('foto_1', 1), ('foto_2', 2), ('foto_3', 3), ('foto_4', 4), ('foto_5', 5),
    ('foto_6', 6), ('foto_7', 7), ('foto_8', 8), ('foto_9', 9), ('foto_10', 10),
    ('foto_11', 11), ('foto_12', 12), ('foto_13', 13), ('foto_14', 14), ('foto_15', 15),
    ('foto_16', 16), ('foto_17', 17), ('foto_18', 18), ('foto_19', 19), ('foto_20', 20),
    ('foto_21', 21), ('foto_22', 22), ('foto_23', 23), ('foto_24', 24), ('foto_25', 25),
    ('foto_26', 26), ('foto_27', 27), ('foto_28', 28), ('foto_29', 29), ('foto_30', 30)
) AS v(id, n)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.votacion_galeria_votar(
  p_voter_uuid uuid,
  p_foto_id text,
  p_ip_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
  v_new_total bigint;
  v_ip text;
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

  SELECT count(*)::int INTO v_count FROM public.votacion_galeria_votos WHERE voter_uuid = p_voter_uuid;
  IF v_count >= 5 THEN
    RAISE EXCEPTION 'max_votos';
  END IF;

  v_ip := nullif(btrim(coalesce(p_ip_hash, '')), '');

  IF v_ip IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.votacion_galeria_votos
      WHERE foto_id = p_foto_id AND ip_hash IS NOT NULL AND ip_hash = v_ip
    ) THEN
      RAISE EXCEPTION 'ip_ya_voto';
    END IF;
  END IF;

  INSERT INTO public.votacion_galeria_votos (voter_uuid, foto_id, ip_hash)
  VALUES (p_voter_uuid, p_foto_id, v_ip);

  UPDATE public.votacion_galeria_fotos
  SET votos = votos + 1
  WHERE id = p_foto_id
  RETURNING votos INTO v_new_total;

  RETURN jsonb_build_object(
    'votos', v_new_total,
    'mis_votos', v_count + 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.votacion_galeria_votar(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.votacion_galeria_votar(uuid, text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.votacion_galeria_votar(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.votacion_galeria_mis_votos(p_voter_uuid uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    jsonb_agg(foto_id ORDER BY foto_id),
    '[]'::jsonb
  )
  FROM public.votacion_galeria_votos
  WHERE voter_uuid = p_voter_uuid;
$$;

REVOKE ALL ON FUNCTION public.votacion_galeria_mis_votos(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.votacion_galeria_mis_votos(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.votacion_galeria_mis_votos(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.votacion_galeria_mi_cuenta(p_voter_uuid uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int FROM public.votacion_galeria_votos WHERE voter_uuid = p_voter_uuid;
$$;

REVOKE ALL ON FUNCTION public.votacion_galeria_mi_cuenta(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.votacion_galeria_mi_cuenta(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.votacion_galeria_mi_cuenta(uuid) TO authenticated;

-- Opcional: reiniciar la votación anterior (productos sugeridos / otros).
-- UPDATE public.votacion_opciones SET votos = 0;
-- TRUNCATE public.votacion_otros;
