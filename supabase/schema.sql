-- TraderAI — Supabase Schema
-- Run this in the SQL Editor to create/update all tables.
-- Safe to run multiple times (uses IF NOT EXISTS).

-- Pipeline data: one row per stage per day
CREATE TABLE IF NOT EXISTS pipeline_data (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stage TEXT NOT NULL,
  run_date DATE NOT NULL,
  data JSONB,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(stage, run_date)
);

-- Per-stock enriched data: fundamentals, insider, analyst, earnings
CREATE TABLE IF NOT EXISTS stock_data (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol TEXT NOT NULL,
  run_date DATE NOT NULL,
  company TEXT,
  sector TEXT,
  data JSONB,
  sentiment_score FLOAT,
  sentiment_reason TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(symbol, run_date)
);

-- News articles (raw + scored)
CREATE TABLE IF NOT EXISTS news_articles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_date DATE NOT NULL,
  symbol TEXT,
  category TEXT,          -- 'general' or 'company'
  headline TEXT,
  source TEXT,
  url TEXT,
  summary TEXT,
  published_at TIMESTAMPTZ,
  sentiment_score FLOAT,  -- filled by analyze function
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Price history (already exists, but ensure schema matches)
CREATE TABLE IF NOT EXISTS price_history (
  symbol TEXT PRIMARY KEY,
  source TEXT,
  candle_count INTEGER,
  first_date DATE,
  last_date DATE,
  candles JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_pipeline_data_stage_date ON pipeline_data(stage, run_date);
CREATE INDEX IF NOT EXISTS idx_stock_data_date ON stock_data(run_date);
CREATE INDEX IF NOT EXISTS idx_stock_data_symbol ON stock_data(symbol);
CREATE INDEX IF NOT EXISTS idx_news_articles_date ON news_articles(run_date);
CREATE INDEX IF NOT EXISTS idx_news_articles_symbol ON news_articles(symbol);

-- Legacy tables (keep for backward compat, client still reads these)
-- watchlist, stage_results already exist from earlier setup
