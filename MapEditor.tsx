import { useState, useRef, useCallback } from "react";

interface Point { x: number; y: number; }
interface DraftSection {
  id: string; name: string; label: string;
  sectionType: "RESERVED"|"GA"|"ACCESSIBLE"|"RESTRICTED";
  points: Point[]; zoneId?: string; saved: boolean;
}
interface Zone { id: string; name: string; color: string; }

interface MapEditorProps {
  mapId: string; svgViewBox: string;
  bgImageUrl?: string; initialZones?: Zone[];
}

type Tool = "select" | "polygon";

function pointsToPath(pts: Point[]) {
  if (pts.length < 2) return "";
  return "M " + pts.map(p => `${p.x} ${p.y}`).join(" L ") + " Z";
}

function centroid(pts: Point[]): Point {
  return {
    x: pts.reduce((s,p) => s+p.x, 0)/pts.length,
    y: pts.reduce((s,p) => s+p.y, 0)/pts.length,
  };
}

function svgPt(svg: SVGSVGElement, e: React.MouseEvent): Point {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM()!.inverse());
}

export default function MapEditor({ mapId, svgViewBox, bgImageUrl, initialZones=[] }: MapEditorProps) {
  const [tool, setTool]         = useState<Tool>("select");
  const [sections, setSections] = useState<DraftSection[]>([]);
  const [selected, setSelected] = useState<string|null>(null);
  const [drawing, setDrawing]   = useState<Point[]>([]);
  const [mouse, setMouse]       = useState<Point|null>(null);
  const [zones, setZones]       = useState<Zone[]>(initialZones);
  const [showRows, setShowRows] = useState(false);
  const [rowCfg, setRowCfg]     = useState({ count:10, seatsPerRow:20, startX:200, startY:200, spacing:28 });
  const [saving, setSaving]     = useState(false);
  const [newZone, setNewZone]   = useState({ name:"", color:"#7F77DD" });
  const svgRef = useRef<SVGSVGElement>(null);
  const [,,vw,vh] = svgViewBox.split(" ").map(Number);
  const sel = sections.find(s => s.id === selected);

  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (tool !== "polygon" || !svgRef.current) return;
    const pt = svgPt(svgRef.current, e);
    if (drawing.length >= 2) {
      const d = Math.hypot(pt.x-drawing[0].x, pt.y-drawing[0].y);
      if (d < 20) { finishPolygon(); return; }
    }
    setDrawing(p => [...p, pt]);
  }, [tool, drawing]);

  const finishPolygon = useCallback(() => {
    if (drawing.length < 3) return;
    const id = crypto.randomUUID();
    setSections(p => [...p, { id, name:`Section ${p.length+1}`, label:`S${p.length+1}`,
      sectionType:"RESERVED", points:drawing, saved:false }]);
    setDrawing([]); setSelected(id); setTool("select");
  }, [drawing]);

  const upd = (id: string, u: Partial<DraftSection>) =>
    setSections(p => p.map(s => s.id===id ? {...s,...u} : s));

  const saveSection = async (s: DraftSection) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/maps/${mapId}/sections`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ name:s.name, label:s.label, sectionType:s.sectionType, polygonPath:pointsToPath(s.points) }),
      });
      const saved = await res.json();
      if (s.zoneId) await fetch(`/api/sections/${saved.id}/zone`, {
        method:"PUT", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ zoneId:s.zoneId }),
      });
      upd(s.id, { saved:true, id:saved.id });
    } finally { setSaving(false); }
  };

  const generateRows = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const { count, seatsPerRow, startX, startY, spacing } = rowCfg;
      for (let r=0; r<count; r++) {
        const rowY = startY + r*spacing;
        await fetch(`/api/sections/${selected}/rows`, {
          method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({
            label: String.fromCharCode(65+r), startX, startY:rowY,
            seats: Array.from({length:seatsPerRow},(_,i) => ({
              rowId:"__placeholder__", seatNumber:String(i+1),
              x:startX+i*spacing, y:rowY,
            })),
          }),
        });
      }
      setShowRows(false);
    } finally { setSaving(false); }
  };

  const addZone = async () => {
    if (!newZone.name) return;
    const res = await fetch(`/api/maps/${mapId}/zones`, {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(newZone),
    });
    setZones(p => [...p, await res.json()]);
    setNewZone({ name:"", color:"#7F77DD" });
  };

  const inp: React.CSSProperties = {
    width:"100%", padding:"5px 8px", borderRadius:6, fontSize:13,
    border:"1px solid #444", background:"#1a1a1a", color:"#fff", boxSizing:"border-box",
  };
  const pbtn: React.CSSProperties = { padding:"6px 12px", borderRadius:6, border:"none", background:"#534AB7", color:"#fff", cursor:"pointer", fontSize:13, fontWeight:500 };
  const sbtn: React.CSSProperties = { padding:"6px 12px", borderRadius:6, border:"1px solid #444", background:"transparent", color:"#ccc", cursor:"pointer", fontSize:13 };
  const dbtn: React.CSSProperties = { padding:"6px 12px", borderRadius:6, border:"none", background:"#3d1a1a", color:"#f09595", cursor:"pointer", fontSize:13 };

  return (
    <div style={{ display:"flex", height:"100vh", fontFamily:"system-ui", background:"#111", color:"#fff" }}>
      {/* Sidebar */}
      <aside style={{ width:268, flexShrink:0, borderRight:"1px solid #333", background:"#1a1a1a", overflowY:"auto", display:"flex", flexDirection:"column" }}>
        {/* Tools */}
        <div style={{ padding:16, borderBottom:"1px solid #333" }}>
          <div style={{ fontWeight:500, marginBottom:10, fontSize:13, color:"#aaa" }}>Tools</div>
          <div style={{ display:"flex", gap:8 }}>
            {(["select","polygon"] as Tool[]).map(t => (
              <button key={t} onClick={() => { setTool(t); setDrawing([]); }} style={{
                flex:1, padding:"6px 0", borderRadius:6, fontSize:13, cursor:"pointer",
                border:"1px solid",
                borderColor: tool===t ? "#534AB7" : "#444",
                background: tool===t ? "#2d2a5e" : "transparent",
                color: tool===t ? "#a09ce8" : "#ccc",
                fontWeight: tool===t ? 500 : 400,
              }}>{t==="select" ? "Select" : "Draw"}</button>
            ))}
          </div>
          {tool==="polygon" && drawing.length===0 && (
            <p style={{ fontSize:11, color:"#666", marginTop:8, marginBottom:0 }}>Click to place points. Click near start to close.</p>
          )}
        </div>

        {/* Section inspector */}
        {sel && (
          <div style={{ padding:16, borderBottom:"1px solid #333" }}>
            <div style={{ fontWeight:500, marginBottom:12, fontSize:13, color:"#aaa" }}>Section</div>
            {([["name","Name",sel.name],["label","Label",sel.label]] as [keyof DraftSection, string, string][]).map(([k,label,val]) => (
              <label key={k} style={{ display:"block", marginBottom:8 }}>
                <span style={{ fontSize:12, color:"#666", display:"block", marginBottom:3 }}>{label}</span>
                <input value={val as string} maxLength={k==="label"?6:undefined}
                  onChange={e => upd(sel.id, { [k]:e.target.value })} style={inp} />
              </label>
            ))}
            <label style={{ display:"block", marginBottom:8 }}>
              <span style={{ fontSize:12, color:"#666", display:"block", marginBottom:3 }}>Type</span>
              <select value={sel.sectionType} onChange={e => upd(sel.id, { sectionType:e.target.value as DraftSection["sectionType"] })} style={inp}>
                <option value="RESERVED">Reserved</option>
                <option value="GA">General admission</option>
                <option value="ACCESSIBLE">Accessible</option>
                <option value="RESTRICTED">Restricted view</option>
              </select>
            </label>
            <label style={{ display:"block", marginBottom:12 }}>
              <span style={{ fontSize:12, color:"#666", display:"block", marginBottom:3 }}>Zone</span>
              <select value={sel.zoneId??""} onChange={e => upd(sel.id, { zoneId:e.target.value||undefined })} style={inp}>
                <option value="">None</option>
                {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <button onClick={() => saveSection(sel)} disabled={saving} style={pbtn}>
                {saving ? "Saving…" : sel.saved ? "✓ Saved" : "Save"}
              </button>
              {sel.saved && sel.sectionType==="RESERVED" && (
                <button onClick={() => setShowRows(true)} style={sbtn}>Add rows</button>
              )}
              <button onClick={() => { setSections(p => p.filter(s => s.id!==sel.id)); setSelected(null); }} style={dbtn}>Delete</button>
            </div>
          </div>
        )}

        {/* Row generator */}
        {showRows && (
          <div style={{ padding:16, borderBottom:"1px solid #333" }}>
            <div style={{ fontWeight:500, marginBottom:12, fontSize:13, color:"#aaa" }}>Row generator</div>
            {(Object.keys(rowCfg) as (keyof typeof rowCfg)[]).map(k => (
              <label key={k} style={{ display:"block", marginBottom:8 }}>
                <span style={{ fontSize:12, color:"#666", display:"block", marginBottom:3 }}>{k}</span>
                <input type="number" value={rowCfg[k]}
                  onChange={e => setRowCfg(p => ({...p,[k]:Number(e.target.value)}))} style={inp} />
              </label>
            ))}
            <div style={{ display:"flex", gap:8, marginTop:8 }}>
              <button onClick={generateRows} disabled={saving} style={pbtn}>{saving?"Generating…":"Generate"}</button>
              <button onClick={() => setShowRows(false)} style={sbtn}>Cancel</button>
            </div>
          </div>
        )}

        {/* Zones */}
        <div style={{ padding:16 }}>
          <div style={{ fontWeight:500, marginBottom:12, fontSize:13, color:"#aaa" }}>Pricing zones</div>
          {zones.map(z => (
            <div key={z.id} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
              <span style={{ width:10, height:10, borderRadius:"50%", background:z.color, flexShrink:0 }} />
              <span style={{ fontSize:13 }}>{z.name}</span>
            </div>
          ))}
          <div style={{ display:"flex", gap:6, marginTop:8 }}>
            <input placeholder="Zone name" value={newZone.name}
              onChange={e => setNewZone(p => ({...p,name:e.target.value}))}
              style={{...inp, flex:1}} />
            <input type="color" value={newZone.color}
              onChange={e => setNewZone(p => ({...p,color:e.target.value}))}
              style={{ width:34, height:32, border:"1px solid #444", borderRadius:6, padding:2, cursor:"pointer", background:"transparent" }} />
            <button onClick={addZone} style={pbtn}>+</button>
          </div>
        </div>
      </aside>

      {/* Canvas */}
      <div style={{ flex:1, position:"relative", overflow:"hidden" }}>
        <svg ref={svgRef} viewBox={svgViewBox} width="100%" height="100%" style={{ display:"block" }}
          onClick={handleClick}
          onMouseMove={e => { if (svgRef.current) setMouse(svgPt(svgRef.current, e)); }}
          onDoubleClick={tool==="polygon" ? finishPolygon : undefined}>

          {bgImageUrl && <image href={bgImageUrl} x="0" y="0" width={vw} height={vh} opacity={0.35} />}

          <defs>
            <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#2a2a2a" strokeWidth="0.5"/>
            </pattern>
          </defs>
          <rect x="0" y="0" width={vw} height={vh} fill="url(#grid)" />

          {sections.map(s => {
            const zone = zones.find(z => z.id===s.zoneId);
            const color = zone?.color ?? "#7F77DD";
            const isSel = s.id===selected;
            const c = centroid(s.points);
            return (
              <g key={s.id} onClick={e => { e.stopPropagation(); if(tool==="select") setSelected(s.id); }}
                style={{ cursor: tool==="select"?"pointer":"default" }}>
                <path d={pointsToPath(s.points)} fill={color+"30"}
                  stroke={color} strokeWidth={isSel?2:1} strokeDasharray={s.saved?"none":"6 3"} />
                {s.points.map((pt,i) => (
                  <circle key={i} cx={pt.x} cy={pt.y} r={isSel?5:3}
                    fill={isSel?color:"transparent"} stroke={color} strokeWidth={1} />
                ))}
                <text x={c.x} y={c.y} textAnchor="middle" dominantBaseline="central"
                  fontSize={13} fontWeight={500} fill={color} style={{ pointerEvents:"none", userSelect:"none" }}>
                  {s.label}
                </text>
                {!s.saved && (
                  <text x={c.x} y={c.y+18} textAnchor="middle" dominantBaseline="central"
                    fontSize={10} fill={color+"88"} style={{ pointerEvents:"none", userSelect:"none" }}>
                    unsaved
                  </text>
                )}
              </g>
            );
          })}

          {drawing.length > 0 && (
            <g>
              <polyline
                points={[...drawing, mouse??drawing[drawing.length-1]].map(p=>`${p.x},${p.y}`).join(" ")}
                fill="none" stroke="#7F77DD" strokeWidth={1.5} strokeDasharray="6 3" />
              {drawing.map((pt,i) => (
                <circle key={i} cx={pt.x} cy={pt.y} r={i===0?6:4}
                  fill={i===0?"#7F77DD":"#2d2a5e"} stroke="#7F77DD" strokeWidth={1} />
              ))}
            </g>
          )}
        </svg>

        {tool==="polygon" && drawing.length===0 && (
          <div style={{ position:"absolute", bottom:20, left:"50%", transform:"translateX(-50%)",
            background:"rgba(0,0,0,0.75)", color:"#ccc", padding:"8px 18px",
            borderRadius:20, fontSize:12, pointerEvents:"none" }}>
            Click to place corner points · Double-click or click first point to close
          </div>
        )}
        {tool==="polygon" && drawing.length>0 && (
          <div style={{ position:"absolute", bottom:20, right:20, display:"flex", gap:8 }}>
            <button onClick={finishPolygon} style={pbtn}>Close polygon</button>
            <button onClick={() => { setDrawing([]); setTool("select"); }} style={sbtn}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
