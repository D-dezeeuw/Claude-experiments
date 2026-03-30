/**
 * Stage 0: Geopolitical & Macro Risk Monitor
 * Measures world "temperature" at micro and macro level.
 * Runs before everything else to set risk context for the day.
 */
const GeopoliticalRisk = {
  id: 'geopolitical',
  name: 'World Risk Monitor',
  description: 'Geopolitical tension, macro risk gauges, world temperature',

  // Fear gauge tickers
  fearGauges: [
    { symbol: '^VIX',  name: 'VIX (Fear Index)',     etf: 'VIXY', category: 'volatility' },
    { symbol: 'GLD',   name: 'Gold (Safe Haven)',     etf: 'GLD',  category: 'safe-haven' },
    { symbol: 'UUP',   name: 'US Dollar Index',       etf: 'UUP',  category: 'safe-haven' },
    { symbol: 'TLT',   name: 'US Treasuries 20Y+',    etf: 'TLT',  category: 'safe-haven' },
    { symbol: 'USO',   name: 'Crude Oil',             etf: 'USO',  category: 'commodity' },
    { symbol: 'ITA',   name: 'Defense & Aerospace',   etf: 'ITA',  category: 'sector' },
    { symbol: 'XAR',   name: 'Aerospace & Defense',   etf: 'XAR',  category: 'sector' },
  ],

  // Thresholds for VIX levels
  vixLevels: {
    low: 15,      // complacent
    normal: 20,   // healthy
    elevated: 25, // nervous
    high: 30,     // fear
    extreme: 40,  // panic
  },

  // Crisis keyword groups with weights
  keywordGroups: {
    military: {
      weight: 3,
      words: ['war', 'military', 'missile', 'attack', 'invasion', 'troops', 'airstrike', 'bombing', 'nuclear', 'nato', 'deploy', 'escalation', 'conflict', 'combat', 'drone strike', 'artillery'],
    },
    sanctions: {
      weight: 2,
      words: ['sanction', 'embargo', 'tariff', 'trade war', 'ban', 'restriction', 'blacklist', 'export control', 'freeze assets', 'trade restriction'],
    },
    political: {
      weight: 2,
      words: ['coup', 'impeach', 'assassination', 'protest', 'riot', 'revolution', 'martial law', 'emergency', 'shutdown', 'election crisis', 'contested', 'insurrection'],
    },
    financial: {
      weight: 2.5,
      words: ['default', 'bankruptcy', 'bank run', 'bailout', 'liquidity crisis', 'credit crisis', 'debt ceiling', 'contagion', 'systemic risk', 'margin call', 'collapse'],
    },
    health: {
      weight: 1.5,
      words: ['pandemic', 'epidemic', 'outbreak', 'quarantine', 'lockdown', 'virus', 'WHO emergency', 'variant', 'vaccine halt'],
    },
    energy: {
      weight: 2,
      words: ['oil shock', 'opec cut', 'pipeline', 'energy crisis', 'blackout', 'gas shortage', 'refinery', 'strait of hormuz', 'oil embargo'],
    },
    cyber: {
      weight: 1.5,
      words: ['cyberattack', 'hack', 'ransomware', 'data breach', 'infrastructure attack', 'grid attack'],
    },
    climate: {
      weight: 1,
      words: ['hurricane', 'earthquake', 'tsunami', 'wildfire', 'flood', 'drought', 'natural disaster', 'climate emergency'],
    },
  },

  // Scenario playbook: event type → sector impact
  scenarios: {
    'Middle East Conflict': {
      trigger: ['military', 'energy'],
      impact: { energy: 2, defense: 2, airlines: -2, consumer: -1, tech: -1 },
    },
    'Trade War Escalation': {
      trigger: ['sanctions'],
      impact: { tech: -2, industrials: -1, consumer_staples: 1, utilities: 1 },
    },
    'Banking / Financial Crisis': {
      trigger: ['financial'],
      impact: { financials: -3, gold: 2, utilities: 1, tech: -1 },
    },
    'Pandemic / Health Crisis': {
      trigger: ['health'],
      impact: { healthcare: 2, travel: -3, remote_tech: 2, consumer: -2 },
    },
    'Political Instability': {
      trigger: ['political'],
      impact: { broad_market: -1, gold: 1, defense: 1, volatility: 2 },
    },
    'Cyber / Infrastructure Attack': {
      trigger: ['cyber'],
      impact: { tech: -1, cybersecurity: 2, utilities: -1, broad_market: -1 },
    },
    'Energy Supply Shock': {
      trigger: ['energy'],
      impact: { energy: 3, airlines: -2, industrials: -1, utilities: -1 },
    },
    'Natural Disaster': {
      trigger: ['climate'],
      impact: { insurance: -2, construction: 1, broad_market: -1, utilities: -1 },
    },
  },

  // Macro regions to track
  // Each region has direct keywords + linked regions that spill over
  regions: {
    'US Domestic': {
      keywords: ['fed', 'congress', 'white house', 'us economy', 'jobs report', 'inflation', 'gdp', 'unemployment', 'federal reserve', 'us military', 'pentagon', 'us troops', 'us sanctions', 'us tariff', 'american', 'united states', 'washington', 'us defense', 'us attack', 'us strike', 'us airstrike', 'biden', 'trump', 'president', 'treasury', 'sec ', 'wall street', 'us debt', 'debt ceiling', 'government shutdown'],
      weight: 1.5,
      // If these regions are hot, US heats up too (as actor/reactor)
      spillover: ['Middle East', 'China / Asia', 'Russia / Eastern Europe'],
      spilloverWeight: 0.3,
    },
    'Europe': {
      // Tighter keywords — removed noisy short matches ('eu ', 'uk ', 'nato', 'european')
      // Europe heats up mostly via spillover from actual conflict zones
      keywords: ['ecb', 'eurozone', 'brexit', 'european union', 'eu sanctions', 'eu tariff', 'european central bank', 'eu economy', 'germany economy', 'france economy', 'uk economy', 'britain economy', 'european energy', 'europe energy', 'europe gas', 'nord stream', 'european markets', 'ftse', 'dax', 'stoxx', 'europe inflation', 'europe recession'],
      weight: 1.0,
      // Europe gets squeezed by everyone else's conflicts
      spillover: ['Russia / Eastern Europe', 'Middle East', 'China / Asia'],
      spilloverWeight: 0.2,
    },
    'China / Asia': {
      keywords: ['china', 'beijing', 'taiwan', 'japan', 'south korea', 'asia', 'chinese economy', 'boj', 'pboc', 'xi jinping', 'chinese military', 'south china sea', 'hong kong', 'semiconductor', 'chip ban', 'asia pacific', 'nikkei', 'shanghai', 'trade deficit china', 'us china'],
      weight: 1.3,
      spillover: ['US Domestic'],
      spilloverWeight: 0.2,
    },
    'Middle East': {
      keywords: ['iran', 'iraq', 'saudi', 'israel', 'gaza', 'syria', 'yemen', 'lebanon', 'opec', 'gulf', 'hezbollah', 'hamas', 'tehran', 'jerusalem', 'west bank', 'strait of hormuz', 'persian gulf', 'middle east', 'idf', 'irgc', 'ayatollah', 'netanyahu', 'mbs'],
      weight: 1.4,
      // US involvement in Middle East heats up US too
      spillover: ['US Domestic'],
      spilloverWeight: 0.4,
    },
    'Russia / Eastern Europe': {
      keywords: ['russia', 'moscow', 'ukraine', 'putin', 'kremlin', 'nato east', 'kyiv', 'zelensky', 'russian military', 'donbas', 'crimea', 'wagner', 'russian sanctions', 'nord stream', 'baltic', 'poland border'],
      weight: 1.3,
      spillover: ['Europe', 'US Domestic'],
      spilloverWeight: 0.3,
    },
    'Emerging Markets': {
      keywords: ['emerging market', 'brazil', 'india', 'africa', 'latin america', 'argentina', 'turkey', 'south africa', 'mexico', 'indonesia', 'modi', 'brics', 'lula', 'peso', 'rupee'],
      weight: 0.8,
      spillover: [],
      spilloverWeight: 0,
    },
  },

  async run(ctx) {
    const results = {
      fearGauges: [],
      newsThreats: { articles: [], scores: {}, totalThreat: 0 },
      regionRisk: {},
      activeScenarios: [],
      threatLevel: { score: 0, label: 'Green', color: 'green' },
      microTemp: {},
      macroTemp: {},
      timestamp: new Date().toISOString(),
    };

    // 1. Fetch fear gauges
    for (const gauge of this.fearGauges) {
      const quote = await this.fetchQuote(gauge.etf);
      if (quote) {
        results.fearGauges.push({ ...gauge, ...quote });
      }
    }

    // 2. Fetch and scan news
    results.newsThreats = await this.scanNews();

    // 3. Calculate region risk (micro/macro temperature)
    results.regionRisk = this.calcRegionRisk(results.newsThreats.articles);
    results.microTemp = this.calcMicroTemp(results.fearGauges);
    results.macroTemp = this.calcMacroTemp(results.regionRisk, results.fearGauges);

    // 4. Determine active scenarios
    results.activeScenarios = this.detectScenarios(results.newsThreats.scores);

    // 5. Composite threat level
    results.threatLevel = this.calcThreatLevel(results);

    // Store in context for downstream stages
    ctx.geopolitical = results;

    return results;
  },

  async fetchQuote(symbol) {
    if (!CONFIG.FINNHUB_API_KEY) return this.mockQuote(symbol);
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${CONFIG.FINNHUB_API_KEY}`
      );
      const d = await res.json();
      if (!d.c) return this.mockQuote(symbol);
      return {
        price: d.c,
        change: d.d,
        changePercent: d.dp,
        high: d.h,
        low: d.l,
        prevClose: d.pc,
      };
    } catch (e) {
      return this.mockQuote(symbol);
    }
  },

  async scanNews() {
    const articles = [];
    const scores = {};
    let totalThreat = 0;

    // Fetch general market news
    if (CONFIG.FINNHUB_API_KEY) {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/news?category=general&token=${CONFIG.FINNHUB_API_KEY}`
        );
        const news = await res.json();
        for (const a of (news || []).slice(0, 50)) {
          articles.push({
            headline: a.headline || '',
            source: a.source || '',
            summary: (a.summary || '').substring(0, 200),
            datetime: a.datetime ? new Date(a.datetime * 1000).toLocaleString() : '',
            url: a.url || '',
          });
        }
      } catch (e) {
        console.warn('News scan failed:', e);
      }
    }

    if (articles.length === 0) {
      // Mock news for demo
      articles.push(
        { headline: 'US military conducts operations near Strait of Hormuz amid rising tensions', source: 'Reuters', datetime: 'Today', mock: true },
        { headline: 'Fed signals potential rate hold as inflation data mixed', source: 'Bloomberg', datetime: 'Today', mock: true },
        { headline: 'China trade talks stall over tech export controls', source: 'CNBC', datetime: 'Today', mock: true },
        { headline: 'European markets rally on strong earnings season', source: 'FT', datetime: 'Today', mock: true },
        { headline: 'Oil prices surge on Middle East supply concerns', source: 'WSJ', datetime: 'Today', mock: true },
        { headline: 'Major cyberattack targets US infrastructure systems', source: 'AP', datetime: 'Yesterday', mock: true },
      );
    }

    // Score each keyword group
    const allText = articles.map(a => (a.headline + ' ' + a.summary).toLowerCase()).join(' ');

    for (const [group, config] of Object.entries(this.keywordGroups)) {
      let hits = 0;
      const matched = [];
      for (const word of config.words) {
        const count = (allText.match(new RegExp(word, 'gi')) || []).length;
        if (count > 0) {
          hits += count;
          matched.push({ word, count });
        }
      }
      const weighted = hits * config.weight;
      scores[group] = { hits, weighted, matched };
      totalThreat += weighted;
    }

    return { articles, scores, totalThreat };
  },

  calcRegionRisk(articles) {
    const allText = articles.map(a => (a.headline + ' ' + a.summary).toLowerCase()).join(' ');

    // Pass 1: Direct keyword scoring
    const rawScores = {};
    for (const [region, config] of Object.entries(this.regions)) {
      let hits = 0;
      const matched = [];
      for (const kw of config.keywords) {
        const count = (allText.match(new RegExp(kw, 'gi')) || []).length;
        if (count > 0) {
          hits += count;
          matched.push(kw);
        }
      }
      rawScores[region] = {
        directScore: hits * config.weight * 5,
        hits,
        keywords: matched,
      };
    }

    // Pass 2: Apply spillover — hot regions heat up linked regions
    // e.g. Middle East hot → US Domestic gets 40% spillover
    const regionScores = {};
    for (const [region, config] of Object.entries(this.regions)) {
      let spilloverScore = 0;
      const spilloverFrom = [];
      if (config.spillover && config.spilloverWeight) {
        for (const linkedRegion of config.spillover) {
          const linked = rawScores[linkedRegion];
          if (linked && linked.directScore > 15) {
            const spill = linked.directScore * config.spilloverWeight;
            spilloverScore += spill;
            spilloverFrom.push(linkedRegion + ' (+' + Math.round(spill) + ')');
          }
        }
      }

      const totalScore = Math.min(100, rawScores[region].directScore + spilloverScore);
      regionScores[region] = {
        score: Math.round(totalScore),
        directScore: Math.round(rawScores[region].directScore),
        spilloverScore: Math.round(spilloverScore),
        spilloverFrom,
        hits: rawScores[region].hits,
        keywords: rawScores[region].keywords,
        level: totalScore > 60 ? 'Hot' : totalScore > 30 ? 'Warm' : totalScore > 10 ? 'Cool' : 'Quiet',
      };
    }

    return regionScores;
  },

  /** Micro temperature: market-internal signals */
  calcMicroTemp(fearGauges) {
    const vix = fearGauges.find(g => g.etf === 'VIXY');
    const vixPrice = vix?.price || 20;

    // VIX component (0-40 points)
    let vixScore = 0;
    if (vixPrice >= this.vixLevels.extreme) vixScore = 40;
    else if (vixPrice >= this.vixLevels.high) vixScore = 30;
    else if (vixPrice >= this.vixLevels.elevated) vixScore = 20;
    else if (vixPrice >= this.vixLevels.normal) vixScore = 10;
    else vixScore = 0;

    // Safe haven flow (0-30 points): gold + USD + treasuries all up = risk-off
    const gold = fearGauges.find(g => g.etf === 'GLD');
    const usd = fearGauges.find(g => g.etf === 'UUP');
    const tlt = fearGauges.find(g => g.etf === 'TLT');
    let safeHavenScore = 0;
    if (gold?.changePercent > 0.5) safeHavenScore += 10;
    if (gold?.changePercent > 1.5) safeHavenScore += 5;
    if (usd?.changePercent > 0.3) safeHavenScore += 8;
    if (tlt?.changePercent > 0.5) safeHavenScore += 7;

    // Oil shock (0-15 points)
    const oil = fearGauges.find(g => g.etf === 'USO');
    let oilScore = 0;
    const oilPct = Math.abs(oil?.changePercent || 0);
    if (oilPct > 5) oilScore = 15;
    else if (oilPct > 3) oilScore = 10;
    else if (oilPct > 1.5) oilScore = 5;

    // Defense spike (0-15 points)
    const defense = fearGauges.find(g => g.etf === 'ITA');
    let defenseScore = 0;
    if (defense?.changePercent > 2) defenseScore = 15;
    else if (defense?.changePercent > 1) defenseScore = 10;
    else if (defense?.changePercent > 0.5) defenseScore = 5;

    const total = Math.min(100, vixScore + safeHavenScore + oilScore + defenseScore);

    return {
      score: total,
      label: total > 60 ? 'Stressed' : total > 35 ? 'Cautious' : total > 15 ? 'Normal' : 'Calm',
      components: {
        vix: { score: vixScore, price: vixPrice },
        safeHaven: { score: safeHavenScore },
        oil: { score: oilScore, change: oil?.changePercent },
        defense: { score: defenseScore, change: defense?.changePercent },
      },
    };
  },

  /** Macro temperature: geopolitical and world-level signals */
  calcMacroTemp(regionRisk, fearGauges) {
    // Average of region scores
    const regions = Object.values(regionRisk);
    const avgRegion = regions.length ? regions.reduce((s, r) => s + r.score, 0) / regions.length : 0;
    const maxRegion = regions.length ? Math.max(...regions.map(r => r.score)) : 0;
    const hotspots = regions.filter(r => r.level === 'Hot').length;

    // Macro is driven by regional tension + fear gauge extremes
    let score = 0;
    score += avgRegion * 0.3;      // avg tension across regions
    score += maxRegion * 0.3;      // worst hotspot
    score += hotspots * 10;        // number of hot regions

    // VIX above 30 adds macro stress
    const vix = fearGauges.find(g => g.etf === 'VIXY');
    if (vix?.price > 30) score += 15;
    else if (vix?.price > 25) score += 8;

    score = Math.min(100, Math.round(score));

    return {
      score,
      label: score > 60 ? 'Critical' : score > 40 ? 'Elevated' : score > 20 ? 'Moderate' : 'Stable',
      avgRegion: Math.round(avgRegion),
      maxRegion: Math.round(maxRegion),
      hotspots,
    };
  },

  detectScenarios(threatScores) {
    const active = [];

    for (const [name, scenario] of Object.entries(this.scenarios)) {
      let triggerScore = 0;
      for (const group of scenario.trigger) {
        triggerScore += (threatScores[group]?.weighted || 0);
      }
      if (triggerScore > 3) {
        // Signal strength: how much news/data is pointing to this scenario
        // NOT a probability — just how loud the signal is (0-100)
        const signalStrength = Math.min(100, Math.round(triggerScore * 5));
        active.push({
          name,
          triggerScore: Math.round(triggerScore),
          signalStrength,
          signalLabel: signalStrength > 75 ? 'Very Strong' : signalStrength > 50 ? 'Strong' : signalStrength > 25 ? 'Moderate' : 'Weak',
          impact: scenario.impact,
        });
      }
    }

    active.sort((a, b) => b.triggerScore - a.triggerScore);
    return active;
  },

  calcThreatLevel(results) {
    const micro = results.microTemp.score || 0;
    const macro = results.macroTemp.score || 0;
    const news = Math.min(50, results.newsThreats.totalThreat * 2);
    const scenarios = results.activeScenarios.length * 5;

    const score = Math.min(100, Math.round(
      micro * 0.35 +
      macro * 0.30 +
      news * 0.25 +
      scenarios * 0.10
    ));

    let label, color, action;
    if (score >= 75) {
      label = 'Red'; color = 'red'; action = 'Reduce to 25% positions, cash-heavy, defensive only';
    } else if (score >= 50) {
      label = 'Orange'; color = 'orange'; action = 'Reduce to 50% positions, tighten stops, hedge';
    } else if (score >= 25) {
      label = 'Yellow'; color = 'yellow'; action = 'Reduce to 75% positions, tighten stops';
    } else {
      label = 'Green'; color = 'green'; action = 'Normal operations, full position sizes';
    }

    return { score, label, color, action, micro, macro, news: Math.round(news), scenarios };
  },

  mockQuote(symbol) {
    const seed = symbol.charCodeAt(0) + (symbol.charCodeAt(1) || 0);
    const bases = { VIXY: 18, GLD: 185, UUP: 27, TLT: 92, USO: 72, ITA: 130, XAR: 145 };
    const base = bases[symbol] || 100;
    const change = (Math.random() - 0.45) * 3;
    return {
      price: +(base + change).toFixed(2),
      change: +change.toFixed(2),
      changePercent: +((change / base) * 100).toFixed(2),
      high: +(base + 2).toFixed(2),
      low: +(base - 1.5).toFixed(2),
      prevClose: +base.toFixed(2),
      mock: true,
    };
  },

  render(data) {
    let html = '';

    // ── Threat Level Banner ──
    const tl = data.threatLevel;
    const tlColors = {
      Green: 'bg-green-500/20 border-green-500/30 text-green-400',
      Yellow: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400',
      Orange: 'bg-orange-500/20 border-orange-500/30 text-orange-400',
      Red: 'bg-red-500/20 border-red-500/30 text-red-400',
    };
    const tlc = tlColors[tl.label] || tlColors.Green;

    html += `<div class="p-4 rounded-lg border ${tlc} mb-5">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-3">
          <span class="text-3xl font-bold">${tl.score}</span>
          <div>
            <div class="font-semibold text-lg">Threat Level: ${tl.label}</div>
            <div class="text-sm opacity-80">${tl.action}</div>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-right">
          <span class="text-gray-500">Micro</span><span class="font-mono font-bold">${tl.micro}</span>
          <span class="text-gray-500">Macro</span><span class="font-mono font-bold">${tl.macro}</span>
          <span class="text-gray-500">News</span><span class="font-mono font-bold">${tl.news}</span>
          <span class="text-gray-500">Scenarios</span><span class="font-mono font-bold">${tl.scenarios}</span>
        </div>
      </div>
      <div class="w-full bg-gray-800 rounded-full h-2">
        <div class="h-2 rounded-full transition-all ${tl.score >= 75 ? 'bg-red-500' : tl.score >= 50 ? 'bg-orange-500' : tl.score >= 25 ? 'bg-yellow-500' : 'bg-green-500'}" style="width:${tl.score}%"></div>
      </div>
    </div>`;

    // ── Micro vs Macro Temperature ──
    html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">';

    // Micro
    const micro = data.microTemp;
    const microColor = micro.score > 60 ? 'text-red-400' : micro.score > 35 ? 'text-yellow-400' : 'text-green-400';
    html += `<div class="p-4 rounded-lg border border-gray-200 dark:border-gray-800">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-sm font-semibold">Micro (Market Internal)</h4>
        <span class="text-lg font-bold ${microColor}">${micro.score} — ${micro.label}</span>
      </div>
      <div class="space-y-2 text-xs">
        <div class="flex justify-between"><span class="text-gray-500">VIX Level</span><span class="font-mono">${micro.components.vix.price.toFixed(1)} (${micro.components.vix.score}pts)</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Safe Haven Flow</span><span class="font-mono">${micro.components.safeHaven.score}pts</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Oil Shock</span><span class="font-mono">${micro.components.oil.change?.toFixed(2) || 0}% (${micro.components.oil.score}pts)</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Defense Spike</span><span class="font-mono">${micro.components.defense.change?.toFixed(2) || 0}% (${micro.components.defense.score}pts)</span></div>
      </div>
    </div>`;

    // Macro
    const macro = data.macroTemp;
    const macroColor = macro.score > 60 ? 'text-red-400' : macro.score > 40 ? 'text-yellow-400' : 'text-green-400';
    html += `<div class="p-4 rounded-lg border border-gray-200 dark:border-gray-800">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-sm font-semibold">Macro (Geopolitical)</h4>
        <span class="text-lg font-bold ${macroColor}">${macro.score} — ${macro.label}</span>
      </div>
      <div class="space-y-2 text-xs">
        <div class="flex justify-between"><span class="text-gray-500">Avg Region Tension</span><span class="font-mono">${macro.avgRegion}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Hottest Region</span><span class="font-mono">${macro.maxRegion}</span></div>
        <div class="flex justify-between"><span class="text-gray-500">Hot Zones</span><span class="font-mono ${macro.hotspots > 0 ? 'text-red-400' : ''}">${macro.hotspots}</span></div>
      </div>
    </div>`;

    html += '</div>';

    // ── Fear Gauges ──
    html += '<div class="mb-5"><h4 class="text-sm font-semibold mb-3">Fear Gauges</h4>';
    html += '<div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">';
    for (const g of data.fearGauges) {
      const up = g.changePercent >= 0;
      const color = up ? 'text-green-500' : 'text-red-500';
      // For VIX, up is bad
      const vixFlip = g.etf === 'VIXY' && up ? 'text-red-500' : color;
      html += `<div class="p-2 rounded-lg border border-gray-200 dark:border-gray-800 text-center">
        <div class="text-[10px] text-gray-500 truncate">${g.name}</div>
        <div class="text-sm font-bold">${g.price}</div>
        <div class="${g.etf === 'VIXY' ? vixFlip : color} text-xs font-mono">${up ? '+' : ''}${g.changePercent}%</div>
      </div>`;
    }
    html += '</div></div>';

    // ── Region Risk Map ──
    html += '<div class="mb-5"><h4 class="text-sm font-semibold mb-3">World Temperature by Region</h4>';
    html += '<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">';
    for (const [region, risk] of Object.entries(data.regionRisk)) {
      const levelColors = {
        Hot: 'bg-red-500/20 border-red-500/30 text-red-400',
        Warm: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400',
        Cool: 'bg-blue-500/20 border-blue-500/30 text-blue-400',
        Quiet: 'bg-gray-500/10 border-gray-500/20 text-gray-400',
      };
      const lc = levelColors[risk.level] || levelColors.Quiet;
      const hasSpillover = risk.spilloverScore > 0;
      html += `<div class="p-3 rounded-lg border ${lc}">
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-medium">${region}</span>
          <span class="text-xs font-bold">${risk.score}</span>
        </div>
        <div class="text-xs font-semibold mb-1">${risk.level}</div>
        ${risk.keywords.length ? '<div class="text-[10px] opacity-70 mb-1">' + risk.keywords.slice(0, 5).join(', ') + '</div>' : ''}
        ${hasSpillover ? '<div class="text-[10px] opacity-50">Spillover: ' + risk.spilloverFrom.join(', ') + '</div>' : ''}
      </div>`;
    }
    html += '</div></div>';

    // ── Active Scenarios ──
    if (data.activeScenarios.length > 0) {
      html += '<div class="mb-5"><h4 class="text-sm font-semibold mb-3">Active Threat Scenarios</h4>';
      html += '<div class="space-y-2">';
      for (const s of data.activeScenarios) {
        const sigColor = s.signalStrength > 75 ? 'text-red-400' : s.signalStrength > 50 ? 'text-yellow-400' : 'text-gray-400';
        html += `<div class="p-3 rounded-lg border border-gray-200 dark:border-gray-800">
          <div class="flex items-center justify-between mb-2">
            <span class="font-semibold">${s.name}</span>
            <span class="${sigColor} text-sm font-bold">Signal Strength <span class="font-mono">${s.signalStrength}/100</span></span>
          </div>
          <div class="flex flex-wrap gap-1">`;
        for (const [sector, impact] of Object.entries(s.impact)) {
          const sectorName = sector.replace(/_/g, ' ');
          const impColor = impact > 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400';
          const arrow = impact > 0 ? '&#9650;' : '&#9660;';
          html += `<span class="px-2 py-0.5 rounded text-[10px] font-medium ${impColor}">${sectorName} ${arrow}${Math.abs(impact)}</span>`;
        }
        html += '</div></div>';
      }
      html += '</div></div>';
    }

    // ── News Threat Breakdown ──
    html += '<div class="mb-4"><h4 class="text-sm font-semibold mb-3">Threat Keyword Scanner</h4>';
    html += '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">';
    for (const [group, score] of Object.entries(data.newsThreats.scores)) {
      const intensity = Math.min(100, score.weighted * 10);
      const bg = score.hits > 0
        ? `rgba(239,68,68,${Math.min(0.3, intensity / 100 * 0.3)})`
        : 'transparent';
      html += `<div class="p-2 rounded-lg border border-gray-200 dark:border-gray-800 text-center" style="background:${bg}">
        <div class="text-[10px] text-gray-500 capitalize">${group}</div>
        <div class="text-sm font-bold">${score.hits}</div>
        <div class="text-[10px] text-gray-500">wt: ${score.weighted.toFixed(1)}</div>
      </div>`;
    }
    html += '</div></div>';

    // Top flagged headlines
    if (data.newsThreats.articles.length > 0) {
      html += '<div><h4 class="text-sm font-semibold mb-2">Recent Headlines</h4>';
      html += '<div class="space-y-1 max-h-48 overflow-y-auto">';
      for (const a of data.newsThreats.articles.slice(0, 15)) {
        // Check if this headline triggers any keywords
        const lower = (a.headline + ' ' + (a.summary || '')).toLowerCase();
        let hasThreat = false;
        for (const config of Object.values(this.keywordGroups)) {
          for (const word of config.words) {
            if (lower.includes(word)) { hasThreat = true; break; }
          }
          if (hasThreat) break;
        }
        const dot = hasThreat ? 'bg-red-500' : 'bg-gray-500';
        html += `<div class="flex items-start gap-2 text-xs">
          <span class="mt-1.5 w-1.5 h-1.5 rounded-full ${dot} flex-shrink-0"></span>
          <span class="${hasThreat ? 'text-gray-200' : 'text-gray-500'}">${a.headline} <span class="text-gray-600">${a.source}</span></span>
        </div>`;
      }
      html += '</div></div>';
    }

    if (data.fearGauges[0]?.mock) {
      html += '<p class="mt-4 text-xs text-yellow-500/70 italic">Demo data — add your Finnhub API key in config.js for live data</p>';
    }

    return html;
  },
};
