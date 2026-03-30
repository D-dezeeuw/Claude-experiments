/**
 * TraderAI — Data Client
 * Reads all data from Supabase (populated by Edge Functions).
 * Falls back to localStorage cache for offline use.
 * The client never calls external APIs directly.
 */

const DataClient = {
  CACHE_KEY: 'traderai-server-data',

  /** Load all pipeline data for today from Supabase */
  async loadFromServer() {
    if (!sbClient) return null;

    const today = new Date().toISOString().split('T')[0];

    try {
      // Fetch all data in parallel
      const [pipelineRes, stocksRes, newsRes, historyRes] = await Promise.all([
        sbClient.from('pipeline_data').select('*').eq('run_date', today),
        sbClient.from('stock_data').select('*').eq('run_date', today),
        sbClient.from('news_articles').select('*').eq('run_date', today).order('published_at', { ascending: false }),
        sbClient.from('price_history').select('*'),
      ]);

      const pipeline = {};
      for (const row of (pipelineRes.data || [])) {
        pipeline[row.stage] = row.data;
      }

      const data = {
        _date: today,
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

  /** Save to localStorage cache */
  saveToCache(data) {
    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(data));
    } catch (e) {
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
      console.info('Loaded fresh data from Supabase');
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

    // Geopolitical (from analysis)
    if (p['analysis']) {
      const a = p['analysis'];
      stageResults['geopolitical'] = {
        regionRisk: a.regionRisk || {},
        threatLevel: { score: a.threatScore?.score || 0 },
        newsThreats: { totalThreat: a.threatScore?.score || 0 },
        llmAnalysis: a.llm || null,
        activeScenarios: [],
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
