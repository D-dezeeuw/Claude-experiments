// supabase/functions/analyze/index.ts
// Runs NLP sentiment analysis on news articles via OpenRouter.
// Also computes geopolitical risk, region temperatures, scenario detection.
// Stores results in pipeline_data.

import {
  today, createSupabaseClient, jsonResponse, corsHeaders,
  OPENROUTER_KEY,
} from '../_shared/config.ts';

const GEOPOLITICAL_KEYWORDS = {
  war: 3, attack: 3, invasion: 3, military: 2, troops: 2, missile: 3,
  nuclear: 3, sanctions: 2, tariff: 2, embargo: 2, conflict: 2,
  terrorism: 3, coup: 3, assassination: 3, airstrike: 3, bombing: 3,
  ceasefire: 1, peace: -1, treaty: -1, diplomacy: -1, negotiate: -1,
  crash: 2, recession: 2, default: 2, bankruptcy: 2, crisis: 2,
  pandemic: 3, outbreak: 2, shutdown: 2,
};

const REGIONS = {
  'US Domestic': {
    keywords: ['fed', 'congress', 'white house', 'us economy', 'federal reserve', 'us military', 'pentagon', 'us troops', 'us sanctions', 'us tariff', 'united states', 'washington', 'us defense', 'us attack', 'us strike', 'president', 'treasury', 'wall street', 'us debt', 'debt ceiling'],
    weight: 1.5,
    spillover: { 'Middle East': 0.4, 'China / Asia': 0.2, 'Russia / Eastern Europe': 0.3 },
  },
  'Europe': {
    keywords: ['ecb', 'eurozone', 'european union', 'eu sanctions', 'eu tariff', 'european central bank', 'european energy', 'europe gas', 'european markets', 'ftse', 'dax', 'stoxx', 'europe inflation'],
    weight: 1.0,
    spillover: { 'Russia / Eastern Europe': 0.2, 'Middle East': 0.2, 'China / Asia': 0.2 },
  },
  'China / Asia': {
    keywords: ['china', 'beijing', 'taiwan', 'japan', 'south korea', 'asia', 'pboc', 'xi jinping', 'chinese military', 'south china sea', 'hong kong', 'semiconductor', 'chip ban', 'nikkei', 'shanghai', 'us china'],
    weight: 1.3,
    spillover: { 'US Domestic': 0.2 },
  },
  'Middle East': {
    keywords: ['iran', 'iraq', 'saudi', 'israel', 'gaza', 'syria', 'yemen', 'lebanon', 'opec', 'hezbollah', 'hamas', 'tehran', 'strait of hormuz', 'middle east'],
    weight: 1.4,
    spillover: { 'US Domestic': 0.4 },
  },
  'Russia / Eastern Europe': {
    keywords: ['russia', 'moscow', 'ukraine', 'putin', 'kremlin', 'kyiv', 'zelensky', 'russian military', 'crimea', 'wagner', 'russian sanctions'],
    weight: 1.3,
    spillover: { 'Europe': 0.3, 'US Domestic': 0.3 },
  },
};

async function analyzeWithLLM(articles: any[]) {
  if (!OPENROUTER_KEY || articles.length === 0) return null;

  // Prepare a batch of headlines for analysis
  const headlines = articles.slice(0, 50).map((a, i) =>
    `${i + 1}. [${a.symbol || 'MARKET'}] ${a.headline}`
  ).join('\n');

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5-20251001',
        messages: [{
          role: 'user',
          content: `You are a financial news analyst. Analyze these headlines and return JSON only (no markdown):

${headlines}

Return this exact JSON structure:
{
  "market_sentiment": "bullish" | "bearish" | "neutral",
  "market_sentiment_score": -1.0 to 1.0,
  "top_risks": ["risk1", "risk2", "risk3"],
  "top_opportunities": ["opp1", "opp2", "opp3"],
  "geopolitical_tension": 0-100,
  "sector_outlook": {
    "technology": -1.0 to 1.0,
    "healthcare": -1.0 to 1.0,
    "energy": -1.0 to 1.0,
    "financials": -1.0 to 1.0,
    "consumer": -1.0 to 1.0,
    "industrials": -1.0 to 1.0,
    "defense": -1.0 to 1.0
  },
  "stock_sentiments": [
    {"symbol": "AAPL", "sentiment": -1.0 to 1.0, "reason": "brief reason"}
  ],
  "summary": "2-3 sentence market summary"
}

Only include stocks that appear in the headlines. Be precise and data-driven.`
        }],
        max_tokens: 2000,
        temperature: 0.1,
      }),
    });

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Parse JSON from response (handle potential markdown wrapping)
    const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('LLM analysis failed:', e);
    return null;
  }
}

async function analyzeSectors(sectorArticles: any[]) {
  if (!OPENROUTER_KEY || sectorArticles.length === 0) return null;

  // Group by sector
  const bySector: Record<string, any[]> = {};
  for (const a of sectorArticles) {
    const sector = a.sector || 'Unknown';
    if (!bySector[sector]) bySector[sector] = [];
    bySector[sector].push(a);
  }

  // Build a compact summary for the LLM
  const sectorSummaries = Object.entries(bySector).map(([sector, arts]) => {
    const headlines = arts.slice(0, 5).map((a: any) => a.headline).join('\n  - ');
    const posCount = arts.filter((a: any) => a.sentiment_score > 0).length;
    const negCount = arts.filter((a: any) => a.sentiment_score < 0).length;
    return `${sector} (${arts.length} articles, ${posCount} positive, ${negCount} negative):\n  - ${headlines}`;
  }).join('\n\n');

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5-20251001',
        messages: [{
          role: 'user',
          content: `You are a financial sector analyst. Analyze these sector news summaries and return JSON only (no markdown):

${sectorSummaries}

Return this exact JSON structure:
{
  "sectors": {
    "SECTOR_NAME": {
      "sentiment": -1.0 to 1.0,
      "outlook": "bullish" | "bearish" | "neutral",
      "risks": ["risk1", "risk2"],
      "opportunities": ["opp1", "opp2"],
      "keyDrivers": ["driver1", "driver2"],
      "summary": "1 sentence sector outlook"
    }
  },
  "crossSectorThemes": ["theme1", "theme2", "theme3"],
  "marketOutlook": "1-2 sentence overall market view based on sector analysis"
}

Be concise and data-driven. Only include sectors present in the data.`
        }],
        max_tokens: 2000,
        temperature: 0.1,
      }),
    });

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonStr = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error('Sector LLM analysis failed:', e);
    return null;
  }
}

function calcRegionRisk(articles: any[]) {
  const allText = articles.map(a => ((a.headline || '') + ' ' + (a.summary || '')).toLowerCase()).join(' ');

  // Direct scoring
  const raw: Record<string, { score: number; hits: number; keywords: string[] }> = {};
  for (const [region, config] of Object.entries(REGIONS)) {
    let hits = 0;
    const matched: string[] = [];
    for (const kw of config.keywords) {
      const count = (allText.match(new RegExp(kw, 'gi')) || []).length;
      if (count > 0) { hits += count; matched.push(kw); }
    }
    raw[region] = { score: hits * config.weight * 5, hits, keywords: matched };
  }

  // Spillover
  const result: Record<string, any> = {};
  for (const [region, config] of Object.entries(REGIONS)) {
    let spilloverScore = 0;
    const spilloverFrom: string[] = [];
    for (const [linked, weight] of Object.entries(config.spillover || {})) {
      if (raw[linked] && raw[linked].score > 15) {
        const spill = raw[linked].score * weight;
        spilloverScore += spill;
        spilloverFrom.push(`${linked} (+${Math.round(spill)})`);
      }
    }
    const total = Math.min(100, raw[region].score + spilloverScore);
    result[region] = {
      score: Math.round(total),
      directScore: Math.round(raw[region].score),
      spilloverScore: Math.round(spilloverScore),
      spilloverFrom,
      hits: raw[region].hits,
      keywords: raw[region].keywords,
      level: total > 60 ? 'Hot' : total > 30 ? 'Warm' : total > 10 ? 'Cool' : 'Quiet',
    };
  }
  return result;
}

function calcThreatScore(articles: any[]) {
  const allText = articles.map(a => ((a.headline || '') + ' ' + (a.summary || '')).toLowerCase()).join(' ');
  let score = 0;
  const matched: string[] = [];
  for (const [kw, weight] of Object.entries(GEOPOLITICAL_KEYWORDS)) {
    const count = (allText.match(new RegExp(kw, 'gi')) || []).length;
    if (count > 0) {
      score += count * weight;
      matched.push(kw);
    }
  }
  return { score: Math.min(100, Math.round(score * 2)), keywords: matched };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const sb = await createSupabaseClient();
    const dateStr = today();

    // Load today's news articles
    const { data: articles } = await sb
      .from('news_articles')
      .select('*')
      .eq('run_date', dateStr);

    if (!articles || articles.length === 0) {
      return jsonResponse({ ok: false, error: 'No news articles found — run fetch-news first' });
    }

    // 1. Keyword-based geopolitical analysis
    const regionRisk = calcRegionRisk(articles);
    const threatScore = calcThreatScore(articles);

    // 2. LLM-powered analysis (general + company news)
    const llmAnalysis = await analyzeWithLLM(articles);

    // 3. Sector news analysis via OpenRouter
    const sectorArticles = articles.filter((a: any) => a.category === 'sector');
    const sectorLLM = sectorArticles.length > 0 ? await analyzeSectors(sectorArticles) : null;

    // 4. Combine results
    const analysis = {
      regionRisk,
      threatScore,
      llm: llmAnalysis,
      sectorAnalysis: sectorLLM,
      articleCount: articles.length,
      sectorArticleCount: sectorArticles.length,
      analyzedAt: new Date().toISOString(),
    };

    // Save to pipeline_data
    await sb.from('pipeline_data').upsert({
      stage: 'analysis',
      run_date: dateStr,
      data: analysis,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'stage,run_date' });

    // Update sector analysis in pipeline_data if available
    if (sectorLLM) {
      await sb.from('pipeline_data').upsert({
        stage: 'sector-analysis',
        run_date: dateStr,
        data: sectorLLM,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'stage,run_date' });
    }

    // Also update per-stock sentiment from LLM if available
    if (llmAnalysis?.stock_sentiments) {
      for (const ss of llmAnalysis.stock_sentiments) {
        await sb.from('stock_data')
          .update({ sentiment_score: ss.sentiment, sentiment_reason: ss.reason })
          .eq('symbol', ss.symbol)
          .eq('run_date', dateStr);
      }
    }

    return jsonResponse({ ok: true, stage: 'analysis', ...analysis });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
});
