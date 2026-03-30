/**
 * Stage 4: Technical Analysis
 * Price action: support/resistance, moving averages, RSI, volume profile.
 */
const TechnicalAnalysis = {
  id: 'technical',
  name: 'Technical Analysis',
  description: 'MAs, RSI, MACD, support/resistance, volume profile',

  async run(ctx) {
    const watchlist = ctx.watchlist || [];
    if (!watchlist.length) return { error: 'No watchlist — run Stock Screener first', stocks: [] };

    const results = [];

    for (const stock of watchlist) {
      const technicals = await this.fetchTechnicals(stock.symbol);
      results.push({ ...stock, ...technicals });
    }

    ctx.technicals = results;
    return { stocks: results };
  },

  async fetchTechnicals(symbol) {
    // Use cached historical data (from Alpha Vantage via History module)
    const hist = typeof History !== 'undefined' ? History.load(symbol) : null;
    if (hist && hist.candles && hist.candles.length >= 50) {
      return this.calcFromHistory(hist);
    }

    // No cached history — try to fetch it now via Alpha Vantage
    if (typeof History !== 'undefined' && CONFIG.ALPHA_VANTAGE_KEY) {
      const freshHist = await History.fetch(symbol, false);
      if (freshHist && freshHist.candles && freshHist.candles.length >= 50) {
        return this.calcFromHistory(freshHist);
      }
    }

    // No history available — use mock with a note to fetch history
    console.warn(`No price history for ${symbol} — run "Fetch History" for real technicals`);
    return this.mockTechnicals(symbol);
  },

  /** Calculate all technicals from cached historical candle data */
  calcFromHistory(hist) {
    const candles = hist.candles;
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    const currentPrice = closes[closes.length - 1];
    const ma20 = this.calcMA(closes, 20);
    const ma50 = this.calcMA(closes, 50);
    const ma200 = closes.length >= 200 ? this.calcMA(closes, 200) : null;
    const avgVolume = this.calcMA(volumes, 20);
    const currentVolume = volumes[volumes.length - 1];

    // RSI (14-period)
    const rsi = this.calcRSI(closes, 14);

    // MACD (12 EMA - 26 EMA)
    const ema12 = this.calcEMA(closes, 12);
    const ema26 = this.calcEMA(closes, 26);
    const macd = ema12 - ema26;

    // Support/resistance from last 30 candles
    const recent30H = highs.slice(-30);
    const recent30L = lows.slice(-30);
    const resistance = Math.max(...recent30H);
    const support = Math.min(...recent30L);

    // Signal
    let signal = 'Neutral';
    if (currentPrice > ma50 && rsi < 70 && macd > 0) signal = 'Bullish';
    if (currentPrice < ma50 && rsi > 30 && macd < 0) signal = 'Bearish';
    if (rsi > 70) signal = 'Overbought';
    if (rsi < 30) signal = 'Oversold';

    // Trend data from history
    const chg7d = closes.length > 7 ? ((currentPrice - closes[closes.length - 8]) / closes[closes.length - 8] * 100) : null;
    const chg30d = closes.length > 30 ? ((currentPrice - closes[closes.length - 31]) / closes[closes.length - 31] * 100) : null;
    const chg90d = closes.length > 90 ? ((currentPrice - closes[closes.length - 91]) / closes[closes.length - 91] * 100) : null;

    return {
      rsi: rsi !== null ? +rsi.toFixed(1) : null,
      ma20: +ma20.toFixed(2),
      ma50: +ma50.toFixed(2),
      ma200: ma200 ? +ma200.toFixed(2) : null,
      macd: +macd.toFixed(2),
      support: +support.toFixed(2),
      resistance: +resistance.toFixed(2),
      volumeRatio: +(currentVolume / avgVolume).toFixed(2),
      signal,
      chg7d: chg7d !== null ? +chg7d.toFixed(2) : null,
      chg30d: chg30d !== null ? +chg30d.toFixed(2) : null,
      chg90d: chg90d !== null ? +chg90d.toFixed(2) : null,
      dataPoints: closes.length,
      fromHistory: true,
    };
  },

  /** Calculate RSI from an array of closes */
  calcRSI(closes, period) {
    if (closes.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
  },

  calcMA(arr, period) {
    if (arr.length < period) return arr.reduce((a, b) => a + b, 0) / arr.length;
    const slice = arr.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  },

  calcEMA(arr, period) {
    const k = 2 / (period + 1);
    let ema = arr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < arr.length; i++) {
      ema = arr[i] * k + ema * (1 - k);
    }
    return ema;
  },

  mockTechnicals(symbol) {
    const seed = symbol.charCodeAt(0) * 3 + symbol.charCodeAt(1);
    const price = 100 + seed % 200;
    const rsi = 30 + (seed % 40);
    let signal = 'Neutral';
    if (rsi < 35) signal = 'Oversold';
    else if (rsi > 65) signal = 'Overbought';
    else if (seed % 3 === 0) signal = 'Bullish';
    else if (seed % 3 === 1) signal = 'Bearish';

    return {
      rsi: +rsi.toFixed(1),
      ma20: +(price * 1.01).toFixed(2),
      ma50: +(price * 0.98).toFixed(2),
      ma200: +(price * 0.95).toFixed(2),
      macd: +((seed % 10) - 5).toFixed(2),
      support: +(price * 0.93).toFixed(2),
      resistance: +(price * 1.07).toFixed(2),
      volumeRatio: +(0.5 + (seed % 30) / 10).toFixed(2),
      signal,
      chg7d: +((seed % 10) - 5).toFixed(1),
      chg30d: +((seed % 20) - 10).toFixed(1),
      chg90d: +((seed % 40) - 20).toFixed(1),
      dataPoints: 90,
      fromHistory: false,
      mock: true,
    };
  },

  render(data) {
    if (data.error) return `<p class="text-yellow-500">${data.error}</p>`;

    let html = '<div class="overflow-x-auto"><table class="w-full text-sm">';
    html += '<thead><tr class="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">';
    html += '<th class="pb-2 pr-3">Symbol</th><th class="pb-2 pr-3 text-right">RSI</th><th class="pb-2 pr-3 text-right">MA20</th><th class="pb-2 pr-3 text-right">MA50</th><th class="pb-2 pr-3 text-right">MACD</th><th class="pb-2 pr-3 text-right">Support</th><th class="pb-2 pr-3 text-right">Resist.</th><th class="pb-2 pr-3 text-right">Vol Ratio</th><th class="pb-2">Signal</th></tr></thead><tbody>';

    for (const s of data.stocks) {
      const signalColors = {
        Bullish: 'bg-green-500/20 text-green-400',
        Bearish: 'bg-red-500/20 text-red-400',
        Overbought: 'bg-red-500/20 text-red-300',
        Oversold: 'bg-green-500/20 text-green-300',
        Neutral: 'bg-gray-500/20 text-gray-400',
      };
      const sc = signalColors[s.signal] || signalColors.Neutral;
      const rsiColor = s.rsi > 70 ? 'text-red-400' : s.rsi < 30 ? 'text-green-400' : '';
      const volColor = s.volumeRatio > 1.5 ? 'text-yellow-400 font-bold' : '';

      html += `<tr class="border-b border-gray-100 dark:border-gray-800/50">
        <td class="py-2 pr-3">${tickerLabel(s.symbol, 'font-bold')}</td>
        <td class="py-2 pr-3 text-right font-mono ${rsiColor}">${s.rsi ?? '-'}</td>
        <td class="py-2 pr-3 text-right font-mono">${s.ma20 ?? '-'}</td>
        <td class="py-2 pr-3 text-right font-mono">${s.ma50 ?? '-'}</td>
        <td class="py-2 pr-3 text-right font-mono">${s.macd ?? '-'}</td>
        <td class="py-2 pr-3 text-right font-mono">${s.support ?? '-'}</td>
        <td class="py-2 pr-3 text-right font-mono">${s.resistance ?? '-'}</td>
        <td class="py-2 pr-3 text-right font-mono ${volColor}">${s.volumeRatio ?? '-'}x</td>
        <td class="py-2"><span class="px-2 py-0.5 rounded-full text-xs font-semibold ${sc}">${s.signal}</span></td>
      </tr>`;
    }

    html += '</tbody></table></div>';
    if (data.stocks[0]?.mock) {
      html += '<p class="mt-4 text-xs text-yellow-500/70 italic">Demo data — add your Finnhub API key in config.js for live data</p>';
    }
    return html;
  },
};
