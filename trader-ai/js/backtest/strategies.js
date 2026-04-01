/**
 * Built-in trading strategies for the backtester.
 * Each strategy: (ctx) => 'buy' | 'sell' | 'hold'
 */
const Strategies = {
  list: [
    {
      id: 'rsi-mean-reversion',
      name: 'RSI Mean Reversion',
      description: 'Buy when RSI oversold, sell when RSI overbought',
      params: { rsiPeriod: 14, rsiBuy: 30, rsiSell: 70 },
      fn(ctx) {
        if (ctx.rsi === null) return 'hold';
        if (!ctx.position && ctx.rsi < ctx.params.rsiBuy) return 'buy';
        if (ctx.position && ctx.rsi > ctx.params.rsiSell) return 'sell';
        return 'hold';
      },
    },
    {
      id: 'ma-crossover',
      name: 'Moving Average Crossover',
      description: 'Buy when fast MA crosses above slow MA, sell on cross below',
      params: { smaFast: 20, smaSlow: 50 },
      fn(ctx) {
        if (ctx.smaFast === null || ctx.smaSlow === null) return 'hold';
        if (!ctx.position && ctx.smaFast > ctx.smaSlow) return 'buy';
        if (ctx.position && ctx.smaFast < ctx.smaSlow) return 'sell';
        return 'hold';
      },
    },
    {
      id: 'bollinger-bounce',
      name: 'Bollinger Bounce',
      description: 'Buy at lower band, sell at upper band',
      params: { bbPeriod: 20 },
      fn(ctx) {
        if (!ctx.bollinger) return 'hold';
        if (!ctx.position && ctx.price <= ctx.bollinger.lower) return 'buy';
        if (ctx.position && ctx.price >= ctx.bollinger.upper) return 'sell';
        return 'hold';
      },
    },
  ],

  get(id) {
    return this.list.find(s => s.id === id);
  },
};
