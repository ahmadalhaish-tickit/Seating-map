#!/bin/bash
set -e
DL=~/Downloads
BASE=~/Desktop/TICKIT

echo "📁 Moving source files into TICKIT..."

cp "$DL/index.ts"       "$BASE/packages/server/src/index.ts"
cp "$DL/schema.prisma"  "$BASE/packages/server/prisma/schema.prisma"
cp "$DL/SeatMap.tsx"    "$BASE/packages/client/src/components/SeatMap.tsx"
cp "$DL/MapEditor.tsx"  "$BASE/packages/client/src/components/MapEditor.tsx"

echo ""
echo "✅ All files in place. TICKIT structure:"
find "$BASE" -not -path "*/node_modules/*" -not -path "*/.git/*" | sort | sed 's|[^/]*/|  |g'

echo ""
echo "══════════════════════════════════════════════"
echo "🎉 TICKIT is fully set up!"
echo "══════════════════════════════════════════════"
echo ""
echo "To start developing:"
echo "  cd ~/Desktop/TICKIT && npm run dev"
echo ""
echo "Before first run, set up your database:"
echo "  1. Edit packages/server/.env with your Postgres URL"
echo "  2. cd packages/server && npx prisma migrate dev --name init"
