#!/bin/bash
set -e

echo "🚀 Creating TICKIT at ~/Desktop/TICKIT..."
BASE=~/Desktop/TICKIT

# ── Directory structure ────────────────────────────────────────────────────────
mkdir -p "$BASE/packages/server/src"
mkdir -p "$BASE/packages/server/prisma"
mkdir -p "$BASE/packages/client/src/components"
mkdir -p "$BASE/packages/shared/src"

# ── Root package.json ──────────────────────────────────────────────────────────
cat > "$BASE/package.json" <<'EOF'
{
  "name": "tickit",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "concurrently \"npm run dev -w packages/server\" \"npm run dev -w packages/client\"",
    "db:migrate": "npm run migrate -w packages/server"
  },
  "devDependencies": {
    "concurrently": "^8.2.0"
  }
}
EOF

# ── Server package.json ────────────────────────────────────────────────────────
cat > "$BASE/packages/server/package.json" <<'EOF'
{
  "name": "@tickit/server",
  "version": "1.0.0",
  "scripts": {
    "dev": "ts-node-dev --respawn --transpile-only src/index.ts",
    "migrate": "prisma migrate dev",
    "build": "tsc"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.6.1",
    "cors": "^2.8.5",
    "@prisma/client": "^5.0.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "ts-node-dev": "^2.0.0",
    "@types/express": "^4.17.17",
    "@types/cors": "^2.8.13",
    "@types/node": "^20.0.0",
    "prisma": "^5.0.0"
  }
}
EOF

# ── Server tsconfig ────────────────────────────────────────────────────────────
cat > "$BASE/packages/server/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
EOF

# ── Server .env ────────────────────────────────────────────────────────────────
cat > "$BASE/packages/server/.env" <<'EOF'
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tickit"
CLIENT_URL="http://localhost:5173"
PORT=3001
EOF

# ── Prisma schema ──────────────────────────────────────────────────────────────
cat > "$BASE/packages/server/prisma/schema.prisma" <<'EOF'
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Venue {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  address   String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  maps      VenueMap[]
}

model VenueMap {
  id           String      @id @default(cuid())
  venueId      String
  name         String
  svgViewBox   String      @default("0 0 1200 800")
  bgImageUrl   String?
  isPublished  Boolean     @default(false)
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
  venue        Venue         @relation(fields: [venueId], references: [id])
  sections     Section[]
  pricingZones PricingZone[]
  events       Event[]
}

model Section {
  id           String      @id @default(cuid())
  mapId        String
  name         String
  label        String
  sectionType  SectionType @default(RESERVED)
  polygonPath  String
  sortOrder    Int         @default(0)
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
  map          VenueMap              @relation(fields: [mapId], references: [id])
  rows         Row[]
  zoneMappings SectionZoneMapping[]
}

enum SectionType {
  RESERVED
  GA
  ACCESSIBLE
  RESTRICTED
}

model Row {
  id        String   @id @default(cuid())
  sectionId String
  label     String
  sortOrder Int      @default(0)
  startX    Float
  startY    Float
  angle     Float    @default(0)
  createdAt DateTime @default(now())
  section   Section  @relation(fields: [sectionId], references: [id])
  seats     Seat[]
}

model Seat {
  id           String  @id @default(cuid())
  rowId        String
  seatNumber   String
  x            Float
  y            Float
  isAccessible Boolean @default(false)
  isObstructed Boolean @default(false)
  notes        String?
  row          Row     @relation(fields: [rowId], references: [id])
  inventory    SeatInventory[]
}

model PricingZone {
  id              String   @id @default(cuid())
  mapId           String
  name            String
  color           String
  sortOrder       Int      @default(0)
  map             VenueMap             @relation(fields: [mapId], references: [id])
  sectionMappings SectionZoneMapping[]
  ticketTypes     TicketType[]
}

model SectionZoneMapping {
  id        String      @id @default(cuid())
  sectionId String
  zoneId    String
  section   Section     @relation(fields: [sectionId], references: [id])
  zone      PricingZone @relation(fields: [zoneId], references: [id])
  @@unique([sectionId, zoneId])
}

model Event {
  id          String    @id @default(cuid())
  mapId       String
  name        String
  date        DateTime
  doorsOpen   DateTime?
  isActive    Boolean   @default(false)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  map         VenueMap        @relation(fields: [mapId], references: [id])
  ticketTypes TicketType[]
  inventory   SeatInventory[]
}

model TicketType {
  id          String @id @default(cuid())
  eventId     String
  zoneId      String
  name        String
  price       Int
  currency    String @default("AED")
  maxPerOrder Int    @default(8)
  available   Int
  event       Event       @relation(fields: [eventId], references: [id])
  zone        PricingZone @relation(fields: [zoneId], references: [id])
}

model SeatInventory {
  id      String     @id @default(cuid())
  eventId String
  seatId  String
  status  SeatStatus @default(AVAILABLE)
  heldBy  String?
  heldAt  DateTime?
  orderId String?
  event   Event @relation(fields: [eventId], references: [id])
  seat    Seat  @relation(fields: [seatId], references: [id])
  @@unique([eventId, seatId])
  @@index([eventId, status])
}

enum SeatStatus {
  AVAILABLE
  HELD
  RESERVED
  SOLD
  BLOCKED
}
EOF

echo "✅ Schema written"

# ── Client scaffold ────────────────────────────────────────────────────────────
cat > "$BASE/packages/client/package.json" <<'EOF'
{
  "name": "@tickit/client",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@use-gesture/react": "^10.3.0",
    "socket.io-client": "^4.6.1"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.0.0",
    "vite": "^4.4.0"
  }
}
EOF

cat > "$BASE/packages/client/index.html" <<'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TICKIT</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
EOF

cat > "$BASE/packages/client/vite.config.ts" <<'EOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3001' } }
})
EOF

cat > "$BASE/packages/client/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
EOF

cat > "$BASE/packages/client/.env" <<'EOF'
VITE_API_URL=http://localhost:3001
EOF

mkdir -p "$BASE/packages/client/src"

cat > "$BASE/packages/client/src/main.tsx" <<'EOF'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
EOF

cat > "$BASE/packages/client/src/index.css" <<'EOF'
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: #111; color: #fff; }
EOF

cat > "$BASE/packages/client/src/App.tsx" <<'EOF'
import { useState } from 'react'

export default function App() {
  const [view, setView] = useState<'map' | 'admin'>('map')
  const btn = (v: typeof view, label: string) => (
    <button onClick={() => setView(v)} style={{
      background: view===v ? '#534AB7' : 'transparent',
      color: '#fff', border: '1px solid #534AB7',
      borderRadius: 6, padding: '5px 16px', cursor: 'pointer', fontSize: 14
    }}>{label}</button>
  )
  return (
    <div style={{ minHeight: '100vh' }}>
      <nav style={{ padding: '12px 24px', borderBottom: '1px solid #333', display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: 20, color: '#7F77DD', marginRight: 8 }}>TICKIT</span>
        {btn('map', 'Seat Map')}
        {btn('admin', 'Map Editor')}
      </nav>
      <div style={{ padding: 32, textAlign: 'center', color: '#666', marginTop: 60 }}>
        {view === 'map'
          ? 'SeatMap component — connect mapId + eventId props to render live seats'
          : 'MapEditor component — select a venueMap to start drawing sections'
        }
      </div>
    </div>
  )
}
EOF

echo "✅ Client scaffold written"

# ── Install all dependencies ───────────────────────────────────────────────────
echo ""
echo "📦 Installing server dependencies..."
cd "$BASE/packages/server" && npm install

echo ""
echo "📦 Installing client dependencies..."
cd "$BASE/packages/client" && npm install

echo ""
echo "📦 Installing root dependencies..."
cd "$BASE" && npm install

echo ""
echo "══════════════════════════════════════════════"
echo "✅  TICKIT is ready at ~/Desktop/TICKIT"
echo "══════════════════════════════════════════════"
echo ""
echo "Next:"
echo "  1. Edit packages/server/.env with your Postgres URL"
echo "  2. cd ~/Desktop/TICKIT/packages/server && npx prisma migrate dev --name init"
echo "  3. cd ~/Desktop/TICKIT && npm run dev"
echo ""
echo "  → Client: http://localhost:5173"
echo "  → Server: http://localhost:3001"
