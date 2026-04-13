import { useState, useEffect } from 'react'
import SeatMap from './components/SeatMap'
import MapEditor from './components/MapEditor'
import { useSession } from './hooks/useSession'

interface MapSlot {
  id: string; name: string; mapSlot: number; svgViewBox: string
  scheduledStartAt: string | null; scheduledEndAt: string | null
  isPublished: boolean
  pricingZones: { id: string; name: string; color: string }[]
}
interface EventData {
  id: string; name: string; date: string | null
  venue: { name: string } | null
  maps: MapSlot[]
}

export default function App() {
  const sessionId = useSession()

  const [urlToken]   = useState(() => new URLSearchParams(window.location.search).get('token'))
  const [urlEventId] = useState(() => new URLSearchParams(window.location.search).get('event'))

  // ── Admin flow (token in URL) ──────────────────────────────────────────
  const [adminState, setAdminState] = useState<'checking' | 'valid' | 'expired' | 'invalid'>(
    urlToken ? 'checking' : 'skip'  as 'checking' | 'valid' | 'expired' | 'invalid'
  )
  const [adminEventId, setAdminEventId] = useState('')

  const [view, setView]               = useState<'map' | 'editor'>('editor')
  const [events, setEvents]           = useState<EventData[]>([])
  const [selectedEventId, setSelectedEventId] = useState('')
  const [selectedMapId,   setSelectedMapId]   = useState('')
  const [adminLoading,    setAdminLoading]     = useState(false)
  const [serverError,     setServerError]      = useState(false)

  const [creatingEvent,    setCreatingEvent]    = useState(false)
  const [newEventName,     setNewEventName]     = useState('')
  const [creating,         setCreating]         = useState(false)
  const [creatingMap,      setCreatingMap]      = useState(false)
  const [newMapName,       setNewMapName]       = useState('')
  const [newMapSlot,       setNewMapSlot]       = useState(1)
  const [creatingMapBusy,  setCreatingMapBusy]  = useState(false)

  // ── Customer flow (no token) ───────────────────────────────────────────
  const [customerState, setCustomerState] = useState<'loading' | 'ready' | 'no-map'>('loading')
  const [customerMapId,   setCustomerMapId]   = useState('')
  const [customerEventId, setCustomerEventId] = useState('')

  // Verify admin token
  useEffect(() => {
    if (!urlToken) return
    fetch(`/api/auth/verify?token=${encodeURIComponent(urlToken)}`)
      .then(async r => {
        const d = await r.json()
        if (r.ok) { setAdminEventId(d.eventId); setAdminState('valid') }
        else setAdminState(d.error?.includes('expired') ? 'expired' : 'invalid')
      })
      .catch(() => setAdminState('invalid'))
  }, [urlToken])

  // Load all events once admin token is verified
  useEffect(() => {
    if (!adminEventId) return
    setAdminLoading(true)
    fetch('/api/events')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((data: EventData[]) => {
        setEvents(data)
        const focus = data.find(e => e.id === adminEventId) ?? data[0]
        if (focus) { setSelectedEventId(focus.id); setSelectedMapId(focus.maps[0]?.id ?? '') }
      })
      .catch(() => setServerError(true))
      .finally(() => setAdminLoading(false))
  }, [adminEventId])

  // Load public customer view
  useEffect(() => {
    if (urlToken) return
    ;(async () => {
      try {
        let eid = urlEventId
        if (!eid) {
          const r = await fetch('/api/events')
          const data: EventData[] = await r.json()
          const found = data.find(e => e.maps.some(m => m.isPublished))
          if (!found) { setCustomerState('no-map'); return }
          eid = found.id
        }
        const mr = await fetch(`/api/events/${eid}/active-map`)
        if (!mr.ok) { setCustomerState('no-map'); return }
        const map = await mr.json()
        setCustomerEventId(eid)
        setCustomerMapId(map.id)
        setCustomerState('ready')
      } catch { setCustomerState('no-map') }
    })()
  }, [urlToken, urlEventId])

  const selectedEvent = events.find(e => e.id === selectedEventId)
  const selectedMap   = selectedEvent?.maps.find(m => m.id === selectedMapId)

  function selectEvent(eid: string) {
    setSelectedEventId(eid)
    const ev = events.find(e => e.id === eid)
    setSelectedMapId(ev?.maps[0]?.id ?? '')
    setCreatingMap(false)
  }

  async function createEvent() {
    if (!newEventName.trim()) return
    setCreating(true)
    try {
      const r = await fetch('/api/events', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newEventName.trim() }),
      })
      if (!r.ok) return
      const ev: EventData = await r.json()
      setEvents(prev => [...prev, ev])
      setSelectedEventId(ev.id); setSelectedMapId('')
      setCreatingEvent(false); setNewEventName('')
    } finally { setCreating(false) }
  }

  async function createMap() {
    if (!newMapName.trim() || !selectedEventId) return
    setCreatingMapBusy(true)
    try {
      const r = await fetch(`/api/events/${selectedEventId}/maps`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMapName.trim(), mapSlot: newMapSlot }),
      })
      if (!r.ok) return
      const newMap: MapSlot = await r.json()
      setEvents(prev => prev.map(e =>
        e.id === selectedEventId
          ? { ...e, maps: [...e.maps, newMap].sort((a, b) => a.mapSlot - b.mapSlot) }
          : e
      ))
      setSelectedMapId(newMap.id)
      setCreatingMap(false); setNewMapName('')
    } finally { setCreatingMapBusy(false) }
  }

  // ── Customer view (no token) ───────────────────────────────────────────
  if (!urlToken) {
    const centered: React.CSSProperties = {
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#111', color: '#888', fontSize: 15, flexDirection: 'column', gap: 10,
    }
    if (customerState === 'loading') return <div style={centered}>Loading…</div>
    if (customerState === 'no-map')  return <div style={centered}>No events available right now.</div>
    return (
      <div style={{ height: '100vh', background: '#111' }}>
        <SeatMap mapId={customerMapId} eventId={customerEventId} sessionId={sessionId} />
      </div>
    )
  }

  // ── Admin view (token present) ─────────────────────────────────────────
  const centered: React.CSSProperties = {
    height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#111', color: '#888', fontSize: 15, flexDirection: 'column', gap: 10,
  }
  if (adminState === 'checking') return <div style={centered}>Verifying access…</div>
  if (adminState === 'expired')
    return (
      <div style={centered}>
        <div style={{ color: '#ccc' }}>Your session has expired.</div>
        <div style={{ fontSize: 13 }}>Please request a new link.</div>
      </div>
    )
  if (adminState === 'invalid') return <div style={centered}>Invalid or unrecognised token.</div>

  const sel: React.CSSProperties = {
    padding: '4px 8px', borderRadius: 6, fontSize: 13,
    background: '#1a1a1a', color: '#fff', border: '1px solid #444', cursor: 'pointer',
  }
  const navBtn = (v: typeof view, label: string) => (
    <button onClick={() => setView(v)} style={{
      background: view === v ? '#534AB7' : 'transparent',
      color: '#fff', border: '1px solid #534AB7',
      borderRadius: 6, padding: '5px 16px', cursor: 'pointer', fontSize: 14,
    }}>{label}</button>
  )

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#111', color: '#fff' }}>
      <nav style={{
        padding: '10px 20px', borderBottom: '1px solid #333',
        display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ fontWeight: 700, fontSize: 20, color: '#7F77DD', marginRight: 4 }}>TICKIT</span>
        {navBtn('map', 'Preview')}
        {navBtn('editor', 'Map Editor')}

        {events.length > 0 && (
          <select value={selectedEventId} onChange={e => selectEvent(e.target.value)}
            style={{ ...sel, marginLeft: 'auto' }}>
            {events.map(e => (
              <option key={e.id} value={e.id}>
                {e.venue ? `${e.venue.name} — ` : ''}{e.name}
              </option>
            ))}
          </select>
        )}

        {selectedEvent && selectedEvent.maps.length > 0 && (
          <div style={{ display: 'flex', gap: 4 }}>
            {selectedEvent.maps.map(m => (
              <button key={m.id} onClick={() => setSelectedMapId(m.id)} style={{
                padding: '4px 10px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
                background: selectedMapId === m.id ? '#2a2a3a' : 'transparent',
                color: selectedMapId === m.id ? '#a09ce8' : '#666',
                border: selectedMapId === m.id ? '1px solid #534AB7' : '1px solid #333',
              }}>
                Map {m.mapSlot}
                {m.isPublished && <span style={{ marginLeft: 4, color: '#1D9E75', fontSize: 10 }}>●</span>}
              </button>
            ))}
            {selectedEvent.maps.length < 3 && (
              <button onClick={() => { setCreatingMap(true); setNewMapSlot(selectedEvent.maps.length + 1) }} style={{
                padding: '4px 10px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
                background: 'transparent', color: '#555', border: '1px dashed #444',
              }}>+ Map</button>
            )}
          </div>
        )}

        <button onClick={() => setCreatingEvent(true)} style={{
          padding: '4px 10px', fontSize: 12, borderRadius: 5, cursor: 'pointer',
          background: 'transparent', color: '#666', border: '1px dashed #444',
          marginLeft: events.length === 0 ? 'auto' : 0,
        }}>+ Event</button>
      </nav>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {/* Create event modal */}
        {creatingEvent && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: '#1a1a1a', borderRadius: 10, padding: 28, width: 360, border: '1px solid #333' }}>
              <div style={{ fontWeight: 600, marginBottom: 16, fontSize: 15 }}>New Event</div>
              <input autoFocus placeholder="Event name" value={newEventName}
                onChange={e => setNewEventName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createEvent()}
                style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #444', background: '#111', color: '#fff', fontSize: 13, boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={createEvent} disabled={creating || !newEventName.trim()}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#534AB7', color: '#fff', fontSize: 13 }}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
                <button onClick={() => { setCreatingEvent(false); setNewEventName('') }}
                  style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #444', background: 'transparent', color: '#aaa', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create map modal */}
        {creatingMap && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: '#1a1a1a', borderRadius: 10, padding: 28, width: 360, border: '1px solid #333' }}>
              <div style={{ fontWeight: 600, marginBottom: 16, fontSize: 15 }}>New Map Slot</div>
              <label style={{ display: 'block', marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>Slot</span>
                <select value={newMapSlot} onChange={e => setNewMapSlot(Number(e.target.value))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #444', background: '#111', color: '#fff', fontSize: 13, boxSizing: 'border-box' as const }}>
                  {[1, 2, 3].filter(s => !selectedEvent?.maps.find(m => m.mapSlot === s)).map(s => (
                    <option key={s} value={s}>Map {s}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'block', marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>Name</span>
                <input autoFocus placeholder="Map name" value={newMapName}
                  onChange={e => setNewMapName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createMap()}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #444', background: '#111', color: '#fff', fontSize: 13, boxSizing: 'border-box' as const }} />
              </label>
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={createMap} disabled={creatingMapBusy || !newMapName.trim()}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#534AB7', color: '#fff', fontSize: 13 }}>
                  {creatingMapBusy ? 'Creating…' : 'Create'}
                </button>
                <button onClick={() => { setCreatingMap(false); setNewMapName('') }}
                  style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #444', background: 'transparent', color: '#aaa', fontSize: 13, cursor: 'pointer' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {adminLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#666', fontSize: 14 }}>Loading…</div>
        ) : serverError ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888', fontSize: 15 }}>Cannot reach the server.</div>
        ) : events.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 14, color: '#666' }}>
            <div style={{ fontSize: 15 }}>No events yet.</div>
            <button onClick={() => setCreatingEvent(true)} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#534AB7', color: '#fff', fontSize: 13 }}>
              Create first event
            </button>
          </div>
        ) : !selectedMapId ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 14, color: '#666' }}>
            <div style={{ fontSize: 15 }}>No maps for this event yet.</div>
            <button onClick={() => { setCreatingMap(true); setNewMapSlot(1) }} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', cursor: 'pointer', background: '#534AB7', color: '#fff', fontSize: 13 }}>
              Create Map 1
            </button>
          </div>
        ) : view === 'map' ? (
          <SeatMap mapId={selectedMapId} eventId={selectedEventId} sessionId={sessionId} />
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
