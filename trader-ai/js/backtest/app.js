/**
 * Backtest Page — UI Controller
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
  init() {
    initSupabase();

    // Populate stock selector
    const sel = document.getElementById('bt-symbol');
    for (const s of BACKTEST_UNIVERSE) {
      const opt = document.createElement('option');
      opt.value = s.symbol;
      opt.textContent = s.symbol + ' — ' + s.company;
      sel.appendChild(opt);
    }

    // Populate strategy selector
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
    const stratId = document.getElementById('bt-strategy').value;
    const strat = Strategies.get(stratId);
    const el = document.getElementById('bt-params');
    if (!strat) { el.innerHTML = ''; return; }

    let html = '';
    for (const [key, val] of Object.entries(strat.params)) {
      const label = key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
      html += `<div>
        <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">${label}</label>
        <input type="number" id="param-${key}" value="${val}" class="w-24 px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-mono">
      </div>`;
    }
    el.innerHTML = html;
  },

  async run() {
    const symbol = document.getElementById('bt-symbol').value;
    const stratId = document.getElementById('bt-strategy').value;
    const capital = parseFloat(document.getElementById('bt-capital').value) || 10000;
    const strat = Strategies.get(stratId);
    if (!strat) return;

    const statusEl = document.getElementById('bt-status');
    statusEl.textContent = 'Loading price history for ' + symbol + '...';

    // Load full history from Supabase
    let candles = await BacktestEngine.loadFullHistory(symbol);
    if (!candles.length) {
      statusEl.textContent = 'No history found in Supabase for ' + symbol + '. Run the pipeline first.';
      return;
    }

    // Ensure candles are sorted oldest first
    candles.sort((a, b) => a.date.localeCompare(b.date));

    // Read params from UI
    const params = { ...strat.params };
    for (const key of Object.keys(params)) {
      const input = document.getElementById('param-' + key);
      if (input) params[key] = parseFloat(input.value) || params[key];
    }

    statusEl.textContent = 'Running backtest on ' + candles.length + ' candles...';

    // Run backtest
    const result = BacktestEngine.run(candles, strat.fn, params, capital);

    statusEl.textContent = strat.name + ' on ' + symbol + ' · ' + candles.length + ' days · ' + result.trades.length + ' trades';

    // Show results
    document.getElementById('bt-results').classList.remove('hidden');
    this.renderMetrics(result.metrics, capital);
    this.renderChart(result.equity);
    this.renderTrades(result.trades);
  },

  renderMetrics(m, capital) {
    const el = document.getElementById('bt-metrics');
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

  renderChart(equity) {
    const el = document.getElementById('bt-chart');
    if (!equity.length) { el.innerHTML = '<p class="text-gray-500">No data</p>'; return; }

    const width = el.clientWidth || 700;
    const height = 200;
    const padding = 5;
    const values = equity.map(e => e.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const points = equity.map((e, i) => {
      const x = padding + (i / (equity.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((e.value - min) / range) * (height - 2 * padding);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const up = values[values.length - 1] >= values[0];
    const color = up ? '#22c55e' : '#ef4444';

    // Start/end labels
    const startLabel = '$' + values[0].toLocaleString();
    const endLabel = '$' + values[values.length - 1].toLocaleString();

    el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" class="w-full" style="height:${height}px">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
      <text x="${padding}" y="15" fill="#9ca3af" font-size="11" font-family="monospace">${startLabel}</text>
      <text x="${width - padding}" y="15" fill="${color}" font-size="11" font-family="monospace" text-anchor="end">${endLabel}</text>
    </svg>`;
  },

  renderTrades(trades) {
    const el = document.getElementById('bt-trades');
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
