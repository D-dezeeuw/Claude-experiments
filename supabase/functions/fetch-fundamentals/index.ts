// supabase/functions/fetch-fundamentals/index.ts
// Fetches per-stock: quotes, fundamentals, insider transactions,
// analyst recommendations, earnings estimates.
// Stores in `stock_data` table.

import {
  finnhub, today, createSupabaseClient, jsonResponse, corsHeaders,
  STOCK_UNIVERSE,
} from '../_shared/config.ts';

async function fetchStockData(symbol: string) {
  // Run all fetches for this stock in parallel
  const [quote, metrics, insider, recommendation, earnings] = await Promise.all([
    finnhub(`/quote?symbol=${symbol}`).catch(() => null),
    finnhub(`/stock/metric?symbol=${symbol}&metric=all`).catch(() => null),
    finnhub(`/stock/insider-transactions?symbol=${symbol}`).catch(() => null),
    finnhub(`/stock/recommendation?symbol=${symbol}`).catch(() => null),
    finnhub(`/stock/earnings?symbol=${symbol}&limit=8`).catch(() => null),
  ]);

  const m = metrics?.metric || {};

  return {
    symbol,
    // Quote
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

    // Insider transactions (last 10)
    insiderTransactions: (insider?.data || []).slice(0, 10).map((t: any) => ({
      name: t.name,
      share: t.share,
      change: t.change,
      transactionDate: t.transactionDate,
      transactionType: t.transactionCode,
      value: t.transactionPrice ? Math.round(t.change * t.transactionPrice) : null,
    })),

    // Analyst recommendations (last 4 months)
    analystRecommendations: (recommendation || []).slice(0, 4).map((r: any) => ({
      period: r.period,
      strongBuy: r.strongBuy,
      buy: r.buy,
      hold: r.hold,
      sell: r.sell,
      strongSell: r.strongSell,
    })),

    // Earnings history (last 8 quarters)
    earningsHistory: (earnings || []).slice(0, 8).map((e: any) => ({
      period: e.period,
      actual: e.actual,
      estimate: e.estimate,
      surprise: e.surprise,
      surprisePercent: e.surprisePercent,
    })),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const sb = await createSupabaseClient();
    const dateStr = today();

    // Fetch in batches of 5 to respect rate limits (60/min)
    const results: any[] = [];
    for (let i = 0; i < STOCK_UNIVERSE.length; i += 5) {
      const batch = STOCK_UNIVERSE.slice(i, i + 5);
      const batchResults = await Promise.all(
        batch.map(s => fetchStockData(s.symbol).catch(e => ({
          symbol: s.symbol, error: e.message,
        })))
      );
      results.push(...batchResults);

      // Rate limit pause between batches
      if (i + 5 < STOCK_UNIVERSE.length) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    // Merge with universe metadata
    const enriched = results.map(r => {
      const meta = STOCK_UNIVERSE.find(s => s.symbol === r.symbol);
      return { ...r, company: meta?.company, sector: meta?.sector };
    });

    // Upsert each stock into stock_data
    for (const stock of enriched) {
      await sb.from('stock_data').upsert({
        symbol: stock.symbol,
        run_date: dateStr,
        company: stock.company,
        sector: stock.sector,
        data: stock,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'symbol,run_date' });
    }

    return jsonResponse({ ok: true, stage: 'fundamentals', count: enriched.length });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
});
