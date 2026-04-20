-- Nombre legible por participante (opcional). Los votos siguen atados a `id` = foto_N;
-- la app no envía este campo: es solo para que en el panel SQL/export veas el handle.

ALTER TABLE public.votacion_galeria_fotos
ADD COLUMN IF NOT EXISTS participante text;

COMMENT ON COLUMN public.votacion_galeria_fotos.participante IS
  'Handle o nombre (mismo criterio que el archivo N.handle.ext). Opcional; votos usan id foto_N.';

-- Ejemplo: repetí el patrón para cada uno que quieras etiquetar en el dashboard.
-- UPDATE public.votacion_galeria_fotos SET participante = 'romanborque' WHERE id = 'foto_1';
-- UPDATE public.votacion_galeria_fotos SET participante = 'elbuendmitry' WHERE id = 'foto_2';
