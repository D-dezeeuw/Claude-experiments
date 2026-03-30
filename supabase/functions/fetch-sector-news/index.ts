// supabase/functions/fetch-sector-news/index.ts
// Fetches financial news per GICS sector from Webz.io News API Lite.
// Stores articles in news_articles table with category 'sector'.
// Budget: 11 calls per run (1 per sector), ~484 calls/month at 2 runs/day.

import {
  today, createSupabaseClient, jsonResponse, corsHeaders,
} from '../_shared/config.ts';

const WEBZIO_TOKEN = Deno.env.get('WEBZIO_TOKEN') || '';

// GICS sector → Webz.io query keywords (no category: filter — not supported on Lite tier)
const SECTOR_QUERIES: Record<string, string> = {
  'Energy': 'oil OR gas OR energy OR OPEC OR crude OR renewable energy',
  'Materials': 'mining OR chemicals OR metals OR steel OR commodities',
  'Industrials': 'aerospace OR defense OR manufacturing OR industrial OR logistics',
  'Consumer Discretionary': 'retail OR automotive OR ecommerce OR EV OR luxury',
  'Consumer Staples': 'food OR beverage OR "consumer staples" OR grocery',
  'Healthcare': 'pharmaceutical OR biotech OR FDA OR drug approval OR healthcare',
  'Financials': 'banking OR "interest rate" OR "wall street" OR fintech OR insurance',
  'Information Technology': 'semiconductor OR "artificial intelligence" OR software OR cloud OR cybersecurity',
  'Communication Services': 'telecom OR streaming OR media OR 5G OR broadband',
  'Utilities': '"electric utility" OR solar OR "wind energy" OR grid OR "clean energy"',
  'Real Estate': '"real estate" OR REIT OR property OR housing OR mortgage',
};

async function fetchSectorNews(sector: string, query: string) {
  if (!WEBZIO_TOKEN) return { sector, articles: [], error: 'WEBZIO_TOKEN not set' };

  try {
    const url = `https://api.webz.io/newsApiLite?token=${WEBZIO_TOKEN}&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Webz.io ${res.status}: ${res.statusText}`);
    const data = await res.json();

    const articles = (data.posts || []).slice(0, 10).map((post: any) => ({
      sector,
      headline: post.title || '',
      source: post.thread?.site || post.author || '',
      url: post.url || '',
      summary: (post.text || '').substring(0, 400),
      published_at: post.published || null,
      sentiment: post.sentiment || 'neutral',
    }));

    return {
      sector,
      articles,
      totalResults: data.totalResults || 0,
      requestsLeft: data.requestsLeft,
    };
  } catch (e) {
    console.error(`Sector news fetch failed for ${sector}:`, e);
    return { sector, articles: [], error: e.message };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const sb = await createSupabaseClient();
    const dateStr = today();
    const results: any[] = [];

    // Fetch news for each sector (sequential to respect 1 req/sec rate limit)
    for (const [sector, query] of Object.entries(SECTOR_QUERIES)) {
      const result = await fetchSectorNews(sector, query);
      results.push(result);
      // Rate limit: 1 request per second
      await new Promise(r => setTimeout(r, 1100));
    }

    // Store articles in news_articles table
    const allArticles = results.flatMap(r => r.articles);
    if (allArticles.length > 0) {
      // Clear today's sector articles first
      await sb.from('news_articles').delete()
        .eq('run_date', dateStr)
        .eq('category', 'sector');

      // Batch insert
      for (let i = 0; i < allArticles.length; i += 50) {
        const batch = allArticles.slice(i, i + 50).map(a => ({
          run_date: dateStr,
          symbol: null,
          category: 'sector',
          headline: a.headline,
          source: a.source,
          url: a.url,
          summary: a.summary,
          published_at: a.published_at,
          sentiment_score: a.sentiment === 'positive' ? 0.5 : a.sentiment === 'negative' ? -0.5 : 0,
          sector: a.sector,
        }));
        await sb.from('news_articles').insert(batch);
      }
    }

    // Build sector sentiment summary for pipeline_data
    const sectorSentiment: Record<string, any> = {};
    for (const r of results) {
      const articles = r.articles || [];
      const pos = articles.filter((a: any) => a.sentiment === 'positive').length;
      const neg = articles.filter((a: any) => a.sentiment === 'negative').length;
      const total = articles.length || 1;
      const score = (pos - neg) / total; // -1 to 1

      sectorSentiment[r.sector] = {
        articleCount: articles.length,
        positive: pos,
        negative: neg,
        neutral: total - pos - neg,
        sentimentScore: +score.toFixed(2),
        sentimentLabel: score > 0.2 ? 'Positive' : score < -0.2 ? 'Negative' : 'Neutral',
        headlines: articles.slice(0, 3).map((a: any) => a.headline),
        totalResults: r.totalResults || 0,
      };
    }

    // Save to pipeline_data
    await sb.from('pipeline_data').upsert({
      stage: 'sector-news',
      run_date: dateStr,
      data: {
        sectorSentiment,
        totalArticles: allArticles.length,
        fetchedAt: new Date().toISOString(),
        requestsLeft: results[results.length - 1]?.requestsLeft,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'stage,run_date' });

    return jsonResponse({
      ok: true,
      stage: 'sector-news',
      totalArticles: allArticles.length,
      sectors: Object.fromEntries(
        Object.entries(sectorSentiment).map(([k, v]: [string, any]) => [k, {
          count: v.articleCount,
          sentiment: v.sentimentScore,
          label: v.sentimentLabel,
        }])
      ),
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
});
