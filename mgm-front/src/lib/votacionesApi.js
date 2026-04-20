import { supa } from './supa.js';

/**
 * @returns {Promise<{ id: string, votos: number, sort_order: number }[]>}
 */
export async function fetchGaleriaCounts() {
  if (!supa) return [];

  const { data, error } = await supa
    .from('votacion_galeria_fotos')
    .select('id, votos, sort_order')
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return (data || []).map((row) => ({
    id: String(row.id),
    votos: Number(row.votos) || 0,
    sort_order: Number(row.sort_order) || 0,
  }));
}

/**
 * @param {string} voterUuid
 * @returns {Promise<number>}
 */
export async function fetchGaleriaMiCuenta(voterUuid) {
  if (!supa) return 0;

  const { data, error } = await supa.rpc('votacion_galeria_mi_cuenta', {
    p_voter_uuid: voterUuid,
  });

  if (error) throw error;
  return Number(data) || 0;
}

/**
 * @param {string} voterUuid
 * @returns {Promise<string[]>}
 */
export async function fetchGaleriaMisFotos(voterUuid) {
  if (!supa) return [];

  const { data, error } = await supa.rpc('votacion_galeria_mis_votos', {
    p_voter_uuid: voterUuid,
  });

  if (error) throw error;
  if (data == null) return [];
  if (Array.isArray(data)) return data.map((x) => String(x));
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * @param {string} voterUuid
 * @param {string} fotoId
 * @param {string} ipHashHex — puede ser '' si no se pudo obtener IP
 * @returns {Promise<{ votos: number, mis_votos: number }>}
 */
export async function votarGaleriaFoto(voterUuid, fotoId, ipHashHex) {
  if (!supa) {
    throw new Error('supabase_not_configured');
  }

  const { data, error } = await supa.rpc('votacion_galeria_votar', {
    p_voter_uuid: voterUuid,
    p_foto_id: fotoId,
    p_ip_hash: ipHashHex || null,
  });

  if (error) throw error;
  let o = data;
  if (typeof o === 'string') {
    try {
      o = JSON.parse(o);
    } catch {
      o = {};
    }
  }
  if (!o || typeof o !== 'object') o = {};
  return {
    votos: Number(o.votos) || 0,
    mis_votos: Number(o.mis_votos) || 0,
  };
}
