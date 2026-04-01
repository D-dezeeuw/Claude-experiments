/**
 * Stage: Correlation Matrix
 * Computes pairwise Pearson correlation on daily returns across all stocks.
 * Uses cached price history (60 candles) — no API calls needed.
 */
const CorrelationMatrix = {
  id: 'correlation',
  name: 'Correlation Matrix',
  description: 'Cross-asset return correlations and sector clustering',

  async run(ctx) {
    // Use full universe, not just watchlist
    const universe = typeof StockScreener !== 'undefined' ? StockScreener.universe : [];
    if (!universe.length) return { error: 'No stock universe available', sectors: [], pairs: [] };

    // Collect daily returns for each stock
    const returns = {};
    const validSymbols = [];

    for (const stock of universe) {
      const candles = History.getCandles(stock.symbol);
      if (candles.length < 10) continue; // need minimum data
      const closes = candles.map(c => c.close);
      const dailyReturns = [];
      for (let i = 1; i < closes.length; i++) {
        dailyReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
      }
      returns[stock.symbol] = dailyReturns;
      validSymbols.push(stock);
    }

    if (validSymbols.length < 2) return { error: 'Need price history for at least 2 stocks. Run the pipeline first.', sectors: [], pairs: [] };

    // Find common length (shortest return series)
    const minLen = Math.min(...Object.values(returns).map(r => r.length));

    // Trim all to same length (most recent N days)
    for (const sym of Object.keys(returns)) {
      returns[sym] = returns[sym].slice(-minLen);
    }

    // Compute pairwise Pearson correlation
    const matrix = {};
    const pairs = [];

    for (let i = 0; i < validSymbols.length; i++) {
      const a = validSymbols[i].symbol;
      matrix[a] = {};
      for (let j = 0; j < validSymbols.length; j++) {
        const b = validSymbols[j].symbol;
        if (i === j) { matrix[a][b] = 1; continue; }
        if (matrix[b] && matrix[b][a] !== undefined) { matrix[a][b] = matrix[b][a]; continue; }
        const corr = this.pearson(returns[a], returns[b]);
        matrix[a][b] = corr;
        if (i < j) pairs.push({ a, b, corr: +corr.toFixed(3) });
      }
    }

    // Sector-level averages
    const sectors = {};
    const sectorNames = [...new Set(validSymbols.map(s => s.sector))];
    for (const s1 of sectorNames) {
      sectors[s1] = {};
      const s1Syms = validSymbols.filter(s => s.sector === s1).map(s => s.symbol);
      for (const s2 of sectorNames) {
        const s2Syms = validSymbols.filter(s => s.sector === s2).map(s => s.symbol);
        let sum = 0, count = 0;
        for (const a of s1Syms) {
          for (const b of s2Syms) {
            if (a === b) continue;
            sum += matrix[a][b];
            count++;
          }
        }
        sectors[s1][s2] = count > 0 ? +(sum / count).toFixed(2) : 0;
      }
    }

    // Sort pairs by correlation
    pairs.sort((a, b) => b.corr - a.corr);

    return {
      matrix,
      sectors,
      sectorNames,
      symbols: validSymbols.map(s => ({ symbol: s.symbol, sector: s.sector })),
      topCorrelated: pairs.slice(0, 5),
      leastCorrelated: pairs.slice(-5).reverse(),
      dataPoints: minLen,
      stockCount: validSymbols.length,
    };
  },

  pearson(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 5) return 0;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += x[i]; sumY += y[i];
      sumXY += x[i] * y[i];
      sumX2 += x[i] * x[i]; sumY2 += y[i] * y[i];
    }
    const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  },

  render(data) {
    if (data.error) return `<p class="text-yellow-500">${data.error}</p>`;

    let html = `<p class="text-sm text-gray-500 dark:text-gray-400 mb-4">${data.stockCount} stocks · ${data.dataPoints} trading days of return data</p>`;

    // Sector-level heatmap
    html += '<h4 class="text-sm font-semibold mb-2">Sector Correlations</h4>';
    html += '<div class="overflow-x-auto mb-6"><table class="text-[10px]">';
    html += '<thead><tr><th></th>';
    for (const s of data.sectorNames) {
      html += `<th class="px-1 py-1 text-center font-normal text-gray-500" style="writing-mode:vertical-lr;transform:rotate(180deg);max-width:20px">${s}</th>`;
    }
    html += '</tr></thead><tbody>';

    for (const s1 of data.sectorNames) {
      html += `<tr><td class="pr-2 text-right text-gray-500 whitespace-nowrap">${s1}</td>`;
      for (const s2 of data.sectorNames) {
        const corr = data.sectors[s1][s2];
        const bg = this.corrColor(s1 === s2 ? 1 : corr);
        html += `<td class="px-1 py-1 text-center font-mono" style="background:${bg};min-width:28px" title="${s1} vs ${s2}: ${corr}">${s1 === s2 ? '' : corr}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table></div>';

    // Top/bottom correlated pairs
    html += '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">';

    html += '<div><h4 class="text-sm font-semibold mb-2">Most Correlated Pairs</h4>';
    html += '<div class="space-y-1">';
    for (const p of data.topCorrelated) {
      const bg = this.corrColor(p.corr);
      html += `<div class="flex items-center justify-between text-xs p-1.5 rounded" style="background:${bg}">
        <span>${tickerLabel(p.a, 'font-bold')} — ${tickerLabel(p.b, 'font-bold')}</span>
        <span class="font-mono font-bold">${p.corr}</span>
      </div>`;
    }
    html += '</div></div>';

    html += '<div><h4 class="text-sm font-semibold mb-2">Least Correlated Pairs</h4>';
    html += '<div class="space-y-1">';
    for (const p of data.leastCorrelated) {
      const bg = this.corrColor(p.corr);
      html += `<div class="flex items-center justify-between text-xs p-1.5 rounded" style="background:${bg}">
        <span>${tickerLabel(p.a, 'font-bold')} — ${tickerLabel(p.b, 'font-bold')}</span>
        <span class="font-mono font-bold">${p.corr}</span>
      </div>`;
    }
    html += '</div></div>';

    html += '</div>';
    return html;
  },

  corrColor(corr) {
    // -1 = red, 0 = neutral gray, +1 = green
    if (corr >= 0) {
      const intensity = Math.min(corr, 1);
      return `rgba(34,197,94,${(intensity * 0.4).toFixed(2)})`;
    } else {
      const intensity = Math.min(Math.abs(corr), 1);
      return `rgba(239,68,68,${(intensity * 0.4).toFixed(2)})`;
    }
  },
};
