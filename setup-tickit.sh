#!/bin/bash
set -e
BASE=~/Desktop/TICKIT

# ── Folders ──────────────────────────────────────────────────────────────────
mkdir -p "$BASE/packages/server/src"
mkdir -p "$BASE/packages/server/prisma"
mkdir -p "$BASE/packages/client/src/components"
mkdir -p "$BASE/packages/shared/src"

# ── Root package.json ─────────────────────────────────────────────────────────
cat > "$BASE/package.json" << 'PKGJSON'
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
PKGJSON

# ── Server package.json ───────────────────────────────────────────────────────
cat > "$BASE/packages/server/package.json" << 'SPKG'
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
SPKG

# ── Server tsconfig ───────────────────────────────────────────────────────────
cat > "$BASE/packages/server/tsconfig.json" << 'TSCONFIG'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
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
TSCONFIG

# ── Server .env ───────────────────────────────────────────────────────────────
cat > "$BASE/packages/server/.env" << 'SENV'
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/tickit"
CLIENT_URL="http://localhost:5173"
PORT=3001
SENV

echo "✅ Folders and config files created"

# ── Install server deps ───────────────────────────────────────────────────────
echo "📦 Installing server dependencies..."
cd "$BASE/packages/server" && npm install

# ── Scaffold Vite client ──────────────────────────────────────────────────────
echo "⚡ Scaffolding Vite React client..."
cd "$BASE/packages/client"
cat > "package.json" << 'CPKG'
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
CPKG

cat > "index.html" << 'HTML'
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
HTML

cat > "vite.config.ts" << 'VITE'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3001' } }
})
VITE

cat > "tsconfig.json" << 'CTSCONFIG'
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
CTSCONFIG

cat > ".env" << 'CENV'
VITE_API_URL=http://localhost:3001
CENV

mkdir -p src
cat > "src/main.tsx" << 'MAIN'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
MAIN

cat > "src/App.tsx" << 'APP'
import { useState } from 'react'

export default function App() {
  const [view, setView] = useState<'map' | 'admin'>('map')
  return (
    <div style={{ fontFamily: 'system-ui', background: '#111', minHeight: '100vh', color: '#fff' }}>
      <nav style={{ padding: '12px 24px', borderBottom: '1px solid #333', display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ fontWeight: 600, fontSize: 18, color: '#7F77DD' }}>TICKIT</span>
        <button onClick={() => setView('map')}
          style={{ background: view==='map' ? '#534AB7' : 'transparent', color: '#fff', border: '1px solid #534AB7', borderRadius: 6, padding: '4px 14px', cursor: 'pointer' }}>
          Seat Map
        </button>
        <button onClick={() => setView('admin')}
          style={{ background: view==='admin' ? '#534AB7' : 'transparent', color: '#fff', border: '1px solid #534AB7', borderRadius: 6, padding: '4px 14px', cursor: 'pointer' }}>
          Map Editor
        </button>
      </nav>
      <div style={{ padding: 24 }}>
        {view === 'map'
          ? <div style={{ color: '#888', textAlign: 'center', marginTop: 80 }}>SeatMap component loads here — connect to an event ID to see live seats.</div>
          : <div style={{ color: '#888', textAlign: 'center', marginTop: 80 }}>MapEditor loads here — select a venue map to start drawing sections.</div>
        }
      </div>
    </div>
  )
}
APP

echo "📦 Installing client dependencies..."
npm install

# ── Root install ──────────────────────────────────────────────────────────────
echo "📦 Installing root dependencies..."
cd "$BASE" && npm install

echo ""
echo "✅ TICKIT project created at ~/Desktop/TICKIT"
echo ""
echo "Next steps:"
echo "  1. Add your Postgres credentials to packages/server/.env"
echo "  2. cd ~/Desktop/TICKIT/packages/server && npx prisma migrate dev --name init"
echo "  3. cd ~/Desktop/TICKIT && npm run dev"
echo ""
echo "Client runs at: http://localhost:5173"
echo "Server runs at: http://localhost:3001"
