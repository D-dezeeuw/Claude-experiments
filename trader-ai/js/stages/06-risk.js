/**
 * Stage 6: Risk Assessment
 * Volatility, beta, correlation, max drawdown, position sizing.
 */
const RiskAssessment = {
  id: 'risk',
  name: 'Risk Assessment',
  description: 'Volatility, beta, correlation, position sizing, drawdown',

  // Default risk parameters
  params: {
    portfolioValue: 100000,   // total portfolio value
    maxRiskPerTrade: 0.02,    // 2% max risk per trade
    maxSectorExposure: 0.30,  // 30% max in one sector
    maxPositionSize: 0.10,    // 10% max single position
  },

  async run(ctx) {
    const watchlist = ctx.watchlist || [];
    const fundamentals = ctx.fundamentals || [];
    const technicals = ctx.technicals || [];
    if (!watchlist.length) return { error: 'No watchlist — run Stock Screener first', stocks: [] };

    const results = [];

    for (const stock of watchlist) {
      const fund = fundamentals.find(f => f.symbol === stock.symbol) || {};
      const tech = technicals.find(t => t.symbol === stock.symbol) || {};

      const beta = fund.beta || 1.0;
      const price = stock.price || 100;
      const support = tech.support || price * 0.93;
      const stopLoss = support;
      const riskPerShare = price - stopLoss;
      const maxShares = Math.floor((this.params.portfolioValue * this.params.maxRiskPerTrade) / riskPerShare);
      const positionValue = maxShares * price;
      const positionPct = (positionValue / this.params.portfolioValue) * 100;

      // Clamp to max position size
      const clampedPct = Math.min(positionPct, this.params.maxPositionSize * 100);
      const clampedShares = Math.floor((this.params.portfolioValue * clampedPct / 100) / price);
      const clampedValue = clampedShares * price;

      // Risk score: 1 (low risk) to 10 (high risk)
      let riskScore = 5;
      if (beta > 1.5) riskScore += 2;
      else if (beta > 1.2) riskScore += 1;
      else if (beta < 0.8) riskScore -= 1;

      const de = fund.debtToEquity || 0;
      if (de > 2) riskScore += 2;
      else if (de > 1) riskScore += 1;

      const rsi = tech.rsi || 50;
      if (rsi > 75 || rsi < 25) riskScore += 1;

      const volRatio = tech.volumeRatio || 1;
      if (volRatio > 2) riskScore += 1;

      riskScore = Math.max(1, Math.min(10, riskScore));

      results.push({
        symbol: stock.symbol,
        company: stock.company,
        sector: stock.sector,
        price,
        beta: +parseFloat(beta).toFixed(2),
        stopLoss: +stopLoss.toFixed(2),
        riskPerShare: +riskPerShare.toFixed(2),
        shares: clampedShares,
        positionValue: +clampedValue.toFixed(0),
        positionPct: +clampedPct.toFixed(1),
        riskScore,
        riskLabel: riskScore <= 3 ? 'Low' : riskScore <= 6 ? 'Medium' : 'High',
      });
    }

    // Sector concentration check
    const sectorTotals = {};
    for (const r of results) {
      sectorTotals[r.sector] = (sectorTotals[r.sector] || 0) + r.positionValue;
    }
    const sectorWarnings = [];
    for (const [sector, total] of Object.entries(sectorTotals)) {
      const pct = total / this.params.portfolioValue;
      if (pct > this.params.maxSectorExposure) {
        sectorWarnings.push(`${sector}: ${(pct * 100).toFixed(1)}% exceeds ${this.params.maxSectorExposure * 100}% limit`);
      }
    }

    ctx.risk = results;
    return { stocks: results, sectorWarnings, params: this.params };
  },

  render(data) {
    if (data.error) return `<p class="text-yellow-500">${data.error}</p>`;

    let html = `<div class="mb-4 p-3 rounded-lg bg-gray-100 dark:bg-gray-800/50 text-sm">
      <span class="font-semibold">Portfolio:</span> $${data.params.portfolioValue.toLocaleString()} ·
      <span class="font-semibold">Max risk/trade:</span> ${data.params.maxRiskPerTrade * 100}% ·
      <span class="font-semibold">Max position:</span> ${data.params.maxPositionSize * 100}% ·
      <span class="font-semibold">Max sector:</span> ${data.params.maxSectorExposure * 100}%
    </div>`;

    if (data.sectorWarnings.length) {
      html += '<div class="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm">';
      html += '<div class="font-semibold text-red-400 mb-1">Sector Concentration Warnings</div>';
      for (const w of data.sectorWarnings) {
        html += `<div class="text-red-300">${w}</div>`;
      }
      html += '</div>';
    }

    html += '<div class="overflow-x-auto"><table class="w-full text-sm">';
    html += '<thead><tr class="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">';
    html += '<th class="pb-2 pr-3">Symbol</th><th class="pb-2 pr-3 text-right">Beta</th><th class="pb-2 pr-3 text-right">Stop Loss</th><th class="pb-2 pr-3 text-right">Risk/Share</th><th class="pb-2 pr-3 text-right">Shares</th><th class="pb-2 pr-3 text-right">Position $</th><th class="pb-2 pr-3 text-right">% Port</th><th class="pb-2">Risk</th></tr></thead><tbody>';

    for (const s of data.stocks) {
      const riskColors = {
        Low: 'bg-green-500/20 text-green-400',
        Medium: 'bg-yellow-500/20 text-yellow-400',
        High: 'bg-red-500/20 text-red-400',
      };
      const rc = riskColors[s.riskLabel];

      html += `<tr class="border-b border-gray-100 dark:border-gray-800/50">
        <td class="py-2 pr-3">${tickerLabel(s.symbol, 'font-bold')}</td>
        <td class="py-2 pr-3 text-right font-mono">${s.beta}</td>
        <td class="py-2 pr-3 text-right font-mono">${s.stopLoss}</td>
        <td class="py-2 pr-3 text-right font-mono">${s.riskPerShare}</td>
        <td class="py-2 pr-3 text-right font-mono">${s.shares}</td>
        <td class="py-2 pr-3 text-right font-mono">$${s.positionValue.toLocaleString()}</td>
        <td class="py-2 pr-3 text-right font-mono">${s.positionPct}%</td>
        <td class="py-2"><span class="px-2 py-0.5 rounded-full text-xs font-semibold ${rc}">${s.riskLabel} (${s.riskScore})</span></td>
      </tr>`;
    }

    html += '</tbody></table></div>';
    return html;
  },
};
