/**
 * Stage 7: Daily Scorecard
 * Per-stock ratings: Verdict, Invest Score, Vulnerability, Risk Rating.
 * Wires in ALL available data: fundamentals, technicals, sentiment,
 * sector sentiment, risk, geopolitical, fear gauges, scenarios.
 */
const DailyScorecard = {
  id: 'scorecard',
  name: 'Daily Scorecard',
  description: 'Verdict, invest score, vulnerability, and risk ratings per stock',

  // Sector → geopolitical impact tags
  sectorMap: {
    'Energy': ['energy'],
    'Materials': ['manufacturing', 'commodities', 'construction'],
    'Industrials': ['industrials', 'construction', 'defense', 'airlines'],
    'Consumer Discretionary': ['consumer'],
    'Consumer Staples': ['consumer_staples'],
    'Healthcare': ['healthcare'],
    'Financials': ['financials', 'insurance'],
    'Information Technology': ['tech', 'cybersecurity', 'remote_tech'],
    'Communication Services': ['tech', 'consumer'],
    'Utilities': ['utilities'],
    'Real Estate': ['real_estate', 'construction'],
  },

  async run(ctx) {
    const watchlist = ctx.watchlist || [];
    if (!watchlist.length) return { error: 'No watchlist — run previous stages first', stocks: [] };

    const fundamentals = ctx.fundamentals || [];
    const technicals = ctx.technicals || [];
    const sentiments = ctx.sentiment || [];
    const risks = ctx.risk || [];
    const geo = ctx.geopolitical || {};

    // Sector sentiment from Webz.io (if available via server pipeline)
    const sectorSentiment = ctx.sectorSentiment || {};

    // Fear gauge data
    const vix = (geo.fearGauges || []).find(g => g.etf === 'VIXY' || g.symbol === '^VIX');
    const vixLevel = vix ? vix.price || 0 : 0;

    const results = [];

    for (const stock of watchlist) {
      const fund = fundamentals.find(f => f.symbol === stock.symbol) || {};
      const tech = technicals.find(t => t.symbol === stock.symbol) || {};
      const sent = sentiments.find(s => s.symbol === stock.symbol) || {};
      const risk = risks.find(r => r.symbol === stock.symbol) || {};
      const secSent = sectorSentiment[stock.sector] || {};

      // ══════════════════════════════════════════
      // 1. FUNDAMENTAL SCORE (0-100)
      // ══════════════════════════════════════════
      let fundScore = 50;
      // Valuation
      if (fund.pe) {
        if (fund.pe < 15) fundScore += 15;
        else if (fund.pe < 25) fundScore += 5;
        else if (fund.pe > 40) fundScore -= 15;
      }
      // Growth
      if (fund.revenueGrowth > 15) fundScore += 15;
      else if (fund.revenueGrowth > 5) fundScore += 5;
      else if (fund.revenueGrowth < 0) fundScore -= 10;
      // Profitability
      if (fund.roe > 20) fundScore += 10;
      // Leverage
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

      // ══════════════════════════════════════════
      // 2. TECHNICAL SCORE (0-100)
      // ══════════════════════════════════════════
      let techScore = 50;
      if (tech.signal === 'Bullish') techScore += 25;
      else if (tech.signal === 'Bearish') techScore -= 25;
      else if (tech.signal === 'Oversold') techScore += 15;
      else if (tech.signal === 'Overbought') techScore -= 15;
      if (tech.rsi >= 40 && tech.rsi <= 60) techScore += 10;
      if (tech.macd > 0) techScore += 10;
      else if (tech.macd != null) techScore -= 10;
      if (tech.volumeRatio > 1.3) techScore += 5;
      // Bollinger Bands
      if (tech.bollinger) {
        if (tech.bollinger.percentB < 0.2) techScore += 5;      // near lower band = oversold
        else if (tech.bollinger.percentB > 0.8) techScore -= 5;  // near upper band = overbought
        if (tech.bollinger.bandwidth < 0.05) techScore += 3;     // squeeze = breakout imminent
      }
      // Stochastic
      if (tech.stochastic) {
        if (tech.stochastic.k < 20) techScore += 5;              // oversold
        else if (tech.stochastic.k > 80) techScore -= 5;         // overbought
        if (tech.stochastic.k > tech.stochastic.d && tech.stochastic.k < 50) techScore += 3; // bullish crossover from low
      }
      techScore = Math.max(0, Math.min(100, techScore));

      // ══════════════════════════════════════════
      // 3. SENTIMENT SCORE (0-100) — stock + sector + AI
      // ══════════════════════════════════════════
      let sentScore = 50;
      // Per-stock sentiment (weight: 60%)
      const avgSent = sent.avgSentiment || 0;
      sentScore += avgSent * 30;
      // Sector sentiment from Webz.io (weight: 40%)
      const secScore = secSent.sentimentScore || 0;
      sentScore += secScore * 20;
      sentScore = Math.max(0, Math.min(100, sentScore));

      // ══════════════════════════════════════════
      // 4. GEOPOLITICAL SCORE (0-100)
      // ══════════════════════════════════════════
      let geoScore = 100 - (geo.threatLevel?.score || 0);
      // Fear gauge adjustment: VIX > 25 = stressed market
      if (vixLevel > 30) geoScore -= 15;
      else if (vixLevel > 25) geoScore -= 8;
      else if (vixLevel < 15) geoScore += 5;
      // Sector-specific scenario impacts
      if (geo.activeScenarios) {
        const stockTags = this.sectorMap[stock.sector] || [];
        for (const scenario of geo.activeScenarios) {
          for (const [impactKey, impact] of Object.entries(scenario.impact || {})) {
            if (stockTags.includes(impactKey)) {
              geoScore += impact * 5;
            }
          }
        }
      }
      geoScore = Math.max(0, Math.min(100, geoScore));

      // ══════════════════════════════════════════
      // VERDICT (0-100) — weighted composite of all signals
      // ══════════════════════════════════════════
      const verdict = Math.round(
        fundScore * 0.25 +
        techScore * 0.25 +
        sentScore * 0.15 +
        geoScore * 0.15 +
        (100 - ((risk.riskScore || 5) * 10)) * 0.20
      );

      // ══════════════════════════════════════════
      // INVEST SCORE (0-100) — how attractive as a buy NOW
      // Emphasizes: value, momentum, analyst consensus, earnings, sector wind
      // ══════════════════════════════════════════
      let investScore = 50;
      // Valuation upside
      if (fund.pe && fund.pe < 20) investScore += 10;
      else if (fund.pe && fund.pe > 35) investScore -= 8;
      // Momentum (technicals)
      if (tech.signal === 'Bullish') investScore += 15;
      else if (tech.signal === 'Oversold') investScore += 10; // bounce opportunity
      else if (tech.signal === 'Bearish') investScore -= 12;
      // RSI sweet spot (not overbought)
      if (tech.rsi && tech.rsi < 40) investScore += 8;
      else if (tech.rsi && tech.rsi > 70) investScore -= 10;
      // Analyst buy consensus
      if (fund.analystScore > 70) investScore += 12;
      else if (fund.analystScore > 55) investScore += 5;
      else if (fund.analystScore < 35) investScore -= 10;
      // Insider buying = smart money signal
      if (fund.insiderNetBuying === true) investScore += 10;
      else if (fund.insiderNetBuying === false) investScore -= 5;
      // Earnings momentum
      if (fund.earningsBeatRate >= 0.75) investScore += 8;
      else if (fund.earningsBeatRate != null && fund.earningsBeatRate < 0.25) investScore -= 8;
      // Revenue growth
      if (fund.revenueGrowth > 15) investScore += 8;
      else if (fund.revenueGrowth < 0) investScore -= 5;
      // Sector tailwind/headwind (from Webz.io)
      if (secScore > 0.3) investScore += 6;
      else if (secScore < -0.3) investScore -= 6;
      // Positive news sentiment
      if (avgSent > 0.3) investScore += 5;
      else if (avgSent < -0.3) investScore -= 5;
      // Market stress penalty (VIX)
      if (vixLevel > 30) investScore -= 8;
      investScore = Math.max(0, Math.min(100, investScore));

      // ══════════════════════════════════════════
      // VULNERABILITY (0-100) — collapse risk
      // 0 = fortress, 100 = fragile / could collapse
      // Emphasizes: debt, earnings misses, insider selling, negative sentiment, overvaluation
      // ══════════════════════════════════════════
      let vulnerability = 20; // baseline: most stocks aren't about to collapse
      // High leverage = structural risk
      if (fund.debtToEquity > 2) vulnerability += 20;
      else if (fund.debtToEquity > 1.5) vulnerability += 12;
      else if (fund.debtToEquity > 1) vulnerability += 5;
      else if (fund.debtToEquity != null && fund.debtToEquity < 0.3) vulnerability -= 8;
      // Extreme overvaluation
      if (fund.pe && fund.pe > 60) vulnerability += 15;
      else if (fund.pe && fund.pe > 40) vulnerability += 8;
      // Revenue decline
      if (fund.revenueGrowth != null && fund.revenueGrowth < -10) vulnerability += 15;
      else if (fund.revenueGrowth != null && fund.revenueGrowth < 0) vulnerability += 8;
      // Earnings misses
      if (fund.earningsBeatRate != null && fund.earningsBeatRate < 0.25) vulnerability += 12;
      else if (fund.earningsBeatRate != null && fund.earningsBeatRate < 0.5) vulnerability += 5;
      // Insider selling = insiders know something
      if (fund.insiderNetBuying === false) vulnerability += 10;
      // Analyst downgrades
      if (fund.analystScore != null && fund.analystScore < 30) vulnerability += 10;
      // Very negative sentiment
      if (avgSent < -0.5) vulnerability += 10;
      else if (avgSent < -0.2) vulnerability += 5;
      // Negative sector sentiment
      if (secScore < -0.3) vulnerability += 6;
      // Bearish technicals (trend breaking down)
      if (tech.signal === 'Bearish') vulnerability += 8;
      // High beta = amplified downside
      if (fund.beta && fund.beta > 1.5) vulnerability += 5;
      // Low margin = thin buffer
      if (fund.operatingMargin != null && fund.operatingMargin < 5) vulnerability += 8;
      // VIX stress = market-wide fragility
      if (vixLevel > 30) vulnerability += 5;
      vulnerability = Math.max(0, Math.min(100, vulnerability));

      // ══════════════════════════════════════════
      // RISK RATING (0-100) — volatility / uncertainty
      // 0 = stable blue chip, 100 = highly volatile/unpredictable
      // ══════════════════════════════════════════
      let riskRating = 30; // baseline
      // Beta is the primary volatility measure
      if (fund.beta) {
        if (fund.beta > 2) riskRating += 25;
        else if (fund.beta > 1.5) riskRating += 15;
        else if (fund.beta > 1.2) riskRating += 8;
        else if (fund.beta < 0.7) riskRating -= 10;
        else if (fund.beta < 1) riskRating -= 5;
      }
      // Wide price range today = volatility
      if (stock.price && stock.high && stock.low) {
        const dayRange = (stock.high - stock.low) / stock.price * 100;
        if (dayRange > 5) riskRating += 15;
        else if (dayRange > 3) riskRating += 8;
      }
      // Volume spike = unusual activity
      if (tech.volumeRatio > 2) riskRating += 10;
      else if (tech.volumeRatio > 1.5) riskRating += 5;
      // RSI extremes = unstable positioning
      if (tech.rsi && (tech.rsi > 80 || tech.rsi < 20)) riskRating += 10;
      else if (tech.rsi && (tech.rsi > 70 || tech.rsi < 30)) riskRating += 5;
      // High debt = financial risk
      if (fund.debtToEquity > 1.5) riskRating += 8;
      // No dividend = less downside buffer
      if (fund.dividendYield != null && fund.dividendYield === 0 && fund.beta && fund.beta > 1.2) riskRating += 5;
      // VIX elevated = market-wide vol
      if (vixLevel > 30) riskRating += 10;
      else if (vixLevel > 25) riskRating += 5;
      // Geopolitical scenarios affecting sector
      if (geo.activeScenarios) {
        const stockTags = this.sectorMap[stock.sector] || [];
        for (const scenario of geo.activeScenarios) {
          for (const [impactKey, impact] of Object.entries(scenario.impact || {})) {
            if (stockTags.includes(impactKey) && impact < 0) {
              riskRating += Math.abs(impact) * 3;
            }
          }
        }
      }
      // ATR-based volatility
      if (tech.atr && stock.price) {
        const atrPct = tech.atr / stock.price * 100;
        if (atrPct > 3) riskRating += 8;
        else if (atrPct < 1) riskRating -= 5;
      }
      riskRating = Math.max(0, Math.min(100, riskRating));

      // ══════════════════════════════════════════
      // CONFIDENCE
      // ══════════════════════════════════════════
      let confidence = 'Medium';
      if (verdict >= 70 || verdict <= 30) confidence = 'High';
      else if (verdict >= 55 || verdict <= 45) confidence = 'Low';

      let verdictLabel = 'Hold';
      if (verdict >= 70) verdictLabel = 'Bullish';
      else if (verdict <= 35) verdictLabel = 'Bearish';
      else if (verdict >= 55) verdictLabel = 'Lean Bullish';
      else if (verdict <= 45) verdictLabel = 'Lean Bearish';

      results.push({
        symbol: stock.symbol,
        company: stock.company,
        sector: stock.sector,
        price: stock.price,
        // Component scores
        fundScore: Math.round(fundScore),
        techScore: Math.round(techScore),
        sentScore: Math.round(sentScore),
        geoScore: Math.round(geoScore),
        // Four ratings
        composite: Math.round(verdict),
        investScore: Math.round(investScore),
        vulnerability: Math.round(vulnerability),
        riskRating: Math.round(riskRating),
        // Labels
        verdict: verdictLabel,
        confidence,
      });
    }

    results.sort((a, b) => b.composite - a.composite);
    ctx.scorecard = results;
    return { stocks: results };
  },

  render(data) {
    if (data.error) return `<p class="text-yellow-500">${data.error}</p>`;

    let html = '<div class="space-y-3">';

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
      const investColor = s.investScore >= 65 ? 'text-green-400' : s.investScore >= 45 ? 'text-yellow-400' : 'text-red-400';
      const vulnColor = s.vulnerability <= 30 ? 'text-green-400' : s.vulnerability <= 55 ? 'text-yellow-400' : 'text-red-400';
      const riskColor = s.riskRating <= 35 ? 'text-green-400' : s.riskRating <= 55 ? 'text-yellow-400' : 'text-red-400';

      html += `<div class="p-4 rounded-lg border border-gray-200 dark:border-gray-800">
        <div class="flex items-center justify-between mb-2">
          <div>
            ${tickerLabel(s.symbol, 'font-bold text-lg')}
            <span class="text-gray-500 dark:text-gray-400 ml-2">${s.company}</span>
            <span class="text-xs text-gray-500 dark:text-gray-500 ml-2">${s.sector}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-2xl font-bold">${s.composite}</span>
            <span class="px-2 py-0.5 rounded-full text-xs font-semibold border ${vc}">${s.verdict}</span>
          </div>
        </div>
        <div class="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-2 mb-3">
          <div class="${barColor} h-2 rounded-full transition-all" style="width:${s.composite}%"></div>
        </div>
        <div class="grid grid-cols-4 gap-3 text-center text-xs mb-2">
          <div class="p-2 rounded bg-gray-50 dark:bg-gray-800/50">
            <div class="text-gray-500 dark:text-gray-400">Verdict</div>
            <div class="text-lg font-bold">${s.composite}</div>
          </div>
          <div class="p-2 rounded bg-gray-50 dark:bg-gray-800/50">
            <div class="text-gray-500 dark:text-gray-400">Invest</div>
            <div class="text-lg font-bold ${investColor}">${s.investScore}</div>
          </div>
          <div class="p-2 rounded bg-gray-50 dark:bg-gray-800/50">
            <div class="text-gray-500 dark:text-gray-400">Vulnerability</div>
            <div class="text-lg font-bold ${vulnColor}">${s.vulnerability}</div>
          </div>
          <div class="p-2 rounded bg-gray-50 dark:bg-gray-800/50">
            <div class="text-gray-500 dark:text-gray-400">Risk</div>
            <div class="text-lg font-bold ${riskColor}">${s.riskRating}</div>
          </div>
        </div>
        <div class="grid grid-cols-4 gap-2 text-center text-[10px] text-gray-500 dark:text-gray-400">
          <div>Fund. <span class="font-bold text-gray-300">${s.fundScore}</span></div>
          <div>Tech. <span class="font-bold text-gray-300">${s.techScore}</span></div>
          <div>Sent. <span class="font-bold text-gray-300">${s.sentScore}</span></div>
          <div>Geo <span class="font-bold text-gray-300">${s.geoScore}</span></div>
        </div>
        <div class="mt-2 text-xs text-gray-500 dark:text-gray-400">Confidence: <span class="font-medium">${s.confidence}</span></div>
      </div>`;
    }

    html += '</div>';
    return html;
  },
};
