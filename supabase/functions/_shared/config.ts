// supabase/functions/_shared/config.ts
// Shared configuration for all edge functions.
// API keys are read from Supabase Edge Function secrets (env vars).

export const FINNHUB_KEY = Deno.env.get('FINNHUB_API_KEY') || '';
export const TWELVE_DATA_KEY = Deno.env.get('TWELVE_DATA_KEY') || '';
export const ALPHA_VANTAGE_KEY = Deno.env.get('ALPHA_VANTAGE_KEY') || '';
export const OPENROUTER_KEY = Deno.env.get('OPENROUTER_API_KEY') || '';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
export const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// GICS sector-based universe — synced with client-side screener
export const STOCK_UNIVERSE = [
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
