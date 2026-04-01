/**
 * Stage 2: Stock Screener
 * Filter Fortune 500 by volume, earnings proximity, momentum → produce watchlist.
 */
const StockScreener = {
  id: 'stock-screener',
  name: 'Stock Screener',
  description: 'Filter Fortune 500 by criteria, build today\'s watchlist',

  // GICS sector-based universe (48 stocks, 11 sectors)
  universe: [
    // Energy
    { symbol: 'XOM', company: 'ExxonMobil', sector: 'Energy' },
    { symbol: 'CVX', company: 'Chevron', sector: 'Energy' },
    // Materials
    { symbol: 'DOW', company: 'Dow Inc.', sector: 'Materials' },
    { symbol: 'DD', company: 'DuPont', sector: 'Materials' },
    { symbol: 'FCX', company: 'Freeport-McMoRan', sector: 'Materials' },
    { symbol: 'NEM', company: 'Newmont', sector: 'Materials' },
    // Industrials
    { symbol: 'BA', company: 'Boeing', sector: 'Industrials' },
    { symbol: 'CAT', company: 'Caterpillar', sector: 'Industrials' },
    { symbol: 'HON', company: 'Honeywell', sector: 'Industrials' },
    { symbol: 'LMT', company: 'Lockheed Martin', sector: 'Industrials' },
    { symbol: 'MMM', company: '3M', sector: 'Industrials' },
    // Consumer Discretionary
    { symbol: 'AMZN', company: 'Amazon', sector: 'Consumer Discretionary' },
    { symbol: 'TSLA', company: 'Tesla', sector: 'Consumer Discretionary' },
    { symbol: 'HD', company: 'Home Depot', sector: 'Consumer Discretionary' },
    { symbol: 'F', company: 'Ford', sector: 'Consumer Discretionary' },
    { symbol: 'GM', company: 'General Motors', sector: 'Consumer Discretionary' },
    // Consumer Staples
    { symbol: 'PG', company: 'Procter & Gamble', sector: 'Consumer Staples' },
    { symbol: 'PEP', company: 'PepsiCo', sector: 'Consumer Staples' },
    { symbol: 'KHC', company: 'Kraft Heinz', sector: 'Consumer Staples' },
    { symbol: 'GIS', company: 'General Mills', sector: 'Consumer Staples' },
    { symbol: 'CL', company: 'Colgate-Palmolive', sector: 'Consumer Staples' },
    // Healthcare
    { symbol: 'JNJ', company: 'Johnson & Johnson', sector: 'Healthcare' },
    { symbol: 'PFE', company: 'Pfizer', sector: 'Healthcare' },
    { symbol: 'MRK', company: 'Merck', sector: 'Healthcare' },
    { symbol: 'ABBV', company: 'AbbVie', sector: 'Healthcare' },
    { symbol: 'AMGN', company: 'Amgen', sector: 'Healthcare' },
    { symbol: 'LLY', company: 'Eli Lilly', sector: 'Healthcare' },
    { symbol: 'GILD', company: 'Gilead Sciences', sector: 'Healthcare' },
    // Financials
    { symbol: 'JPM', company: 'JPMorgan Chase', sector: 'Financials' },
    { symbol: 'GS', company: 'Goldman Sachs', sector: 'Financials' },
    { symbol: 'WFC', company: 'Wells Fargo', sector: 'Financials' },
    { symbol: 'V', company: 'Visa', sector: 'Financials' },
    { symbol: 'MA', company: 'Mastercard', sector: 'Financials' },
    // Information Technology
    { symbol: 'MSFT', company: 'Microsoft', sector: 'Information Technology' },
    { symbol: 'NVDA', company: 'NVIDIA', sector: 'Information Technology' },
    { symbol: 'GOOGL', company: 'Alphabet', sector: 'Information Technology' },
    { symbol: 'META', company: 'Meta Platforms', sector: 'Information Technology' },
    { symbol: 'ORCL', company: 'Oracle', sector: 'Information Technology' },
    { symbol: 'INTC', company: 'Intel', sector: 'Information Technology' },
    // Communication Services
    { symbol: 'T', company: 'AT&T', sector: 'Communication Services' },
    { symbol: 'VZ', company: 'Verizon', sector: 'Communication Services' },
    { symbol: 'DIS', company: 'Walt Disney', sector: 'Communication Services' },
    { symbol: 'NFLX', company: 'Netflix', sector: 'Communication Services' },
    // Utilities
    { symbol: 'NEE', company: 'NextEra Energy', sector: 'Utilities' },
    { symbol: 'DUK', company: 'Duke Energy', sector: 'Utilities' },
    { symbol: 'SO', company: 'Southern Company', sector: 'Utilities' },
    // Real Estate
    { symbol: 'PLD', company: 'Prologis', sector: 'Real Estate' },
    { symbol: 'AMT', company: 'American Tower', sector: 'Real Estate' },
    { symbol: 'VNO', company: 'Vornado Realty Trust', sector: 'Real Estate' },
  ],

  // User-adjustable screening filters
  filters: {
    minChangePercent: 1.5,    // minimum absolute % move
    sectors: [],               // empty = all sectors
    maxResults: 12,
  },

  async run(ctx) {
    const screened = [];

    for (const stock of this.universe) {
      // Apply sector filter
      if (this.filters.sectors.length > 0 && !this.filters.sectors.includes(stock.sector)) {
        continue;
      }

      const quote = await this.fetchQuote(stock.symbol);
      if (!quote) continue;

      const absPct = Math.abs(quote.changePercent || 0);

      screened.push({
        ...stock,
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
        volume: quote.volume || 0,
        high: quote.high,
        low: quote.low,
        score: absPct, // simple ranking by move size
        mock: quote.mock || false,
      });
    }

    // Sort by absolute move (most interesting first)
    screened.sort((a, b) => b.score - a.score);

    const watchlist = screened.slice(0, this.filters.maxResults);

    // Persist watchlist for downstream stages
    ctx.watchlist = watchlist;

    return { watchlist, totalScreened: this.universe.length };
  },

  async fetchQuote(symbol) {
    if (!CONFIG.FINNHUB_API_KEY) return this.mockQuote(symbol);
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${CONFIG.FINNHUB_API_KEY}`
      );
      const d = await res.json();
      return {
        price: d.c, change: d.d, changePercent: d.dp,
        high: d.h, low: d.l, volume: d.v || 0,
      };
    } catch (e) {
      return this.mockQuote(symbol);
    }
  },

  mockQuote(symbol) {
    const base = 100 + symbol.charCodeAt(0) * 2;
    const change = (Math.random() - 0.45) * 8;
    return {
      price: +(base + change).toFixed(2),
      change: +change.toFixed(2),
      changePercent: +((change / base) * 100).toFixed(2),
      high: +(base + 5).toFixed(2),
      low: +(base - 3).toFixed(2),
      volume: Math.floor(Math.random() * 50000000),
      mock: true,
    };
  },

  render(data) {
    let html = `<p class="text-sm text-gray-500 dark:text-gray-400 mb-4">Screened <strong>${data.totalScreened}</strong> stocks → <strong>${data.watchlist.length}</strong> on today's watchlist (sorted by move size)</p>`;

    html += '<div class="overflow-x-auto"><table class="w-full text-sm">';
    html += '<thead><tr class="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800">';
    html += '<th class="pb-2 pr-3">#</th><th class="pb-2 pr-3">Symbol</th><th class="pb-2 pr-3">Company</th><th class="pb-2 pr-3">Sector</th><th class="pb-2 pr-3 text-right">Price</th><th class="pb-2 pr-3 text-right">Change</th><th class="pb-2 text-right">%</th></tr></thead><tbody>';

    data.watchlist.forEach((s, i) => {
      const up = s.change >= 0;
      const color = up ? 'text-green-500' : 'text-red-500';
      html += `<tr class="border-b border-gray-100 dark:border-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/30">
        <td class="py-2 pr-3 text-gray-400">${i + 1}</td>
        <td class="py-2 pr-3">${tickerLabel(s.symbol, 'font-bold')}</td>
        <td class="py-2 pr-3">${s.company}</td>
        <td class="py-2 pr-3 text-gray-500 dark:text-gray-400">${s.sector}</td>
        <td class="py-2 pr-3 text-right font-mono">${s.price.toFixed(2)}</td>
        <td class="py-2 pr-3 text-right font-mono ${color}">${up ? '+' : ''}${s.change.toFixed(2)}</td>
        <td class="py-2 text-right font-mono font-bold ${color}">${up ? '+' : ''}${s.changePercent.toFixed(2)}%</td>
      </tr>`;
    });

    html += '</tbody></table></div>';

    if (data.watchlist[0]?.mock) {
      html += '<p class="mt-4 text-xs text-yellow-500/70 italic">Demo data — add your Finnhub API key in config.js for live data</p>';
    }

    return html;
  },
};
