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

  /** Fetch daily candles from Twelve Data (800 calls/day, 8/min) */
  async fetchTwelveData(symbol) {
    if (!CONFIG.TWELVE_DATA_KEY) return null;
    try {
      const url = `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=1day&outputsize=5000&apikey=${CONFIG.TWELVE_DATA_KEY}`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.status === 'error' || !json.values) {
        console.warn('Twelve Data error for ' + symbol + ':', json.message || json.status);
        return null;
      }

      const candles = json.values
        .map(d => ({
          date: d.datetime,
          open: parseFloat(d.open),
          high: parseFloat(d.high),
          low: parseFloat(d.low),
          close: parseFloat(d.close),
          volume: parseInt(d.volume, 10),
        }))
        .reverse(); // Twelve Data returns newest first, we want oldest first

      return {
        symbol,
        source: 'twelvedata',
        _fetched: new Date().toISOString().split('T')[0],
        _timestamp: new Date().toISOString(),
        count: candles.length,
        candles,
      };
    } catch (e) {
      console.error('Twelve Data fetch failed for ' + symbol + ':', e);
      return null;
    }
  },

  /**
   * Fetch and cache history for a symbol.
   * Tries Twelve Data first (800/day), Alpha Vantage as fallback (25/day).
   * Skips if already cached today.
   */
  async fetch(symbol, force) {
    if (!force && !this.isStale(symbol)) {
      return this.load(symbol);
    }

    let data = await this.fetchTwelveData(symbol);
    if (!data) {
      data = await this.fetchAlphaVantage(symbol);
    }

    if (data) {
      this.save(symbol, data);
      // Auto-backup this symbol to Supabase
      this.backupSymbolToSupabase(symbol, data);
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
        // Twelve Data: 8 calls/min → 8s between calls
        // Alpha Vantage: 5 calls/min → 13s between calls
        const delay = CONFIG.TWELVE_DATA_KEY ? 8000 : 13000;
        await new Promise(r => setTimeout(r, delay));
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

  // ── Persistence: Supabase + flat file backup ──

  /**
   * Save all cached history to Supabase (price_history table).
   * Stores one row per symbol with full candle array as JSONB.
   */
  /** Backup a single symbol to Supabase (called automatically on fetch) */
  async backupSymbolToSupabase(symbol, data) {
    if (!sbClient || !data || !data.candles) return;
    try {
      const { error } = await sbClient
        .from('price_history')
        .upsert({
          symbol,
          source: data.source || 'unknown',
          candle_count: data.count,
          first_date: data.candles[0]?.date || null,
          last_date: data.candles[data.candles.length - 1]?.date || null,
          candles: data.candles,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'symbol' });
      if (error) {
        console.error('Supabase auto-backup failed for ' + symbol + ':', error);
      } else {
        console.info('Auto-backed up ' + symbol + ' to Supabase (' + data.count + ' candles)');
      }
    } catch (e) {
      // Silent fail — localStorage is the primary store
    }
  },

  /** Backup all cached symbols to Supabase */
  async backupToSupabase() {
    if (!sbClient) return { saved: 0, error: 'Supabase not connected' };
    const symbols = this.cachedSymbols();
    let saved = 0;
    for (const symbol of symbols) {
      const data = this.load(symbol);
      if (!data) continue;
      const { error } = await sbClient
        .from('price_history')
        .upsert({
          symbol,
          source: data.source || 'unknown',
          candle_count: data.count,
          first_date: data.candles[0]?.date || null,
          last_date: data.candles[data.candles.length - 1]?.date || null,
          candles: data.candles,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'symbol' });
      if (error) {
        console.error('Supabase backup failed for ' + symbol + ':', error);
      } else {
        saved++;
      }
    }
    console.info('Backed up ' + saved + '/' + symbols.length + ' stocks to Supabase');
    return { saved, total: symbols.length };
  },

  /**
   * Restore history from Supabase into localStorage.
   * Useful when localStorage was cleared or on a new device.
   */
  async restoreFromSupabase() {
    if (!sbClient) return { restored: 0, error: 'Supabase not connected' };
    const { data, error } = await sbClient
      .from('price_history')
      .select('*');
    if (error) {
      console.error('Supabase restore failed:', error);
      return { restored: 0, error: error.message };
    }
    let restored = 0;
    for (const row of (data || [])) {
      const entry = {
        symbol: row.symbol,
        source: row.source,
        _fetched: row.last_date,
        _timestamp: row.updated_at,
        count: row.candle_count,
        candles: row.candles,
      };
      this.save(row.symbol, entry);
      restored++;
    }
    console.info('Restored ' + restored + ' stocks from Supabase');
    return { restored };
  },

  /**
   * Download all cached history as a single JSON flat file.
   * File contains all symbols with their full candle arrays.
   */
  exportFile() {
    const symbols = this.cachedSymbols();
    if (!symbols.length) return alert('No historical data to export');

    const payload = {
      _exported: new Date().toISOString(),
      _type: 'traderai-price-history',
      stocks: {},
    };

    for (const symbol of symbols) {
      payload.stocks[symbol] = this.load(symbol);
    }

    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'traderai-price-history-' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  /**
   * Import history from a previously exported JSON file.
   * Merges into localStorage (does not overwrite newer data).
   */
  importFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (data._type !== 'traderai-price-history' || !data.stocks) {
            throw new Error('Not a valid price history file');
          }
          let imported = 0;
          for (const [symbol, entry] of Object.entries(data.stocks)) {
            if (!entry || !entry.candles) continue;
            // Only import if we don't have it or ours is older
            const existing = this.load(symbol);
            if (!existing || (existing.count || 0) < (entry.count || 0)) {
              this.save(symbol, entry);
              imported++;
            }
          }
          alert('Imported ' + imported + ' stock(s) of price history');
          if (typeof App !== 'undefined') App.renderHistoryPanel();
        } catch (err) {
          alert('Import failed: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  },
};
