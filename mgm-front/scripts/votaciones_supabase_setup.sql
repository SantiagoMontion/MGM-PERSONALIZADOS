-- Ejecutar en Supabase SQL Editor (una vez).
-- Cuenta votos por opción; los títulos e imágenes viven en el front (VOTACION_OPCIONES).

CREATE TABLE IF NOT EXISTS public.votacion_opciones (
  id text PRIMARY KEY,
  votos bigint NOT NULL DEFAULT 0 CHECK (votos >= 0)
);

INSERT INTO public.votacion_opciones (id, votos) VALUES
  ('opt_a', 0),
  ('opt_b', 0),
  ('opt_c', 0),
  ('opt_d', 0),
  ('opt_e', 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.votacion_opciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "votacion_opciones_select" ON public.votacion_opciones;
CREATE POLICY "votacion_opciones_select"
  ON public.votacion_opciones FOR SELECT
  USING (true);

-- Sin políticas de INSERT/UPDATE/DELETE: el anon solo lee la tabla.

CREATE OR REPLACE FUNCTION public.increment_voto(p_opcion_id text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_total bigint;
BEGIN
  UPDATE public.votacion_opciones
  SET votos = votos + 1
  WHERE id = p_opcion_id
  RETURNING votos INTO new_total;

  IF new_total IS NULL THEN
    RAISE EXCEPTION 'invalid_option';
  END IF;

  RETURN new_total;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_voto(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_voto(text) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_voto(text) TO authenticated;

-- Votos libres "Otros" (texto del cliente, máx. 40 caracteres)
CREATE TABLE IF NOT EXISTS public.votacion_otros (
  texto text PRIMARY KEY CHECK (char_length(texto) >= 1 AND char_length(texto) <= 40),
  votos bigint NOT NULL DEFAULT 0 CHECK (votos >= 0)
);

ALTER TABLE public.votacion_otros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "votacion_otros_select" ON public.votacion_otros;
CREATE POLICY "votacion_otros_select"
  ON public.votacion_otros FOR SELECT
  USING (true);

CREATE OR REPLACE FUNCTION public.increment_otro(p_texto text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t text;
  new_total bigint;
BEGIN
  t := trim(p_texto);
  IF t IS NULL OR length(t) < 1 OR length(t) > 40 THEN
    RAISE EXCEPTION 'invalid_text';
  END IF;

  INSERT INTO public.votacion_otros (texto, votos)
  VALUES (t, 1)
  ON CONFLICT (texto)
  DO UPDATE SET votos = public.votacion_otros.votos + 1
  RETURNING votos INTO new_total;

  RETURN new_total;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_otro(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_otro(text) TO anon;
GRANT EXECUTE ON FUNCTION public.increment_otro(text) TO authenticated;

-- Migración desde máx. 50 → 40 (solo si votacion_otros ya existía):
-- ALTER TABLE public.votacion_otros DROP CONSTRAINT IF EXISTS votacion_otros_texto_check;
-- ALTER TABLE public.votacion_otros ADD CONSTRAINT votacion_otros_texto_check
--   CHECK (char_length(texto) >= 1 AND char_length(texto) <= 40);
-- Luego volver a ejecutar el bloque CREATE OR REPLACE FUNCTION increment_otro de arriba.
