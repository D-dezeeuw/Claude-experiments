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

    for (const stock of watchlist) {
      const fundamentals = await this.fetchFundamentals(stock.symbol);
      results.push({
        ...stock,
        ...fundamentals,
      });
    }

    ctx.fundamentals = results;
    return { stocks: results };
  },

  async fetchFundamentals(symbol) {
    if (!CONFIG.FINNHUB_API_KEY) return this.mockFundamentals(symbol);
    try {
      const [metricRes, profileRes] = await Promise.all([
        fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${CONFIG.FINNHUB_API_KEY}`),
        fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${CONFIG.FINNHUB_API_KEY}`),
      ]);
      const metrics = await metricRes.json();
      const profile = await profileRes.json();
      const m = metrics.metric || {};
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
      };
    } catch (e) {
      console.error(`Fundamentals fetch failed for ${symbol}:`, e);
      return this.mockFundamentals(symbol);
    }
  },

  mockFundamentals(symbol) {
    const seed = symbol.charCodeAt(0) + symbol.charCodeAt(1);
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

    if (data.stocks[0]?.mock) {
      html += '<p class="mt-4 text-xs text-yellow-500/70 italic">Demo data — add your Finnhub API key in config.js for live data</p>';
    }

    return html;
  },

  fmt(val, suffix = '') {
    if (val === null || val === undefined) return '-';
    return val + suffix;
  },
};
