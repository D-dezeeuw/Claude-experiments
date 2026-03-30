// supabase/functions/_shared/config.ts
// Shared configuration for all edge functions.
// API keys are read from Supabase Edge Function secrets (env vars).

export const FINNHUB_KEY = Deno.env.get('FINNHUB_API_KEY') || '';
export const TWELVE_DATA_KEY = Deno.env.get('TWELVE_DATA_KEY') || '';
export const ALPHA_VANTAGE_KEY = Deno.env.get('ALPHA_VANTAGE_KEY') || '';
export const OPENROUTER_KEY = Deno.env.get('OPENROUTER_API_KEY') || '';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
export const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Stock universe — same as client-side screener
export const STOCK_UNIVERSE = [
  { symbol: 'AAPL', company: 'Apple', sector: 'Technology' },
  { symbol: 'MSFT', company: 'Microsoft', sector: 'Technology' },
  { symbol: 'GOOGL', company: 'Alphabet', sector: 'Technology' },
  { symbol: 'AMZN', company: 'Amazon', sector: 'Consumer Disc.' },
  { symbol: 'NVDA', company: 'NVIDIA', sector: 'Technology' },
  { symbol: 'META', company: 'Meta Platforms', sector: 'Technology' },
  { symbol: 'TSLA', company: 'Tesla', sector: 'Consumer Disc.' },
  { symbol: 'JPM', company: 'JPMorgan Chase', sector: 'Financials' },
  { symbol: 'V', company: 'Visa', sector: 'Financials' },
  { symbol: 'JNJ', company: 'Johnson & Johnson', sector: 'Healthcare' },
  { symbol: 'UNH', company: 'UnitedHealth', sector: 'Healthcare' },
  { symbol: 'XOM', company: 'ExxonMobil', sector: 'Energy' },
  { symbol: 'PG', company: 'Procter & Gamble', sector: 'Consumer Staples' },
  { symbol: 'MA', company: 'Mastercard', sector: 'Financials' },
  { symbol: 'HD', company: 'Home Depot', sector: 'Consumer Disc.' },
  { symbol: 'CVX', company: 'Chevron', sector: 'Energy' },
  { symbol: 'LLY', company: 'Eli Lilly', sector: 'Healthcare' },
  { symbol: 'PFE', company: 'Pfizer', sector: 'Healthcare' },
  { symbol: 'ABBV', company: 'AbbVie', sector: 'Healthcare' },
  { symbol: 'KO', company: 'Coca-Cola', sector: 'Consumer Staples' },
  { symbol: 'MRK', company: 'Merck', sector: 'Healthcare' },
  { symbol: 'PEP', company: 'PepsiCo', sector: 'Consumer Staples' },
  { symbol: 'COST', company: 'Costco', sector: 'Consumer Staples' },
  { symbol: 'WMT', company: 'Walmart', sector: 'Consumer Staples' },
  { symbol: 'DIS', company: 'Walt Disney', sector: 'Communication' },
  { symbol: 'NFLX', company: 'Netflix', sector: 'Communication' },
  { symbol: 'INTC', company: 'Intel', sector: 'Technology' },
  { symbol: 'AMD', company: 'AMD', sector: 'Technology' },
  { symbol: 'CRM', company: 'Salesforce', sector: 'Technology' },
  { symbol: 'BA', company: 'Boeing', sector: 'Industrials' },
  { symbol: 'CAT', company: 'Caterpillar', sector: 'Industrials' },
  { symbol: 'GS', company: 'Goldman Sachs', sector: 'Financials' },
  { symbol: 'NEE', company: 'NextEra Energy', sector: 'Utilities' },
  { symbol: 'LOW', company: "Lowe's", sector: 'Consumer Disc.' },
];

// Fear gauge ETFs
export const FEAR_GAUGES = [
  { symbol: 'VIXY', name: 'VIX (Fear Index)', type: 'fear' },
  { symbol: 'GLD', name: 'Gold', type: 'safe_haven' },
  { symbol: 'TLT', name: 'Treasury 20yr', type: 'safe_haven' },
  { symbol: 'UUP', name: 'US Dollar', type: 'safe_haven' },
  { symbol: 'USO', name: 'Crude Oil', type: 'commodity' },
  { symbol: 'ITA', name: 'Defense ETF', type: 'defense' },
];

// Index ETFs
export const INDEX_ETFS = ['SPY', 'QQQ', 'DIA', 'IWM'];

// Sector ETFs
export const SECTOR_ETFS = [
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

// Helper: create Supabase client for server-side operations
export async function createSupabaseClient() {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

// Helper: fetch a Finnhub endpoint
export async function finnhub(path: string): Promise<any> {
  if (!FINNHUB_KEY) throw new Error('FINNHUB_API_KEY not set');
  const res = await fetch(`https://finnhub.io/api/v1${path}${path.includes('?') ? '&' : '?'}token=${FINNHUB_KEY}`);
  if (!res.ok) throw new Error(`Finnhub ${path}: ${res.status}`);
  return res.json();
}

// Helper: fetch a Twelve Data endpoint
export async function twelveData(path: string): Promise<any> {
  if (!TWELVE_DATA_KEY) throw new Error('TWELVE_DATA_KEY not set');
  const res = await fetch(`https://api.twelvedata.com${path}${path.includes('?') ? '&' : '?'}apikey=${TWELVE_DATA_KEY}`);
  if (!res.ok) throw new Error(`TwelveData ${path}: ${res.status}`);
  return res.json();
}

// Helper: CORS headers for edge function responses
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper: respond with JSON
export function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Helper: today's date as YYYY-MM-DD
export function today(): string {
  return new Date().toISOString().split('T')[0];
}
