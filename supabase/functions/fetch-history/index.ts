// supabase/functions/fetch-history/index.ts
// Fetches daily OHLCV candles via Twelve Data (800/day).
// Stores in `price_history` table.
// Only fetches if data is stale (not updated today).
// Processes max 5 stocks per run to stay within edge function limits.

import {
  twelveData, today, createSupabaseClient, jsonResponse, corsHeaders,
  STOCK_UNIVERSE, TWELVE_DATA_KEY, ALPHA_VANTAGE_KEY,
} from '../_shared/config.ts';

const MAX_PER_RUN = 5;   // max stocks to fetch per invocation (avoid timeout)
const PAUSE_MS = 8000;   // rate limit pause between API calls

async function fetchCandles(symbol: string): Promise<any | null> {
  // Try Twelve Data first — only fetch 250 candles (1 year, enough for MA200)
  if (TWELVE_DATA_KEY) {
    try {
      const data = await twelveData(`/time_series?symbol=${symbol}&interval=1day&outputsize=250`);
      if (data.status !== 'error' && data.values) {
        const candles = data.values
          .map((d: any) => ({
            date: d.datetime,
            open: parseFloat(d.open),
            high: parseFloat(d.high),
            low: parseFloat(d.low),
            close: parseFloat(d.close),
            volume: parseInt(d.volume, 10),
          }))
          .reverse();
        return { source: 'twelvedata', candles };
      }
    } catch (_) {}
  }

  // Fallback to Alpha Vantage (compact = last 100 days, saves memory)
  if (ALPHA_VANTAGE_KEY) {
    try {
      const res = await fetch(
        `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=compact&apikey=${ALPHA_VANTAGE_KEY}`
      );
      const json = await res.json();
      const ts = json['Time Series (Daily)'];
      if (ts) {
        const candles = Object.entries(ts)
          .map(([date, d]: [string, any]) => ({
            date,
            open: parseFloat(d['1. open']),
            high: parseFloat(d['2. high']),
            low: parseFloat(d['3. low']),
            close: parseFloat(d['4. close']),
            volume: parseInt(d['5. volume'], 10),
          }))
          .sort((a, b) => a.date.localeCompare(b.date));
        return { source: 'alphavantage', candles };
      }
    } catch (_) {}
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const sb = await createSupabaseClient();
    const dateStr = today();

    // Check which symbols need updating
    const { data: existing } = await sb
      .from('price_history')
      .select('symbol, last_date')
      .in('symbol', STOCK_UNIVERSE.map(s => s.symbol));

    const existingMap = new Map((existing || []).map(r => [r.symbol, r.last_date]));

    const needsUpdate = STOCK_UNIVERSE.filter(s => {
      const lastDate = existingMap.get(s.symbol);
      return !lastDate || lastDate < dateStr;
    });

    // Process max N stocks per run to avoid timeout/memory limits
    const batch = needsUpdate.slice(0, MAX_PER_RUN);
    let fetched = 0;
    const errors: string[] = [];

    for (let i = 0; i < batch.length; i++) {
      const stock = batch[i];
      try {
        const result = await fetchCandles(stock.symbol);
        if (result) {
          await sb.from('price_history').upsert({
            symbol: stock.symbol,
            source: result.source,
            candle_count: result.candles.length,
            first_date: result.candles[0]?.date || null,
            last_date: result.candles[result.candles.length - 1]?.date || null,
            candles: result.candles,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'symbol' });
          fetched++;
        }
      } catch (e) {
        errors.push(`${stock.symbol}: ${(e as Error).message}`);
      }

      // Rate limit pause (skip after last stock)
      if (i < batch.length - 1) {
        await new Promise(r => setTimeout(r, PAUSE_MS));
      }
    }

    return jsonResponse({
      ok: true,
      stage: 'history',
      total: STOCK_UNIVERSE.length,
      alreadyCurrent: STOCK_UNIVERSE.length - needsUpdate.length,
      needsUpdate: needsUpdate.length,
      fetchedThisRun: fetched,
      remaining: needsUpdate.length - batch.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e) {
    return jsonResponse({ ok: false, error: (e as Error).message }, 500);
  }
});
