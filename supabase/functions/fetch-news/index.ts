// supabase/functions/fetch-news/index.ts
// Fetches: company news per stock + general market news.
// Stores in `news_articles` table.

import {
  finnhub, today, createSupabaseClient, jsonResponse, corsHeaders,
  STOCK_UNIVERSE,
} from '../_shared/config.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const sb = await createSupabaseClient();
    const dateStr = today();
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

    // General market news
    let generalNews: any[] = [];
    try {
      const gen = await finnhub(`/news?category=general&minId=0`);
      generalNews = (gen || []).slice(0, 30).map((a: any) => ({
        headline: a.headline,
        source: a.source,
        url: a.url,
        summary: a.summary?.substring(0, 300) || '',
        datetime: a.datetime ? new Date(a.datetime * 1000).toISOString() : null,
        category: 'general',
        symbol: null,
      }));
    } catch (_) {}

    // Company-specific news (batch to avoid rate limits)
    const companyNews: any[] = [];
    for (let i = 0; i < STOCK_UNIVERSE.length; i += 3) {
      const batch = STOCK_UNIVERSE.slice(i, i + 3);
      const batchResults = await Promise.all(
        batch.map(async (s) => {
          try {
            const articles = await finnhub(
              `/company-news?symbol=${s.symbol}&from=${weekAgo}&to=${dateStr}`
            );
            return (articles || []).slice(0, 5).map((a: any) => ({
              headline: a.headline,
              source: a.source,
              url: a.url,
              summary: a.summary?.substring(0, 300) || '',
              datetime: a.datetime ? new Date(a.datetime * 1000).toISOString() : null,
              category: 'company',
              symbol: s.symbol,
            }));
          } catch (_) {
            return [];
          }
        })
      );
      companyNews.push(...batchResults.flat());

      if (i + 3 < STOCK_UNIVERSE.length) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    const allArticles = [...generalNews, ...companyNews];

    // Store in news_articles table
    // Clear today's articles first, then insert
    await sb.from('news_articles').delete().eq('run_date', dateStr);
    if (allArticles.length > 0) {
      // Batch insert in chunks of 50
      for (let i = 0; i < allArticles.length; i += 50) {
        const batch = allArticles.slice(i, i + 50).map(a => ({
          run_date: dateStr,
          symbol: a.symbol,
          category: a.category,
          headline: a.headline,
          source: a.source,
          url: a.url,
          summary: a.summary,
          published_at: a.datetime,
        }));
        await sb.from('news_articles').insert(batch);
      }
    }

    // Also save summary to pipeline_data
    await sb.from('pipeline_data').upsert({
      stage: 'news',
      run_date: dateStr,
      data: {
        generalCount: generalNews.length,
        companyCount: companyNews.length,
        totalArticles: allArticles.length,
        fetchedAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'stage,run_date' });

    return jsonResponse({
      ok: true, stage: 'news',
      general: generalNews.length, company: companyNews.length,
    });
  } catch (e) {
    return jsonResponse({ error: e.message }, 500);
  }
});
