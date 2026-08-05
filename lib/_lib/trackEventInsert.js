/**
 * Alta de eventos en track_events deduplicando por (rid, event_name).
 *
 * La tabla tiene un índice único sobre esa pareja, así que cada repetición normal de un visitante
 * (recargar la página, volver a abrir un panel) choca. Con ON CONFLICT DO NOTHING el choque deja de
 * ser un error y Postgres no lo escribe en el log.
 *
 * Requiere el índice no parcial track_events_rid_event_name_key
 * (migración 20260805120000_track_events_dedup_on_conflict.sql). Mientras no esté aplicada, Postgres
 * responde 42P10 y se cae al insert directo, que sigue funcionando aunque loguee.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {Record<string, unknown>} payload
 * @returns {Promise<'inserted'|'duplicate'>}
 */
export async function insertTrackEventDeduped(supabase, payload) {
  const { data, error } = await supabase
    .from('track_events')
    .upsert(payload, { onConflict: 'rid,event_name', ignoreDuplicates: true })
    .select('id');

  if (error?.code === '42P10') {
    const { error: fallbackError } = await supabase.from('track_events').insert(payload);
    if (!fallbackError) return 'inserted';
    if (fallbackError.code === '23505') return 'duplicate';
    throw fallbackError;
  }

  if (error) {
    if (error.code === '23505') return 'duplicate';
    throw error;
  }

  return Array.isArray(data) && data.length === 0 ? 'duplicate' : 'inserted';
}

export default insertTrackEventDeduped;
