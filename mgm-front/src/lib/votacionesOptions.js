import foto1 from '../icons/Foto1.jpeg';
import foto2 from '../icons/Foto2.jpeg';
import foto3 from '../icons/Foto3.jpeg';
import foto4 from '../icons/Foto4.jpeg';
import foto5 from '../icons/Foto5.jpeg';
import foto6 from '../icons/Foto6.jpeg';

/** IDs = filas en `votacion_opciones` (script SQL). Imágenes: `src/icons/Foto1.jpeg` … `Foto6.jpeg`. */
export const VOTACION_OPCIONES = [
  {
    id: 'opt_a',
    titulo: 'Keycaps',
    imagen: foto1,
  },
  {
    id: 'opt_b',
    titulo: 'Gabinetes',
    imagen: foto2,
  },
  {
    id: 'opt_c',
    titulo: 'Mouse pad de silicona',
    imagen: foto3,
  },
  {
    id: 'opt_d',
    titulo: 'Mangas de poliéster',
    imagen: foto4,
  },
  {
    id: 'opt_e',
    titulo: 'Barra de luz para PC',
    imagen: foto5,
  },
];

/** Tarjeta UI; votos en `votacion_otros`. */
export const VOTACION_OTROS_CARD = {
  id: 'opt_otros_ui',
  titulo: 'Otros',
  imagen: foto6,
};

export const VOTACION_MAX_VOTOS = 3;

export const VOTACION_OTROS_MAX_CHARS = 40;

export const VOTACION_SESSION_KEY = 'mgm_votaciones_session_v2';
