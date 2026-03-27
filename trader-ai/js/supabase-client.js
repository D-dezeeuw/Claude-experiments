/**
 * Supabase client initialization.
 * Requires config.js to be loaded first.
 */
let supabase = null;

function initSupabase() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    console.warn('Supabase not configured — running in offline mode');
    return null;
  }
  supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  return supabase;
}

/** Save stage results to Supabase */
async function saveStageResult(stage, data) {
  if (!supabase) return null;
  const { data: result, error } = await supabase
    .from('stage_results')
    .upsert({
      stage_id: stage,
      run_date: new Date().toISOString().split('T')[0],
      data: data,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'stage_id,run_date' })
    .select();
  if (error) console.error(`Save failed for ${stage}:`, error);
  return result;
}

/** Load latest stage results from Supabase */
async function loadStageResult(stage) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('stage_results')
    .select('*')
    .eq('stage_id', stage)
    .eq('run_date', new Date().toISOString().split('T')[0])
    .single();
  if (error) return null;
  return data;
}

/** Load the user's current watchlist */
async function loadWatchlist() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('watchlist')
    .select('*')
    .order('added_at', { ascending: false });
  if (error) return [];
  return data;
}

/** Save tickers to watchlist */
async function saveWatchlist(tickers) {
  if (!supabase) return;
  const rows = tickers.map(t => ({
    symbol: t.symbol,
    company: t.company,
    sector: t.sector || '',
    added_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from('watchlist')
    .upsert(rows, { onConflict: 'symbol' });
  if (error) console.error('Watchlist save failed:', error);
}
