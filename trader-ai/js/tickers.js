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

  // Technology
  AAPL:  'Apple',
  MSFT:  'Microsoft',
  GOOGL: 'Alphabet (Google)',
  NVDA:  'NVIDIA',
  META:  'Meta Platforms (Facebook)',
  INTC:  'Intel',
  AMD:   'Advanced Micro Devices',
  CRM:   'Salesforce',

  // Consumer Discretionary
  AMZN:  'Amazon',
  TSLA:  'Tesla',
  HD:    'Home Depot',
  LOW:   'Lowe\'s',

  // Financials
  'BRK.B': 'Berkshire Hathaway',
  JPM:   'JPMorgan Chase',
  V:     'Visa',
  MA:    'Mastercard',
  GS:    'Goldman Sachs',

  // Healthcare
  JNJ:   'Johnson & Johnson',
  UNH:   'UnitedHealth Group',
  LLY:   'Eli Lilly',
  PFE:   'Pfizer',
  ABBV:  'AbbVie',
  MRK:   'Merck',

  // Energy
  XOM:   'ExxonMobil',
  CVX:   'Chevron',

  // Consumer Staples
  PG:    'Procter & Gamble',
  KO:    'Coca-Cola',
  PEP:   'PepsiCo',
  COST:  'Costco',
  WMT:   'Walmart',

  // Communication
  DIS:   'Walt Disney',
  NFLX:  'Netflix',

  // Industrials
  BA:    'Boeing',
  CAT:   'Caterpillar',

  // Utilities
  NEE:   'NextEra Energy',
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
