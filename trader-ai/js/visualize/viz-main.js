/**
 * TraderAI — 3D Starfield Visualization (ES Module entry point)
 * Loads stock data, sets up ThreeJS scene, wires axis selectors.
 */

import { createScene, resizeScene, animate } from './viz-scene.js';
import { buildStarfield, updateStarfield, setupRaycaster } from './viz-points.js';

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
let scene, camera, renderer, composer, labelRenderer;

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

// ── Data Loading ──
async function loadData() {
  if (typeof initSupabase !== 'undefined') initSupabase();

  const serverData = typeof DataClient !== 'undefined' && typeof sbClient !== 'undefined' && sbClient
    ? await DataClient.load()
    : null;

  if (!serverData || Object.keys(serverData.pipeline || {}).length === 0) {
    document.getElementById('loading-overlay').innerHTML =
      '<span class="text-sm text-red-400">No pipeline data available. Run the pipeline first.</span>';
    return [];
  }

  const { stageResults, ctx } = DataClient.transformForUI(serverData);

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

  // Merge all per-stock data into flat array
  const scorecard = stageResults['scorecard']?.stocks || ctx.scorecard || [];
  const fundamentals = stageResults['fundamentals']?.stocks || ctx.fundamentals || [];
  const technicals = stageResults['technical']?.stocks || ctx.technicals || [];

  const merged = scorecard.map(sc => {
    const fund = fundamentals.find(f => f.symbol === sc.symbol) || {};
    const tech = technicals.find(t => t.symbol === sc.symbol) || {};
    const name = typeof TICKERS !== 'undefined' ? (TICKERS[sc.symbol] || sc.company || sc.symbol) : sc.symbol;
    return {
      symbol: sc.symbol,
      company: name,
      sector: fund.sector || sc.sector || '',
      ...fund,
      ...tech,
      ...sc,
    };
  });

  return merged;
}

// ── Init ──
async function init() {
  populateSelectors();

  // Set up ThreeJS scene
  const container = document.getElementById('canvas-container');
  const sceneObj = createScene(container);
  scene = sceneObj.scene;
  camera = sceneObj.camera;
  renderer = sceneObj.renderer;
  composer = sceneObj.composer;
  labelRenderer = sceneObj.labelRenderer;

  // Start animation loop
  animate(sceneObj);

  // Handle resize
  window.addEventListener('resize', () => resizeScene(sceneObj, container));

  // Load data
  stocks = await loadData();

  if (stocks.length > 0) {
    document.getElementById('loading-overlay').style.display = 'none';
    document.getElementById('stock-count').textContent = stocks.length + ' stocks loaded';

    const sel = getAxisSelections();
    buildStarfield(sceneObj, stocks, sel, METRICS);
    setupRaycaster(sceneObj, stocks, METRICS);
  }
}

init();
