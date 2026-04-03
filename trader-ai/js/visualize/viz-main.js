/**
 * TraderAI — 3D Starfield Visualization (ES Module entry point)
 * Loads stock data, sets up ThreeJS scene, wires axis selectors.
 */

import { createScene, resizeScene, animate, flyTo } from './viz-scene.js';
import { buildStarfield, updateStarfield, setupRaycaster, focusOnStock } from './viz-points.js';

// ── Metric Registry ──
const METRICS = {
  // Scorecard (computed client-side)
  composite:     { label: 'Verdict',          group: 'Scorecard',     range: [0, 100],  key: 'composite' },
  investScore:   { label: 'Invest Score',     group: 'Scorecard',     range: [0, 100],  key: 'investScore' },
  vulnerability: { label: 'Vulnerability',    group: 'Scorecard',     range: [0, 100],  key: 'vulnerability' },
  riskRating:    { label: 'Risk Rating',      group: 'Scorecard',     range: [0, 100],  key: 'riskRating' },
  fundScore:     { label: 'Fundamental Score',group: 'Scorecard',     range: [0, 100],  key: 'fundScore' },
  techScore:     { label: 'Technical Score',  group: 'Scorecard',     range: [0, 100],  key: 'techScore' },

  // Fundamentals (from Supabase)
  pe:            { label: 'P/E Ratio',        group: 'Fundamentals',  range: [0, 60],   key: 'pe' },
  beta:          { label: 'Beta',             group: 'Fundamentals',  range: [0, 3],    key: 'beta' },
  revenueGrowth: { label: 'Revenue Growth %', group: 'Fundamentals',  range: [-50, 100],key: 'revenueGrowth' },
  operatingMargin:{ label: 'Op. Margin %',    group: 'Fundamentals',  range: [-20, 60], key: 'operatingMargin' },
  debtToEquity:  { label: 'Debt/Equity',      group: 'Fundamentals',  range: [0, 5],    key: 'debtToEquity' },
  roe:           { label: 'ROE %',            group: 'Fundamentals',  range: [-20, 80], key: 'roe' },

  // Technical (computed client-side)
  rsi:           { label: 'RSI',              group: 'Technical',     range: [0, 100],  key: 'rsi' },
  volumeRatio:   { label: 'Volume Ratio',     group: 'Technical',     range: [0, 3],    key: 'volumeRatio' },
  chg7d:         { label: '7d Change %',      group: 'Technical',     range: [-15, 15], key: 'chg7d' },
  chg30d:        { label: '30d Change %',     group: 'Technical',     range: [-30, 30], key: 'chg30d' },

  // Price
  changePercent: { label: 'Change %',         group: 'Price',         range: [-5, 5],   key: 'changePercent' },
  price:         { label: 'Price $',          group: 'Price',         range: [0, 500],  key: 'price' },
};

const DEFAULTS = { x: 'investScore', y: 'vulnerability', z: 'riskRating', color: 'composite', size: 'changePercent' };

// ── Globals ──
let stocks = [];
let sceneObj = null;

// ── Populate Dropdowns ──
function populateSelectors() {
  const selectors = {
    x: document.getElementById('axis-x'),
    y: document.getElementById('axis-y'),
    z: document.getElementById('axis-z'),
    color: document.getElementById('axis-color'),
    size: document.getElementById('axis-size'),
  };

  const groups = {};
  for (const [id, m] of Object.entries(METRICS)) {
    if (!groups[m.group]) groups[m.group] = [];
    groups[m.group].push({ id, label: m.label });
  }

  for (const [axis, el] of Object.entries(selectors)) {
    el.innerHTML = '';
    for (const [group, items] of Object.entries(groups)) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = group;
      for (const item of items) {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.label;
        if (item.id === DEFAULTS[axis]) opt.selected = true;
        optgroup.appendChild(opt);
      }
      el.appendChild(optgroup);
    }
    el.addEventListener('change', () => onAxisChange());
  }
}

function getAxisSelections() {
  return {
    x: document.getElementById('axis-x').value,
    y: document.getElementById('axis-y').value,
    z: document.getElementById('axis-z').value,
    color: document.getElementById('axis-color').value,
    size: document.getElementById('axis-size').value,
  };
}

function onAxisChange() {
  const sel = getAxisSelections();
  updateStarfield(stocks, sel, METRICS);
}

// ── Cache ──
const VIZ_CACHE_KEY = 'traderai-viz-cache';

function saveCache(merged) {
  try {
    const payload = { _date: new Date().toISOString().split('T')[0], _ts: Date.now(), stocks: merged };
    localStorage.setItem(VIZ_CACHE_KEY, JSON.stringify(payload));
  } catch (e) { /* ignore quota errors */ }
}

function loadCache() {
  try {
    const raw = localStorage.getItem(VIZ_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - data._ts > 2 * 60 * 60 * 1000) return null;
    return data.stocks;
  } catch (e) { return null; }
}

// ── Data Loading ──
async function loadData() {
  // 1. Try cache first (instant, no network)
  const cached = loadCache();
  if (cached && cached.length >= 40) { // only use cache if it has most stocks
    console.info('3D View: loaded ' + cached.length + ' stocks from cache');
    return cached;
  }

  // 2. Fetch from Supabase
  if (typeof initSupabase !== 'undefined') initSupabase();

  const serverData = typeof DataClient !== 'undefined' && typeof sbClient !== 'undefined' && sbClient
    ? await DataClient.load()
    : null;

  let stageResults = {}, ctx = {};
  if (serverData && Object.keys(serverData.pipeline || {}).length > 0) {
    const transformed = DataClient.transformForUI(serverData);
    stageResults = transformed.stageResults;
    ctx = transformed.ctx;
  }

  // Run compute stages to get scorecard
  const COMPUTE_STAGES = [
    typeof TechnicalAnalysis !== 'undefined' ? TechnicalAnalysis : null,
    typeof CorrelationMatrix !== 'undefined' ? CorrelationMatrix : null,
    typeof RiskAssessment !== 'undefined' ? RiskAssessment : null,
    typeof DailyScorecard !== 'undefined' ? DailyScorecard : null,
  ].filter(Boolean);

  const COMPUTE_IDS = ['technical', 'correlation', 'risk', 'scorecard'];

  if (ctx.watchlist && ctx.watchlist.length) {
    for (let i = 0; i < COMPUTE_STAGES.length; i++) {
      const stage = COMPUTE_STAGES[i];
      if (!stageResults[COMPUTE_IDS[i]]) {
        try {
          const result = await stage.run(ctx);
          stageResults[stage.id] = result;
        } catch (e) {
          console.warn('Compute stage failed:', stage.id, e);
        }
      }
    }
  }

  const fundamentals = stageResults['fundamentals']?.stocks || ctx.fundamentals || [];
  const scorecard = stageResults['scorecard']?.stocks || ctx.scorecard || [];
  const technicals = stageResults['technical']?.stocks || ctx.technicals || [];

  // ALWAYS start from the full universe (49 stocks), merge available data in
  const universe = typeof StockScreener !== 'undefined'
    ? StockScreener.universe
    : [];

  const merged = universe.map(base => {
    const fund = fundamentals.find(f => f.symbol === base.symbol) || {};
    const sc = scorecard.find(s => s.symbol === base.symbol) || {};
    const tech = technicals.find(t => t.symbol === base.symbol) || {};
    const name = typeof TICKERS !== 'undefined' ? (TICKERS[base.symbol] || base.company || base.symbol) : base.symbol;
    return {
      symbol: base.symbol,
      company: name,
      sector: base.sector,
      _hasData: Object.keys(fund).length > 2 || Object.keys(sc).length > 0,
      ...fund,
      ...tech,
      ...sc,
    };
  });

  if (merged.length > 0) saveCache(merged);

  const withData = merged.filter(s => s._hasData).length;
  console.info('3D View: ' + merged.length + ' stocks (' + withData + ' with data, ' + (merged.length - withData) + ' no data)');
  return merged;
}

// ── Stock List ──
function buildStockList(stocks) {
  const container = document.getElementById('stock-list');
  if (!container) return;

  const bySector = {};
  for (const s of stocks) {
    const sector = s.sector || 'Unknown';
    if (!bySector[sector]) bySector[sector] = [];
    bySector[sector].push(s);
  }

  let html = '';
  const sectorColors = {
    'Energy': 'text-amber-400', 'Materials': 'text-orange-400', 'Industrials': 'text-slate-400',
    'Consumer Discretionary': 'text-pink-400', 'Consumer Staples': 'text-green-400',
    'Healthcare': 'text-red-400', 'Financials': 'text-emerald-400',
    'Information Technology': 'text-blue-400', 'Communication Services': 'text-violet-400',
    'Utilities': 'text-yellow-400', 'Real Estate': 'text-cyan-400',
  };

  for (const [sector, sectorStocks] of Object.entries(bySector)) {
    const color = sectorColors[sector] || 'text-gray-400';
    html += `<div class="mb-3">
      <div class="text-[10px] uppercase tracking-wider ${color} mb-1 font-semibold">${sector}</div>
      <div class="flex flex-wrap gap-1">`;
    for (const s of sectorStocks) {
      const chg = s.changePercent != null ? (s.changePercent >= 0 ? '+' : '') + s.changePercent.toFixed(2) + '%' : '';
      const chgColor = s.changePercent >= 0 ? 'text-green-400' : s.changePercent < 0 ? 'text-red-400' : 'text-gray-500';
      const dim = s._hasData ? '' : 'opacity-40';
      html += `<button data-symbol="${s.symbol}" class="stock-focus-btn px-2 py-1 rounded text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-blue-500/50 transition-all cursor-pointer group ${dim}">
        <span class="font-mono font-bold text-gray-200 group-hover:text-blue-400">${s.symbol}</span>
        ${chg ? `<span class="${chgColor} font-mono ml-1">${chg}</span>` : ''}
      </button>`;
    }
    html += `</div></div>`;
  }

  container.innerHTML = html;

  container.querySelectorAll('.stock-focus-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const symbol = btn.dataset.symbol;
      focusOnStock(sceneObj, symbol);
      container.querySelectorAll('.stock-focus-btn').forEach(b => b.classList.remove('ring-1', 'ring-blue-500'));
      btn.classList.add('ring-1', 'ring-blue-500');
    });
  });
}

// ── Init ──
async function init() {
  populateSelectors();

  const container = document.getElementById('canvas-container');
  sceneObj = createScene(container);
  animate(sceneObj);
  window.addEventListener('resize', () => resizeScene(sceneObj, container));

  stocks = await loadData();

  if (stocks.length > 0) {
    document.getElementById('loading-overlay').style.display = 'none';
    const withData = stocks.filter(s => s._hasData).length;
    document.getElementById('stock-count').textContent = stocks.length + ' stocks (' + withData + ' with data)';

    const sel = getAxisSelections();
    buildStarfield(sceneObj, stocks, sel, METRICS);
    setupRaycaster(sceneObj, stocks, METRICS);
    buildStockList(stocks);
  }
}

init();
