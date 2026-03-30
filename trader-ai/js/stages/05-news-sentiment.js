/**
 * Stage 5: News & Sentiment
 * Fetch headlines per watchlist stock, basic sentiment scoring.
 */
const NewsSentiment = {
  id: 'news-sentiment',
  name: 'News & Sentiment',
  description: 'Headlines, sentiment analysis, historical pattern match',

  // Simple keyword-based sentiment (no external NLP lib needed)
  positiveWords: ['surge', 'jump', 'gain', 'rally', 'beat', 'record', 'high', 'upgrade', 'profit', 'growth', 'bullish', 'soar', 'boom', 'outperform', 'strong', 'positive', 'recovery', 'innovation', 'breakthrough', 'exceed'],
  negativeWords: ['drop', 'fall', 'loss', 'decline', 'miss', 'crash', 'low', 'downgrade', 'debt', 'warning', 'bearish', 'plunge', 'slump', 'underperform', 'weak', 'negative', 'recession', 'layoff', 'lawsuit', 'investigation'],

  async run(ctx) {
    const watchlist = ctx.watchlist || [];
    if (!watchlist.length) return { error: 'No watchlist — run Stock Screener first', stocks: [] };

    const results = [];

    for (const stock of watchlist) {
      const news = await this.fetchNews(stock.symbol);
      const scored = news.map(article => ({
        ...article,
        sentiment: this.scoreSentiment(article.headline),
      }));

      const avgSentiment = scored.length
        ? scored.reduce((sum, a) => sum + a.sentiment.score, 0) / scored.length
        : 0;

      results.push({
        symbol: stock.symbol,
        company: stock.company,
        articles: scored,
        avgSentiment: +avgSentiment.toFixed(2),
        sentimentLabel: avgSentiment > 0.2 ? 'Positive' : avgSentiment < -0.2 ? 'Negative' : 'Neutral',
        articleCount: scored.length,
      });
    }

    ctx.sentiment = results;
    return { stocks: results };
  },

  async fetchNews(symbol) {
    if (!CONFIG.FINNHUB_API_KEY) return this.mockNews(symbol);
    try {
      const today = new Date().toISOString().split('T')[0];
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      const res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${weekAgo}&to=${today}&token=${CONFIG.FINNHUB_API_KEY}`
      );
      const articles = await res.json();
      return (articles || []).slice(0, 5).map(a => ({
        headline: a.headline,
        source: a.source,
        url: a.url,
        datetime: new Date(a.datetime * 1000).toLocaleDateString(),
        summary: a.summary?.substring(0, 150) || '',
      }));
    } catch (e) {
      console.error(`News fetch failed for ${symbol}:`, e);
      return this.mockNews(symbol);
    }
  },

  scoreSentiment(text) {
    if (!text) return { score: 0, label: 'Neutral' };
    const lower = text.toLowerCase();
    let score = 0;
    let matched = [];

    for (const word of this.positiveWords) {
      if (lower.includes(word)) { score += 1; matched.push('+' + word); }
    }
    for (const word of this.negativeWords) {
      if (lower.includes(word)) { score -= 1; matched.push('-' + word); }
    }

    // Normalize to -1..1
    const maxPossible = Math.max(matched.length, 1);
    const normalized = Math.max(-1, Math.min(1, score / maxPossible));

    return {
      score: +normalized.toFixed(2),
      label: normalized > 0.2 ? 'Positive' : normalized < -0.2 ? 'Negative' : 'Neutral',
      keywords: matched,
    };
  },

  mockNews(symbol) {
    const headlines = [
      { headline: `${symbol} beats earnings estimates, stock surges in after-hours`, source: 'Reuters', datetime: 'Today', mock: true },
      { headline: `Analysts upgrade ${symbol} on strong growth outlook`, source: 'Bloomberg', datetime: 'Today', mock: true },
      { headline: `${symbol} announces new product line, market reacts positively`, source: 'CNBC', datetime: 'Yesterday', mock: true },
      { headline: `${symbol} faces regulatory investigation, shares decline`, source: 'WSJ', datetime: '2 days ago', mock: true },
      { headline: `Sector rotation: how ${symbol} fits in the current market`, source: 'MarketWatch', datetime: '3 days ago', mock: true },
    ];
    // Shuffle a bit based on symbol
    const seed = symbol.charCodeAt(0);
    return headlines.slice(0, 3 + (seed % 3));
  },

  render(data) {
    if (data.error) return `<p class="text-yellow-500">${data.error}</p>`;

    let html = '';

    // Sector sentiment overview (from server-side Webz.io data)
    if (data.sectorSentiment) {
      html += this.renderSectorSentiment(data.sectorSentiment, data.sectorAnalysis);
    }

    for (const stock of data.stocks) {
      const sentColors = {
        Positive: 'bg-green-500/20 text-green-400',
        Negative: 'bg-red-500/20 text-red-400',
        Neutral: 'bg-gray-500/20 text-gray-400',
      };
      const sc = sentColors[stock.sentimentLabel] || sentColors.Neutral;

      html += `<div class="mb-6 p-4 rounded-lg border border-gray-200 dark:border-gray-800">`;
      html += `<div class="flex items-center justify-between mb-3">`;
      html += `<span>${tickerLabel(stock.symbol, 'font-bold')} <span class="font-normal text-gray-500 dark:text-gray-400">— ${stock.company}</span></span>`;
      html += `<span class="px-2 py-0.5 rounded-full text-xs font-semibold ${sc}">${stock.sentimentLabel} (${stock.avgSentiment})</span>`;
      html += `</div>`;

      if (stock.articles.length === 0) {
        html += '<p class="text-sm text-gray-500">No recent news</p>';
      } else {
        for (const a of stock.articles) {
          const dotColor = a.sentiment.score > 0.2 ? 'bg-green-500' : a.sentiment.score < -0.2 ? 'bg-red-500' : 'bg-gray-500';
          html += `<div class="flex items-start gap-2 mb-2 text-sm">
            <span class="mt-1.5 w-2 h-2 rounded-full ${dotColor} flex-shrink-0"></span>
            <div>
              <span class="font-medium">${a.headline}</span>
              <span class="text-gray-500 dark:text-gray-400 text-xs ml-2">${a.source} · ${a.datetime}</span>
            </div>
          </div>`;
        }
      }

      html += '</div>';
    }

    if (data.stocks[0]?.articles?.[0]?.mock) {
      html += '<p class="mt-2 text-xs text-yellow-500/70 italic">Demo data — add your Finnhub API key in config.js for live data</p>';
    }

    return html;
  },

  renderSectorSentiment(sectorSentiment, sectorAnalysis) {
    let html = '<div class="mb-6">';
    html += '<h4 class="text-sm font-semibold mb-3">Sector Sentiment</h4>';

    // Market outlook from LLM if available
    if (sectorAnalysis?.marketOutlook) {
      html += `<p class="text-sm text-gray-400 mb-3 italic">${sectorAnalysis.marketOutlook}</p>`;
    }
    if (sectorAnalysis?.crossSectorThemes?.length) {
      html += '<div class="flex flex-wrap gap-1 mb-3">';
      for (const theme of sectorAnalysis.crossSectorThemes) {
        html += `<span class="px-2 py-0.5 rounded text-[10px] bg-blue-500/10 text-blue-400">${theme}</span>`;
      }
      html += '</div>';
    }

    html += '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">';

    for (const [sector, data] of Object.entries(sectorSentiment)) {
      const d = data;
      const score = d.sentimentScore || 0;
      const barWidth = Math.round(Math.abs(score) * 100);
      const barColor = score > 0.2 ? 'bg-green-500' : score < -0.2 ? 'bg-red-500' : 'bg-gray-500';
      const labelColor = score > 0.2 ? 'text-green-400' : score < -0.2 ? 'text-red-400' : 'text-gray-400';

      // LLM analysis for this sector
      const llm = sectorAnalysis?.sectors?.[sector];

      html += `<div class="p-3 rounded-lg border border-gray-100 dark:border-gray-800">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-semibold">${sector}</span>
          <span class="text-xs font-semibold ${labelColor}">${d.sentimentLabel} (${score >= 0 ? '+' : ''}${score})</span>
        </div>
        <div class="flex h-1.5 rounded-full bg-gray-200 dark:bg-gray-800 mb-2">
          <div class="${barColor} h-1.5 rounded-full" style="width:${Math.max(barWidth, 5)}%"></div>
        </div>
        <div class="flex gap-2 text-[10px] text-gray-500 mb-1">
          <span class="text-green-400">${d.positive || 0} pos</span>
          <span class="text-gray-400">${d.neutral || 0} neu</span>
          <span class="text-red-400">${d.negative || 0} neg</span>
          <span>${d.articleCount || 0} articles</span>
        </div>`;

      // LLM outlook
      if (llm) {
        const outlookColor = llm.outlook === 'bullish' ? 'text-green-400' : llm.outlook === 'bearish' ? 'text-red-400' : 'text-gray-400';
        html += `<div class="text-xs ${outlookColor} font-medium mb-1">${llm.outlook?.charAt(0).toUpperCase() + llm.outlook?.slice(1) || ''}</div>`;
        if (llm.summary) {
          html += `<p class="text-[10px] text-gray-500 dark:text-gray-400 mb-1">${llm.summary}</p>`;
        }
        if (llm.risks?.length) {
          html += '<div class="flex flex-wrap gap-1">';
          for (const r of llm.risks.slice(0, 2)) {
            html += `<span class="px-1.5 py-0.5 rounded text-[9px] bg-red-500/10 text-red-400">${r}</span>`;
          }
          html += '</div>';
        }
      }

      // Top headlines
      if (d.headlines?.length) {
        html += '<div class="mt-2 space-y-1">';
        for (const h of d.headlines.slice(0, 2)) {
          html += `<p class="text-[10px] text-gray-500 dark:text-gray-400 truncate">${h}</p>`;
        }
        html += '</div>';
      }

      html += '</div>';
    }

    html += '</div></div>';
    return html;
  },
};
