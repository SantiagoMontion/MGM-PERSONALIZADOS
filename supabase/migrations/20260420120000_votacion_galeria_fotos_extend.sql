-- Ampliar slots de la galería (foto_31 … foto_200) para poder sumar más imágenes sin tocar el front.
-- Los ids siguen siendo foto_<n> donde <n> es el número del nombre de archivo (ej. 31.foo.jpg → foto_31).

INSERT INTO public.votacion_galeria_fotos (id, sort_order, votos)
SELECT 'foto_' || n, n, 0
FROM generate_series(31, 200) AS n
ON CONFLICT (id) DO NOTHING;
