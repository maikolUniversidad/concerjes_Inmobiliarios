import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, X, Loader2, ArrowDownToLine, ArrowUpFromLine, RefreshCw, Settings2, CloudUpload } from 'lucide-react'
import { encolar, type OutboxItem } from '@conserjes/offline'
import { db, store } from '../lib/db'
import { EVENTO_SYNC } from '../components/Layout'
import { usePermisos } from '../components/Permisos'

interface Prod { id: string; nombre_estandar: string; presentacion: string | null; activo?: boolean }
interface St { id: string; producto_id: string; cantidad_real: number; cantidad_disp: number }
interface Mov { id: string; tipo: string; producto_id: string; cantidad: number; observacion: string | null; created_at: string }

const TIPOS = [
  { v: 'ENTRADA', l: 'Entrada', icon: ArrowDownToLine, c: 'text-green-600' },
  { v: 'SALIDA', l: 'Salida', icon: ArrowUpFromLine, c: 'text-orange-600' },
  { v: 'DEVOLUCION', l: 'Devolución', icon: RefreshCw, c: 'text-blue-600' },
  { v: 'AJUSTE', l: 'Ajuste', icon: Settings2, c: 'text-purple-600' },
]

function nuevoStock(s: St | undefined, tipo: string, cant: number) {
  const real = Number(s?.cantidad_real ?? 0), disp = Number(s?.cantidad_disp ?? 0)
  if (tipo === 'AJUSTE') return { cantidad_real: cant, cantidad_disp: cant }
  if (tipo === 'ENTRADA' || tipo === 'DEVOLUCION') return { cantidad_real: real + cant, cantidad_disp: disp + cant }
  if (tipo === 'SALIDA') return { cantidad_real: Math.max(0, real - cant), cantidad_disp: Math.max(0, disp - cant) }
  return { cantidad_real: real, cantidad_disp: disp }
}

export function Movimientos() {
  const { tiene } = usePermisos()
  const puedeCrear = tiene('crear_movimientos')
  const [prods, setProds] = useState<Prod[]>([])
  const [movs, setMovs] = useState<Mov[]>([])
  const [pendientes, setPendientes] = useState<OutboxItem[]>([])
  const [abrir, setAbrir] = useState(false)

  const cargar = useCallback(async () => {
    const [p, m, ob] = await Promise.all([
      db.table('productos').toArray() as Promise<Prod[]>,
      db.table('movimientos').orderBy('created_at').reverse().limit(60).toArray() as Promise<Mov[]>,
      store.getOutbox(),
    ])
    setProds(p.filter(x => x.activo !== false).sort((a, b) => a.nombre_estandar.localeCompare(b.nombre_estandar)))
    setMovs(m)
    setPendientes(ob.filter(o => o.kind === 'movimiento'))
  }, [])

  useEffect(() => { cargar(); const h = () => cargar(); window.addEventListener(EVENTO_SYNC, h); return () => window.removeEventListener(EVENTO_SYNC, h) }, [cargar])

  const nombre = useMemo(() => new Map(prods.map(p => [p.id, p.nombre_estandar])), [prods])

  return (
    <div className="p-4 space-y-3">
      {puedeCrear && (
        <button onClick={() => setAbrir(true)}
          className="w-full flex items-center justify-center gap-2 bg-brand-green text-white font-semibold text-sm px-4 py-3 rounded-xl hover:bg-brand-green-dark">
          <Plus className="w-4 h-4" /> Registrar movimiento
        </button>
      )}

      {pendientes.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3">
          <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5 mb-1.5"><CloudUpload className="w-3.5 h-3.5" /> {pendientes.length} pendiente(s) de subir</p>
          {pendientes.slice(0, 5).map(o => (
            <p key={o.id} className="text-xs text-amber-800">{String(o.payload.p_tipo)} · {nombre.get(String(o.payload.p_producto)) ?? 'producto'} · {String(o.payload.p_cantidad)}</p>
          ))}
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden divide-y divide-gray-50">
        {movs.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">Sin movimientos sincronizados.</p>
        ) : movs.map(m => {
          const meta = TIPOS.find(t => t.v === m.tipo)
          const Icon = meta?.icon ?? Settings2
          return (
            <div key={m.id} className="px-3 py-2.5 flex items-center gap-2">
              <Icon className={`w-4 h-4 shrink-0 ${meta?.c ?? 'text-gray-500'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 truncate">{nombre.get(m.producto_id) ?? '—'}</p>
                <p className="text-[11px] text-gray-400">{new Date(m.created_at).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}{m.observacion ? ` · ${m.observacion}` : ''}</p>
              </div>
              <span className="font-bold text-sm text-gray-900">{Number(m.cantidad)}</span>
            </div>
          )
        })}
      </div>

      {abrir && <FormMovimiento prods={prods} onClose={() => setAbrir(false)} onSaved={() => { setAbrir(false); cargar() }} />}
    </div>
  )
}

function FormMovimiento({ prods, onClose, onSaved }: { prods: Prod[]; onClose: () => void; onSaved: () => void }) {
  const [busca, setBusca] = useState('')
  const [prodId, setProdId] = useState('')
  const [tipo, setTipo] = useState('ENTRADA')
  const [cant, setCant] = useState('')
  const [obs, setObs] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const cands = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return []
    return prods.filter(p => p.nombre_estandar.toLowerCase().includes(t)).slice(0, 6)
  }, [busca, prods])
  const sel = prods.find(p => p.id === prodId)

  async function guardar() {
    const c = Number(cant)
    if (!prodId) { setError('Selecciona un producto.'); return }
    if (!Number.isFinite(c) || c <= 0) { setError('Cantidad inválida.'); return }
    setSaving(true); setError('')
    try {
      // Optimista: actualiza el stock local (si existe la fila). producto_id no
      // es índice en Dexie → filtramos en memoria.
      const s = ((await db.table('stock').toArray()) as St[]).find(x => x.producto_id === prodId)
      if (s) await store.bulkPut('stock', [{ ...s, ...nuevoStock(s, tipo, c) }])
      // Encola el intent RPC (se ejecuta en el servidor con auth.uid() al sincronizar)
      await encolar(store, 'movimiento', {
        p_producto: prodId, p_tipo: tipo, p_cantidad: c,
        p_sede: null, p_observacion: obs.trim() || null, p_ubicacion: null,
      })
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={onClose}>
      <div className="w-full bg-white rounded-t-3xl p-5 space-y-3 max-h-[90%] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900">Registrar movimiento</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="grid grid-cols-4 gap-1.5">
          {TIPOS.map(t => (
            <button key={t.v} onClick={() => setTipo(t.v)}
              className={`text-xs font-semibold py-2 rounded-lg border ${tipo === t.v ? 'border-brand-green bg-green-50 text-brand-green' : 'border-gray-200 text-gray-600'}`}>{t.l}</button>
          ))}
        </div>

        {sel ? (
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2">
            <span className="text-sm text-gray-800 truncate">{sel.nombre_estandar}</span>
            <button onClick={() => { setProdId(''); setBusca('') }} className="text-xs text-brand-green">Cambiar</button>
          </div>
        ) : (
          <div>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar producto…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-green" />
            {cands.length > 0 && (
              <div className="border border-gray-100 rounded-xl mt-1 divide-y divide-gray-50">
                {cands.map(p => <button key={p.id} onClick={() => { setProdId(p.id); setBusca('') }} className="w-full text-left px-3 py-2 text-sm hover:bg-green-50/50 truncate">{p.nombre_estandar}</button>)}
              </div>
            )}
          </div>
        )}

        <input type="number" inputMode="decimal" value={cant} onChange={e => setCant(e.target.value)}
          placeholder={tipo === 'AJUSTE' ? 'Nueva cantidad real' : 'Cantidad'}
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-green" />
        <input value={obs} onChange={e => setObs(e.target.value)} placeholder="Observación (opcional)"
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-green" />

        <button onClick={guardar} disabled={saving}
          className="w-full flex items-center justify-center gap-2 bg-brand-green text-white font-semibold text-sm px-4 py-3 rounded-xl disabled:opacity-60">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Guardar {typeof navigator !== 'undefined' && !navigator.onLine ? '(offline, se sube luego)' : ''}
        </button>
      </div>
    </div>
  )
}
