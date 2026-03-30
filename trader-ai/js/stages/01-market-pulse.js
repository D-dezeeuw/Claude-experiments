/**
 * Stage 1: Market Pulse
 * Pre-market overview: index futures, sector performance, economic calendar.
 */
const MarketPulse = {
  id: 'market-pulse',
  name: 'Market Pulse',
  description: 'Index overview, sector heat map, macro events',

  async run(ctx) {
    const indices = ['SPY', 'QQQ', 'DIA', 'IWM'];
    const results = { indices: [], sectors: [], events: [] };

    // Fetch major index quotes
    for (const symbol of indices) {
      const quote = await this.fetchQuote(symbol);
      if (quote) results.indices.push(quote);
    }

    // Sector ETFs for heat map
    const sectorETFs = [
      { symbol: 'XLK', name: 'Technology' },
      { symbol: 'XLF', name: 'Financials' },
      { symbol: 'XLV', name: 'Healthcare' },
      { symbol: 'XLE', name: 'Energy' },
      { symbol: 'XLY', name: 'Consumer Disc.' },
      { symbol: 'XLP', name: 'Consumer Staples' },
      { symbol: 'XLI', name: 'Industrials' },
      { symbol: 'XLU', name: 'Utilities' },
      { symbol: 'XLB', name: 'Materials' },
      { symbol: 'XLRE', name: 'Real Estate' },
      { symbol: 'XLC', name: 'Communication' },
    ];

    for (const etf of sectorETFs) {
      const quote = await this.fetchQuote(etf.symbol);
      if (quote) results.sectors.push({ ...etf, ...quote });
    }

    // Economic calendar (Finnhub)
    results.events = await this.fetchEconomicCalendar();

    return results;
  },

  async fetchQuote(symbol) {
    if (!CONFIG.FINNHUB_API_KEY) return this.mockQuote(symbol);
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${CONFIG.FINNHUB_API_KEY}`
      );
      const d = await res.json();
      return {
        symbol,
        price: d.c,
        change: d.d,
        changePercent: d.dp,
        high: d.h,
        low: d.l,
        open: d.o,
        prevClose: d.pc,
      };
    } catch (e) {
      console.error(`Quote fetch failed for ${symbol}:`, e);
      return this.mockQuote(symbol);
    }
  },

  async fetchEconomicCalendar() {
    if (!CONFIG.FINNHUB_API_KEY) return this.mockEvents();
    try {
      const today = new Date().toISOString().split('T')[0];
      const res = await fetch(
        `https://finnhub.io/api/v1/calendar/economic?from=${today}&to=${today}&token=${CONFIG.FINNHUB_API_KEY}`
      );
      const d = await res.json();
      return (d.economicCalendar || []).slice(0, 10).map(e => ({
        time: e.time,
        event: e.event,
        impact: e.impact,
        actual: e.actual,
        estimate: e.estimate,
        prior: e.prior,
      }));
    } catch (e) {
      return this.mockEvents();
    }
  },

  mockQuote(symbol) {
    const base = { SPY: 520, QQQ: 440, DIA: 390, IWM: 205 }[symbol] || 100;
    const change = (Math.random() - 0.48) * 4;
    return {
      symbol,
      price: +(base + change).toFixed(2),
      change: +change.toFixed(2),
      changePercent: +((change / base) * 100).toFixed(2),
      high: +(base + Math.abs(change) + 1).toFixed(2),
      low: +(base - Math.abs(change) - 0.5).toFixed(2),
      open: +(base + change * 0.3).toFixed(2),
      prevClose: +base.toFixed(2),
      mock: true,
    };
  },

  mockEvents() {
    return [
      { time: '08:30', event: 'Initial Jobless Claims', impact: 'medium', actual: '220K', estimate: '225K', prior: '228K' },
      { time: '10:00', event: 'Existing Home Sales', impact: 'medium', actual: null, estimate: '4.15M', prior: '4.08M' },
      { time: '14:00', event: 'Fed Interest Rate Decision', impact: 'high', actual: null, estimate: '5.50%', prior: '5.50%' },
    ];
  },

  render(data) {
    let html = '';

    // Indices
    html += '<div class="mb-6"><h3 class="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Major Indices</h3>';
    html += '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">';
    for (const idx of data.indices) {
      const up = idx.change >= 0;
      const color = up ? 'text-green-500' : 'text-red-500';
      const bg = up ? 'bg-green-500/10' : 'bg-red-500/10';
      html += `
        <div class="rounded-lg border border-gray-200 dark:border-gray-800 p-3 ${bg}">
          <div class="text-xs text-gray-500 dark:text-gray-400">${tickerLabel(idx.symbol)}</div>
          <div class="text-lg font-bold">${idx.price}</div>
          <div class="${color} text-sm font-medium">${up ? '+' : ''}${idx.change} (${up ? '+' : ''}${idx.changePercent}%)</div>
        </div>`;
    }
    html += '</div></div>';

    // Sector heat map
    html += '<div class="mb-6"><h3 class="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Sector Heat Map</h3>';
    html += '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">';
    for (const s of data.sectors) {
      const pct = s.changePercent || 0;
      const up = pct >= 0;
      const intensity = Math.min(Math.abs(pct) * 20, 100);
      const bg = up ? `rgba(34,197,94,${intensity / 100 * 0.3})` : `rgba(239,68,68,${intensity / 100 * 0.3})`;
      html += `
        <div class="rounded-lg p-2 text-center border border-gray-200 dark:border-gray-800" style="background:${bg}">
          <div class="text-xs font-medium">${s.name}</div>
          <div class="text-sm font-bold ${up ? 'text-green-500' : 'text-red-500'}">${up ? '+' : ''}${pct.toFixed(2)}%</div>
        </div>`;
    }
    html += '</div></div>';

    // Economic calendar
    html += '<div><h3 class="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Economic Calendar</h3>';
    html += '<div class="overflow-x-auto"><table class="w-full text-sm">';
    html += '<thead><tr class="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-800"><th class="pb-2 pr-4">Time</th><th class="pb-2 pr-4">Event</th><th class="pb-2 pr-4">Impact</th><th class="pb-2 pr-4">Est.</th><th class="pb-2">Prior</th></tr></thead><tbody>';
    for (const e of data.events) {
      const impactColor = { high: 'text-red-500', medium: 'text-yellow-500', low: 'text-gray-400' }[e.impact] || 'text-gray-400';
      html += `<tr class="border-b border-gray-100 dark:border-gray-800/50">
        <td class="py-2 pr-4 text-gray-500 dark:text-gray-400">${e.time || '-'}</td>
        <td class="py-2 pr-4 font-medium">${e.event}</td>
        <td class="py-2 pr-4 ${impactColor} font-medium capitalize">${e.impact || '-'}</td>
        <td class="py-2 pr-4">${e.estimate || '-'}</td>
        <td class="py-2">${e.prior || '-'}</td>
      </tr>`;
    }
    html += '</tbody></table></div></div>';

    if (data.indices[0]?.mock) {
      html += '<p class="mt-4 text-xs text-yellow-500/70 italic">Demo data — add your Finnhub API key in config.js for live data</p>';
    }

    return html;
  },
};
