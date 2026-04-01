/**
 * Backtesting Engine
 * Loads full price history from Supabase and simulates trading strategies.
 * Supports: basic backtest, walk-forward validation, position sizing, multi-strategy comparison.
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

  calcSMA(arr, period, index) {
    if (index < period - 1) return null;
    let sum = 0;
    for (let i = index - period + 1; i <= index; i++) sum += arr[i];
    return sum / period;
  },

  calcBollinger(closes, period, index) {
    if (index < period - 1) return null;
    const slice = closes.slice(index - period + 1, index + 1);
    const mid = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((s, c) => s + (c - mid) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    return { upper: mid + 2 * std, middle: mid, lower: mid - 2 * std };
  },

  /**
   * Run a single backtest
   * @returns {{ trades, equity, metrics }}
   */
  run(candles, strategy, params, capital) {
    capital = capital || 10000;
    const closes = candles.map(c => c.close);
    let cash = capital;
    let shares = 0;
    let position = null;
    const trades = [];
    const equity = [];
    let peakEquity = capital;
    let maxDrawdown = 0;
    const warmup = Math.max(params.rsiPeriod || 14, params.smaSlow || 50, params.bbPeriod || 20) + 5;

    for (let i = 0; i < candles.length; i++) {
      const price = closes[i];
      const currentEquity = cash + (shares * price);
      equity.push({ date: candles[i].date, value: +currentEquity.toFixed(2) });
      if (currentEquity > peakEquity) peakEquity = currentEquity;
      const dd = (peakEquity - currentEquity) / peakEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;
      if (i < warmup) continue;

      const ctx = {
        i, price, candles, closes, highs: candles.map(c => c.high), lows: candles.map(c => c.low), params,
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
        cash -= shares * price;
        position = { entryPrice: price, entryDate: candles[i].date, shares };
      } else if (signal === 'sell' && position) {
        const revenue = shares * price;
        cash += revenue;
        trades.push({
          entryDate: position.entryDate, entryPrice: +position.entryPrice.toFixed(2),
          exitDate: candles[i].date, exitPrice: +price.toFixed(2),
          shares: position.shares,
          pnl: +(revenue - position.shares * position.entryPrice).toFixed(2),
          pnlPercent: +(((revenue - position.shares * position.entryPrice) / (position.shares * position.entryPrice)) * 100).toFixed(2),
        });
        shares = 0;
        position = null;
      }
    }

    // Close open position
    if (position && candles.length > 0) {
      const lastPrice = closes[closes.length - 1];
      cash += shares * lastPrice;
      trades.push({
        entryDate: position.entryDate, entryPrice: +position.entryPrice.toFixed(2),
        exitDate: candles[candles.length - 1].date, exitPrice: +lastPrice.toFixed(2),
        shares: position.shares,
        pnl: +(shares * lastPrice - position.shares * position.entryPrice).toFixed(2),
        pnlPercent: +(((shares * lastPrice - position.shares * position.entryPrice) / (position.shares * position.entryPrice)) * 100).toFixed(2),
        open: true,
      });
    }

    return { trades, equity, metrics: this.computeMetrics(trades, equity, capital, cash + (shares > 0 ? shares * closes[closes.length - 1] : 0), maxDrawdown, candles.length) };
  },

  computeMetrics(trades, equity, capital, finalEquity, maxDrawdown, dataPoints) {
    const totalReturn = ((finalEquity - capital) / capital) * 100;
    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;

    const dailyReturns = [];
    for (let i = 1; i < equity.length; i++) {
      dailyReturns.push((equity[i].value - equity[i - 1].value) / equity[i - 1].value);
    }
    const avgReturn = dailyReturns.length > 0 ? dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length : 0;
    const stdReturn = dailyReturns.length > 1 ? Math.sqrt(dailyReturns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (dailyReturns.length - 1)) : 0;
    const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

    return {
      totalReturn: +totalReturn.toFixed(2), finalEquity: +finalEquity.toFixed(2),
      tradeCount: trades.length, winRate: trades.length > 0 ? +((wins.length / trades.length) * 100).toFixed(1) : 0,
      avgWin: +avgWin.toFixed(2), avgLoss: +avgLoss.toFixed(2),
      maxDrawdown: +(maxDrawdown * 100).toFixed(2), sharpe: +sharpe.toFixed(2), dataPoints,
    };
  },

  /**
   * Walk-forward validation: split data into train/test, run on both
   * @param {number} trainPct - Percentage for training (e.g. 0.7 = 70%)
   * @returns {{ train, test, overfit }}
   */
  walkForward(candles, strategy, params, capital, trainPct) {
    trainPct = trainPct || 0.7;
    const splitIdx = Math.floor(candles.length * trainPct);
    const trainCandles = candles.slice(0, splitIdx);
    const testCandles = candles.slice(splitIdx);

    const train = this.run(trainCandles, strategy, params, capital);
    const test = this.run(testCandles, strategy, params, capital);

    // Overfit score: how much worse is test vs train (0 = same, 100 = completely degraded)
    const returnDelta = train.metrics.totalReturn - test.metrics.totalReturn;
    const sharpeDelta = train.metrics.sharpe - test.metrics.sharpe;
    const overfit = Math.max(0, Math.min(100, Math.round(
      (returnDelta > 0 ? returnDelta * 0.5 : 0) +
      (sharpeDelta > 0 ? sharpeDelta * 20 : 0)
    )));

    return {
      train: { ...train.metrics, period: trainCandles[0]?.date + ' → ' + trainCandles[trainCandles.length - 1]?.date, candles: trainCandles.length },
      test: { ...test.metrics, period: testCandles[0]?.date + ' → ' + testCandles[testCandles.length - 1]?.date, candles: testCandles.length },
      trainEquity: train.equity,
      testEquity: test.equity,
      overfit,
      verdict: overfit < 20 ? 'Robust' : overfit < 40 ? 'Acceptable' : overfit < 60 ? 'Questionable' : 'Overfitted',
    };
  },

  /**
   * Position sizing recommendations based on backtest results
   * @returns {{ kelly, halfKelly, fixedFractional, riskParity }}
   */
  positionSizing(metrics, capital, stockPrice) {
    const winRate = metrics.winRate / 100;
    const avgWin = Math.abs(metrics.avgWin);
    const avgLoss = Math.abs(metrics.avgLoss) || 1;
    const winLossRatio = avgWin / avgLoss;

    // Kelly Criterion: f* = W - (1-W)/R
    const kelly = Math.max(0, winRate - ((1 - winRate) / winLossRatio));
    const halfKelly = kelly / 2; // conservative

    // Fixed fractional (risk 2% of capital per trade)
    const riskPct = 0.02;
    const fixedFracShares = stockPrice > 0 ? Math.floor((capital * riskPct) / stockPrice) : 0;

    // Risk-parity: size based on ATR / volatility (use max drawdown as proxy)
    const volAdj = metrics.maxDrawdown > 0 ? Math.min(1, 15 / metrics.maxDrawdown) : 1;
    const riskParityShares = stockPrice > 0 ? Math.floor((capital * 0.1 * volAdj) / stockPrice) : 0;

    return {
      kelly: { fraction: +kelly.toFixed(3), shares: stockPrice > 0 ? Math.floor(capital * kelly / stockPrice) : 0, pctCapital: +(kelly * 100).toFixed(1) },
      halfKelly: { fraction: +halfKelly.toFixed(3), shares: stockPrice > 0 ? Math.floor(capital * halfKelly / stockPrice) : 0, pctCapital: +(halfKelly * 100).toFixed(1) },
      fixedFractional: { shares: fixedFracShares, riskPct: 2, value: +(fixedFracShares * stockPrice).toFixed(2) },
      riskParity: { shares: riskParityShares, volAdj: +volAdj.toFixed(2), value: +(riskParityShares * stockPrice).toFixed(2) },
      recommendation: halfKelly > 0.05 ? 'Half-Kelly (' + (halfKelly * 100).toFixed(1) + '% of capital)' : 'Fixed fractional (2% risk per trade)',
    };
  },

  /**
   * Compare all strategies on the same data
   * @returns {Array} Array of { strategyName, metrics, equity }
   */
  async compareStrategies(candles, capital) {
    const results = [];
    for (const strat of Strategies.list) {
      const result = this.run(candles, strat.fn, strat.params, capital);
      results.push({
        id: strat.id,
        name: strat.name,
        metrics: result.metrics,
        equity: result.equity,
        trades: result.trades,
      });
    }
    // Also add buy-and-hold benchmark
    if (candles.length > 0) {
      const startPrice = candles[0].close;
      const endPrice = candles[candles.length - 1].close;
      const shares = Math.floor(capital / startPrice);
      const finalVal = shares * endPrice + (capital - shares * startPrice);
      results.push({
        id: 'buy-and-hold',
        name: 'Buy & Hold (benchmark)',
        metrics: {
          totalReturn: +(((finalVal - capital) / capital) * 100).toFixed(2),
          finalEquity: +finalVal.toFixed(2),
          tradeCount: 1,
          winRate: endPrice > startPrice ? 100 : 0,
          avgWin: +(finalVal - capital).toFixed(2),
          avgLoss: 0,
          maxDrawdown: 0, // simplified
          sharpe: 0,
          dataPoints: candles.length,
        },
        equity: candles.map(c => ({ date: c.date, value: +(shares * c.close + (capital - shares * startPrice)).toFixed(2) })),
        trades: [],
      });
    }
    return results;
  },
};
