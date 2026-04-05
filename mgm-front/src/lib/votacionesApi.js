import { supa } from './supa.js';

/**
 * @returns {Promise<{ presets: Record<string, number>, otros: { texto: string, votos: number }[] }>}
 */
export async function fetchVotacionCounts() {
  if (!supa) return { presets: {}, otros: [] };

  const [r1, r2] = await Promise.all([
    supa.from('votacion_opciones').select('id, votos'),
    supa.from('votacion_otros').select('texto, votos'),
  ]);

  if (r1.error) throw r1.error;
  if (r2.error) throw r2.error;

  const presets = {};
  for (const row of r1.data || []) {
    presets[row.id] = Number(row.votos) || 0;
  }
  const otros = (r2.data || []).map((row) => ({
    texto: String(row.texto || ''),
    votos: Number(row.votos) || 0,
  }));
  return { presets, otros };
}

/**
 * @param {string} optionId
 * @returns {Promise<number>} nuevo total
 */
export async function incrementVoto(optionId) {
  if (!supa) {
    throw new Error('supabase_not_configured');
  }

  const { data, error } = await supa.rpc('increment_voto', {
    p_opcion_id: optionId,
  });

  if (error) throw error;
  const n = Number(data);
  if (!Number.isFinite(n)) {
    throw new Error('rpc_invalid_response');
  }
  return n;
}

/**
 * @param {string} texto — 1–40 caracteres tras trim
 * @returns {Promise<number>} nuevo total para ese texto
 */
export async function incrementOtro(texto) {
  if (!supa) {
    throw new Error('supabase_not_configured');
  }

  const { data, error } = await supa.rpc('increment_otro', {
    p_texto: texto,
  });

  if (error) throw error;
  const n = Number(data);
  if (!Number.isFinite(n)) {
    throw new Error('rpc_invalid_response');
  }
  return n;
}
