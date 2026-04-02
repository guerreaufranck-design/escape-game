#!/bin/bash
# Test the game generation pipeline
# Usage: ./scripts/test-pipeline.sh
#
# This calls the /api/generate-game endpoint with a test game template
# The pipeline takes 3-7 minutes (Perplexity deep research is slow)

API_URL="${1:-http://localhost:3000}"
API_SECRET="${EXTERNAL_API_SECRET:?Set EXTERNAL_API_SECRET env var}"

echo "🎮 Testing Game Generation Pipeline..."
echo "📍 City: Toledo, Spain"
echo "🎭 Theme: The Three Cultures"
echo "⏱️  This will take 3-7 minutes..."
echo ""

curl -X POST "${API_URL}/api/generate-game" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_SECRET}" \
  -d '{
    "city": "Toledo",
    "country": "Spain",
    "theme": "The Three Cultures",
    "themeDescription": "Explore how Christians, Muslims and Jews coexisted in medieval Toledo, leaving their marks in the architecture and culture of this fascinating city.",
    "narrative": "The player is a medieval scholar who discovers a hidden manuscript revealing a secret pact between the three religious communities. Each step reveals a fragment of this ancient covenant.",
    "difficulty": 3,
    "estimatedDurationMin": 90
  }' \
  --max-time 600 \
  -w "\n\n⏱️  Total time: %{time_total}s\n"

echo ""
echo "✅ Done!"
