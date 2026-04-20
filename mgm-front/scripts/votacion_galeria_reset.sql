-- Reiniciar conteos de la galería (ejecutar en Supabase SQL Editor cuando quieras una nueva ronda).
TRUNCATE public.votacion_galeria_votos;
UPDATE public.votacion_galeria_fotos SET votos = 0;
