/**
 * Stage 7: Daily Scorecard
 * Composite score per stock combining fundamentals, technicals, sentiment, risk.
 */
const DailyScorecard = {
  id: 'scorecard',
  name: 'Daily Scorecard',
  description: 'Composite score: fundamentals + technicals + sentiment + risk',

  // Weighting for composite score
  weights: {
    fundamentals: 0.20,
    technical: 0.25,
    sentiment: 0.15,
    risk: 0.20,
    geopolitical: 0.20,
  },

  async run(ctx) {
    const watchlist = ctx.watchlist || [];
    if (!watchlist.length) return { error: 'No watchlist — run previous stages first', stocks: [] };

    const fundamentals = ctx.fundamentals || [];
    const technicals = ctx.technicals || [];
    const sentiments = ctx.sentiment || [];
    const risks = ctx.risk || [];
    const geo = ctx.geopolitical || {};

    const results = [];

    for (const stock of watchlist) {
      const fund = fundamentals.find(f => f.symbol === stock.symbol) || {};
      const tech = technicals.find(t => t.symbol === stock.symbol) || {};
      const sent = sentiments.find(s => s.symbol === stock.symbol) || {};
      const risk = risks.find(r => r.symbol === stock.symbol) || {};

      // Fundamental score (0-100)
      let fundScore = 50;
      if (fund.pe) {
        if (fund.pe < 15) fundScore += 15;
        else if (fund.pe < 25) fundScore += 5;
        else if (fund.pe > 40) fundScore -= 15;
      }
      if (fund.revenueGrowth > 15) fundScore += 15;
      else if (fund.revenueGrowth > 5) fundScore += 5;
      else if (fund.revenueGrowth < 0) fundScore -= 10;
      if (fund.roe > 20) fundScore += 10;
      if (fund.debtToEquity < 0.5) fundScore += 10;
      else if (fund.debtToEquity > 1.5) fundScore -= 10;
      // Insider activity
      if (fund.insiderNetBuying === true) fundScore += 8;
      else if (fund.insiderNetBuying === false) fundScore -= 5;
      // Analyst consensus
      if (fund.analystScore > 70) fundScore += 10;
      else if (fund.analystScore > 55) fundScore += 5;
      else if (fund.analystScore < 35) fundScore -= 10;
      // Earnings consistency
      if (fund.earningsBeatRate >= 0.75) fundScore += 8;
      else if (fund.earningsBeatRate >= 0.5) fundScore += 3;
      else if (fund.earningsBeatRate != null && fund.earningsBeatRate < 0.25) fundScore -= 8;
      fundScore = Math.max(0, Math.min(100, fundScore));

      // Technical score (0-100)
      let techScore = 50;
      if (tech.signal === 'Bullish') techScore += 25;
      else if (tech.signal === 'Bearish') techScore -= 25;
      else if (tech.signal === 'Oversold') techScore += 15; // potential bounce
      else if (tech.signal === 'Overbought') techScore -= 15;
      if (tech.rsi >= 40 && tech.rsi <= 60) techScore += 10; // healthy range
      if (tech.macd > 0) techScore += 10;
      else techScore -= 10;
      if (tech.volumeRatio > 1.3) techScore += 5; // above avg volume = conviction
      techScore = Math.max(0, Math.min(100, techScore));

      // Sentiment score (0-100)
      let sentScore = 50;
      const avgSent = sent.avgSentiment || 0;
      sentScore += avgSent * 40; // -1..1 maps to -40..+40
      sentScore = Math.max(0, Math.min(100, sentScore));

      // Risk score (0-100, inverted: low risk = high score)
      let riskAdjScore = 100 - ((risk.riskScore || 5) * 10);
      riskAdjScore = Math.max(0, Math.min(100, riskAdjScore));

      // Geopolitical score (0-100, inverted: high threat = low score)
      // Also adjusts per stock based on active scenarios and sector
      let geoScore = 100 - (geo.threatLevel?.score || 0);
      // Adjust for sector-specific scenario impacts
      if (geo.activeScenarios) {
        for (const scenario of geo.activeScenarios) {
          for (const [sector, impact] of Object.entries(scenario.impact || {})) {
            const sectorNorm = (stock.sector || '').toLowerCase().replace(/[^a-z]/g, '');
            const scenarioSector = sector.toLowerCase().replace(/[^a-z]/g, '');
            if (sectorNorm.includes(scenarioSector) || scenarioSector.includes(sectorNorm)) {
              geoScore += impact * 5; // positive impact helps, negative hurts
            }
          }
        }
      }
      geoScore = Math.max(0, Math.min(100, geoScore));

      // Composite
      const composite = (
        fundScore * this.weights.fundamentals +
        techScore * this.weights.technical +
        sentScore * this.weights.sentiment +
        riskAdjScore * this.weights.risk +
        geoScore * this.weights.geopolitical
      );

      let verdict = 'Hold';
      let confidence = 'Medium';
      if (composite >= 70) { verdict = 'Bullish'; confidence = composite >= 80 ? 'High' : 'Medium'; }
      else if (composite <= 35) { verdict = 'Bearish'; confidence = composite <= 25 ? 'High' : 'Medium'; }
      else if (composite >= 55) { verdict = 'Lean Bullish'; confidence = 'Low'; }
      else if (composite <= 45) { verdict = 'Lean Bearish'; confidence = 'Low'; }

      results.push({
        symbol: stock.symbol,
        company: stock.company,
        sector: stock.sector,
        price: stock.price,
        fundScore: Math.round(fundScore),
        techScore: Math.round(techScore),
        sentScore: Math.round(sentScore),
        riskAdjScore: Math.round(riskAdjScore),
        geoScore: Math.round(geoScore),
        composite: Math.round(composite),
        verdict,
        confidence,
      });
    }

    results.sort((a, b) => b.composite - a.composite);
    ctx.scorecard = results;
    return { stocks: results, weights: this.weights };
  },

  render(data) {
    if (data.error) return `<p class="text-yellow-500">${data.error}</p>`;

    let html = `<div class="mb-4 text-sm text-gray-500 dark:text-gray-400">
      Weights: Fund ${data.weights.fundamentals * 100}% · Tech ${data.weights.technical * 100}% · Sent ${data.weights.sentiment * 100}% · Risk ${data.weights.risk * 100}% · Geo ${data.weights.geopolitical * 100}%
    </div>`;

    html += '<div class="space-y-3">';

    for (const s of data.stocks) {
      const verdictColors = {
        Bullish: 'bg-green-500/20 text-green-400 border-green-500/30',
        'Lean Bullish': 'bg-green-500/10 text-green-300 border-green-500/20',
        Hold: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
        'Lean Bearish': 'bg-red-500/10 text-red-300 border-red-500/20',
        Bearish: 'bg-red-500/20 text-red-400 border-red-500/30',
      };
      const vc = verdictColors[s.verdict] || verdictColors.Hold;

      const barColor = s.composite >= 65 ? 'bg-green-500' : s.composite >= 45 ? 'bg-yellow-500' : 'bg-red-500';

      html += `<div class="p-4 rounded-lg border border-gray-200 dark:border-gray-800">
        <div class="flex items-center justify-between mb-2">
          <div>
            ${tickerLabel(s.symbol, 'font-bold text-lg')}
            <span class="text-gray-500 dark:text-gray-400 ml-2">${s.company}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-2xl font-bold">${s.composite}</span>
            <span class="px-2 py-0.5 rounded-full text-xs font-semibold border ${vc}">${s.verdict}</span>
          </div>
        </div>
        <div class="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 mb-3">
          <div class="${barColor} h-2 rounded-full transition-all" style="width:${s.composite}%"></div>
        </div>
        <div class="grid grid-cols-5 gap-2 text-center text-xs">
          <div><div class="text-gray-500 dark:text-gray-400">Fund.</div><div class="font-bold">${s.fundScore}</div></div>
          <div><div class="text-gray-500 dark:text-gray-400">Tech.</div><div class="font-bold">${s.techScore}</div></div>
          <div><div class="text-gray-500 dark:text-gray-400">Sent.</div><div class="font-bold">${s.sentScore}</div></div>
          <div><div class="text-gray-500 dark:text-gray-400">Risk</div><div class="font-bold">${s.riskAdjScore}</div></div>
          <div><div class="text-gray-500 dark:text-gray-400">Geo</div><div class="font-bold">${s.geoScore}</div></div>
        </div>
        <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">Confidence: <span class="font-medium">${s.confidence}</span></div>
      </div>`;
    }

    html += '</div>';
    return html;
  },
};
