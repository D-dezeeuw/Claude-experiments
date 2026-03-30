/**
 * TraderAI — Historical Price Data
 * Fetches and caches daily OHLCV candles per ticker.
 * Source: Alpha Vantage TIME_SERIES_DAILY (full 20yr history per call).
 * Falls back to Finnhub stock candles if Alpha Vantage is not configured.
 */

const History = {
  PREFIX: 'traderai-prices-',

  _key(symbol) {
    return this.PREFIX + symbol;
  },

  /** Load cached price history for a symbol */
  load(symbol) {
    try {
      const raw = localStorage.getItem(this._key(symbol));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  },

  /** Save price history for a symbol */
  save(symbol, data) {
    try {
      localStorage.setItem(this._key(symbol), JSON.stringify(data));
    } catch (e) {
      console.warn('History save failed for ' + symbol + ':', e);
    }
  },

  /** Check if history is stale (older than today) */
  isStale(symbol) {
    const data = this.load(symbol);
    if (!data || !data._fetched) return true;
    const today = new Date().toISOString().split('T')[0];
    return data._fetched < today;
  },

  /** Fetch daily candles from Alpha Vantage (full history, 1 API call) */
  async fetchAlphaVantage(symbol) {
    if (!CONFIG.ALPHA_VANTAGE_KEY) return null;
    try {
      const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${symbol}&outputsize=full&apikey=${CONFIG.ALPHA_VANTAGE_KEY}`;
      const res = await fetch(url);
      const json = await res.json();

      // Check for rate limit / error
      if (json['Note'] || json['Error Message'] || json['Information']) {
        console.warn('Alpha Vantage limit/error for ' + symbol + ':', json['Note'] || json['Error Message'] || json['Information']);
        return null;
      }

      const timeSeries = json['Time Series (Daily)'];
      if (!timeSeries) return null;

      const candles = Object.entries(timeSeries)
        .map(([date, d]) => ({
          date,
          open: parseFloat(d['1. open']),
          high: parseFloat(d['2. high']),
          low: parseFloat(d['3. low']),
          close: parseFloat(d['4. close']),
          volume: parseInt(d['5. volume'], 10),
        }))
        .sort((a, b) => a.date.localeCompare(b.date)); // oldest first

      return {
        symbol,
        source: 'alphavantage',
        _fetched: new Date().toISOString().split('T')[0],
        _timestamp: new Date().toISOString(),
        count: candles.length,
        candles,
      };
    } catch (e) {
      console.error('Alpha Vantage fetch failed for ' + symbol + ':', e);
      return null;
    }
  },

  /** Fetch daily candles from Finnhub (last 2 years, as fallback) */
  async fetchFinnhub(symbol) {
    if (!CONFIG.FINNHUB_API_KEY) return null;
    try {
      const now = Math.floor(Date.now() / 1000);
      const twoYearsAgo = now - (730 * 86400);
      const url = `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${twoYearsAgo}&to=${now}&token=${CONFIG.FINNHUB_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.s !== 'ok' || !json.c) return null;

      const candles = json.t.map((t, i) => ({
        date: new Date(t * 1000).toISOString().split('T')[0],
        open: json.o[i],
        high: json.h[i],
        low: json.l[i],
        close: json.c[i],
        volume: json.v[i],
      }));

      return {
        symbol,
        source: 'finnhub',
        _fetched: new Date().toISOString().split('T')[0],
        _timestamp: new Date().toISOString(),
        count: candles.length,
        candles,
      };
    } catch (e) {
      console.error('Finnhub candle fetch failed for ' + symbol + ':', e);
      return null;
    }
  },

  /**
   * Fetch and cache history for a symbol.
   * Uses Alpha Vantage first, Finnhub as fallback.
   * Skips if already cached today.
   */
  async fetch(symbol, force) {
    if (!force && !this.isStale(symbol)) {
      return this.load(symbol);
    }

    let data = await this.fetchAlphaVantage(symbol);
    if (!data) {
      data = await this.fetchFinnhub(symbol);
    }

    if (data) {
      this.save(symbol, data);
    }

    return data;
  },

  /**
   * Fetch history for all symbols in the watchlist.
   * Returns progress via callback for UI updates.
   */
  async fetchAll(symbols, onProgress) {
    const results = [];
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      if (onProgress) onProgress(symbol, i, symbols.length);

      const data = await this.fetch(symbol);
      results.push({ symbol, success: !!data, count: data?.count || 0 });

      // Rate limit: Alpha Vantage = 5 calls/min on free tier
      if (i < symbols.length - 1) {
        await new Promise(r => setTimeout(r, 13000)); // ~13s between calls
      }
    }
    return results;
  },

  /** Get the last N candles for a symbol (from cache) */
  getCandles(symbol, days) {
    const data = this.load(symbol);
    if (!data || !data.candles) return [];
    if (!days) return data.candles;
    return data.candles.slice(-days);
  },

  /** Calculate a simple moving average from cached data */
  calcSMA(symbol, period) {
    const candles = this.getCandles(symbol);
    if (candles.length < period) return null;
    const slice = candles.slice(-period);
    return slice.reduce((sum, c) => sum + c.close, 0) / period;
  },

  /** Calculate EMA from cached data */
  calcEMA(symbol, period) {
    const candles = this.getCandles(symbol);
    if (candles.length < period) return null;
    const closes = candles.map(c => c.close);
    const k = 2 / (period + 1);
    let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < closes.length; i++) {
      ema = closes[i] * k + ema * (1 - k);
    }
    return ema;
  },

  /** Calculate RSI from cached data */
  calcRSI(symbol, period) {
    period = period || 14;
    const candles = this.getCandles(symbol);
    if (candles.length < period + 1) return null;
    const closes = candles.map(c => c.close);
    let gains = 0, losses = 0;

    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  },

  /** Price change over N days */
  changeOverDays(symbol, days) {
    const candles = this.getCandles(symbol, days + 1);
    if (candles.length < 2) return null;
    const oldest = candles[0].close;
    const newest = candles[candles.length - 1].close;
    return {
      absolute: newest - oldest,
      percent: ((newest - oldest) / oldest) * 100,
      from: candles[0].date,
      to: candles[candles.length - 1].date,
    };
  },

  /** 52-week high/low from cached data */
  week52Range(symbol) {
    const candles = this.getCandles(symbol, 252);
    if (!candles.length) return null;
    let high = -Infinity, low = Infinity;
    for (const c of candles) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
    }
    const current = candles[candles.length - 1].close;
    return {
      high,
      low,
      current,
      percentFromHigh: ((current - high) / high) * 100,
      percentFromLow: ((current - low) / low) * 100,
    };
  },

  /** Generate SVG sparkline from last N days of closes */
  sparkline(symbol, days, width, height) {
    days = days || 30;
    width = width || 80;
    height = height || 24;
    const candles = this.getCandles(symbol, days);
    if (candles.length < 2) return '';

    const closes = candles.map(c => c.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min || 1;

    const points = closes.map((c, i) => {
      const x = (i / (closes.length - 1)) * width;
      const y = height - ((c - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const up = closes[closes.length - 1] >= closes[0];
    const color = up ? '#22c55e' : '#ef4444';

    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" class="inline-block align-middle">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  },

  /** List all symbols that have cached history */
  cachedSymbols() {
    const symbols = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(this.PREFIX)) {
        symbols.push(key.replace(this.PREFIX, ''));
      }
    }
    return symbols;
  },

  /** Clear all price history */
  clearAll() {
    for (const symbol of this.cachedSymbols()) {
      localStorage.removeItem(this._key(symbol));
    }
  },
};
