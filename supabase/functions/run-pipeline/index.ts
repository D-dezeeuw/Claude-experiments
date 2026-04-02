// supabase/functions/run-pipeline/index.ts
// Orchestrator: calls all data functions in sequence/parallel.
// Can be triggered manually or via cron.

import {
  today, createSupabaseClient, jsonResponse, corsHeaders,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
} from '../_shared/config.ts';

// Use service role key if available, otherwise fall back to anon key
const AUTH_KEY = SUPABASE_SERVICE_KEY
  || Deno.env.get('SUPABASE_ANON_KEY')
  || '';

async function callFunction(name: string, timeoutMs = 55000) {
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const start = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AUTH_KEY}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json();
    const duration = Date.now() - start;
    return { name, ok: data.ok !== false, duration, data };
  } catch (e) {
    clearTimeout(timer);
    const isTimeout = e.name === 'AbortError';
    return {
      name,
      ok: isTimeout, // timeout is not a failure — function keeps running in background
      duration: Date.now() - start,
      note: isTimeout ? 'running in background (incremental writes active)' : undefined,
      error: isTimeout ? undefined : (e as Error).message,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const start = Date.now();
  const dateStr = today();
  const results: any[] = [];

  // Stage 1: Market data + News + Sector news in parallel (~5-15s)
  const [marketResult, newsResult, sectorNewsResult] = await Promise.all([
    callFunction('fetch-market-data'),
    callFunction('fetch-news'),
    callFunction('fetch-sector-news'),
  ]);
  results.push(marketResult, newsResult, sectorNewsResult);

  // Stage 2: Fire fetch-fundamentals (slow — writes incrementally, runs in background)
  //          and run analyze + fetch-history in parallel without waiting for fundamentals.
  //
  //          fetch-fundamentals is given 45s before we move on; it keeps writing
  //          stock_data rows in the background even after this orchestrator returns.
  const [fundResult, analysisResult, historyResult] = await Promise.all([
    callFunction('fetch-fundamentals', 45000),   // 45s timeout — continues in background
    callFunction('analyze'),                      // needs news_articles (from stage 1)
    callFunction('fetch-history'),               // independent of news/fundamentals
  ]);
  results.push(fundResult, analysisResult, historyResult);

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
      allOk: results.filter(r => !r.note).every(r => r.ok), // ignore background tasks
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'stage,run_date' });

  return jsonResponse({
    ok: results.filter(r => !r.note).every(r => r.ok),
    date: dateStr,
    totalDuration,
    stages: results.map(r => ({
      name: r.name,
      ok: r.ok,
      duration: r.duration,
      note: r.note,
      error: r.error,
    })),
  });
});
