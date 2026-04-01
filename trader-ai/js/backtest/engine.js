/**
 * Backtesting Engine
 * Loads full price history from Supabase and simulates trading strategies.
 */
const BacktestEngine = {
  /** Load full candle history from Supabase (bypasses 60-candle localStorage limit) */
  async loadFullHistory(symbol) {
    if (!sbClient) return [];
    try {
      const { data, error } = await sbClient
        .from('price_history')
        .select('candles')
        .eq('symbol', symbol)
        .single();
      if (error || !data) return [];
      return data.candles || [];
    } catch (e) {
      console.warn('Failed to load full history for ' + symbol, e);
      return [];
    }
  },

  /** Compute RSI from an array of closes */
  calcRSI(closes, period, index) {
    if (index < period) return null;
    let gains = 0, losses = 0;
    for (let i = index - period + 1; i <= index; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + (avgGain / avgLoss)));
  },

  /** Compute SMA at a given index */
  calcSMA(arr, period, index) {
    if (index < period - 1) return null;
    let sum = 0;
    for (let i = index - period + 1; i <= index; i++) sum += arr[i];
    return sum / period;
  },

  /** Compute Bollinger Bands at a given index */
  calcBollinger(closes, period, index) {
    if (index < period - 1) return null;
    const slice = closes.slice(index - period + 1, index + 1);
    const mid = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((s, c) => s + (c - mid) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return { upper: mid + 2 * std, middle: mid, lower: mid - 2 * std };
  },

  /**
   * Run a backtest
   * @param {Array} candles - Full OHLCV candle array
   * @param {Function} strategy - strategy(ctx) => 'buy'|'sell'|'hold'
   * @param {Object} params - Strategy parameters
   * @param {number} capital - Starting capital
   * @returns {Object} { trades, equity, metrics }
   */
  run(candles, strategy, params, capital) {
    capital = capital || 10000;
    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    let cash = capital;
    let shares = 0;
    let position = null; // { entryPrice, entryDate, shares }
    const trades = [];
    const equity = []; // daily equity values
    let peakEquity = capital;
    let maxDrawdown = 0;

    // Warmup period (need enough data for indicators)
    const warmup = Math.max(params.rsiPeriod || 14, params.smaSlow || 50, params.bbPeriod || 20) + 5;

    for (let i = 0; i < candles.length; i++) {
      const price = closes[i];
      const currentEquity = cash + (shares * price);
      equity.push({ date: candles[i].date, value: +currentEquity.toFixed(2) });

      // Track drawdown
      if (currentEquity > peakEquity) peakEquity = currentEquity;
      const dd = (peakEquity - currentEquity) / peakEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;

      if (i < warmup) continue;

      // Build indicator context for strategy
      const ctx = {
        i, price, candles, closes, highs, lows, params,
        rsi: this.calcRSI(closes, params.rsiPeriod || 14, i),
        smaFast: this.calcSMA(closes, params.smaFast || 20, i),
        smaSlow: this.calcSMA(closes, params.smaSlow || 50, i),
        bollinger: this.calcBollinger(closes, params.bbPeriod || 20, i),
        position,
      };

      const signal = strategy(ctx);

      if (signal === 'buy' && !position) {
        shares = Math.floor(cash / price);
        if (shares <= 0) continue;
        const cost = shares * price;
        cash -= cost;
        position = { entryPrice: price, entryDate: candles[i].date, shares };
      } else if (signal === 'sell' && position) {
        const revenue = shares * price;
        cash += revenue;
        const pnl = revenue - (position.shares * position.entryPrice);
        trades.push({
          entryDate: position.entryDate,
          entryPrice: +position.entryPrice.toFixed(2),
          exitDate: candles[i].date,
          exitPrice: +price.toFixed(2),
          shares: position.shares,
          pnl: +pnl.toFixed(2),
          pnlPercent: +((pnl / (position.shares * position.entryPrice)) * 100).toFixed(2),
        });
        shares = 0;
        position = null;
      }
    }

    // Close any open position at last price
    if (position && candles.length > 0) {
      const lastPrice = closes[closes.length - 1];
      const revenue = shares * lastPrice;
      cash += revenue;
      trades.push({
        entryDate: position.entryDate,
        entryPrice: +position.entryPrice.toFixed(2),
        exitDate: candles[candles.length - 1].date,
        exitPrice: +lastPrice.toFixed(2),
        shares: position.shares,
        pnl: +(revenue - position.shares * position.entryPrice).toFixed(2),
        pnlPercent: +(((revenue - position.shares * position.entryPrice) / (position.shares * position.entryPrice)) * 100).toFixed(2),
        open: true,
      });
      shares = 0;
    }

    const finalEquity = cash;
    const totalReturn = ((finalEquity - capital) / capital) * 100;
    const wins = trades.filter(t => t.pnl > 0).length;
    const avgWin = wins > 0 ? trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0) / wins : 0;
    const losses = trades.filter(t => t.pnl <= 0).length;
    const avgLoss = losses > 0 ? trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0) / losses : 0;

    // Sharpe ratio (annualized, assuming 252 trading days)
    const dailyReturns = [];
    for (let i = 1; i < equity.length; i++) {
      dailyReturns.push((equity[i].value - equity[i - 1].value) / equity[i - 1].value);
    }
    const avgReturn = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
    const stdReturn = dailyReturns.length > 1 ? Math.sqrt(dailyReturns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (dailyReturns.length - 1)) : 0;
    const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

    return {
      trades,
      equity,
      metrics: {
        totalReturn: +totalReturn.toFixed(2),
        finalEquity: +finalEquity.toFixed(2),
        tradeCount: trades.length,
        winRate: trades.length > 0 ? +((wins / trades.length) * 100).toFixed(1) : 0,
        avgWin: +avgWin.toFixed(2),
        avgLoss: +avgLoss.toFixed(2),
        maxDrawdown: +(maxDrawdown * 100).toFixed(2),
        sharpe: +sharpe.toFixed(2),
        dataPoints: candles.length,
      },
    };
  },
};
