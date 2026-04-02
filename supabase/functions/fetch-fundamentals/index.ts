// supabase/functions/fetch-fundamentals/index.ts
// Fetches per-stock: quotes and fundamental metrics.
// Stores in `stock_data` table incrementally (writes after each batch).
// Rate-limited to ~60 Finnhub calls/minute (free tier).

import {
  finnhub, today, createSupabaseClient, jsonResponse, corsHeaders,
  STOCK_UNIVERSE,
} from '../_shared/config.ts';

async function fetchStockData(symbol: string) {
  // 2 parallel calls per stock: quote + metrics
  const [quote, metrics] = await Promise.all([
    finnhub(`/quote?symbol=${symbol}`).catch(() => null),
    finnhub(`/stock/metric?symbol=${symbol}&metric=all`).catch(() => null),
  ]);

  const m = metrics?.metric || {};

  return {
    symbol,
    // Quote (live)
    price: quote?.c || null,
    change: quote?.d || null,
    changePercent: quote?.dp || null,
    high: quote?.h || null,
    low: quote?.l || null,

    // Fundamentals
    pe: m.peNormalizedAnnual || m.peTTM || null,
    marketCap: m.marketCapitalization || null,
    revenueGrowth: m.revenueGrowthQuarterlyYoy || null,
    grossMargin: m.grossMarginTTM || null,
    operatingMargin: m.operatingMarginTTM || null,
    debtToEquity: m.totalDebtToEquityQuarterly || null,
    roe: m.roeTTM || null,
    dividendYield: m.dividendYieldIndicatedAnnual || null,
    beta: m.beta || null,
    wk52High: m['52WeekHigh'] || null,
    wk52Low: m['52WeekLow'] || null,

    // Enrichment data not fetched in this run (fetched by separate enrichment pass)
    insiderTransactions: [],
    analystRecommendations: [],
    earningsHistory: [],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const sb = await createSupabaseClient();
    const dateStr = today();

    // Batch 3 stocks × 2 calls = 6 calls, then pause 6s → ≈60 calls/min
    // Write to stock_data after every batch so partial results are saved on timeout.
    const BATCH_SIZE = 3;
    const PAUSE_MS = 6000;

    let saved = 0;
    let failed = 0;

    for (let i = 0; i < STOCK_UNIVERSE.length; i += BATCH_SIZE) {
      const batch = STOCK_UNIVERSE.slice(i, i + BATCH_SIZE);

      const batchData = await Promise.all(
        batch.map(s =>
          fetchStockData(s.symbol).catch(e => ({
            symbol: s.symbol,
            error: e.message,
            price: null, change: null, changePercent: null,
            insiderTransactions: [], analystRecommendations: [], earningsHistory: [],
          }))
        )
      );

      // Upsert this batch immediately — ensures data is saved even if we timeout later
      for (const stock of batchData) {
        const meta = STOCK_UNIVERSE.find(s => s.symbol === stock.symbol);
        const { error } = await sb.from('stock_data').upsert({
          symbol: stock.symbol,
          run_date: dateStr,
          company: meta?.company,
          sector: meta?.sector,
          data: stock,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'symbol,run_date' });

        if (error) failed++;
        else saved++;
      }

      // Pause between batches to respect Finnhub rate limit
      if (i + BATCH_SIZE < STOCK_UNIVERSE.length) {
        await new Promise(r => setTimeout(r, PAUSE_MS));
      }
    }

    return jsonResponse({
      ok: true,
      stage: 'fundamentals',
      saved,
      failed,
      total: STOCK_UNIVERSE.length,
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
});
