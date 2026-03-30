// supabase/functions/fetch-market-data/index.ts
// Fetches: index quotes, sector ETFs, fear gauges, economic calendar.
// Stores results in `pipeline_data` table.

import {
  finnhub, today, createSupabaseClient, jsonResponse, corsHeaders,
  INDEX_ETFS, SECTOR_ETFS, FEAR_GAUGES,
} from '../_shared/config.ts';

async function fetchQuote(symbol: string) {
  const d = await finnhub(`/quote?symbol=${symbol}`);
  return {
    symbol,
    price: d.c,
    change: d.d,
    changePercent: d.dp,
    high: d.h,
    low: d.l,
    open: d.o,
    prevClose: d.pc,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const sb = await createSupabaseClient();

    // Fetch all quotes in parallel
    const [indices, sectors, fearGauges] = await Promise.all([
      Promise.all(INDEX_ETFS.map(s => fetchQuote(s).catch(() => null))),
      Promise.all(SECTOR_ETFS.map(e => fetchQuote(e.symbol).then(q => ({ ...e, ...q })).catch(() => null))),
      Promise.all(FEAR_GAUGES.map(g => fetchQuote(g.symbol).then(q => ({ ...g, ...q })).catch(() => null))),
    ]);

    // Economic calendar
    const dateStr = today();
    let events: any[] = [];
    try {
      const cal = await finnhub(`/calendar/economic?from=${dateStr}&to=${dateStr}`);
      events = (cal.economicCalendar || []).slice(0, 15).map((e: any) => ({
        time: e.time, event: e.event, impact: e.impact,
        actual: e.actual, estimate: e.estimate, prior: e.prior,
      }));
    } catch (_) {}

    const result = {
      indices: indices.filter(Boolean),
      sectors: sectors.filter(Boolean),
      fearGauges: fearGauges.filter(Boolean),
      events,
      fetchedAt: new Date().toISOString(),
    };

    // Save to pipeline_data
    await sb.from('pipeline_data').upsert({
      stage: 'market-pulse',
      run_date: dateStr,
      data: result,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'stage,run_date' });

    return jsonResponse({ ok: true, stage: 'market-pulse', ...result });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
});
