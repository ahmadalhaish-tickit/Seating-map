import { useState, useEffect } from 'react'
import SeatMap from './components/SeatMap'
import MapEditor from './components/MapEditor'
import { useSession } from './hooks/useSession'

interface EventInfo   { id: string; name: string; date: string }
interface ZoneInfo    { id: string; name: string; color: string }
interface MapInfo {
  id: string; name: string; svgViewBox: string
  venue: { name: string }
  events: EventInfo[]
  pricingZones: ZoneInfo[]
}

export default function App() {
  const sessionId = useSession()
  const [view, setView]               = useState<'map' | 'admin'>('map')
  const [maps, setMaps]               = useState<MapInfo[]>([])
  const [selectedMapId, setSelectedMapId]     = useState('')
  const [selectedEventId, setSelectedEventId] = useState('')
  const [loading, setLoading]         = useState(true)

  const [serverError, setServerError] = useState(false)

  useEffect(() => {
    fetch('/api/maps')
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((data: MapInfo[]) => {
        setMaps(data)
        if (data.length > 0) {
          setSelectedMapId(data[0].id)
          if (data[0].events.length > 0) setSelectedEventId(data[0].events[0].id)
        }
      })
      .catch(() => setServerError(true))
      .finally(() => setLoading(false))
  }, [])

  const selectedMap = maps.find(m => m.id === selectedMapId)

  function handleMapChange(mapId: string) {
    setSelectedMapId(mapId)
    const m = maps.find(m => m.id === mapId)
    setSelectedEventId(m?.events[0]?.id ?? '')
  }

  const navBtn = (v: typeof view, label: string) => (
    <button onClick={() => setView(v)} style={{
      background: view === v ? '#534AB7' : 'transparent',
      color: '#fff', border: '1px solid #534AB7',
      borderRadius: 6, padding: '5px 16px', cursor: 'pointer', fontSize: 14,
    }}>{label}</button>
  )

  const sel: React.CSSProperties = {
    padding: '4px 8px', borderRadius: 6, fontSize: 13,
    background: '#1a1a1a', color: '#fff', border: '1px solid #444', cursor: 'pointer',
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#111', color: '#fff' }}>
      <nav style={{
        padding: '10px 20px', borderBottom: '1px solid #333',
        display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, fontSize: 20, color: '#7F77DD', marginRight: 4 }}>TICKIT</span>

        {navBtn('map', 'Seat Map')}
        {navBtn('admin', 'Map Editor')}

        {maps.length > 0 && (
          <select value={selectedMapId} onChange={e => handleMapChange(e.target.value)} style={{ ...sel, marginLeft: 'auto' }}>
            {maps.map(m => (
              <option key={m.id} value={m.id}>{m.venue.name} — {m.name}</option>
            ))}
          </select>
        )}

        {view === 'map' && selectedMap && selectedMap.events.length > 0 && (
          <select value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)} style={sel}>
            {selectedMap.events.map(ev => (
              <option key={ev.id} value={ev.id}>{ev.name}</option>
            ))}
          </select>
        )}
      </nav>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', fontSize: 14 }}>
            Loading…
          </div>
        ) : serverError ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, color: '#888' }}>
            <div style={{ fontSize: 15 }}>Cannot reach the server.</div>
            <code style={{ background: '#1a1a1a', padding: '8px 16px', borderRadius: 6, fontSize: 13, color: '#aaa' }}>
              npm run dev
            </code>
          </div>
        ) : !selectedMapId ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12, color: '#666' }}>
            <div style={{ fontSize: 15 }}>No maps found. Run the seed to create demo data:</div>
            <code style={{ background: '#1a1a1a', padding: '8px 16px', borderRadius: 6, fontSize: 13, color: '#aaa' }}>
              cd packages/server && npm run seed
            </code>
          </div>
        ) : view === 'map' ? (
          selectedEventId
            ? <SeatMap mapId={selectedMapId} eventId={selectedEventId} sessionId={sessionId} />
            : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', fontSize: 14 }}>
                No events for this map yet.
              </div>
        ) : (
          <MapEditor
            mapId={selectedMapId}
            svgViewBox={selectedMap?.svgViewBox ?? '0 0 1200 800'}
            initialZones={selectedMap?.pricingZones ?? []}
          />
        )}
      </div>
    </div>
  )
}
