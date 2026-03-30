# TraderAI — Edge Functions Deployment Guide

## Prerequisites

1. Node.js installed
2. Your Supabase project ID: `aykblttlspkmqrvknwhm`

## Step 1: Install Supabase CLI

```bash
npm install -g supabase
```

## Step 2: Login & Link

```bash
supabase login
supabase link --project-ref aykblttlspkmqrvknwhm
```

## Step 3: Run the Schema SQL

Go to your Supabase Dashboard → SQL Editor → paste the contents of `supabase/schema.sql` → Run.

Or via CLI:
```bash
supabase db execute --file supabase/schema.sql
```

## Step 4: Set Secrets (API Keys)

These are stored server-side in Supabase, never in your client code.

```bash
supabase secrets set FINNHUB_API_KEY=d75659hr01qg1eo7p5j0d75659hr01qg1eo7p5jg
supabase secrets set TWELVE_DATA_KEY=99e4268432a04dc8b640cd59c9d745fc
supabase secrets set ALPHA_VANTAGE_KEY=TUPMU48U4SPT7PI9
supabase secrets set OPENROUTER_API_KEY=<your-openrouter-key-here>
```

## Step 5: Deploy All Functions

From the repo root:

```bash
supabase functions deploy fetch-market-data
supabase functions deploy fetch-fundamentals
supabase functions deploy fetch-news
supabase functions deploy fetch-history
supabase functions deploy analyze
supabase functions deploy run-pipeline
```

## Step 6: Test

Run the full pipeline:
```bash
curl -X POST https://aykblttlspkmqrvknwhm.supabase.co/functions/v1/run-pipeline \
  -H "Authorization: Bearer <your-anon-key>" \
  -H "Content-Type: application/json"
```

Or trigger individual stages:
```bash
curl -X POST https://aykblttlspkmqrvknwhm.supabase.co/functions/v1/fetch-market-data \
  -H "Authorization: Bearer <your-anon-key>"
```

## Step 7: Schedule (Optional)

To run the pipeline automatically, add a cron job in Supabase:

Go to Dashboard → Database → Extensions → Enable `pg_cron` and `pg_net`.

Then in SQL Editor:
```sql
-- Run pipeline every weekday at 9:30 AM ET (13:30 UTC)
SELECT cron.schedule(
  'traderai-morning',
  '30 13 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://aykblttlspkmqrvknwhm.supabase.co/functions/v1/run-pipeline',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'
  );
  $$
);

-- Run again at 12:00 PM ET (16:00 UTC) for midday update
SELECT cron.schedule(
  'traderai-midday',
  '0 16 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://aykblttlspkmqrvknwhm.supabase.co/functions/v1/run-pipeline',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'
  );
  $$
);
```

## Architecture

```
Edge Functions (server-side)          Supabase DB            Client (browser)
┌──────────────────────┐         ┌──────────────┐      ┌─────────────────┐
│ fetch-market-data    │────────▶│ pipeline_data │◀─────│                 │
│ fetch-fundamentals   │────────▶│ stock_data    │◀─────│  Read-only      │
│ fetch-news           │────────▶│ news_articles │◀─────│  Dashboard      │
│ fetch-history        │────────▶│ price_history │◀─────│  (HTML/JS)      │
│ analyze (OpenRouter) │────────▶│               │◀─────│                 │
│ run-pipeline         │         └──────────────┘      └─────────────────┘
└──────────────────────┘              ▲
         ▲                            │
         │                     pg_cron schedule
    API Keys (secrets)         (auto-run weekdays)
    - Finnhub
    - Twelve Data
    - Alpha Vantage
    - OpenRouter
```
