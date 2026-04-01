/**
 * Stage 8: Action Plan
 * Buy/sell/hold recommendations with entry, stop-loss, take-profit targets.
 */
const ActionPlan = {
  id: 'action-plan',
  name: 'Action Plan',
  description: 'Buy/sell/hold with entry, stop-loss, and take-profit targets',

  async run(ctx) {
    const scorecard = ctx.scorecard || [];
    const risks = ctx.risk || [];
    const technicals = ctx.technicals || [];
    const fundamentals = ctx.fundamentals || [];
    const geo = ctx.geopolitical || {};
    const sectorSentiment = ctx.sectorSentiment || {};
    if (!scorecard.length) return { error: 'No scorecard — run previous stages first', actions: [] };

    const actions = [];

    for (const stock of scorecard) {
      const risk = risks.find(r => r.symbol === stock.symbol) || {};
      const tech = technicals.find(t => t.symbol === stock.symbol) || {};
      const fund = fundamentals.find(f => f.symbol === stock.symbol) || {};
      const secSent = sectorSentiment[stock.sector] || {};
      const price = stock.price || 0;

      let action = 'HOLD';
      let reasoning = [];

      // Action decision uses invest score + vulnerability for nuance
      if (stock.composite >= 65 && stock.confidence !== 'Low') {
        action = 'BUY';
        reasoning.push(`Strong verdict (${stock.composite})`);
        if (stock.investScore >= 65) reasoning.push(`Invest score: ${stock.investScore}`);
        if (stock.techScore >= 60) reasoning.push('Favorable technicals');
        if (stock.sentScore >= 60) reasoning.push('Positive sentiment');
      } else if (stock.composite <= 35 && stock.confidence !== 'Low') {
        action = 'SELL';
        reasoning.push(`Weak verdict (${stock.composite})`);
        if (stock.vulnerability >= 60) reasoning.push(`High vulnerability: ${stock.vulnerability}`);
        if (stock.techScore <= 40) reasoning.push('Bearish technicals');
        if (stock.sentScore <= 40) reasoning.push('Negative sentiment');
      } else if (stock.composite >= 55) {
        action = 'WATCH';
        reasoning.push('Moderate bullish signals, wait for confirmation');
      } else if (stock.composite <= 45) {
        action = 'WATCH';
        reasoning.push('Moderate bearish signals, monitor closely');
      } else {
        action = 'HOLD';
        reasoning.push('Mixed signals, no clear edge');
      }

      // Vulnerability warning
      if (stock.vulnerability >= 65) reasoning.push('Collapse risk elevated');
      // Risk warning
      if (stock.riskRating >= 70) reasoning.push('High volatility');

      // Enrichment reasoning
      if (fund.insiderNetBuying === true) reasoning.push('Insider buying');
      else if (fund.insiderNetBuying === false && action !== 'BUY') reasoning.push('Insider selling');
      if (fund.analystConsensus === 'Strong Buy') reasoning.push('Analyst: Strong Buy');
      else if (fund.analystConsensus === 'Sell' || fund.analystConsensus === 'Strong Sell') reasoning.push('Analyst: ' + fund.analystConsensus);
      if (fund.earningsBeatRate >= 0.75) reasoning.push('Consistent earnings beats');
      else if (fund.earningsBeatRate != null && fund.earningsBeatRate < 0.25) reasoning.push('Earnings misses');

      // Sector sentiment
      if (secSent.sentimentScore > 0.3) reasoning.push('Sector tailwind');
      else if (secSent.sentimentScore < -0.3) reasoning.push('Sector headwind');

      // Geopolitical scenario impacts
      if (geo.activeScenarios) {
        for (const scenario of geo.activeScenarios) {
          if (scenario.signalStrength >= 50) {
            reasoning.push('Geo: ' + scenario.name);
            break; // only show strongest
          }
        }
      }

      // Technical indicator signals
      if (tech.bollinger && tech.bollinger.bandwidth < 0.05) reasoning.push('Bollinger squeeze');
      if (tech.stochastic && tech.stochastic.k < 20) reasoning.push('Stochastic oversold');
      else if (tech.stochastic && tech.stochastic.k > 80) reasoning.push('Stochastic overbought');
      if (tech.atr && price > 0 && (tech.atr / price * 100) > 3) reasoning.push('High ATR volatility');

      // Targets based on technical levels
      const stopLoss = risk.stopLoss || tech.support || price * 0.95;
      const resistance = tech.resistance || price * 1.08;
      const riskDenom = price - stopLoss;
      const riskReward = riskDenom > 0 ? ((resistance - price) / riskDenom).toFixed(1) : 'N/A';

      // Position sizing from risk stage
      const shares = risk.shares || 0;
      const positionValue = risk.positionValue || 0;

      actions.push({
        symbol: stock.symbol,
        company: stock.company,
        sector: stock.sector,
        action,
        composite: stock.composite,
        investScore: stock.investScore,
        vulnerability: stock.vulnerability,
        riskRating: stock.riskRating,
        confidence: stock.confidence,
        price: +price.toFixed(2),
        entry: action === 'BUY' ? +price.toFixed(2) : null,
        stopLoss: +stopLoss.toFixed(2),
        target: +resistance.toFixed(2),
        riskReward,
        shares,
        positionValue,
        reasoning,
      });
    }

    // Sort: BUY first, then WATCH, HOLD, SELL
    const order = { BUY: 0, WATCH: 1, HOLD: 2, SELL: 3 };
    actions.sort((a, b) => (order[a.action] ?? 4) - (order[b.action] ?? 4));


    return { actions, date: new Date().toLocaleDateString() };
  },

  render(data) {
    if (data.error) return `<p class="text-yellow-500">${data.error}</p>`;

    let html = `<div class="mb-4 text-sm text-gray-500 dark:text-gray-400">Action plan for <strong>${data.date}</strong></div>`;

    const actionStyles = {
      BUY: { bg: 'bg-green-500', text: 'text-green-400', border: 'border-green-500/30', icon: '&uarr;' },
      SELL: { bg: 'bg-red-500', text: 'text-red-400', border: 'border-red-500/30', icon: '&darr;' },
      HOLD: { bg: 'bg-gray-500', text: 'text-gray-400', border: 'border-gray-500/30', icon: '&mdash;' },
      WATCH: { bg: 'bg-yellow-500', text: 'text-yellow-400', border: 'border-yellow-500/30', icon: '&#9673;' },
    };

    html += '<div class="space-y-3">';

    for (const a of data.actions) {
      const s = actionStyles[a.action] || actionStyles.HOLD;

      html += `<div class="p-4 rounded-lg border ${s.border} bg-white dark:bg-gray-900">`;
      html += `<div class="flex items-center justify-between mb-3">`;
      html += `<div class="flex items-center gap-3">`;
      html += `<span class="w-10 h-10 rounded-lg ${s.bg} text-white flex items-center justify-center font-bold text-lg">${s.icon}</span>`;
      html += `<div><div>${tickerLabel(a.symbol, 'font-bold text-lg')}</div><div class="text-xs text-gray-500 dark:text-gray-400">${a.company}</div></div>`;
      html += `</div>`;
      html += `<div class="text-right"><div class="text-xl font-bold ${s.text}">${a.action}</div>`;
      html += `<div class="text-xs text-gray-500">Score: ${a.composite} · ${a.confidence} conf.</div></div>`;
      html += `</div>`;

      // Price targets
      if (a.action === 'BUY' || a.action === 'WATCH') {
        html += `<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">`;
        html += `<div class="p-2 rounded bg-gray-100 dark:bg-gray-800 text-center"><div class="text-xs text-gray-500 dark:text-gray-400">Entry</div><div class="font-mono font-bold">${a.entry ?? a.price}</div></div>`;
        html += `<div class="p-2 rounded bg-red-500/10 text-center"><div class="text-xs text-gray-500 dark:text-gray-400">Stop Loss</div><div class="font-mono font-bold text-red-400">${a.stopLoss}</div></div>`;
        html += `<div class="p-2 rounded bg-green-500/10 text-center"><div class="text-xs text-gray-500 dark:text-gray-400">Target</div><div class="font-mono font-bold text-green-400">${a.target}</div></div>`;
        html += `<div class="p-2 rounded bg-gray-100 dark:bg-gray-800 text-center"><div class="text-xs text-gray-500 dark:text-gray-400">R:R</div><div class="font-mono font-bold">${a.riskReward}</div></div>`;
        html += `</div>`;
      }

      if (a.shares > 0) {
        html += `<div class="text-sm mb-2"><span class="text-gray-500 dark:text-gray-400">Position:</span> ${a.shares} shares · $${a.positionValue.toLocaleString()}</div>`;
      }

      // Reasoning
      html += `<div class="text-sm text-gray-500 dark:text-gray-400">`;
      for (const r of a.reasoning) {
        html += `<span class="inline-block mr-2 mb-1 px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-xs">${r}</span>`;
      }
      html += `</div></div>`;
    }

    html += '</div>';

    // Disclaimer
    html += `<div class="mt-6 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-600 dark:text-yellow-400">
      <strong>Disclaimer:</strong> This is an experimental tool for educational purposes only. Not financial advice. Always do your own research and consult a financial advisor before making investment decisions.
    </div>`;

    return html;
  },
};
