#!/bin/bash
# TraderAI — Run pipeline manually
# Usage: ./run-pipeline.sh [full|market|news|fundamentals|history|analyze]

SUPABASE_URL="https://aykblttlspkmqrvknwhm.supabase.co"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5a2JsdHRsc3BrbXFydmtud2htIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NjkyMDAsImV4cCI6MjA5MDQ0NTIwMH0.HA-DxWM_CsH4HzBEWnjUMC8Wh0BQMRYb9_3WWZsI9LY"

call() {
  local fn=$1
  echo ""
  echo "━━━ $fn ━━━"
  curl -s -X POST "$SUPABASE_URL/functions/v1/$fn" \
    -H "Authorization: Bearer $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d '{}' | python3 -m json.tool 2>/dev/null || echo "(no JSON output)"
  echo ""
}

CMD=${1:-full}

case $CMD in
  full)
    echo "Running full pipeline..."
    call "run-pipeline"
    ;;
  market)
    call "fetch-market-data"
    ;;
  news)
    call "fetch-news"
    ;;
  fundamentals)
    call "fetch-fundamentals"
    ;;
  history)
    call "fetch-history"
    ;;
  analyze)
    call "analyze"
    ;;
  sector-news)
    call "fetch-sector-news"
    ;;
  all-individual)
    echo "Running all functions individually..."
    call "fetch-market-data"
    call "fetch-news"
    call "fetch-sector-news"
    call "fetch-fundamentals"
    call "analyze"
    call "fetch-history"
    ;;
  *)
    echo "Usage: $0 [full|market|news|fundamentals|history|analyze|all-individual]"
    echo ""
    echo "  full            Run the orchestrator (calls all stages in order)"
    echo "  market          Fetch market data only (indices, sectors)"
    echo "  news            Fetch news only"
    echo "  sector-news     Fetch sector news (Webz.io)"
    echo "  fundamentals    Fetch fundamentals only"
    echo "  history         Fetch price history only"
    echo "  analyze         Run NLP analysis only"
    echo "  all-individual  Run each function one by one"
    exit 1
    ;;
esac

echo "Done."
