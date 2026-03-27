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

const App = {
  ctx: {},           // shared context passed between stages
  stageResults: {},  // cached results per stage id
  running: null,     // currently running stage id

  init() {
    initSupabase();
    this.renderDashboard();
  },

  renderDashboard() {
    const container = document.getElementById('stages');
    if (!container) return;

    container.innerHTML = '';

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
};

document.addEventListener('DOMContentLoaded', () => App.init());
