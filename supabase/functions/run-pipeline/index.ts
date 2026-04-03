// supabase/functions/run-pipeline/index.ts
// Orchestrator: calls all data functions in sequence/parallel.
// Can be triggered manually or via cron.

import {
  today, createSupabaseClient, jsonResponse, corsHeaders,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
} from '../_shared/config.ts';

// Both keys for function invocation — try anon first (known to work), fall back to service role
const AUTH_KEYS = [
  Deno.env.get('SUPABASE_ANON_KEY') || '',
  SUPABASE_SERVICE_KEY,
].filter(k => k.length > 0);

async function tryFetch(url: string, key: string, signal: AbortSignal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    signal,
  });
  const data = await res.json();
  // Detect actual HTTP errors (401, 403, 500) hidden inside JSON responses
  if (data.code === 401 || data.code === 403) {
    throw new Error(`Auth failed (${data.code}): ${data.message || 'rejected'}`);
  }
  return { data, ok: res.ok && data.ok !== false };
}

async function callFunction(name: string, timeoutMs = 55000) {
  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const start = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Try each key until one works
    let lastError = '';
    for (const key of AUTH_KEYS) {
      try {
        const { data, ok } = await tryFetch(url, key, controller.signal);
        clearTimeout(timer);
        return { name, ok, duration: Date.now() - start, data };
      } catch (e) {
        lastError = (e as Error).message;
        // If abort/timeout, don't try next key
        if ((e as Error).name === 'AbortError') throw e;
        // Auth error — try next key
      }
    }
    // All keys failed
    clearTimeout(timer);
    return { name, ok: false, duration: Date.now() - start, error: lastError || 'All auth keys rejected' };
  } catch (e) {
    clearTimeout(timer);
    const isTimeout = (e as Error).name === 'AbortError';
    return {
      name,
      ok: isTimeout,
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
