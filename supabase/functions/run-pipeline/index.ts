// supabase/functions/run-pipeline/index.ts
// Orchestrator: calls all data functions in sequence.
// Can be triggered manually or via cron.

import {
  today, createSupabaseClient, jsonResponse, corsHeaders,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
} from '../_shared/config.ts';

// Use service role key if available, otherwise fall back to anon key
const AUTH_KEY = SUPABASE_SERVICE_KEY
  || Deno.env.get('SUPABASE_ANON_KEY')
  || '';

async function callFunction(name: string) {
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AUTH_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await res.json();
    const duration = Date.now() - start;
    return { name, ok: data.ok !== false, duration, data };
  } catch (e) {
    return { name, ok: false, duration: Date.now() - start, error: e.message };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const start = Date.now();
  const dateStr = today();
  const results: any[] = [];

  // Stage 1: Market data + News in parallel
  const [marketResult, newsResult] = await Promise.all([
    callFunction('fetch-market-data'),
    callFunction('fetch-news'),
  ]);
  results.push(marketResult, newsResult);

  // Stage 2: Fundamentals (needs rate limiting, runs alone)
  const fundResult = await callFunction('fetch-fundamentals');
  results.push(fundResult);

  // Stage 3: Analysis (needs news to be done first)
  const analysisResult = await callFunction('analyze');
  results.push(analysisResult);

  // Stage 4: History (only fetches stale data, can be slow)
  // This runs last since it's the least time-sensitive
  const historyResult = await callFunction('fetch-history');
  results.push(historyResult);

  const totalDuration = Date.now() - start;

  // Save pipeline run summary
  const sb = await createSupabaseClient();
  await sb.from('pipeline_data').upsert({
    stage: 'pipeline-run',
    run_date: dateStr,
    data: {
      results,
      totalDuration,
      completedAt: new Date().toISOString(),
      allOk: results.every(r => r.ok),
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'stage,run_date' });

  return jsonResponse({
    ok: results.every(r => r.ok),
    date: dateStr,
    totalDuration,
    stages: results.map(r => ({
      name: r.name,
      ok: r.ok,
      duration: r.duration,
      error: r.error,
    })),
  });
});
