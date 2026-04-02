// supabase/functions/fetch-fundamentals/index.ts
// Smart stock data pipeline:
//   1. Derives QUOTES from price_history candles (0 API calls)
//   2. Fetches FUNDAMENTALS only if stale (> 7 days old) (0-49 calls/week)
//   3. Writes to stock_data incrementally
//
// On a typical daily run: 0 Finnhub calls.
// On weekly refresh: ~49 calls spread over time.

import {
  finnhub, today, createSupabaseClient, jsonResponse, corsHeaders,
  STOCK_UNIVERSE,
} from '../_shared/config.ts';

const FUNDAMENTALS_STALE_DAYS = 7;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const sb = await createSupabaseClient();
    const dateStr = today();

    // ── 1. Load price history to derive quotes (0 API calls) ──
    const { data: historyRows } = await sb
      .from('price_history')
      .select('symbol, candles')
      .in('symbol', STOCK_UNIVERSE.map(s => s.symbol));

    const quoteMap = new Map<string, any>();
    for (const row of (historyRows || [])) {
      const candles = row.candles || [];
      if (candles.length < 2) continue;
      const latest = candles[candles.length - 1];
      const prev = candles[candles.length - 2];
      const price = latest.close;
      const prevClose = prev.close;
      const change = +(price - prevClose).toFixed(2);
      const changePercent = prevClose ? +((change / prevClose) * 100).toFixed(2) : 0;
      quoteMap.set(row.symbol, {
        price,
        change,
        changePercent,
        high: latest.high,
        low: latest.low,
        volume: latest.volume,
        prevClose,
      });
    }

    // ── 2. Check which stocks need fundamentals refresh ──
    const { data: existingStocks } = await sb
      .from('stock_data')
      .select('symbol, data, updated_at')
      .in('symbol', STOCK_UNIVERSE.map(s => s.symbol));

    const existingMap = new Map<string, any>();
    for (const row of (existingStocks || [])) {
      existingMap.set(row.symbol, row);
    }

    const now = Date.now();
    const staleMs = FUNDAMENTALS_STALE_DAYS * 24 * 60 * 60 * 1000;
    const needsRefresh: string[] = [];

    for (const stock of STOCK_UNIVERSE) {
      const existing = existingMap.get(stock.symbol);
      if (!existing?.data?.pe) {
        // No fundamental data at all → must fetch
        needsRefresh.push(stock.symbol);
      } else if (existing.updated_at) {
        const age = now - new Date(existing.updated_at).getTime();
        if (age > staleMs) needsRefresh.push(stock.symbol);
      }
    }

    // ── 3. Fetch fundamentals only for stale stocks ──
    // 1 Finnhub call per stock (metric endpoint has everything we need)
    // Batch 5, pause 5s → 60/min rate limit
    const freshMetrics = new Map<string, any>();
    let apiFetched = 0;

    for (let i = 0; i < needsRefresh.length; i += 5) {
      const batch = needsRefresh.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(async (symbol) => {
          try {
            const metrics = await finnhub(`/stock/metric?symbol=${symbol}&metric=all`);
            apiFetched++;
            return { symbol, metrics: metrics?.metric || {} };
          } catch (_) {
            return { symbol, metrics: {} };
          }
        })
      );
      for (const r of results) freshMetrics.set(r.symbol, r.metrics);

      if (i + 5 < needsRefresh.length) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    // ── 4. Merge quote + fundamentals and write to stock_data ──
    let saved = 0;

    for (const stock of STOCK_UNIVERSE) {
      const quote = quoteMap.get(stock.symbol);
      const existing = existingMap.get(stock.symbol);
      const fresh = freshMetrics.get(stock.symbol);

      // Use fresh metrics if fetched, otherwise keep existing
      const m = fresh || existing?.data || {};

      const data: any = {
        symbol: stock.symbol,
        // Quote (from price_history — fresh daily)
        price: quote?.price ?? existing?.data?.price ?? null,
        change: quote?.change ?? existing?.data?.change ?? null,
        changePercent: quote?.changePercent ?? existing?.data?.changePercent ?? null,
        high: quote?.high ?? null,
        low: quote?.low ?? null,
        volume: quote?.volume ?? null,
        prevClose: quote?.prevClose ?? null,

        // Fundamentals (from cache or fresh Finnhub fetch)
        pe: fresh?.peNormalizedAnnual || fresh?.peTTM || existing?.data?.pe || null,
        marketCap: fresh?.marketCapitalization || existing?.data?.marketCap || null,
        revenueGrowth: fresh?.revenueGrowthQuarterlyYoy || existing?.data?.revenueGrowth || null,
        grossMargin: fresh?.grossMarginTTM || existing?.data?.grossMargin || null,
        operatingMargin: fresh?.operatingMarginTTM || existing?.data?.operatingMargin || null,
        debtToEquity: fresh?.totalDebtToEquityQuarterly || existing?.data?.debtToEquity || null,
        roe: fresh?.roeTTM || existing?.data?.roe || null,
        dividendYield: fresh?.dividendYieldIndicatedAnnual || existing?.data?.dividendYield || null,
        beta: fresh?.beta || existing?.data?.beta || null,
        wk52High: fresh?.['52WeekHigh'] || existing?.data?.wk52High || null,
        wk52Low: fresh?.['52WeekLow'] || existing?.data?.wk52Low || null,

        // Enrichment (preserved from previous fetches if available)
        insiderTransactions: existing?.data?.insiderTransactions || [],
        analystRecommendations: existing?.data?.analystRecommendations || [],
        earningsHistory: existing?.data?.earningsHistory || [],
      };

      // Only write if we have at least a price (from history or previous data)
      if (data.price == null) continue;

      const { error } = await sb.from('stock_data').upsert({
        symbol: stock.symbol,
        run_date: dateStr,
        company: stock.company,
        sector: stock.sector,
        data,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'symbol,run_date' });

      if (!error) saved++;
    }

    return jsonResponse({
      ok: true,
      stage: 'fundamentals',
      saved,
      total: STOCK_UNIVERSE.length,
      quotesFromHistory: quoteMap.size,
      fundamentalsRefreshed: apiFetched,
      staleCount: needsRefresh.length,
    });
  } catch (e) {
    return jsonResponse({ error: (e as Error).message }, 500);
  }
});
