/**
 * TraderAI — Data Client
 * Reads all data from Supabase (populated by Edge Functions).
 * Falls back to localStorage cache for offline use.
 * The client never calls external APIs directly.
 */

const DataClient = {
  CACHE_KEY: 'traderai-server-data',

  /** Load all pipeline data from Supabase — uses the most recent run date available */
  async loadFromServer() {
    if (!sbClient) return null;

    try {
      // Find the most recent run date that has pipeline data
      const latestRes = await sbClient
        .from('pipeline_data')
        .select('run_date')
        .order('run_date', { ascending: false })
        .limit(1);

      const latestDate = latestRes.data?.[0]?.run_date;
      if (!latestDate) {
        console.info('No pipeline data found in Supabase yet');
        return null;
      }

      const today = new Date().toISOString().split('T')[0];
      const isStale = latestDate !== today;
      if (isStale) {
        console.warn('No pipeline data for today (' + today + ') — loading most recent run: ' + latestDate);
      }

      // Fetch all data in parallel for the most recent run date
      const [pipelineRes, stocksRes, newsRes, historyRes] = await Promise.all([
        sbClient.from('pipeline_data').select('stage,data').eq('run_date', latestDate),
        sbClient.from('stock_data').select('symbol,company,sector,data').eq('run_date', latestDate),
        sbClient.from('news_articles').select('symbol,category,sector,headline,source,summary,published_at,sentiment_score').eq('run_date', latestDate).order('published_at', { ascending: false }).limit(200),
        sbClient.from('price_history').select('symbol,source,last_date,candle_count,candles'),
      ]);

      const pipeline = {};
      for (const row of (pipelineRes.data || [])) {
        pipeline[row.stage] = row.data;
      }

      const data = {
        _date: latestDate,
        _isStale: isStale,
        _timestamp: new Date().toISOString(),
        _source: 'supabase',
        pipeline,
        stocks: stocksRes.data || [],
        news: newsRes.data || [],
        history: historyRes.data || [],
      };

      // Cache locally
      this.saveToCache(data);

      return data;
    } catch (e) {
      console.error('Failed to load from Supabase:', e);
      return null;
    }
  },

  /** Load from localStorage cache */
  loadFromCache() {
    try {
      const raw = localStorage.getItem(this.CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  },

  /** Save to localStorage cache (skip history to save space) */
  saveToCache(data) {
    try {
      // Strip price history from cache — it's stored separately per-symbol
      const slim = { ...data, history: [] };
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(slim));
    } catch (e) {
      if (e.name === 'QuotaExceededError') return;
      console.warn('Cache save failed:', e);
    }
  },

  /**
   * Main entry: load data from best available source.
   * 1. Try Supabase (freshest)
   * 2. Fall back to localStorage cache
   */
  async load() {
    // Try server first
    const serverData = await this.loadFromServer();
    if (serverData && Object.keys(serverData.pipeline).length > 0) {
      const label = serverData._isStale ? 'stale data from ' + serverData._date : 'fresh data';
      console.info('Loaded ' + label + ' from Supabase');
      return serverData;
    }

    // Fall back to cache
    const cached = this.loadFromCache();
    if (cached) {
      console.info('Loaded from localStorage cache (date: ' + cached._date + ')');
      return cached;
    }

    console.info('No data available — run the server pipeline first');
    return null;
  },

  /**
   * Transform server data into the format the existing UI expects.
   * This bridges the new server-side data with the old client-side renderers.
   */
  transformForUI(data) {
    if (!data) return { stageResults: {}, ctx: {} };

    const p = data.pipeline || {};
    const stocks = data.stocks || [];
    const news = data.news || [];

    // Build stage results in the format the existing render functions expect
    const stageResults = {};
    const ctx = {};

    // Market Pulse
    if (p['market-pulse']) {
      stageResults['market-pulse'] = p['market-pulse'];
    }

    // Geopolitical (from analysis + market-pulse fear gauges)
    if (p['analysis']) {
      const a = p['analysis'];
      const regionRisk = a.regionRisk || {};
      const threatScore = a.threatScore?.score || 0;

      // Fear gauges come from market-pulse (fetched by fetch-market-data)
      const fearGauges = (p['market-pulse']?.fearGauges || []).map(g => ({
        symbol: g.symbol,
        name: g.name || g.symbol,
        etf: g.symbol,
        category: g.type || 'unknown',
        price: g.price || 0,
        change: g.change || 0,
        changePercent: g.changePercent || 0,
        high: g.high || 0,
        low: g.low || 0,
        prevClose: g.prevClose || 0,
      }));

      // Compute micro temperature from fear gauges
      const vix = fearGauges.find(g => g.etf === 'VIXY');
      const vixPrice = vix?.price || 20;
      let vixScore = vixPrice >= 40 ? 40 : vixPrice >= 30 ? 30 : vixPrice >= 25 ? 20 : vixPrice >= 20 ? 10 : 0;
      const gold = fearGauges.find(g => g.etf === 'GLD');
      const usd = fearGauges.find(g => g.etf === 'UUP');
      const tlt = fearGauges.find(g => g.etf === 'TLT');
      let safeHavenScore = 0;
      if (gold?.changePercent > 0.5) safeHavenScore += 10;
      if (gold?.changePercent > 1.5) safeHavenScore += 5;
      if (usd?.changePercent > 0.3) safeHavenScore += 8;
      if (tlt?.changePercent > 0.5) safeHavenScore += 7;
      const oil = fearGauges.find(g => g.etf === 'USO');
      const oilPct = Math.abs(oil?.changePercent || 0);
      let oilScore = oilPct > 5 ? 15 : oilPct > 3 ? 10 : oilPct > 1.5 ? 5 : 0;
      const defense = fearGauges.find(g => g.etf === 'ITA');
      let defenseScore = defense?.changePercent > 2 ? 15 : defense?.changePercent > 1 ? 10 : defense?.changePercent > 0.5 ? 5 : 0;
      const microTotal = Math.min(100, vixScore + safeHavenScore + oilScore + defenseScore);
      const microTemp = {
        score: microTotal,
        label: microTotal > 60 ? 'Stressed' : microTotal > 35 ? 'Cautious' : microTotal > 15 ? 'Normal' : 'Calm',
        components: {
          vix: { score: vixScore, price: vixPrice },
          safeHaven: { score: safeHavenScore },
          oil: { score: oilScore, change: oil?.changePercent || 0 },
          defense: { score: defenseScore, change: defense?.changePercent || 0 },
        },
      };

      // Compute macro temperature from region risk
      const regions = Object.values(regionRisk);
      const avgRegion = regions.length ? regions.reduce((s, r) => s + (r.score || 0), 0) / regions.length : 0;
      const maxRegion = regions.length ? Math.max(...regions.map(r => r.score || 0)) : 0;
      const hotspots = regions.filter(r => r.level === 'Hot').length;
      let macroScore = avgRegion * 0.3 + maxRegion * 0.3 + hotspots * 10;
      if (vixPrice > 30) macroScore += 15; else if (vixPrice > 25) macroScore += 8;
      macroScore = Math.min(100, Math.round(macroScore));
      const macroTemp = {
        score: macroScore,
        label: macroScore > 60 ? 'Critical' : macroScore > 40 ? 'Elevated' : macroScore > 20 ? 'Moderate' : 'Stable',
        avgRegion: Math.round(avgRegion),
        maxRegion: Math.round(maxRegion),
        hotspots,
      };

      // Build news keyword threat scores from analysis
      const newsScores = {};
      const keywordGroups = ['military', 'sanctions', 'political', 'financial', 'health', 'energy', 'cyber', 'climate'];
      for (const group of keywordGroups) {
        newsScores[group] = { hits: 0, weighted: 0, matched: [] };
      }
      const newsArticles = news.map(n => ({
        headline: n.headline || '',
        source: n.source || '',
        summary: n.summary || '',
        datetime: n.published_at || '',
      }));
      // Quick keyword scan on available news
      const allText = newsArticles.map(n => (n.headline + ' ' + n.summary).toLowerCase()).join(' ');
      const kws = {
        military: { weight: 3, words: ['war','military','missile','attack','invasion','troops','nuclear'] },
        sanctions: { weight: 2, words: ['sanction','embargo','tariff','trade war','ban'] },
        political: { weight: 2, words: ['coup','impeach','protest','riot','revolution','martial law'] },
        financial: { weight: 2.5, words: ['default','bankruptcy','bank run','bailout','crisis','collapse'] },
        health: { weight: 1.5, words: ['pandemic','epidemic','outbreak','quarantine','lockdown'] },
        energy: { weight: 2, words: ['oil shock','opec','pipeline','energy crisis','blackout'] },
        cyber: { weight: 1.5, words: ['cyberattack','hack','ransomware','data breach'] },
        climate: { weight: 1, words: ['hurricane','earthquake','tsunami','wildfire','flood'] },
      };
      let totalNewsThreat = 0;
      for (const [group, cfg] of Object.entries(kws)) {
        let hits = 0;
        const matched = [];
        for (const word of cfg.words) {
          const count = (allText.match(new RegExp(word, 'gi')) || []).length;
          if (count > 0) { hits += count; matched.push({ word, count }); }
        }
        const weighted = hits * cfg.weight;
        newsScores[group] = { hits, weighted, matched };
        totalNewsThreat += weighted;
      }

      // Composite threat level
      const newsPoints = Math.min(50, totalNewsThreat * 2);
      const tlScore = Math.min(100, Math.round(
        microTemp.score * 0.35 + macroTemp.score * 0.30 + newsPoints * 0.25
      ));
      let tlLabel, tlColor, tlAction;
      if (tlScore >= 75) { tlLabel = 'Red'; tlColor = 'red'; tlAction = 'Reduce to 25% positions, cash-heavy, defensive only'; }
      else if (tlScore >= 50) { tlLabel = 'Orange'; tlColor = 'orange'; tlAction = 'Reduce to 50% positions, tighten stops, hedge'; }
      else if (tlScore >= 25) { tlLabel = 'Yellow'; tlColor = 'yellow'; tlAction = 'Reduce to 75% positions, tighten stops'; }
      else { tlLabel = 'Green'; tlColor = 'green'; tlAction = 'Normal operations, full position sizes'; }

      stageResults['geopolitical'] = {
        fearGauges,
        newsThreats: { articles: newsArticles.slice(0, 50), scores: newsScores, totalThreat: totalNewsThreat },
        regionRisk,
        activeScenarios: [],
        threatLevel: { score: tlScore, label: tlLabel, color: tlColor, action: tlAction, micro: microTemp.score, macro: macroTemp.score, news: Math.round(newsPoints), scenarios: 0 },
        microTemp,
        macroTemp,
        llmAnalysis: a.llm || null,
        timestamp: a.analyzedAt || new Date().toISOString(),
      };
      ctx.geopolitical = stageResults['geopolitical'];
    }

    // Stock Screener (from stock_data)
    if (stocks.length > 0) {
      const watchlist = stocks.map(s => ({
        symbol: s.symbol,
        company: s.company,
        sector: s.sector,
        price: s.data?.price,
        change: s.data?.change,
        changePercent: s.data?.changePercent,
      })).filter(s => s.price != null);

      // Sort by absolute change percent
      watchlist.sort((a, b) => Math.abs(b.changePercent || 0) - Math.abs(a.changePercent || 0));

      stageResults['stock-screener'] = {
        watchlist: watchlist.slice(0, 12),
        totalScreened: stocks.length,
      };
      ctx.watchlist = stageResults['stock-screener'].watchlist;

      // Fundamentals
      const fundamentals = stocks.map(s => ({
        symbol: s.symbol,
        company: s.company,
        sector: s.sector,
        ...s.data,
      }));
      stageResults['fundamentals'] = { stocks: fundamentals };
      ctx.fundamentals = fundamentals;

      // Build enriched data for display (insider, analyst, earnings)
      stageResults['enriched'] = {
        stocks: stocks.map(s => ({
          symbol: s.symbol,
          company: s.company,
          insiderTransactions: s.data?.insiderTransactions || [],
          analystRecommendations: s.data?.analystRecommendations || [],
          earningsHistory: s.data?.earningsHistory || [],
        })),
      };
    }

    // News & Sentiment
    if (news.length > 0) {
      const bySymbol = {};
      for (const article of news) {
        const sym = article.symbol || '_general';
        if (!bySymbol[sym]) bySymbol[sym] = [];
        bySymbol[sym].push({
          headline: article.headline,
          source: article.source,
          url: article.url,
          summary: article.summary,
          datetime: article.published_at,
          sentiment: { score: article.sentiment_score || 0 },
        });
      }

      const sentimentStocks = (ctx.watchlist || []).map(s => {
        const articles = bySymbol[s.symbol] || [];
        const avgSentiment = articles.length
          ? articles.reduce((sum, a) => sum + (a.sentiment.score || 0), 0) / articles.length
          : 0;
        return {
          symbol: s.symbol,
          company: s.company,
          articles,
          avgSentiment: +avgSentiment.toFixed(2),
          sentimentLabel: avgSentiment > 0.2 ? 'Positive' : avgSentiment < -0.2 ? 'Negative' : 'Neutral',
          articleCount: articles.length,
        };
      });

      stageResults['news-sentiment'] = { stocks: sentimentStocks };
      ctx.sentiment = sentimentStocks;
    }

    // Sector news sentiment (from Webz.io + OpenRouter)
    if (p['sector-news']) {
      const sectorSentiment = p['sector-news'].sectorSentiment || {};
      if (!stageResults['news-sentiment']) stageResults['news-sentiment'] = { stocks: [] };
      stageResults['news-sentiment'].sectorSentiment = sectorSentiment;
      // Make available in ctx for scorecard + action plan
      ctx.sectorSentiment = sectorSentiment;
    }
    if (p['sector-analysis']) {
      if (!stageResults['news-sentiment']) stageResults['news-sentiment'] = { stocks: [] };
      stageResults['news-sentiment'].sectorAnalysis = p['sector-analysis'];
    }

    // Price history → inject into History module for sparklines
    if (data.history && data.history.length > 0) {
      for (const h of data.history) {
        if (h.candles && typeof History !== 'undefined') {
          History.save(h.symbol, {
            symbol: h.symbol,
            source: h.source,
            _fetched: h.last_date,
            _timestamp: h.updated_at,
            count: h.candle_count,
            candles: h.candles,
          });
        }
      }
    }

    // LLM analysis summary
    if (p['analysis']?.llm) {
      stageResults['llm-analysis'] = p['analysis'].llm;
    }

    return { stageResults, ctx };
  },

  /** Trigger the server-side pipeline (calls run-pipeline edge function) */
  async triggerPipeline() {
    if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
      return { ok: false, error: 'Supabase not configured' };
    }

    try {
      const res = await fetch(CONFIG.SUPABASE_URL + '/functions/v1/run-pipeline', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + CONFIG.SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
      });
      return await res.json();
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
