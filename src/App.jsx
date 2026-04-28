import { useState, useCallback, useRef, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const API = "https://api.anthropic.com/v1/messages";
const STORAGE_KEY = "facturas_grupo_damp_v2";

// ── Usuarios y roles ──
const USUARIOS = [
  { usuario: "oficina",  password: "damp2024",  rol: "oficina", nombre: "Oficina" },
  { usuario: "dueño",    password: "damp2024admin", rol: "dueno", nombre: "Dueño" },
  { usuario: "hermano",  password: "damp2024admin", rol: "dueno", nombre: "Dueño" },
];

const EMPRESAS = [
  { nombre: "Agibratex SRL",      color: "#f59e0b" },
  { nombre: "Abtex SRL",          color: "#10b981" },
  { nombre: "Bragitex SRL",       color: "#3b82f6" },
  { nombre: "Gasbratex SRL",      color: "#f43f5e" },
  { nombre: "Ginette Ivana Damp", color: "#a855f7" },
  { nombre: "Axel Gaston Damp",   color: "#06b6d4" },
  { nombre: "Braian Uriel Damp",  color: "#84cc16" },
];

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function getCurrentMesKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
}
function mesKeyToLabel(key) {
  if (!key) return "";
  const [y, m] = key.split("-");
  return `${MESES[parseInt(m)-1]} ${y}`;
}
const fmt = (n) => n != null && n !== 0
  ? `$${Number(n).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2})}`
  : "-";

const SYSTEM_PROMPT = `Eres un experto en lectura de facturas argentinas (AFIP). Extraés datos con máxima precisión.

Las empresas del grupo son:
1. "Agibratex SRL"
2. "Abtex SRL"
3. "Bragitex SRL"
4. "Gasbratex SRL"
5. "Ginette Ivana Damp"
6. "Axel Gaston Damp"
7. "Braian Uriel Damp"

Identificá a cuál de estas empresas está dirigida la factura (campo cliente/receptor).
Buscá coincidencias por nombre (ignorá mayúsculas, tildes, abreviaturas). Si no coincide con ninguna ponés "Sin identificar".

Respondé ÚNICAMENTE con JSON válido, sin markdown, sin texto adicional:

{
  "numero_factura": "string o null",
  "tipo_factura": "A|B|C|M|X|null",
  "fecha_emision": "DD/MM/YYYY o null",
  "fecha_vencimiento": "DD/MM/YYYY o null",
  "empresa_destino": "nombre exacto de la lista o Sin identificar",
  "empresa_detectada_raw": "texto tal como aparece en la factura para el cliente",
  "proveedor": {
    "razon_social": "string o null",
    "cuit": "string o null",
    "condicion_iva": "string o null"
  },
  "importes": {
    "neto_gravado": number o null,
    "neto_no_gravado": number o null,
    "iva_10_5": number o null,
    "iva_21": number o null,
    "iva_27": number o null,
    "otros_impuestos": number o null,
    "total": number o null
  },
  "condicion_pago": "string o null",
  "moneda": "ARS|USD|EUR|null",
  "cae": "string o null"
}`;

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function extractFromClaude(file, apiKey) {
  const base64 = await fileToBase64(file);
  const isPDF = file.type === "application/pdf";
  const isImage = file.type.startsWith("image/");
  if (!isPDF && !isImage) throw new Error("Formato no soportado");

  const contentBlock = isPDF
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
    : { type: "image", source: { type: "base64", media_type: file.type, data: base64 } };

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  const res = await fetch(API, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [contentBlock, { type: "text", text: "Extraé los datos. Solo JSON." }] }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Error ${res.status}`);
  }

  const data = await res.json();
  const text = data.content?.map(i => i.text || "").join("") || "";
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

function exportToCSV(facturas, mesLabel) {
  const headers = ["N° Factura","Tipo","Fecha","Vencimiento","Empresa Destino","Proveedor","CUIT Proveedor","Cond. IVA","Neto Gravado","IVA 21%","IVA 10.5%","IVA 27%","Total","Moneda","CAE","Archivo"];
  const rows = facturas.map(f => [
    f.numero_factura||"", f.tipo_factura||"", f.fecha_emision||"", f.fecha_vencimiento||"",
    f.empresa_destino||"", f.proveedor?.razon_social||"", f.proveedor?.cuit||"", f.proveedor?.condicion_iva||"",
    f.importes?.neto_gravado??"", f.importes?.iva_21??"", f.importes?.iva_10_5??"", f.importes?.iva_27??"",
    f.importes?.total??"", f.moneda||"ARS", f.cae||"", f._fileName||""
  ]);
  const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `facturas_${mesLabel.replace(" ","_")}.csv`;
  a.click();
}

function EmpresaBadge({ nombre }) {
  const e = EMPRESAS.find(e => e.nombre === nombre);
  const color = e?.color || "#9ca3af";
  return (
    <span style={{background:color+"20",color,border:`1px solid ${color}40`,padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>
      {nombre || "Sin identificar"}
    </span>
  );
}

function StatusPill({ status, error }) {
  const map = {
    ok: ["#d1fae5","#065f46","✓ Listo"],
    loading: ["#fef3c7","#92400e","⏳ Leyendo"],
    error: ["#fee2e2","#991b1b","✗ Error"]
  };
  const [bg, color, label] = map[status] || map.error;
  return <span title={error||""} style={{background:bg,color,padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700,cursor:error?"help":"default"}}>{label}</span>;
}

// ── Pantalla Login ──
function LoginScreen({ onLogin }) {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPass, setShowPass] = useState(false);

  const handleLogin = () => {
    const user = USUARIOS.find(u => u.usuario === usuario.toLowerCase().trim() && u.password === password);
    if (!user) { setError("Usuario o contraseña incorrectos"); return; }
    onLogin(user);
  };

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f172a 0%,#1e293b 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#fff",borderRadius:24,boxShadow:"0 20px 60px rgba(0,0,0,0.3)",padding:"44px 40px",maxWidth:420,width:"100%"}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:48,marginBottom:12}}>📄</div>
          <div style={{fontSize:11,letterSpacing:4,color:"#94a3b8",textTransform:"uppercase",marginBottom:6}}>Grupo Damp</div>
          <h2 style={{margin:0,fontSize:24,fontWeight:900,color:"#0f172a"}}>Gestión de Facturas</h2>
          <p style={{color:"#64748b",marginTop:8,fontSize:14}}>Ingresá con tu usuario</p>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:20}}>
          <div>
            <label style={{fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:6}}>Usuario</label>
            <input
              value={usuario}
              onChange={e=>{setUsuario(e.target.value);setError("");}}
              onKeyDown={e=>e.key==="Enter"&&handleLogin()}
              placeholder="oficina / dueño / hermano"
              style={{width:"100%",padding:"12px 14px",borderRadius:10,border:`1px solid ${error?"#fca5a5":"#e2e8f0"}`,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"inherit"}}
            />
          </div>
          <div>
            <label style={{fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:6}}>Contraseña</label>
            <div style={{position:"relative"}}>
              <input
                type={showPass?"text":"password"}
                value={password}
                onChange={e=>{setPassword(e.target.value);setError("");}}
                onKeyDown={e=>e.key==="Enter"&&handleLogin()}
                placeholder="••••••••"
                style={{width:"100%",padding:"12px 44px 12px 14px",borderRadius:10,border:`1px solid ${error?"#fca5a5":"#e2e8f0"}`,fontSize:14,outline:"none",boxSizing:"border-box",fontFamily:"monospace"}}
              />
              <button onClick={()=>setShowPass(s=>!s)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",color:"#94a3b8",fontSize:16}}>
                {showPass?"🙈":"👁"}
              </button>
            </div>
          </div>
          {error && <div style={{background:"#fee2e2",color:"#dc2626",padding:"10px 14px",borderRadius:8,fontSize:13,fontWeight:600}}>❌ {error}</div>}
        </div>

        <button
          onClick={handleLogin}
          disabled={!usuario||!password}
          style={{width:"100%",padding:"14px",background:usuario&&password?"#0f172a":"#e2e8f0",color:usuario&&password?"#f59e0b":"#94a3b8",border:"none",borderRadius:12,fontWeight:900,fontSize:16,cursor:usuario&&password?"pointer":"not-allowed",transition:"all 0.2s"}}
        >
          Ingresar →
        </button>

        <div style={{marginTop:24,background:"#f8fafc",borderRadius:12,padding:14,fontSize:12,color:"#64748b",lineHeight:1.8}}>
          <strong>Usuarios disponibles:</strong><br/>
          👩‍💼 <code>oficina</code> — carga facturas y ve la tabla<br/>
          👔 <code>dueño</code> / <code>hermano</code> — acceso completo
        </div>
      </div>
    </div>
  );
}

// ── Pantalla API Key (solo dueños) ──
function ApiKeyScreen({ onSave }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");

  const handleSave = () => {
    if (!key.trim().startsWith("sk-ant-")) { setError("La API key debe empezar con sk-ant-"); return; }
    onSave(key.trim());
  };

  return (
    <div style={{minHeight:"100vh",background:"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{background:"#fff",borderRadius:24,boxShadow:"0 8px 40px rgba(0,0,0,0.10)",padding:"44px 40px",maxWidth:480,width:"100%"}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:44,marginBottom:10}}>🔑</div>
          <h2 style={{margin:0,fontSize:22,fontWeight:900,color:"#0f172a"}}>Configuración inicial</h2>
          <p style={{color:"#64748b",marginTop:8,fontSize:14,lineHeight:1.6}}>Ingresá la API key de Anthropic.<br/>Se guarda solo en este dispositivo.</p>
        </div>
        <div style={{marginBottom:16}}>
          <label style={{fontSize:12,fontWeight:700,color:"#64748b",textTransform:"uppercase",letterSpacing:1,display:"block",marginBottom:8}}>API Key de Anthropic</label>
          <input type="password" value={key} onChange={e=>{setKey(e.target.value);setError("");}} placeholder="sk-ant-api03-..."
            style={{width:"100%",padding:"12px 14px",borderRadius:10,border:`1px solid ${error?"#fca5a5":"#e2e8f0"}`,fontSize:14,outline:"none",fontFamily:"monospace",boxSizing:"border-box"}} />
          {error && <div style={{color:"#dc2626",fontSize:12,marginTop:6}}>{error}</div>}
        </div>
        <div style={{background:"#f8fafc",borderRadius:12,padding:14,marginBottom:22,fontSize:13,color:"#475569",lineHeight:1.6}}>
          <strong>¿Dónde conseguirla?</strong><br/>
          Entrá a <strong>console.anthropic.com</strong> → API Keys → Create Key
        </div>
        <button onClick={handleSave} disabled={!key.trim()} style={{width:"100%",padding:"14px",background:key.trim()?"#0f172a":"#e2e8f0",color:key.trim()?"#f59e0b":"#94a3b8",border:"none",borderRadius:12,fontWeight:900,fontSize:16,cursor:key.trim()?"pointer":"not-allowed"}}>
          Guardar y continuar →
        </button>
      </div>
    </div>
  );
}

// ── App principal ──
export default function ExtractorFacturas() {
  const [sesion, setSesion] = useState(null);
  const [apiKey, setApiKey] = useState(null);
  const [facturas, setFacturas] = useState([]);
  const [historial, setHistorial] = useState({});
  const [mesActivo, setMesActivo] = useState(getCurrentMesKey());
  const [queue, setQueue] = useState([]);
  const [tab, setTab] = useState("cargar");
  const [filtroEmpresa, setFiltroEmpresa] = useState("TODAS");
  const [mesFiltroHistorial, setMesFiltroHistorial] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [showCerrarMes, setShowCerrarMes] = useState(false);
  const inputRef = useRef();

  const esDueno = sesion?.rol === "dueno";

  useEffect(() => {
    try {
      const savedKey = localStorage.getItem("damp_api_key");
      if (savedKey) setApiKey(savedKey);
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        setFacturas(saved.facturas || []);
        setHistorial(saved.historial || {});
        setMesActivo(saved.mesActivo || getCurrentMesKey());
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!apiKey) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ facturas, historial, mesActivo })); } catch {}
  }, [facturas, historial, mesActivo, apiKey]);

  const saveApiKey = (key) => { localStorage.setItem("damp_api_key", key); setApiKey(key); };

  const processFiles = useCallback(async (files) => {
    const valid = Array.from(files).filter(f => f.type==="application/pdf"||f.type.startsWith("image/"));
    if (!valid.length) return;
    const newItems = valid.map(f => ({ id: Date.now()+Math.random(), file: f, status: "loading" }));
    setQueue(q => [...q, ...newItems]);
    for (const item of newItems) {
      try {
        const data = await extractFromClaude(item.file, apiKey);
        const factura = { ...data, _fileName: item.file.name, _id: item.id, _cargadaEn: new Date().toISOString(), _cargadaPor: sesion?.nombre };
        setFacturas(prev => [...prev, factura]);
        setQueue(q => q.map(qi => qi.id===item.id ? {...qi,status:"ok"} : qi));
      } catch(e) {
        setQueue(q => q.map(qi => qi.id===item.id ? {...qi,status:"error",error:e.message} : qi));
      }
    }
  }, [apiKey, sesion]);

  const handleDrop = useCallback((e) => { e.preventDefault(); setDragging(false); processFiles(e.dataTransfer.files); }, [processFiles]);
  const eliminarFactura = (id) => setFacturas(prev => prev.filter(f => f._id !== id));

  const cerrarMes = () => {
    setHistorial(prev => ({ ...prev, [mesActivo]: { label: mesKeyToLabel(mesActivo), facturas: [...facturas] } }));
    setFacturas([]); setQueue([]); setMesActivo(getCurrentMesKey());
    setShowCerrarMes(false); setTab("cargar"); setFiltroEmpresa("TODAS");
  };

  // ── Guards ──
  if (!sesion) return <LoginScreen onLogin={setSesion} />;
  if (!apiKey) {
    if (!esDueno) return (
      <div style={{minHeight:"100vh",background:"#f1f5f9",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
        <div style={{background:"#fff",borderRadius:20,padding:"40px 32px",maxWidth:400,textAlign:"center",boxShadow:"0 4px 20px rgba(0,0,0,0.08)"}}>
          <div style={{fontSize:44,marginBottom:12}}>⏳</div>
          <h3 style={{margin:"0 0 10px",color:"#0f172a"}}>Configuración pendiente</h3>
          <p style={{color:"#64748b",fontSize:14}}>Un dueño debe configurar la API key primero para activar el sistema.</p>
          <button onClick={()=>setSesion(null)} style={{marginTop:20,padding:"10px 24px",background:"#0f172a",color:"#f59e0b",border:"none",borderRadius:10,fontWeight:700,cursor:"pointer"}}>Volver al login</button>
        </div>
      </div>
    );
    return <ApiKeyScreen onSave={saveApiKey} />;
  }

  // Cálculos
  const factFiltradas = filtroEmpresa==="TODAS" ? facturas : facturas.filter(f=>f.empresa_destino===filtroEmpresa);
  const sinIdentificar = facturas.filter(f=>f.empresa_destino==="Sin identificar").length;
  const hasLoading = queue.some(q=>q.status==="loading");
  const mesesHistorial = Object.keys(historial).sort().reverse();

  const calcT = (fs) => ({
    total: fs.reduce((s,f)=>s+(f.importes?.total||0),0),
    neto: fs.reduce((s,f)=>s+(f.importes?.neto_gravado||0),0),
    iva21: fs.reduce((s,f)=>s+(f.importes?.iva_21||0),0),
    iva105: fs.reduce((s,f)=>s+(f.importes?.iva_10_5||0),0),
    iva27: fs.reduce((s,f)=>s+(f.importes?.iva_27||0),0),
    ivaTotal: fs.reduce((s,f)=>s+(f.importes?.iva_21||0)+(f.importes?.iva_10_5||0)+(f.importes?.iva_27||0),0),
  });

  const totales = calcT(factFiltradas);
  const totalesG = calcT(facturas);

  const porEmpresa = EMPRESAS.map(e => {
    const fs = facturas.filter(f=>f.empresa_destino===e.nombre);
    return { ...e, ...calcT(fs), count: fs.length, shortName: e.nombre.split(" ")[0] };
  }).filter(e=>e.count>0);

  const factHistorial = mesFiltroHistorial ? (historial[mesFiltroHistorial]?.facturas||[]) : [];
  const totalesH = calcT(factHistorial);
  const porEmpresaH = EMPRESAS.map(e => {
    const fs = factHistorial.filter(f=>f.empresa_destino===e.nombre);
    return { ...e, ...calcT(fs), count: fs.length };
  }).filter(e=>e.count>0);

  // Tabs según rol
  const tabs = [
    ["cargar","📂 Cargar"],
    ["tabla","📋 Tabla"],
    ...(esDueno ? [["reportes","📊 Reportes"]] : []),
    ...(esDueno && mesesHistorial.length>0 ? [["historial","🗂 Historial"]] : []),
  ];

  return (
    <div style={{fontFamily:"'Segoe UI',system-ui,sans-serif",minHeight:"100vh",background:"#f1f5f9",color:"#1e293b"}}>

      {/* Header */}
      <div style={{background:"#0f172a",padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"3px solid #f59e0b",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:12,padding:"13px 0"}}>
          <div>
            <div style={{fontSize:10,letterSpacing:3,color:"#f59e0b",textTransform:"uppercase"}}>Grupo Damp</div>
            <div style={{fontSize:18,fontWeight:900,color:"#fff"}}>📄 Gestión de Facturas</div>
          </div>
          <div style={{background:"#f59e0b22",border:"1px solid #f59e0b55",borderRadius:20,padding:"4px 12px",fontSize:12,color:"#f59e0b",fontWeight:700}}>
            {mesKeyToLabel(mesActivo)}
          </div>
          {facturas.length>0 && (
            <div style={{background:"#10b98122",border:"1px solid #10b98155",borderRadius:20,padding:"4px 12px",fontSize:12,color:"#10b981",fontWeight:700}}>
              {facturas.length} fact.
            </div>
          )}
        </div>
        <div style={{display:"flex",gap:8,padding:"12px 0",alignItems:"center"}}>
          {/* Badge rol */}
          <div style={{background:esDueno?"#a855f722":"#06b6d422",border:`1px solid ${esDueno?"#a855f755":"#06b6d455"}`,borderRadius:20,padding:"4px 12px",fontSize:12,color:esDueno?"#a855f7":"#06b6d4",fontWeight:700}}>
            {esDueno?"👔 Dueño":"👩‍💼 Oficina"} · {sesion.nombre}
          </div>
          {esDueno && facturas.length>0 && (
            <>
              <button onClick={()=>exportToCSV(facturas,mesKeyToLabel(mesActivo))} style={{background:"#f59e0b",color:"#0f172a",border:"none",padding:"8px 14px",borderRadius:8,fontWeight:800,fontSize:12,cursor:"pointer"}}>⬇ CSV</button>
              <button onClick={()=>setShowCerrarMes(true)} style={{background:"#dc262622",color:"#fca5a5",border:"1px solid #dc262644",padding:"8px 12px",borderRadius:8,fontWeight:700,fontSize:12,cursor:"pointer"}}>🗂 Cerrar mes</button>
            </>
          )}
          <button onClick={()=>{setSesion(null);setTab("cargar");}} style={{background:"rgba(255,255,255,0.06)",color:"#94a3b8",border:"1px solid rgba(255,255,255,0.1)",padding:"8px 12px",borderRadius:8,fontSize:12,cursor:"pointer"}}>
            Salir
          </button>
        </div>
      </div>

      {/* Nav */}
      <div style={{background:"#1e293b",padding:"0 24px",display:"flex",gap:2,overflowX:"auto"}}>
        {tabs.map(([id,label]) => (
          <button key={id} onClick={()=>setTab(id)} style={{padding:"11px 16px",border:"none",borderBottom:tab===id?"3px solid #f59e0b":"3px solid transparent",background:"transparent",color:tab===id?"#f59e0b":"#94a3b8",fontWeight:tab===id?800:500,fontSize:13,cursor:"pointer",whiteSpace:"nowrap"}}>
            {label}
          </button>
        ))}
      </div>

      <div style={{padding:"22px 24px",maxWidth:1150,margin:"0 auto"}}>

        {/* ── CARGAR ── */}
        {tab==="cargar" && (
          <>
            <div onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={handleDrop} onClick={()=>inputRef.current.click()}
              style={{border:`2px dashed ${dragging?"#f59e0b":"#cbd5e1"}`,borderRadius:16,padding:"44px 24px",textAlign:"center",cursor:"pointer",background:dragging?"#fffbeb":"#fff",transition:"all 0.2s",marginBottom:20,boxShadow:"0 2px 10px rgba(0,0,0,0.05)"}}>
              <input ref={inputRef} type="file" accept=".pdf,image/*" multiple style={{display:"none"}} onChange={e=>processFiles(e.target.files)} />
              <div style={{fontSize:44,marginBottom:10}}>🧾</div>
              <div style={{fontWeight:800,fontSize:18,color:"#1e293b",marginBottom:6}}>
                {hasLoading ? "⏳ Procesando con Claude…" : "Arrastrá las facturas acá"}
              </div>
              <div style={{fontSize:14,color:"#64748b"}}>PDF digitales, PDF escaneados, JPG, PNG — podés subir varias a la vez</div>
            </div>

            {queue.length>0 && (
              <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:20}}>
                {queue.map(q=>(
                  <div key={q.id} style={{background:"#fff",border:"1px solid #e2e8f0",borderRadius:10,padding:"6px 12px",display:"flex",alignItems:"center",gap:8,fontSize:12,boxShadow:"0 1px 3px rgba(0,0,0,0.05)"}}>
                    <span style={{color:"#64748b",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{q.file.name}</span>
                    <StatusPill status={q.status} error={q.error} />
                  </div>
                ))}
              </div>
            )}

            {facturas.length===0 && queue.length===0 ? (
              <div style={{background:"#fff",borderRadius:16,padding:22,boxShadow:"0 2px 8px rgba(0,0,0,0.05)"}}>
                <div style={{fontSize:12,fontWeight:700,color:"#64748b",marginBottom:12,textTransform:"uppercase",letterSpacing:1}}>Empresas del grupo</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                  {EMPRESAS.map(e=>(
                    <span key={e.nombre} style={{background:e.color+"20",color:e.color,border:`1px solid ${e.color}40`,padding:"6px 14px",borderRadius:20,fontSize:13,fontWeight:700}}>{e.nombre}</span>
                  ))}
                </div>
              </div>
            ) : facturas.length>0 && (
              <div style={{background:"#fff",borderRadius:16,padding:20,boxShadow:"0 2px 8px rgba(0,0,0,0.05)"}}>
                <div style={{fontSize:12,fontWeight:700,color:"#64748b",marginBottom:12,textTransform:"uppercase",letterSpacing:1}}>Últimas cargadas</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {[...facturas].reverse().slice(0,6).map(f=>(
                    <div key={f._id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:"#f8fafc",borderRadius:10,gap:12}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0,flex:1}}>
                        <EmpresaBadge nombre={f.empresa_destino} />
                        <span style={{fontSize:13,color:"#475569",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.proveedor?.razon_social||f._fileName}</span>
                        {f.fecha_emision && <span style={{fontSize:11,color:"#94a3b8",whiteSpace:"nowrap"}}>{f.fecha_emision}</span>}
                        {f._cargadaPor && <span style={{fontSize:10,color:"#cbd5e1",whiteSpace:"nowrap"}}>· {f._cargadaPor}</span>}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
                        <span style={{fontSize:14,fontWeight:800,color:"#065f46"}}>{fmt(f.importes?.total)}</span>
                        {esDueno && <button onClick={()=>eliminarFactura(f._id)} style={{background:"none",border:"none",color:"#cbd5e1",cursor:"pointer",fontSize:18,lineHeight:1,padding:"2px 4px"}}>×</button>}
                      </div>
                    </div>
                  ))}
                  {facturas.length>6 && <div style={{fontSize:12,color:"#94a3b8",textAlign:"center",paddingTop:4}}>+ {facturas.length-6} más — ver en Tabla</div>}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── TABLA ── */}
        {tab==="tabla" && (
          <>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
              <button onClick={()=>setFiltroEmpresa("TODAS")} style={{padding:"7px 16px",borderRadius:20,border:"1px solid",borderColor:filtroEmpresa==="TODAS"?"#0f172a":"#e2e8f0",background:filtroEmpresa==="TODAS"?"#0f172a":"#fff",color:filtroEmpresa==="TODAS"?"#f59e0b":"#64748b",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                Todas ({facturas.length})
              </button>
              {EMPRESAS.map(e=>{
                const count=facturas.filter(f=>f.empresa_destino===e.nombre).length;
                if(!count) return null;
                const active=filtroEmpresa===e.nombre;
                return (
                  <button key={e.nombre} onClick={()=>setFiltroEmpresa(e.nombre)} style={{padding:"7px 14px",borderRadius:20,border:`1px solid ${active?e.color:"#e2e8f0"}`,background:active?e.color:"#fff",color:active?"#fff":"#374151",fontWeight:700,fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                    <span style={{width:7,height:7,borderRadius:"50%",background:active?"#fff":e.color,display:"inline-block"}} />
                    {e.nombre.split(" ")[0]} ({count})
                  </button>
                );
              })}
              {sinIdentificar>0 && (
                <button onClick={()=>setFiltroEmpresa("Sin identificar")} style={{padding:"7px 14px",borderRadius:20,border:"1px solid #fca5a5",background:filtroEmpresa==="Sin identificar"?"#dc2626":"#fff",color:filtroEmpresa==="Sin identificar"?"#fff":"#dc2626",fontWeight:700,fontSize:12,cursor:"pointer"}}>
                  ⚠️ Sin identificar ({sinIdentificar})
                </button>
              )}
            </div>

            <div style={{overflowX:"auto",background:"#fff",borderRadius:16,boxShadow:"0 2px 10px rgba(0,0,0,0.06)",border:"1px solid #e2e8f0"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                <thead>
                  <tr style={{background:"#0f172a"}}>
                    {["Empresa","N° Factura","Tipo","Fecha","Proveedor","CUIT","Neto","IVA","Total",...(esDueno?[""]:[])] .map(h=>(
                      <th key={h} style={{padding:"12px 14px",textAlign:"left",color:"#f59e0b",fontWeight:700,fontSize:11,textTransform:"uppercase",letterSpacing:0.5,whiteSpace:"nowrap"}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {factFiltradas.length===0 ? (
                    <tr><td colSpan={esDueno?10:9} style={{padding:32,textAlign:"center",color:"#94a3b8"}}>No hay facturas para este filtro</td></tr>
                  ) : factFiltradas.map((f,i)=>{
                    const ivaTotal=(f.importes?.iva_21||0)+(f.importes?.iva_10_5||0)+(f.importes?.iva_27||0);
                    return (
                      <tr key={f._id} style={{borderTop:"1px solid #f1f5f9",background:i%2===0?"#fff":"#f8fafc"}}>
                        <td style={{padding:"10px 14px"}}><EmpresaBadge nombre={f.empresa_destino} /></td>
                        <td style={{padding:"10px 14px",fontWeight:700}}>{f.numero_factura||"-"}</td>
                        <td style={{padding:"10px 14px"}}>{f.tipo_factura?<span style={{background:"#fef3c7",color:"#92400e",padding:"2px 8px",borderRadius:6,fontWeight:800,fontSize:11}}>{f.tipo_factura}</span>:"-"}</td>
                        <td style={{padding:"10px 14px",whiteSpace:"nowrap",color:"#475569"}}>{f.fecha_emision||"-"}</td>
                        <td style={{padding:"10px 14px",maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:600}}>{f.proveedor?.razon_social||"-"}</td>
                        <td style={{padding:"10px 14px",fontFamily:"monospace",fontSize:11,color:"#64748b",whiteSpace:"nowrap"}}>{f.proveedor?.cuit||"-"}</td>
                        <td style={{padding:"10px 14px",color:"#1e40af",fontWeight:600,whiteSpace:"nowrap"}}>{fmt(f.importes?.neto_gravado)}</td>
                        <td style={{padding:"10px 14px",color:"#92400e",fontWeight:600,whiteSpace:"nowrap"}}>{fmt(ivaTotal||null)}</td>
                        <td style={{padding:"10px 14px",color:"#065f46",fontWeight:800,whiteSpace:"nowrap"}}>{fmt(f.importes?.total)}</td>
                        {esDueno && <td style={{padding:"10px 14px"}}><button onClick={()=>eliminarFactura(f._id)} style={{background:"none",border:"none",color:"#cbd5e1",cursor:"pointer",fontSize:18}}>×</button></td>}
                      </tr>
                    );
                  })}
                </tbody>
                {factFiltradas.length>0 && (
                  <tfoot>
                    <tr style={{background:"#0f172a",borderTop:"2px solid #f59e0b"}}>
                      <td colSpan={6} style={{padding:"11px 14px",color:"#f59e0b",fontWeight:800,fontSize:11,textTransform:"uppercase"}}>
                        {filtroEmpresa==="TODAS"?`Total mes — ${factFiltradas.length} facturas`:`${filtroEmpresa} — ${factFiltradas.length} facturas`}
                      </td>
                      <td style={{padding:"11px 14px",color:"#93c5fd",fontWeight:800,whiteSpace:"nowrap"}}>{fmt(totales.neto)}</td>
                      <td style={{padding:"11px 14px",color:"#fcd34d",fontWeight:800,whiteSpace:"nowrap"}}>{fmt(totales.ivaTotal)}</td>
                      <td style={{padding:"11px 14px",color:"#6ee7b7",fontWeight:800,whiteSpace:"nowrap"}}>{fmt(totales.total)}</td>
                      {esDueno && <td/>}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}

        {/* ── REPORTES (solo dueños) ── */}
        {tab==="reportes" && esDueno && (
          facturas.length===0 ? (
            <div style={{textAlign:"center",padding:"60px 0",color:"#94a3b8"}}>
              <div style={{fontSize:48,marginBottom:12}}>📊</div>
              <div style={{fontSize:15,fontWeight:600}}>No hay facturas cargadas este mes</div>
            </div>
          ) : (
            <>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:12,marginBottom:22}}>
                {[
                  {label:"Total del mes",value:fmt(totalesG.total),color:"#065f46",icon:"💰"},
                  {label:"Neto gravado",value:fmt(totalesG.neto),color:"#1e40af",icon:"📊"},
                  {label:"IVA crédito fiscal",value:fmt(totalesG.ivaTotal),color:"#92400e",icon:"🏛️"},
                  {label:"Facturas",value:facturas.length,color:"#0f172a",icon:"🧾"},
                  ...(sinIdentificar>0?[{label:"Sin identificar",value:sinIdentificar,color:"#dc2626",icon:"⚠️"}]:[]),
                ].map(k=>(
                  <div key={k.label} style={{background:"#fff",borderRadius:12,padding:"16px 18px",boxShadow:"0 2px 8px rgba(0,0,0,0.05)",borderLeft:`4px solid ${k.color}`}}>
                    <div style={{fontSize:20,marginBottom:4}}>{k.icon}</div>
                    <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{k.label}</div>
                    <div style={{fontSize:18,fontWeight:900,color:k.color}}>{k.value}</div>
                  </div>
                ))}
              </div>

              <div style={{background:"#fff",borderRadius:16,padding:22,boxShadow:"0 2px 10px rgba(0,0,0,0.06)",marginBottom:20,border:"1px solid #e2e8f0"}}>
                <div style={{fontWeight:800,fontSize:15,color:"#0f172a",marginBottom:16}}>🏢 Resumen por empresa — {mesKeyToLabel(mesActivo)}</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                    <thead>
                      <tr style={{borderBottom:"2px solid #f1f5f9"}}>
                        {["Empresa","Fact.","Neto Gravado","IVA 21%","IVA 10.5%","IVA 27%","IVA Total","Total"].map(h=>(
                          <th key={h} style={{padding:"8px 12px",textAlign:"left",color:"#64748b",fontWeight:700,fontSize:11,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {porEmpresa.map((e,i)=>(
                        <tr key={e.nombre} style={{borderTop:"1px solid #f1f5f9",background:i%2===0?"#fff":"#f8fafc"}}>
                          <td style={{padding:"10px 12px"}}><EmpresaBadge nombre={e.nombre} /></td>
                          <td style={{padding:"10px 12px",fontWeight:700,color:"#475569"}}>{e.count}</td>
                          <td style={{padding:"10px 12px",color:"#1e40af",fontWeight:600}}>{fmt(e.neto)}</td>
                          <td style={{padding:"10px 12px",color:"#92400e"}}>{fmt(e.iva21)}</td>
                          <td style={{padding:"10px 12px",color:"#92400e"}}>{fmt(e.iva105)}</td>
                          <td style={{padding:"10px 12px",color:"#92400e"}}>{fmt(e.iva27)}</td>
                          <td style={{padding:"10px 12px",color:"#92400e",fontWeight:700}}>{fmt(e.ivaTotal)}</td>
                          <td style={{padding:"10px 12px",color:"#065f46",fontWeight:800}}>{fmt(e.total)}</td>
                        </tr>
                      ))}
                      {sinIdentificar>0 && (
                        <tr style={{borderTop:"1px solid #fee2e2",background:"#fff5f5"}}>
                          <td style={{padding:"10px 12px",color:"#dc2626",fontWeight:700}}>⚠️ Sin identificar</td>
                          <td style={{padding:"10px 12px",color:"#dc2626"}}>{sinIdentificar}</td>
                          <td colSpan={6} style={{padding:"10px 12px",color:"#dc2626",fontSize:12}}>Revisá estas facturas manualmente</td>
                        </tr>
                      )}
                      <tr style={{borderTop:"2px solid #0f172a",background:"#0f172a"}}>
                        <td style={{padding:"10px 12px",color:"#f59e0b",fontWeight:800,fontSize:11,textTransform:"uppercase"}}>TOTAL</td>
                        <td style={{padding:"10px 12px",color:"#f59e0b",fontWeight:800}}>{facturas.length}</td>
                        <td style={{padding:"10px 12px",color:"#93c5fd",fontWeight:800}}>{fmt(totalesG.neto)}</td>
                        <td style={{padding:"10px 12px",color:"#fcd34d",fontWeight:800}}>{fmt(totalesG.iva21)}</td>
                        <td style={{padding:"10px 12px",color:"#fcd34d",fontWeight:800}}>{fmt(totalesG.iva105)}</td>
                        <td style={{padding:"10px 12px",color:"#fcd34d",fontWeight:800}}>{fmt(totalesG.iva27)}</td>
                        <td style={{padding:"10px 12px",color:"#fcd34d",fontWeight:800}}>{fmt(totalesG.ivaTotal)}</td>
                        <td style={{padding:"10px 12px",color:"#6ee7b7",fontWeight:800}}>{fmt(totalesG.total)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
                <div style={{background:"#fff",borderRadius:16,padding:22,boxShadow:"0 2px 10px rgba(0,0,0,0.06)",border:"1px solid #e2e8f0",gridColumn:"1/-1"}}>
                  <div style={{fontWeight:800,fontSize:15,color:"#0f172a",marginBottom:16}}>💰 Total por empresa</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={porEmpresa} margin={{top:0,right:10,left:10,bottom:0}}>
                      <XAxis dataKey="shortName" tick={{fontSize:12,fill:"#64748b"}} />
                      <YAxis tick={{fontSize:11,fill:"#64748b"}} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v,_,p)=>[fmt(v),p.payload.nombre]} />
                      <Bar dataKey="total" radius={[6,6,0,0]}>
                        {porEmpresa.map((e,i)=><Cell key={i} fill={e.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div style={{background:"#fff",borderRadius:16,padding:22,boxShadow:"0 2px 10px rgba(0,0,0,0.06)",border:"1px solid #e2e8f0"}}>
                  <div style={{fontWeight:800,fontSize:15,color:"#0f172a",marginBottom:16}}>🏛️ IVA crédito fiscal</div>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {[...porEmpresa].sort((a,b)=>b.ivaTotal-a.ivaTotal).map(e=>(
                      <div key={e.nombre}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                          <span style={{fontSize:12,color:"#374151",fontWeight:600}}>{e.nombre.split(" ")[0]}</span>
                          <span style={{fontSize:12,fontWeight:800,color:e.color}}>{fmt(e.ivaTotal)}</span>
                        </div>
                        <div style={{height:8,background:"#f1f5f9",borderRadius:4,overflow:"hidden"}}>
                          <div style={{height:"100%",borderRadius:4,background:e.color,width:totalesG.ivaTotal>0?`${(e.ivaTotal/totalesG.ivaTotal*100).toFixed(1)}%`:"0%",transition:"width 0.5s"}} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{background:"#fff",borderRadius:16,padding:22,boxShadow:"0 2px 10px rgba(0,0,0,0.06)",border:"1px solid #e2e8f0"}}>
                  <div style={{fontWeight:800,fontSize:15,color:"#0f172a",marginBottom:16}}>📊 Participación</div>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={porEmpresa} dataKey="total" nameKey="nombre" cx="50%" cy="50%" outerRadius={80} label={({name,percent})=>`${name.split(" ")[0]} ${(percent*100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                        {porEmpresa.map((e,i)=><Cell key={i} fill={e.color} />)}
                      </Pie>
                      <Tooltip formatter={v=>fmt(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )
        )}

        {/* ── HISTORIAL (solo dueños) ── */}
        {tab==="historial" && esDueno && (
          <>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:20}}>
              {mesesHistorial.map(key=>(
                <button key={key} onClick={()=>setMesFiltroHistorial(mesFiltroHistorial===key?null:key)} style={{padding:"8px 18px",borderRadius:20,border:`1px solid ${mesFiltroHistorial===key?"#0f172a":"#e2e8f0"}`,background:mesFiltroHistorial===key?"#0f172a":"#fff",color:mesFiltroHistorial===key?"#f59e0b":"#374151",fontWeight:700,fontSize:13,cursor:"pointer"}}>
                  🗂 {historial[key].label} ({historial[key].facturas.length} fact.)
                </button>
              ))}
            </div>

            {mesFiltroHistorial && (
              <>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:12,marginBottom:20}}>
                  {[
                    {label:"Total",value:fmt(totalesH.total),color:"#065f46",icon:"💰"},
                    {label:"Neto",value:fmt(totalesH.neto),color:"#1e40af",icon:"📊"},
                    {label:"IVA total",value:fmt(totalesH.ivaTotal),color:"#92400e",icon:"🏛️"},
                    {label:"Facturas",value:factHistorial.length,color:"#0f172a",icon:"🧾"},
                  ].map(k=>(
                    <div key={k.label} style={{background:"#fff",borderRadius:12,padding:"16px 18px",boxShadow:"0 2px 8px rgba(0,0,0,0.05)",borderLeft:`4px solid ${k.color}`}}>
                      <div style={{fontSize:20,marginBottom:4}}>{k.icon}</div>
                      <div style={{fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:1,marginBottom:3}}>{k.label}</div>
                      <div style={{fontSize:18,fontWeight:900,color:k.color}}>{k.value}</div>
                    </div>
                  ))}
                </div>

                <div style={{background:"#fff",borderRadius:16,padding:22,boxShadow:"0 2px 10px rgba(0,0,0,0.06)",border:"1px solid #e2e8f0"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                    <div style={{fontWeight:800,fontSize:15}}>{historial[mesFiltroHistorial].label} — por empresa</div>
                    <button onClick={()=>exportToCSV(factHistorial,historial[mesFiltroHistorial].label)} style={{background:"#f59e0b",color:"#0f172a",border:"none",padding:"7px 14px",borderRadius:8,fontWeight:800,fontSize:12,cursor:"pointer"}}>⬇ CSV</button>
                  </div>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                      <thead>
                        <tr style={{borderBottom:"2px solid #f1f5f9"}}>
                          {["Empresa","Fact.","Neto","IVA 21%","IVA 10.5%","IVA 27%","IVA Total","Total"].map(h=>(
                            <th key={h} style={{padding:"8px 12px",textAlign:"left",color:"#64748b",fontWeight:700,fontSize:11,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {porEmpresaH.map((e,i)=>(
                          <tr key={e.nombre} style={{borderTop:"1px solid #f1f5f9",background:i%2===0?"#fff":"#f8fafc"}}>
                            <td style={{padding:"10px 12px"}}><EmpresaBadge nombre={e.nombre} /></td>
                            <td style={{padding:"10px 12px",fontWeight:700}}>{e.count}</td>
                            <td style={{padding:"10px 12px",color:"#1e40af",fontWeight:600}}>{fmt(e.neto)}</td>
                            <td style={{padding:"10px 12px",color:"#92400e"}}>{fmt(e.iva21)}</td>
                            <td style={{padding:"10px 12px",color:"#92400e"}}>{fmt(e.iva105)}</td>
                            <td style={{padding:"10px 12px",color:"#92400e"}}>{fmt(e.iva27)}</td>
                            <td style={{padding:"10px 12px",color:"#92400e",fontWeight:700}}>{fmt(e.ivaTotal)}</td>
                            <td style={{padding:"10px 12px",color:"#065f46",fontWeight:800}}>{fmt(e.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
            {!mesFiltroHistorial && <div style={{textAlign:"center",padding:"40px 0",color:"#94a3b8"}}><div style={{fontSize:36,marginBottom:10}}>👆</div><div style={{fontSize:14}}>Seleccioná un mes para ver el detalle</div></div>}
          </>
        )}
      </div>

      {/* Modal cerrar mes */}
      {showCerrarMes && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:24}}>
          <div style={{background:"#fff",borderRadius:20,padding:"36px 32px",maxWidth:420,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,0.2)"}}>
            <div style={{fontSize:36,textAlign:"center",marginBottom:12}}>🗂</div>
            <h3 style={{textAlign:"center",margin:"0 0 12px",fontSize:20,fontWeight:900,color:"#0f172a"}}>Cerrar {mesKeyToLabel(mesActivo)}</h3>
            <p style={{textAlign:"center",color:"#64748b",fontSize:14,lineHeight:1.6,marginBottom:24}}>
              Las <strong>{facturas.length} facturas</strong> se guardan en el historial y empezás el mes nuevo en cero.
            </p>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setShowCerrarMes(false)} style={{flex:1,padding:"12px",background:"#f1f5f9",color:"#64748b",border:"none",borderRadius:10,fontWeight:700,fontSize:14,cursor:"pointer"}}>Cancelar</button>
              <button onClick={cerrarMes} style={{flex:1,padding:"12px",background:"#dc2626",color:"#fff",border:"none",borderRadius:10,fontWeight:800,fontSize:14,cursor:"pointer"}}>Sí, cerrar mes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
