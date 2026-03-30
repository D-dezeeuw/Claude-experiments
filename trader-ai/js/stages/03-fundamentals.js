/**
 * Stage 3: Fundamentals Check
 * For each watchlist stock: P/E, revenue, margins, debt, insider activity.
 */
const FundamentalsCheck = {
  id: 'fundamentals',
  name: 'Fundamentals Check',
  description: 'P/E, revenue, margins, debt ratio, insider activity',

  async run(ctx) {
    const watchlist = ctx.watchlist || [];
    if (!watchlist.length) return { error: 'No watchlist — run Stock Screener first', stocks: [] };

    const results = [];
    const BATCH_SIZE = 4; // 4 stocks × 5 calls = 20 per batch (under 60/min limit)

    for (let i = 0; i < watchlist.length; i += BATCH_SIZE) {
      const batch = watchlist.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(stock => this.fetchFundamentals(stock.symbol).then(f => ({ ...stock, ...f })))
      );
      results.push(...batchResults);

      // Rate-limit pause between batches
      if (i + BATCH_SIZE < watchlist.length) {
        await new Promise(r => setTimeout(r, 5000));
      }
    }

    ctx.fundamentals = results;
    return { stocks: results };
  },

  async fetchFundamentals(symbol) {
    if (!CONFIG.FINNHUB_API_KEY) return this.mockFundamentals(symbol);
    try {
      const [metricRes, profileRes, insiderRes, recommendationRes, earningsRes] = await Promise.all([
        fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${CONFIG.FINNHUB_API_KEY}`),
        fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${CONFIG.FINNHUB_API_KEY}`),
        fetch(`https://finnhub.io/api/v1/stock/insider-transactions?symbol=${symbol}&token=${CONFIG.FINNHUB_API_KEY}`).catch(() => null),
        fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${symbol}&token=${CONFIG.FINNHUB_API_KEY}`).catch(() => null),
        fetch(`https://finnhub.io/api/v1/stock/earnings?symbol=${symbol}&token=${CONFIG.FINNHUB_API_KEY}`).catch(() => null),
      ]);
      const metrics = await metricRes.json();
      const profile = await profileRes.json();
      const m = metrics.metric || {};

      // Parse enrichment data (gracefully handle failures)
      const insiderRaw = insiderRes ? await insiderRes.json().catch(() => ({})) : {};
      const recommendationRaw = recommendationRes ? await recommendationRes.json().catch(() => []) : [];
      const earningsRaw = earningsRes ? await earningsRes.json().catch(() => []) : [];

      // Insider transactions — last 10, recent 90 days
      const insiderTransactions = (insiderRaw.data || []).slice(0, 10).map(t => ({
        name: t.name,
        share: t.share,
        change: t.change,
        transactionDate: t.transactionDate,
        transactionType: t.transactionCode, // P=purchase, S=sale
        value: Math.abs((t.change || 0) * (t.transactionPrice || 0)),
      }));

      // Analyst recommendations — last 4 periods
      const analystRecommendations = (Array.isArray(recommendationRaw) ? recommendationRaw : []).slice(0, 4);

      // Earnings history — last 4 quarters
      const earningsHistory = (Array.isArray(earningsRaw) ? earningsRaw : []).slice(0, 4).map(e => ({
        period: e.period,
        actual: e.actual,
        estimate: e.estimate,
        surprise: e.surprise,
        surprisePercent: e.surprisePercent,
      }));

      // Derived scores
      const { insiderNetBuying, insiderScore } = this.computeInsiderScore(insiderTransactions);
      const { analystConsensus, analystScore } = this.computeAnalystScore(analystRecommendations);
      const { earningsBeatRate, avgEarningsSurprise } = this.computeEarningsScore(earningsHistory);

      return {
        pe: m.peNormalizedAnnual || m.peTTM || null,
        marketCap: profile.marketCapitalization || null,
        revenueGrowth: m.revenueGrowthQuarterlyYoy || null,
        grossMargin: m.grossMarginTTM || null,
        operatingMargin: m.operatingMarginTTM || null,
        debtToEquity: m.totalDebtToEquityQuarterly || null,
        roe: m.roeTTM || null,
        dividendYield: m.dividendYieldIndicatedAnnual || null,
        beta: m.beta || null,
        wk52High: m['52WeekHigh'] || null,
        wk52Low: m['52WeekLow'] || null,
        // Enrichment data
        insiderTransactions,
        analystRecommendations,
        earningsHistory,
        // Derived scores
        insiderNetBuying,
        insiderScore,
        analystConsensus,
        analystScore,
        earningsBeatRate,
        avgEarningsSurprise,
      };
    } catch (e) {
      console.error(`Fundamentals fetch failed for ${symbol}:`, e);
      return this.mockFundamentals(symbol);
    }
  },

  computeInsiderScore(transactions) {
    if (!transactions.length) return { insiderNetBuying: null, insiderScore: 50 };
    let buys = 0, sells = 0, buyValue = 0, sellValue = 0;
    for (const t of transactions) {
      if (t.transactionType === 'P') { buys++; buyValue += t.value || 0; }
      else if (t.transactionType === 'S') { sells++; sellValue += t.value || 0; }
    }
    const netBuying = buyValue > sellValue;
    // Score: 50 = neutral, up to 80 for strong buying, down to 20 for strong selling
    let score = 50;
    if (buys > sells) score += Math.min(30, buys * 8);
    else if (sells > buys) score -= Math.min(30, sells * 6);
    if (buyValue > sellValue * 2) score += 10;
    else if (sellValue > buyValue * 2) score -= 10;
    return { insiderNetBuying: netBuying, insiderScore: Math.max(0, Math.min(100, score)) };
  },

  computeAnalystScore(recommendations) {
    if (!recommendations.length) return { analystConsensus: null, analystScore: 50 };
    const latest = recommendations[0];
    const total = (latest.strongBuy || 0) + (latest.buy || 0) + (latest.hold || 0) + (latest.sell || 0) + (latest.strongSell || 0);
    if (total === 0) return { analystConsensus: null, analystScore: 50 };
    const weighted = (
      (latest.strongBuy || 0) * 100 +
      (latest.buy || 0) * 75 +
      (latest.hold || 0) * 50 +
      (latest.sell || 0) * 25 +
      (latest.strongSell || 0) * 0
    ) / total;
    let consensus;
    if (weighted >= 80) consensus = 'Strong Buy';
    else if (weighted >= 65) consensus = 'Buy';
    else if (weighted >= 45) consensus = 'Hold';
    else if (weighted >= 25) consensus = 'Sell';
    else consensus = 'Strong Sell';
    return { analystConsensus: consensus, analystScore: Math.round(weighted) };
  },

  computeEarningsScore(earnings) {
    if (!earnings.length) return { earningsBeatRate: null, avgEarningsSurprise: null };
    let beats = 0, totalSurprise = 0, counted = 0;
    for (const e of earnings) {
      if (e.actual != null && e.estimate != null) {
        if (e.actual > e.estimate) beats++;
        counted++;
      }
      if (e.surprisePercent != null) totalSurprise += e.surprisePercent;
    }
    return {
      earningsBeatRate: counted > 0 ? beats / counted : null,
      avgEarningsSurprise: counted > 0 ? +(totalSurprise / counted).toFixed(2) : null,
    };
  },

  mockFundamentals(symbol) {
    const seed = symbol.charCodeAt(0) + symbol.charCodeAt(1);
    const buys = seed % 4;
    const sells = (seed + 1) % 3;
    return {
      pe: +(15 + (seed % 30)).toFixed(1),
      marketCap: +(50 + (seed % 2000)).toFixed(0) + 'B',
      revenueGrowth: +((seed % 40) - 10).toFixed(1),
      grossMargin: +(30 + (seed % 40)).toFixed(1),
      operatingMargin: +(10 + (seed % 25)).toFixed(1),
      debtToEquity: +(0.2 + (seed % 200) / 100).toFixed(2),
      roe: +(5 + (seed % 35)).toFixed(1),
      dividendYield: +(seed % 5).toFixed(2),
      beta: +(0.5 + (seed % 15) / 10).toFixed(2),
      wk52High: +(100 + seed * 1.5).toFixed(2),
      wk52Low: +(60 + seed * 0.8).toFixed(2),
      // Enrichment mock data
      insiderTransactions: [
        { name: 'CEO', change: buys > 1 ? 5000 : -3000, transactionType: buys > 1 ? 'P' : 'S', transactionDate: '2026-03-15', value: buys > 1 ? 250000 : 150000 },
        { name: 'CFO', change: 2000, transactionType: 'P', transactionDate: '2026-03-10', value: 100000 },
      ],
      analystRecommendations: [
        { period: '2026-03-01', strongBuy: 3 + (seed % 5), buy: 5 + (seed % 4), hold: 4 + (seed % 3), sell: seed % 2, strongSell: 0 },
      ],
      earningsHistory: [
        { period: '2025-Q4', actual: 1.52, estimate: 1.45, surprise: 0.07, surprisePercent: 4.8 },
        { period: '2025-Q3', actual: 1.38, estimate: 1.40, surprise: -0.02, surprisePercent: -1.4 },
        { period: '2025-Q2', actual: 1.29, estimate: 1.22, surprise: 0.07, surprisePercent: 5.7 },
        { period: '2025-Q1', actual: 1.15, estimate: 1.10, surprise: 0.05, surprisePercent: 4.5 },
      ],
      insiderNetBuying: buys > sells,
      insiderScore: 50 + (buys - sells) * 10,
      analystConsensus: 'Buy',
      analystScore: 65 + (seed % 15),
      earningsBeatRate: 0.75,
      avgEarningsSurprise: 3.4,
      mock: true,
    };
  },

  render(data) {
    if (data.error) {
      return `<p class="text-yellow-500">${data.error}</p>`;
    }

    let html = '<div class="overflow-x-auto"><table class="w-full text-sm">';
    html += '<thead><tr class="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">';
    html += '<th class="pb-2 pr-3">Symbol</th><th class="pb-2 pr-3 text-right">P/E</th><th class="pb-2 pr-3 text-right">Rev Growth</th><th class="pb-2 pr-3 text-right">Gross Margin</th><th class="pb-2 pr-3 text-right">Op Margin</th><th class="pb-2 pr-3 text-right">D/E</th><th class="pb-2 pr-3 text-right">ROE</th><th class="pb-2 text-right">Beta</th></tr></thead><tbody>';

    for (const s of data.stocks) {
      const deColor = s.debtToEquity > 1.5 ? 'text-red-500' : s.debtToEquity > 0.8 ? 'text-yellow-500' : 'text-green-500';
      const peColor = s.pe > 40 ? 'text-red-400' : s.pe > 25 ? 'text-yellow-400' : 'text-green-400';
      const revColor = s.revenueGrowth > 10 ? 'text-green-500' : s.revenueGrowth > 0 ? 'text-gray-300' : 'text-red-500';

      html += `<tr class="border-b border-gray-100 dark:border-gray-800/50">
        <td class="py-2 pr-3">${tickerLabel(s.symbol, 'font-bold')}</td>
        <td class="py-2 pr-3 text-right font-mono ${peColor}">${this.fmt(s.pe)}</td>
        <td class="py-2 pr-3 text-right font-mono ${revColor}">${this.fmt(s.revenueGrowth, '%')}</td>
        <td class="py-2 pr-3 text-right font-mono">${this.fmt(s.grossMargin, '%')}</td>
        <td class="py-2 pr-3 text-right font-mono">${this.fmt(s.operatingMargin, '%')}</td>
        <td class="py-2 pr-3 text-right font-mono ${deColor}">${this.fmt(s.debtToEquity)}</td>
        <td class="py-2 pr-3 text-right font-mono">${this.fmt(s.roe, '%')}</td>
        <td class="py-2 text-right font-mono">${this.fmt(s.beta)}</td>
      </tr>`;
    }

    html += '</tbody></table></div>';

    // Enrichment panels
    html += this.renderInsiderPanel(data.stocks);
    html += this.renderAnalystPanel(data.stocks);
    html += this.renderEarningsPanel(data.stocks);

    if (data.stocks[0]?.mock) {
      html += '<p class="mt-4 text-xs text-yellow-500/70 italic">Demo data — add your Finnhub API key in config.js for live data</p>';
    }

    return html;
  },

  renderInsiderPanel(stocks) {
    const hasData = stocks.some(s => s.insiderTransactions?.length);
    if (!hasData) return '';

    let html = '<div class="mt-6"><h4 class="text-sm font-semibold mb-3">Insider Activity</h4>';
    html += '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">';

    for (const s of stocks) {
      const txns = s.insiderTransactions || [];
      if (!txns.length) continue;

      let buys = 0, sells = 0, buyVal = 0, sellVal = 0;
      for (const t of txns) {
        if (t.transactionType === 'P') { buys++; buyVal += t.value || 0; }
        else if (t.transactionType === 'S') { sells++; sellVal += t.value || 0; }
      }
      const net = buyVal - sellVal;
      const signalColor = net > 0 ? 'text-green-400' : net < 0 ? 'text-red-400' : 'text-gray-400';
      const signalLabel = net > 0 ? 'Net Buying' : net < 0 ? 'Net Selling' : 'Neutral';

      html += `<div class="p-3 rounded-lg border border-gray-100 dark:border-gray-800">
        <div class="flex items-center justify-between mb-2">
          ${tickerLabel(s.symbol, 'font-bold text-sm')}
          <span class="text-xs font-semibold ${signalColor}">${signalLabel}</span>
        </div>
        <div class="flex gap-3 text-xs text-gray-500 dark:text-gray-400">
          <span class="text-green-400">${buys} buy${buys !== 1 ? 's' : ''}</span>
          <span class="text-red-400">${sells} sell${sells !== 1 ? 's' : ''}</span>
          <span class="font-mono ${signalColor}">$${this.fmtCompact(Math.abs(net))}</span>
        </div>
      </div>`;
    }
    html += '</div></div>';
    return html;
  },

  renderAnalystPanel(stocks) {
    const hasData = stocks.some(s => s.analystRecommendations?.length);
    if (!hasData) return '';

    let html = '<div class="mt-6"><h4 class="text-sm font-semibold mb-3">Analyst Consensus</h4>';
    html += '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">';

    for (const s of stocks) {
      const recs = s.analystRecommendations || [];
      if (!recs.length) continue;
      const r = recs[0];
      const total = (r.strongBuy || 0) + (r.buy || 0) + (r.hold || 0) + (r.sell || 0) + (r.strongSell || 0);
      if (total === 0) continue;

      const consColor = {
        'Strong Buy': 'text-green-400', 'Buy': 'text-green-300', 'Hold': 'text-yellow-400',
        'Sell': 'text-red-300', 'Strong Sell': 'text-red-400',
      };

      html += `<div class="p-3 rounded-lg border border-gray-100 dark:border-gray-800">
        <div class="flex items-center justify-between mb-2">
          ${tickerLabel(s.symbol, 'font-bold text-sm')}
          <span class="text-xs font-semibold ${consColor[s.analystConsensus] || 'text-gray-400'}">${s.analystConsensus || '-'} (${s.analystScore})</span>
        </div>
        <div class="flex h-2 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-800">
          <div class="bg-green-600" style="width:${(r.strongBuy / total * 100).toFixed(0)}%" title="Strong Buy: ${r.strongBuy}"></div>
          <div class="bg-green-400" style="width:${(r.buy / total * 100).toFixed(0)}%" title="Buy: ${r.buy}"></div>
          <div class="bg-yellow-400" style="width:${(r.hold / total * 100).toFixed(0)}%" title="Hold: ${r.hold}"></div>
          <div class="bg-red-400" style="width:${(r.sell / total * 100).toFixed(0)}%" title="Sell: ${r.sell}"></div>
          <div class="bg-red-600" style="width:${(r.strongSell / total * 100).toFixed(0)}%" title="Strong Sell: ${r.strongSell}"></div>
        </div>
        <div class="flex justify-between mt-1 text-[10px] text-gray-500">
          <span>${r.strongBuy} SB · ${r.buy} B</span>
          <span>${r.hold} H</span>
          <span>${r.sell} S · ${r.strongSell || 0} SS</span>
        </div>
      </div>`;
    }
    html += '</div></div>';
    return html;
  },

  renderEarningsPanel(stocks) {
    const hasData = stocks.some(s => s.earningsHistory?.length);
    if (!hasData) return '';

    let html = '<div class="mt-6"><h4 class="text-sm font-semibold mb-3">Earnings History</h4>';
    html += '<div class="overflow-x-auto"><table class="w-full text-sm">';
    html += '<thead><tr class="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">';
    html += '<th class="pb-2 pr-3">Symbol</th>';

    // Get max quarters across all stocks for headers
    const maxQ = Math.max(...stocks.map(s => (s.earningsHistory || []).length), 0);
    for (let i = 0; i < Math.min(maxQ, 4); i++) {
      html += `<th class="pb-2 pr-3 text-center" colspan="2">Q${i + 1}</th>`;
    }
    html += '<th class="pb-2 text-right">Beat Rate</th></tr></thead><tbody>';

    for (const s of stocks) {
      const earnings = s.earningsHistory || [];
      if (!earnings.length) continue;

      html += `<tr class="border-b border-gray-100 dark:border-gray-800/50">`;
      html += `<td class="py-2 pr-3">${tickerLabel(s.symbol, 'font-bold')}</td>`;

      for (let i = 0; i < Math.min(earnings.length, 4); i++) {
        const e = earnings[i];
        const beat = e.actual != null && e.estimate != null && e.actual > e.estimate;
        const miss = e.actual != null && e.estimate != null && e.actual < e.estimate;
        const surpriseColor = beat ? 'text-green-400' : miss ? 'text-red-400' : 'text-gray-400';
        html += `<td class="py-2 pr-1 text-right font-mono text-xs">${e.actual != null ? e.actual.toFixed(2) : '-'}</td>`;
        html += `<td class="py-2 pr-3 text-xs ${surpriseColor}">${e.surprisePercent != null ? (e.surprisePercent >= 0 ? '+' : '') + e.surprisePercent.toFixed(1) + '%' : ''}</td>`;
      }

      // Fill empty columns if less than maxQ
      for (let i = earnings.length; i < Math.min(maxQ, 4); i++) {
        html += `<td class="py-2 pr-1"></td><td class="py-2 pr-3"></td>`;
      }

      const beatColor = s.earningsBeatRate >= 0.75 ? 'text-green-400' : s.earningsBeatRate >= 0.5 ? 'text-yellow-400' : 'text-red-400';
      html += `<td class="py-2 text-right font-mono ${beatColor}">${s.earningsBeatRate != null ? Math.round(s.earningsBeatRate * 100) + '%' : '-'}</td>`;
      html += `</tr>`;
    }

    html += '</tbody></table></div></div>';
    return html;
  },

  fmtCompact(num) {
    if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
    if (num >= 1e3) return (num / 1e3).toFixed(0) + 'K';
    return num.toFixed(0);
  },

  fmt(val, suffix = '') {
    if (val === null || val === undefined) return '-';
    return val + suffix;
  },
};
