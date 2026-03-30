/**
 * TraderAI — Ticker Map
 * Central symbol → company name mapping.
 * Used for tooltips and display across all stages.
 */
const TICKERS = {
  // Indices & ETFs
  SPY:  'SPDR S&P 500 ETF',
  QQQ:  'Invesco QQQ (Nasdaq-100)',
  DIA:  'SPDR Dow Jones Industrial Avg',
  IWM:  'iShares Russell 2000',
  XLK:  'Technology Select Sector',
  XLF:  'Financial Select Sector',
  XLV:  'Health Care Select Sector',
  XLE:  'Energy Select Sector',
  XLY:  'Consumer Discretionary Select',
  XLP:  'Consumer Staples Select',
  XLI:  'Industrial Select Sector',
  XLU:  'Utilities Select Sector',
  XLB:  'Materials Select Sector',
  XLRE: 'Real Estate Select Sector',
  XLC:  'Communication Services Select',

  // Fear Gauges
  VIXY: 'VIX Short-Term Futures',
  GLD:  'SPDR Gold Shares',
  TLT:  'iShares 20+ Year Treasury',
  UUP:  'Invesco DB US Dollar',
  USO:  'United States Oil Fund',
  ITA:  'iShares U.S. Aerospace & Defense',

  // Energy
  XOM:   'ExxonMobil',
  CVX:   'Chevron',

  // Materials
  DOW:   'Dow Inc.',
  DD:    'DuPont',
  FCX:   'Freeport-McMoRan',
  NEM:   'Newmont',

  // Industrials
  BA:    'Boeing',
  CAT:   'Caterpillar',
  HON:   'Honeywell',
  LMT:   'Lockheed Martin',
  MMM:   '3M',

  // Consumer Discretionary
  AMZN:  'Amazon',
  TSLA:  'Tesla',
  HD:    'Home Depot',
  F:     'Ford',
  GM:    'General Motors',

  // Consumer Staples
  PG:    'Procter & Gamble',
  PEP:   'PepsiCo',
  KHC:   'Kraft Heinz',
  GIS:   'General Mills',
  CL:    'Colgate-Palmolive',

  // Healthcare
  JNJ:   'Johnson & Johnson',
  PFE:   'Pfizer',
  MRK:   'Merck',
  ABBV:  'AbbVie',
  AMGN:  'Amgen',
  LLY:   'Eli Lilly',
  GILD:  'Gilead Sciences',

  // Financials
  JPM:   'JPMorgan Chase',
  GS:    'Goldman Sachs',
  WFC:   'Wells Fargo',
  V:     'Visa',
  MA:    'Mastercard',

  // Information Technology
  MSFT:  'Microsoft',
  NVDA:  'NVIDIA',
  GOOGL: 'Alphabet (Google)',
  META:  'Meta Platforms',
  ORCL:  'Oracle',
  INTC:  'Intel',

  // Communication Services
  T:     'AT&T',
  VZ:    'Verizon',
  DIS:   'Walt Disney',
  NFLX:  'Netflix',

  // Utilities
  NEE:   'NextEra Energy',
  DUK:   'Duke Energy',
  SO:    'Southern Company',

  // Real Estate
  PLD:   'Prologis',
  AMT:   'American Tower',
  VNO:   'Vornado Realty Trust',
};

/**
 * Resolve a symbol to its full company name.
 * Falls back to the symbol itself if not found.
 */
function tickerName(symbol) {
  return TICKERS[symbol] || symbol;
}

/**
 * Wrap a symbol in a styled <span> with a tooltip showing the company name.
 * Use this anywhere a ticker symbol is rendered in HTML.
 */
function tickerLabel(symbol, extraClasses) {
  const name = tickerName(symbol);
  const cls = extraClasses || '';
  if (name === symbol) {
    // No mapping found, just render plain
    return `<span class="${cls}">${symbol}</span>`;
  }
  return `<span class="ticker-tip relative inline-block cursor-help border-b border-dotted border-gray-500 ${cls}" data-tip="${name}">${symbol}</span>`;
}
