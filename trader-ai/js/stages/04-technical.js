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
    if (!CONFIG.FINNHUB_API_KEY) return this.mockTechnicals(symbol);
    try {
      const now = Math.floor(Date.now() / 1000);
      const monthAgo = now - 30 * 86400;
      const res = await fetch(
        `https://finnhub.io/api/v1/indicator?symbol=${symbol}&resolution=D&from=${monthAgo}&to=${now}&indicator=rsi&timeperiod=14&token=${CONFIG.FINNHUB_API_KEY}`
      );
      const d = await res.json();
      const rsi = d.rsi ? d.rsi[d.rsi.length - 1] : null;

      // Fetch candles for MA calculations
      const candleRes = await fetch(
        `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${now - 200 * 86400}&to=${now}&token=${CONFIG.FINNHUB_API_KEY}`
      );
      const candles = await candleRes.json();

      if (candles.s !== 'ok') return this.mockTechnicals(symbol);

      const closes = candles.c;
      const volumes = candles.v;
      const ma20 = this.calcMA(closes, 20);
      const ma50 = this.calcMA(closes, 50);
      const ma200 = this.calcMA(closes, 200);
      const currentPrice = closes[closes.length - 1];
      const avgVolume = this.calcMA(volumes, 20);
      const currentVolume = volumes[volumes.length - 1];

      // Simple support/resistance from recent highs/lows
      const recent30 = candles.h.slice(-30);
      const recent30Low = candles.l.slice(-30);
      const resistance = Math.max(...recent30);
      const support = Math.min(...recent30Low);

      // MACD simplified (12 EMA - 26 EMA)
      const ema12 = this.calcEMA(closes, 12);
      const ema26 = this.calcEMA(closes, 26);
      const macd = ema12 - ema26;

      // Signal
      let signal = 'Neutral';
      if (currentPrice > ma50 && rsi < 70 && macd > 0) signal = 'Bullish';
      if (currentPrice < ma50 && rsi > 30 && macd < 0) signal = 'Bearish';
      if (rsi > 70) signal = 'Overbought';
      if (rsi < 30) signal = 'Oversold';

      return {
        rsi: +rsi?.toFixed(1),
        ma20: +ma20.toFixed(2),
        ma50: +ma50.toFixed(2),
        ma200: ma200 ? +ma200.toFixed(2) : null,
        macd: +macd.toFixed(2),
        support: +support.toFixed(2),
        resistance: +resistance.toFixed(2),
        volumeRatio: +(currentVolume / avgVolume).toFixed(2),
        signal,
      };
    } catch (e) {
      console.error(`Technical fetch failed for ${symbol}:`, e);
      return this.mockTechnicals(symbol);
    }
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
