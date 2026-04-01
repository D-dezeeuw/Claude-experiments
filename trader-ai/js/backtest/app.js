/**
 * Backtest Page — UI Controller with Scenario Tabs
 */
const BACKTEST_UNIVERSE = [
  { symbol: 'XOM', company: 'ExxonMobil' }, { symbol: 'CVX', company: 'Chevron' },
  { symbol: 'DOW', company: 'Dow Inc.' }, { symbol: 'DD', company: 'DuPont' },
  { symbol: 'FCX', company: 'Freeport-McMoRan' }, { symbol: 'NEM', company: 'Newmont' },
  { symbol: 'BA', company: 'Boeing' }, { symbol: 'CAT', company: 'Caterpillar' },
  { symbol: 'HON', company: 'Honeywell' }, { symbol: 'LMT', company: 'Lockheed Martin' },
  { symbol: 'MMM', company: '3M' }, { symbol: 'AMZN', company: 'Amazon' },
  { symbol: 'TSLA', company: 'Tesla' }, { symbol: 'HD', company: 'Home Depot' },
  { symbol: 'F', company: 'Ford' }, { symbol: 'GM', company: 'General Motors' },
  { symbol: 'PG', company: 'P&G' }, { symbol: 'PEP', company: 'PepsiCo' },
  { symbol: 'KHC', company: 'Kraft Heinz' }, { symbol: 'GIS', company: 'General Mills' },
  { symbol: 'CL', company: 'Colgate-Palmolive' }, { symbol: 'JNJ', company: 'J&J' },
  { symbol: 'PFE', company: 'Pfizer' }, { symbol: 'MRK', company: 'Merck' },
  { symbol: 'ABBV', company: 'AbbVie' }, { symbol: 'AMGN', company: 'Amgen' },
  { symbol: 'LLY', company: 'Eli Lilly' }, { symbol: 'GILD', company: 'Gilead' },
  { symbol: 'JPM', company: 'JPMorgan' }, { symbol: 'GS', company: 'Goldman Sachs' },
  { symbol: 'WFC', company: 'Wells Fargo' }, { symbol: 'V', company: 'Visa' },
  { symbol: 'MA', company: 'Mastercard' }, { symbol: 'MSFT', company: 'Microsoft' },
  { symbol: 'NVDA', company: 'NVIDIA' }, { symbol: 'GOOGL', company: 'Alphabet' },
  { symbol: 'META', company: 'Meta' }, { symbol: 'ORCL', company: 'Oracle' },
  { symbol: 'INTC', company: 'Intel' }, { symbol: 'T', company: 'AT&T' },
  { symbol: 'VZ', company: 'Verizon' }, { symbol: 'DIS', company: 'Disney' },
  { symbol: 'NFLX', company: 'Netflix' }, { symbol: 'NEE', company: 'NextEra' },
  { symbol: 'DUK', company: 'Duke Energy' }, { symbol: 'SO', company: 'Southern Co' },
  { symbol: 'PLD', company: 'Prologis' }, { symbol: 'AMT', company: 'American Tower' },
  { symbol: 'VNO', company: 'Vornado' },
];

const BacktestApp = {
  candles: [],
  lastResult: null,

  init() {
    initSupabase();
    const sel = document.getElementById('bt-symbol');
    for (const s of BACKTEST_UNIVERSE) {
      const opt = document.createElement('option');
      opt.value = s.symbol;
      opt.textContent = s.symbol + ' — ' + s.company;
      sel.appendChild(opt);
    }
    const stratSel = document.getElementById('bt-strategy');
    for (const s of Strategies.list) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      stratSel.appendChild(opt);
    }
    stratSel.onchange = () => this.renderParams();
    this.renderParams();
  },

  renderParams() {
    const strat = Strategies.get(document.getElementById('bt-strategy').value);
    const el = document.getElementById('bt-params');
    if (!strat) { el.innerHTML = ''; return; }
    let html = '';
    for (const [key, val] of Object.entries(strat.params)) {
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
      html += `<div><label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">${label}</label>
        <input type="number" id="param-${key}" value="${val}" class="w-24 px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-mono"></div>`;
    }
    el.innerHTML = html;
  },

  getParams() {
    const strat = Strategies.get(document.getElementById('bt-strategy').value);
    if (!strat) return {};
    const params = { ...strat.params };
    for (const key of Object.keys(params)) {
      const input = document.getElementById('param-' + key);
      if (input) params[key] = parseFloat(input.value) || params[key];
    }
    return params;
  },

  switchTab(tabId) {
    document.querySelectorAll('.scenario-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.scenario-tab').forEach(el => {
      el.classList.remove('border-blue-500', 'text-blue-500');
      el.classList.add('border-transparent', 'text-gray-500');
    });
    const tab = document.getElementById('tab-' + tabId);
    if (tab) tab.classList.remove('hidden');
    const btn = document.querySelector(`[data-tab="${tabId}"]`);
    if (btn) { btn.classList.add('border-blue-500', 'text-blue-500'); btn.classList.remove('border-transparent', 'text-gray-500'); }

    // Lazy-render scenario tabs
    if (tabId === 'validation' && this.candles.length) this.renderValidation();
    if (tabId === 'sizing' && this.lastResult) this.renderSizing();
    if (tabId === 'compare' && this.candles.length) this.renderComparison();
  },

  async run() {
    const symbol = document.getElementById('bt-symbol').value;
    const stratId = document.getElementById('bt-strategy').value;
    const capital = parseFloat(document.getElementById('bt-capital').value) || 10000;
    const strat = Strategies.get(stratId);
    if (!strat) return;

    const statusEl = document.getElementById('bt-status');
    statusEl.textContent = 'Loading history for ' + symbol + '...';

    this.candles = await BacktestEngine.loadFullHistory(symbol);
    if (!this.candles.length) { statusEl.textContent = 'No history in Supabase for ' + symbol; return; }
    this.candles.sort((a, b) => a.date.localeCompare(b.date));

    statusEl.textContent = 'Running on ' + this.candles.length + ' candles...';
    const params = this.getParams();
    this.lastResult = BacktestEngine.run(this.candles, strat.fn, params, capital);
    this.lastResult._symbol = symbol;
    this.lastResult._capital = capital;
    this.lastResult._stratName = strat.name;

    statusEl.textContent = strat.name + ' on ' + symbol + ' · ' + this.candles.length + ' days · ' + this.lastResult.trades.length + ' trades';

    document.getElementById('bt-tabs').classList.remove('hidden');
    this.renderResults();
    this.switchTab('results');
  },

  // ═══════════════════════════════════════
  // TAB: Results
  // ═══════════════════════════════════════
  renderResults() {
    const r = this.lastResult;
    this.renderMetrics(r.metrics, r._capital, 'bt-metrics');
    this.renderChart(r.equity, 'bt-chart');
    this.renderTrades(r.trades, 'bt-trades');
  },

  // ═══════════════════════════════════════
  // TAB: Validation (Walk-Forward)
  // ═══════════════════════════════════════
  renderValidation() {
    const strat = Strategies.get(document.getElementById('bt-strategy').value);
    if (!strat || !this.candles.length) return;
    const params = this.getParams();
    const capital = parseFloat(document.getElementById('bt-capital').value) || 10000;
    const wf = BacktestEngine.walkForward(this.candles, strat.fn, params, capital, 0.7);

    const el = document.getElementById('bt-validation');
    const verdictColor = { Robust: 'text-green-400', Acceptable: 'text-yellow-400', Questionable: 'text-orange-400', Overfitted: 'text-red-400' };

    let html = `<div class="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <h3 class="text-sm font-semibold mb-1">Walk-Forward Validation (70/30 split)</h3>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">Tests if the strategy works on unseen data. A robust strategy performs similarly on both periods.</p>
      <div class="flex items-center gap-3 mb-4">
        <span class="text-lg font-bold ${verdictColor[wf.verdict] || 'text-gray-400'}">${wf.verdict}</span>
        <span class="text-sm text-gray-500">Overfit score: ${wf.overfit}/100</span>
      </div>`;

    // Comparison table
    html += '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">';
    html += '<th class="pb-2 pr-3">Metric</th><th class="pb-2 pr-3 text-right">Training (70%)</th><th class="pb-2 text-right">Testing (30%)</th></tr></thead><tbody>';

    const rows = [
      ['Period', wf.train.period, wf.test.period],
      ['Data Points', wf.train.candles, wf.test.candles],
      ['Return', wf.train.totalReturn + '%', wf.test.totalReturn + '%'],
      ['Sharpe', wf.train.sharpe, wf.test.sharpe],
      ['Win Rate', wf.train.winRate + '%', wf.test.winRate + '%'],
      ['Max Drawdown', wf.train.maxDrawdown + '%', wf.test.maxDrawdown + '%'],
      ['Trades', wf.train.tradeCount, wf.test.tradeCount],
    ];
    for (const [label, train, test] of rows) {
      html += `<tr class="border-b border-gray-100 dark:border-gray-800/50"><td class="py-2 pr-3 text-gray-500">${label}</td><td class="py-2 pr-3 text-right font-mono">${train}</td><td class="py-2 text-right font-mono">${test}</td></tr>`;
    }
    html += '</tbody></table></div>';

    // Decision box
    const isRobust = wf.overfit < 40;
    html += `<div class="mt-4 p-3 rounded-lg ${isRobust ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20'}">
      <div class="text-sm font-semibold ${isRobust ? 'text-green-400' : 'text-red-400'}">${isRobust ? 'Strategy appears valid for live use' : 'Strategy may be overfitted — use with caution'}</div>
      <div class="text-xs text-gray-500 mt-1">${isRobust ? 'Out-of-sample performance is consistent with in-sample. Consider using Half-Kelly sizing.' : 'Test period shows significantly worse results. Consider different parameters or a simpler strategy.'}</div>
    </div>`;

    html += '</div>';
    el.innerHTML = html;
  },

  // ═══════════════════════════════════════
  // TAB: Position Sizing
  // ═══════════════════════════════════════
  renderSizing() {
    const r = this.lastResult;
    if (!r) return;
    const capital = r._capital;
    const lastPrice = this.candles.length ? this.candles[this.candles.length - 1].close : 100;
    const sizing = BacktestEngine.positionSizing(r.metrics, capital, lastPrice);

    const el = document.getElementById('bt-sizing');
    let html = `<div class="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <h3 class="text-sm font-semibold mb-1">Position Sizing Calculator</h3>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">Based on backtest win rate (${r.metrics.winRate}%) and avg win/loss ratio. Capital: $${capital.toLocaleString()}, Stock price: $${lastPrice.toFixed(2)}</p>`;

    // Sizing cards
    html += '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">';

    const methods = [
      { name: 'Kelly Criterion', data: sizing.kelly, desc: 'Mathematically optimal — maximizes long-term growth. Often too aggressive.', color: 'border-red-500/30' },
      { name: 'Half-Kelly (recommended)', data: sizing.halfKelly, desc: 'Half the Kelly fraction — balances growth with safety. Industry standard.', color: 'border-green-500/30' },
      { name: 'Fixed Fractional (2%)', data: sizing.fixedFractional, desc: 'Risk 2% of capital per trade. Conservative, good for beginners.', color: 'border-blue-500/30' },
      { name: 'Risk-Parity', data: sizing.riskParity, desc: 'Sized by volatility — smaller positions in volatile stocks. Vol adj: ' + sizing.riskParity.volAdj + 'x', color: 'border-yellow-500/30' },
    ];

    for (const m of methods) {
      html += `<div class="p-4 rounded-lg border ${m.color} bg-gray-50 dark:bg-gray-800/30">
        <div class="text-sm font-semibold mb-1">${m.name}</div>
        <div class="text-2xl font-bold font-mono mb-1">${m.data.shares} shares</div>
        <div class="text-xs text-gray-500 mb-2">$${(m.data.value || m.data.shares * lastPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })} · ${m.data.pctCapital || m.data.riskPct || '—'}% of capital</div>
        <div class="text-[10px] text-gray-500">${m.desc}</div>
      </div>`;
    }
    html += '</div>';

    // Recommendation
    html += `<div class="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
      <div class="text-sm font-semibold text-blue-400">Recommendation: ${sizing.recommendation}</div>
      <div class="text-xs text-gray-500 mt-1">Based on ${r.metrics.tradeCount} trades, ${r.metrics.winRate}% win rate, avg win $${r.metrics.avgWin} / avg loss $${r.metrics.avgLoss}</div>
    </div>`;

    html += '</div>';
    el.innerHTML = html;
  },

  // ═══════════════════════════════════════
  // TAB: Strategy Comparison
  // ═══════════════════════════════════════
  async renderComparison() {
    const el = document.getElementById('bt-compare');
    el.innerHTML = '<p class="text-sm text-gray-500">Comparing all strategies + buy-and-hold benchmark...</p>';

    const capital = parseFloat(document.getElementById('bt-capital').value) || 10000;
    const results = await BacktestEngine.compareStrategies(this.candles, capital);

    let html = `<div class="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <h3 class="text-sm font-semibold mb-1">Strategy Comparison</h3>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-4">All strategies tested on the same ${this.candles.length} candles with $${capital.toLocaleString()} capital</p>`;

    // Comparison table
    html += '<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">';
    html += '<th class="pb-2 pr-3">Strategy</th><th class="pb-2 pr-3 text-right">Return</th><th class="pb-2 pr-3 text-right">Sharpe</th><th class="pb-2 pr-3 text-right">Drawdown</th><th class="pb-2 pr-3 text-right">Win Rate</th><th class="pb-2 text-right">Trades</th></tr></thead><tbody>';

    // Sort by return
    results.sort((a, b) => b.metrics.totalReturn - a.metrics.totalReturn);

    for (const r of results) {
      const retColor = r.metrics.totalReturn >= 0 ? 'text-green-400' : 'text-red-400';
      const isBest = r === results[0];
      const rowClass = isBest ? 'bg-green-500/5' : '';
      html += `<tr class="border-b border-gray-100 dark:border-gray-800/50 ${rowClass}">
        <td class="py-2 pr-3 font-medium">${r.name}${isBest ? ' <span class="text-[10px] text-green-400 ml-1">BEST</span>' : ''}</td>
        <td class="py-2 pr-3 text-right font-mono font-bold ${retColor}">${r.metrics.totalReturn >= 0 ? '+' : ''}${r.metrics.totalReturn}%</td>
        <td class="py-2 pr-3 text-right font-mono">${r.metrics.sharpe}</td>
        <td class="py-2 pr-3 text-right font-mono">${r.metrics.maxDrawdown}%</td>
        <td class="py-2 pr-3 text-right font-mono">${r.metrics.winRate}%</td>
        <td class="py-2 text-right font-mono">${r.metrics.tradeCount}</td>
      </tr>`;
    }
    html += '</tbody></table></div>';

    // Overlay equity curves
    html += '<div class="mt-6"><h4 class="text-sm font-semibold mb-2">Equity Curves</h4>';
    html += this.renderMultiChart(results, capital);
    html += '</div>';

    // Decision box
    const best = results[0];
    const benchmark = results.find(r => r.id === 'buy-and-hold');
    const beatsBenchmark = benchmark && best.id !== 'buy-and-hold';

    html += `<div class="mt-4 p-3 rounded-lg ${beatsBenchmark ? 'bg-green-500/10 border border-green-500/20' : 'bg-yellow-500/10 border border-yellow-500/20'}">
      <div class="text-sm font-semibold ${beatsBenchmark ? 'text-green-400' : 'text-yellow-400'}">${beatsBenchmark ? best.name + ' beats buy-and-hold by ' + (best.metrics.totalReturn - benchmark.metrics.totalReturn).toFixed(1) + 'pp' : 'No strategy beats buy-and-hold on this data'}</div>
      <div class="text-xs text-gray-500 mt-1">${beatsBenchmark ? 'Active strategy adds value. Consider validation tab to check robustness.' : 'Simple buy-and-hold would have been better. This is common in trending markets.'}</div>
    </div>`;

    html += '</div>';
    el.innerHTML = html;
  },

  // ═══════════════════════════════════════
  // Shared render helpers
  // ═══════════════════════════════════════
  renderMetrics(m, capital, containerId) {
    const el = document.getElementById(containerId);
    const returnColor = m.totalReturn >= 0 ? 'text-green-400' : 'text-red-400';
    const sharpeColor = m.sharpe >= 1 ? 'text-green-400' : m.sharpe >= 0 ? 'text-yellow-400' : 'text-red-400';
    const ddColor = m.maxDrawdown < 10 ? 'text-green-400' : m.maxDrawdown < 25 ? 'text-yellow-400' : 'text-red-400';
    const wrColor = m.winRate >= 55 ? 'text-green-400' : m.winRate >= 45 ? 'text-yellow-400' : 'text-red-400';

    el.innerHTML = `
      <div class="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 text-center">
        <div class="text-xs text-gray-500 dark:text-gray-400">Total Return</div>
        <div class="text-2xl font-bold ${returnColor}">${m.totalReturn >= 0 ? '+' : ''}${m.totalReturn}%</div>
        <div class="text-xs text-gray-500">$${capital.toLocaleString()} → $${m.finalEquity.toLocaleString()}</div>
      </div>
      <div class="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 text-center">
        <div class="text-xs text-gray-500 dark:text-gray-400">Sharpe Ratio</div>
        <div class="text-2xl font-bold ${sharpeColor}">${m.sharpe}</div>
        <div class="text-xs text-gray-500">${m.sharpe >= 1 ? 'Good' : m.sharpe >= 0.5 ? 'Acceptable' : 'Poor'}</div>
      </div>
      <div class="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 text-center">
        <div class="text-xs text-gray-500 dark:text-gray-400">Max Drawdown</div>
        <div class="text-2xl font-bold ${ddColor}">${m.maxDrawdown}%</div>
        <div class="text-xs text-gray-500">${m.tradeCount} trades</div>
      </div>
      <div class="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 text-center">
        <div class="text-xs text-gray-500 dark:text-gray-400">Win Rate</div>
        <div class="text-2xl font-bold ${wrColor}">${m.winRate}%</div>
        <div class="text-xs text-gray-500">Avg W: $${m.avgWin} / L: $${m.avgLoss}</div>
      </div>`;
  },

  renderChart(equity, containerId) {
    const el = document.getElementById(containerId);
    if (!equity.length) { el.innerHTML = '<p class="text-gray-500">No data</p>'; return; }
    const width = el.clientWidth || 700;
    const height = 200;
    const p = 5;
    const values = equity.map(e => e.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = equity.map((e, i) => {
      const x = p + (i / (equity.length - 1)) * (width - 2 * p);
      const y = height - p - ((e.value - min) / range) * (height - 2 * p);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    const up = values[values.length - 1] >= values[0];
    const color = up ? '#22c55e' : '#ef4444';
    el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" class="w-full" style="height:${height}px">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
      <text x="${p}" y="15" fill="#9ca3af" font-size="11" font-family="monospace">$${values[0].toLocaleString()}</text>
      <text x="${width - p}" y="15" fill="${color}" font-size="11" font-family="monospace" text-anchor="end">$${values[values.length - 1].toLocaleString()}</text>
    </svg>`;
  },

  renderMultiChart(results, capital) {
    const width = 700;
    const height = 200;
    const p = 5;
    const colors = ['#22c55e', '#3b82f6', '#eab308', '#ef4444', '#a855f7'];
    const allValues = results.flatMap(r => r.equity.map(e => e.value));
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const range = max - min || 1;
    const maxLen = Math.max(...results.map(r => r.equity.length));

    let svg = `<svg viewBox="0 0 ${width} ${height}" class="w-full" style="height:${height}px">`;
    results.forEach((r, ri) => {
      const pts = r.equity.map((e, i) => {
        const x = p + (i / (maxLen - 1)) * (width - 2 * p);
        const y = height - p - ((e.value - min) / range) * (height - 2 * p);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      svg += `<polyline points="${pts}" fill="none" stroke="${colors[ri % colors.length]}" stroke-width="1.5" stroke-linejoin="round" opacity="0.8"/>`;
    });
    svg += '</svg>';

    // Legend
    svg += '<div class="flex flex-wrap gap-3 mt-2">';
    results.forEach((r, ri) => {
      svg += `<span class="text-xs flex items-center gap-1"><span class="w-3 h-0.5 inline-block" style="background:${colors[ri % colors.length]}"></span>${r.name}</span>`;
    });
    svg += '</div>';
    return svg;
  },

  renderTrades(trades, containerId) {
    const el = document.getElementById(containerId);
    if (!trades.length) { el.innerHTML = '<p class="text-gray-500 text-sm">No trades executed</p>'; return; }
    let html = '<table class="w-full text-sm"><thead><tr class="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">';
    html += '<th class="pb-2 pr-3">#</th><th class="pb-2 pr-3">Entry</th><th class="pb-2 pr-3 text-right">Price</th><th class="pb-2 pr-3">Exit</th><th class="pb-2 pr-3 text-right">Price</th><th class="pb-2 pr-3 text-right">Shares</th><th class="pb-2 pr-3 text-right">P&L</th><th class="pb-2 text-right">%</th></tr></thead><tbody>';
    trades.forEach((t, i) => {
      const color = t.pnl >= 0 ? 'text-green-400' : 'text-red-400';
      html += `<tr class="border-b border-gray-100 dark:border-gray-800/50">
        <td class="py-1.5 pr-3 text-gray-500">${i + 1}</td>
        <td class="py-1.5 pr-3 font-mono text-xs">${t.entryDate}</td>
        <td class="py-1.5 pr-3 text-right font-mono">${t.entryPrice}</td>
        <td class="py-1.5 pr-3 font-mono text-xs">${t.exitDate}${t.open ? ' (open)' : ''}</td>
        <td class="py-1.5 pr-3 text-right font-mono">${t.exitPrice}</td>
        <td class="py-1.5 pr-3 text-right font-mono">${t.shares}</td>
        <td class="py-1.5 pr-3 text-right font-mono font-bold ${color}">${t.pnl >= 0 ? '+' : ''}$${t.pnl}</td>
        <td class="py-1.5 text-right font-mono ${color}">${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent}%</td>
      </tr>`;
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  },
};

document.addEventListener('DOMContentLoaded', () => BacktestApp.init());
