/**
 * TraderAI — Main Application
 * Orchestrates the 8-stage pipeline and manages the dashboard UI.
 */

const STAGES = [
  MarketPulse,
  StockScreener,
  FundamentalsCheck,
  TechnicalAnalysis,
  NewsSentiment,
  RiskAssessment,
  DailyScorecard,
  ActionPlan,
];

/** Local flat-file cache via localStorage — one entry per day */
const Cache = {
  PREFIX: 'traderai-cache-',
  INDEX_KEY: 'traderai-cache-index',

  _today() {
    return new Date().toISOString().split('T')[0];
  },

  _key(date) {
    return this.PREFIX + date;
  },

  /** Get the index of all cached dates (sorted newest first) */
  index() {
    try {
      const raw = localStorage.getItem(this.INDEX_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  },

  _saveIndex(dates) {
    const unique = [...new Set(dates)].sort().reverse();
    localStorage.setItem(this.INDEX_KEY, JSON.stringify(unique));
  },

  /** Load today's cache */
  load() {
    return this.loadDate(this._today());
  },

  /** Load cache for a specific date */
  loadDate(date) {
    try {
      const raw = localStorage.getItem(this._key(date));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Cache load failed for ' + date + ':', e);
      return null;
    }
  },

  /** Load all cached days (for graphing/history) */
  loadAll() {
    const dates = this.index();
    const history = [];
    for (const date of dates) {
      const entry = this.loadDate(date);
      if (entry) history.push(entry);
    }
    return history;
  },

  save(stageResults, ctx) {
    try {
      const today = this._today();
      const cache = {
        _date: today,
        _timestamp: new Date().toISOString(),
        stageResults: stageResults,
        ctx: {
          watchlist: ctx.watchlist || [],
          fundamentals: ctx.fundamentals || [],
          technicals: ctx.technicals || [],
          sentiment: ctx.sentiment || [],
          risk: ctx.risk || [],
          scorecard: ctx.scorecard || [],
        },
      };
      localStorage.setItem(this._key(today), JSON.stringify(cache));

      // Update index
      const dates = this.index();
      if (!dates.includes(today)) {
        dates.push(today);
        this._saveIndex(dates);
      }
    } catch (e) {
      console.warn('Cache save failed:', e);
    }
  },

  /** Clear only today's cache */
  clear() {
    const today = this._today();
    localStorage.removeItem(this._key(today));
    const dates = this.index().filter(d => d !== today);
    this._saveIndex(dates);
  },

  /** Clear all history */
  clearAll() {
    const dates = this.index();
    for (const date of dates) {
      localStorage.removeItem(this._key(date));
    }
    localStorage.removeItem(this.INDEX_KEY);
  },

  /** Export full history as a single .json file */
  export() {
    const history = this.loadAll();
    if (!history.length) return alert('No cached data to export');
    const payload = { _exported: new Date().toISOString(), days: history };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'traderai-history-' + this._today() + '.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  /** Import history from a .json file */
  import() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);

          // Support both single-day and multi-day formats
          const days = data.days || [data];
          let imported = 0;

          for (const day of days) {
            if (!day._date || !day.stageResults) continue;
            localStorage.setItem(this._key(day._date), JSON.stringify(day));
            const dates = this.index();
            if (!dates.includes(day._date)) {
              dates.push(day._date);
              this._saveIndex(dates);
            }
            imported++;
          }

          // Restore today's data if present
          const today = this.load();
          if (today) App.restoreFromCache(today);
          alert('Imported ' + imported + ' day(s) of data');
          App.renderDashboard();
        } catch (err) {
          alert('Invalid cache file: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  },
};

const App = {
  ctx: {},           // shared context passed between stages
  stageResults: {},  // cached results per stage id
  running: null,     // currently running stage id

  init() {
    initSupabase();

    // Try to restore from cache
    const cached = Cache.load();
    if (cached) {
      this.restoreFromCache(cached);
    } else {
      this.renderDashboard();
    }
  },

  restoreFromCache(cached) {
    this.stageResults = cached.stageResults || {};
    this.ctx = cached.ctx || {};
    this.renderDashboard();
    console.info('Restored from cache (' + cached._timestamp + ')');
  },

  renderSummary() {
    const el = document.getElementById('executive-summary');
    if (!el) return;

    const scorecard = this.stageResults['scorecard'];
    const actionPlan = this.stageResults['action-plan'];
    const risk = this.stageResults['risk'];
    const marketPulse = this.stageResults['market-pulse'];

    // Need at least scorecard data
    if (!scorecard || !scorecard.stocks || !scorecard.stocks.length) {
      el.classList.add('hidden');
      return;
    }

    const sorted = [...scorecard.stocks].sort((a, b) => b.composite - a.composite);
    const top3 = sorted.slice(0, 3);
    const bottom3 = sorted.slice(-3).reverse();

    // Get action plan data for targets
    const actions = actionPlan?.actions || [];
    const risks = risk?.stocks || [];

    // Market overview from pulse
    const indices = marketPulse?.indices || [];
    const spyData = indices.find(i => i.symbol === 'SPY');
    const marketTrend = spyData ? (spyData.changePercent >= 0 ? 'up' : 'down') : null;

    el.classList.remove('hidden');
    el.innerHTML = this.buildSummaryHTML(top3, bottom3, actions, risks, marketTrend, spyData);
  },

  buildSummaryHTML(top3, bottom3, actions, risks, marketTrend, spyData) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

    // Market sentiment line
    let marketLine = '';
    if (spyData) {
      const up = spyData.changePercent >= 0;
      const arrow = up ? '&#9650;' : '&#9660;';
      const color = up ? 'text-green-400' : 'text-red-400';
      marketLine = `<span class="${color} font-medium">S&P 500 ${arrow} ${up ? '+' : ''}${spyData.changePercent}%</span>`;
    }

    let html = `
      <div class="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        <!-- Header bar -->
        <div class="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <span class="text-sm font-semibold">Daily Brief</span>
            <span class="text-xs text-gray-500 dark:text-gray-400">${dateStr} · ${timeStr}</span>
          </div>
          ${marketLine ? '<div class="text-sm">' + marketLine + '</div>' : ''}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-0 md:divide-x divide-gray-200 dark:divide-gray-800">

          <!-- TOP 3 BUY -->
          <div class="p-5">
            <div class="flex items-center gap-2 mb-4">
              <span class="w-6 h-6 rounded bg-green-500/20 text-green-400 flex items-center justify-center text-xs font-bold">&#9650;</span>
              <span class="text-sm font-semibold">Top 3 — Buy</span>
            </div>
            <div class="space-y-3">`;

    for (const stock of top3) {
      html += this.buildStockCard(stock, actions, risks, 'buy');
    }

    html += `
            </div>
          </div>

          <!-- TOP 3 SELL -->
          <div class="p-5 border-t md:border-t-0 border-gray-200 dark:border-gray-800">
            <div class="flex items-center gap-2 mb-4">
              <span class="w-6 h-6 rounded bg-red-500/20 text-red-400 flex items-center justify-center text-xs font-bold">&#9660;</span>
              <span class="text-sm font-semibold">Top 3 — Sell / Avoid</span>
            </div>
            <div class="space-y-3">`;

    for (const stock of bottom3) {
      html += this.buildStockCard(stock, actions, risks, 'sell');
    }

    html += `
            </div>
          </div>
        </div>
      </div>`;

    return html;
  },

  buildStockCard(stock, actions, risks, side) {
    const action = actions.find(a => a.symbol === stock.symbol) || {};
    const riskData = risks.find(r => r.symbol === stock.symbol) || {};

    const isBuy = side === 'buy';
    const scoreColor = stock.composite >= 65 ? 'text-green-400' : stock.composite >= 45 ? 'text-yellow-400' : 'text-red-400';
    const barColor = stock.composite >= 65 ? 'bg-green-500' : stock.composite >= 45 ? 'bg-yellow-500' : 'bg-red-500';

    // Confidence badge
    const confColors = {
      High: 'bg-green-500/20 text-green-400',
      Medium: 'bg-yellow-500/20 text-yellow-400',
      Low: 'bg-gray-500/20 text-gray-400',
    };
    const confClass = confColors[stock.confidence] || confColors.Low;

    // Price change from screener context
    const change = stock.changePercent || 0;
    const changeUp = change >= 0;
    const changeColor = changeUp ? 'text-green-400' : 'text-red-400';

    // Risk label
    const riskLabel = riskData.riskLabel || '-';
    const riskColors = { Low: 'text-green-400', Medium: 'text-yellow-400', High: 'text-red-400' };
    const riskColor = riskColors[riskLabel] || 'text-gray-400';

    let html = `
      <div class="p-3 rounded-lg border border-gray-100 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 transition-colors">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            ${tickerLabel(stock.symbol, 'font-bold text-base')}
            <span class="text-xs text-gray-500 dark:text-gray-400">${stock.company || ''}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-lg font-bold ${scoreColor}">${stock.composite}</span>
            <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold ${confClass}">${stock.confidence}</span>
          </div>
        </div>
        <div class="w-full bg-gray-200 dark:bg-gray-800 rounded-full h-1 mb-2">
          <div class="${barColor} h-1 rounded-full" style="width:${stock.composite}%"></div>
        </div>
        <div class="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
          <span>Price <span class="font-mono text-gray-300">${stock.price ? '$' + stock.price.toFixed(2) : '-'}</span></span>`;

    if (action.entry && isBuy) {
      html += `<span>Entry <span class="font-mono text-gray-300">$${action.entry}</span></span>`;
    }
    if (action.stopLoss) {
      html += `<span>Stop <span class="font-mono text-red-400">$${action.stopLoss}</span></span>`;
    }
    if (action.target && isBuy) {
      html += `<span>Target <span class="font-mono text-green-400">$${action.target}</span></span>`;
    }
    if (action.riskReward && isBuy) {
      html += `<span>R:R <span class="font-mono text-gray-300">${action.riskReward}</span></span>`;
    }

    html += `
          <span>Risk <span class="font-mono ${riskColor}">${riskLabel}</span></span>
          <span>Fund <span class="font-mono">${stock.fundScore}</span></span>
          <span>Tech <span class="font-mono">${stock.techScore}</span></span>
          <span>Sent <span class="font-mono">${stock.sentScore}</span></span>
        </div>`;

    // Action reasoning tags
    if (action.reasoning && action.reasoning.length) {
      html += '<div class="mt-2 flex flex-wrap gap-1">';
      for (const r of action.reasoning) {
        html += `<span class="px-1.5 py-0.5 rounded text-[10px] ${isBuy ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}">${r}</span>`;
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  },

  renderDashboard() {
    const container = document.getElementById('stages');
    if (!container) return;

    container.innerHTML = '';

    // Render executive summary
    this.renderSummary();

    // Update cache status indicator
    const cacheStatus = document.getElementById('cache-status');
    if (cacheStatus) {
      const cached = Cache.load();
      const totalDays = Cache.index().length;
      if (cached) {
        const time = new Date(cached._timestamp).toLocaleTimeString();
        cacheStatus.textContent = 'Cached ' + time + ' (' + totalDays + 'd history)';
        cacheStatus.className = 'text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-400';
      } else if (totalDays > 0) {
        cacheStatus.textContent = totalDays + 'd history (no data today)';
        cacheStatus.className = 'text-xs px-2 py-1 rounded-full bg-gray-500/20 text-gray-400';
      } else {
        cacheStatus.textContent = 'No cache';
        cacheStatus.className = 'text-xs px-2 py-1 rounded-full bg-gray-500/20 text-gray-400';
      }
    }

    STAGES.forEach((stage, i) => {
      const result = this.stageResults[stage.id];
      const isRunning = this.running === stage.id;
      const isDone = !!result;
      const canRun = i === 0 || this.stageResults[STAGES[i - 1].id];

      const card = document.createElement('div');
      card.id = `stage-${stage.id}`;
      card.className = 'rounded-xl border bg-white dark:bg-gray-900 transition-all ' +
        (isDone ? 'border-green-500/30' : isRunning ? 'border-blue-500/50 ring-1 ring-blue-500/20' : 'border-gray-200 dark:border-gray-800');

      // Header
      const header = document.createElement('div');
      header.className = 'flex items-center justify-between p-5 cursor-pointer select-none';
      header.onclick = () => this.toggleExpand(stage.id);

      const left = document.createElement('div');
      left.className = 'flex items-center gap-3';

      const num = document.createElement('span');
      num.className = 'w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ' +
        (isDone ? 'bg-green-500/20 text-green-400' : isRunning ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-500');
      num.textContent = i + 1;

      const info = document.createElement('div');
      info.innerHTML = `<div class="font-semibold">${stage.name}</div><div class="text-xs text-gray-500 dark:text-gray-400">${stage.description}</div>`;

      left.append(num, info);

      const right = document.createElement('div');
      right.className = 'flex items-center gap-2';

      if (isDone) {
        const badge = document.createElement('span');
        badge.className = 'text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 font-medium';
        badge.textContent = 'Complete';
        right.appendChild(badge);
      }

      if (isRunning) {
        const spinner = document.createElement('span');
        spinner.className = 'text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-medium animate-pulse';
        spinner.textContent = 'Running...';
        right.appendChild(spinner);
      }

      const runBtn = document.createElement('button');
      runBtn.className = 'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ' +
        (canRun && !isRunning
          ? 'bg-blue-600 hover:bg-blue-500 text-white'
          : 'bg-gray-200 dark:bg-gray-800 text-gray-400 cursor-not-allowed');
      runBtn.textContent = isDone ? 'Re-run' : 'Run';
      runBtn.disabled = !canRun || isRunning;
      runBtn.onclick = (e) => { e.stopPropagation(); this.runStage(i); };
      right.appendChild(runBtn);

      header.append(left, right);
      card.appendChild(header);

      // Collapsible content area
      const content = document.createElement('div');
      content.id = `content-${stage.id}`;
      content.className = 'px-5 pb-5 ' + (isDone ? '' : 'hidden');

      if (result) {
        const output = document.createElement('div');
        output.className = 'border-t border-gray-200 dark:border-gray-800 pt-4';
        output.innerHTML = stage.render(result);
        content.appendChild(output);
      }

      card.appendChild(content);
      container.appendChild(card);
    });
  },

  toggleExpand(stageId) {
    const el = document.getElementById(`content-${stageId}`);
    if (el) el.classList.toggle('hidden');
  },

  async runStage(index) {
    const stage = STAGES[index];
    this.running = stage.id;
    this.renderDashboard();

    // Scroll to stage
    document.getElementById(`stage-${stage.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
      const result = await stage.run(this.ctx);
      this.stageResults[stage.id] = result;
      Cache.save(this.stageResults, this.ctx);
      await saveStageResult(stage.id, result);
    } catch (e) {
      console.error(`Stage ${stage.name} failed:`, e);
      this.stageResults[stage.id] = { error: `Stage failed: ${e.message}` };
    }

    this.running = null;
    this.renderDashboard();

    // Auto-expand completed stage
    const content = document.getElementById(`content-${stage.id}`);
    if (content) content.classList.remove('hidden');
  },

  async runAll() {
    for (let i = 0; i < STAGES.length; i++) {
      await this.runStage(i);
      // Small delay between stages for UI feedback
      await new Promise(r => setTimeout(r, 300));
    }
  },

  clearCache() {
    Cache.clear();
    this.stageResults = {};
    this.ctx = {};
    this.renderDashboard();
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
