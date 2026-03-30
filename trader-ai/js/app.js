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

/** Local flat-file cache via localStorage */
const Cache = {
  KEY: 'traderai-cache',

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return null;
      const cache = JSON.parse(raw);
      // Check if cache is from today
      const today = new Date().toISOString().split('T')[0];
      if (cache._date !== today) {
        console.info('Cache is from ' + cache._date + ', today is ' + today + ' — stale, ignoring');
        return null;
      }
      return cache;
    } catch (e) {
      console.warn('Cache load failed:', e);
      return null;
    }
  },

  save(stageResults, ctx) {
    try {
      const cache = {
        _date: new Date().toISOString().split('T')[0],
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
      localStorage.setItem(this.KEY, JSON.stringify(cache));
    } catch (e) {
      console.warn('Cache save failed:', e);
    }
  },

  clear() {
    localStorage.removeItem(this.KEY);
  },

  /** Download cache as a .json file */
  export() {
    const raw = localStorage.getItem(this.KEY);
    if (!raw) return alert('No cached data to export');
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'traderai-cache-' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  /** Import cache from a .json file */
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
          if (!data._date || !data.stageResults) throw new Error('Invalid cache file');
          localStorage.setItem(this.KEY, JSON.stringify(data));
          App.restoreFromCache(data);
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

  renderDashboard() {
    const container = document.getElementById('stages');
    if (!container) return;

    container.innerHTML = '';

    // Update cache status indicator
    const cacheStatus = document.getElementById('cache-status');
    if (cacheStatus) {
      const cached = Cache.load();
      if (cached) {
        const time = new Date(cached._timestamp).toLocaleTimeString();
        cacheStatus.textContent = 'Cached ' + time;
        cacheStatus.className = 'text-xs px-2 py-1 rounded-full bg-blue-500/20 text-blue-400';
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
