'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Save, Loader2, Plus, Pencil, X, SlidersHorizontal, Gift, Ticket,
  Eye, EyeOff, CheckCircle2, Ban, Search, Sparkles,
} from 'lucide-react'
import {
  guardarParametrosPuntos, upsertRecompensa, archivarRecompensa,
  marcarRedencion, anularRedencion, ajustarPuntos, buscarClientes,
} from '../puntos-actions'

const TIPOS_RECOMPENSA = [
  { value: 'DESCUENTO_FIJO',  label: 'Descuento en pesos',  ayuda: 'El valor es el monto del descuento.' },
  { value: 'DESCUENTO_PCT',   label: 'Descuento en %',      ayuda: 'El valor es el porcentaje.' },
  { value: 'SERVICIO_GRATIS', label: 'Servicio gratis',     ayuda: 'El valor son las horas del servicio.' },
  { value: 'BENEFICIO',       label: 'Otro beneficio',      ayuda: 'Lo entrega el personal a mano.' },
]

const PLANES = [
  { value: '',      label: 'Todos los clientes' },
  { value: 'PRIME', label: 'Solo Plan Prime' },
  { value: 'PRO',   label: 'Solo Plan Pro' },
]

const ESTADOS: Record<string, { label: string; cls: string }> = {
  SOLICITADA: { label: 'Por entregar', cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  APROBADA:   { label: 'Aprobada',     cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  ENTREGADA:  { label: 'Entregada',    cls: 'bg-green-50 text-green-700 border-green-200' },
  RECHAZADA:  { label: 'Rechazada',    cls: 'bg-red-50 text-red-700 border-red-200' },
  ANULADA:    { label: 'Anulada',      cls: 'bg-gray-50 text-gray-500 border-gray-200' },
}

const RECOMPENSA_VACIA = {
  codigo: '', nombre: '', descripcion: '', tipo: 'DESCUENTO_FIJO',
  costo_puntos: 500, valor: 10000, icono: '🎁', stock: '', vence_dias: 90,
  plan_minimo: '', destacada: false, activo: true, orden: 0,
}

export default function PuntosClient({ parametros, recompensas, redenciones }: {
  parametros: any; recompensas: any[]; redenciones: any[]
}) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [tab, setTab] = useState<'reglas' | 'recompensas' | 'redenciones' | 'ajustes'>('reglas')
  const refrescar = () => startTransition(() => router.refresh())

  const pestanas = [
    { id: 'reglas',      icon: SlidersHorizontal, label: 'Reglas del programa' },
    { id: 'recompensas', icon: Gift,              label: `Recompensas (${recompensas.length})` },
    { id: 'redenciones', icon: Ticket,            label: 'Canjes' },
    { id: 'ajustes',     icon: Sparkles,          label: 'Ajustar puntos' },
  ] as const

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1">
        {pestanas.map((p) => (
          <button key={p.id} onClick={() => setTab(p.id)}
            className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
              tab === p.id ? 'bg-white text-brand-green shadow-sm' : 'text-gray-500'
            }`}>
            <p.icon className="w-4 h-4" /> {p.label}
          </button>
        ))}
      </div>

      {tab === 'reglas'      && <Reglas parametros={parametros} onGuardado={refrescar} />}
      {tab === 'recompensas' && <Recompensas recompensas={recompensas} onCambio={refrescar} />}
      {tab === 'redenciones' && <Redenciones redenciones={redenciones} onCambio={refrescar} />}
      {tab === 'ajustes'     && <Ajustes onCambio={refrescar} />}
    </div>
  )
}

// ── Reglas ───────────────────────────────────────────────────────────────────

function Reglas({ parametros, onGuardado }: { parametros: any; onGuardado: () => void }) {
  const [f, setF] = useState<any>(parametros ?? {})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)

  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }))

  async function guardar() {
    setGuardando(true); setError(''); setOk(false)
    try {
      await guardarParametrosPuntos(f)
      setOk(true); onGuardado()
      setTimeout(() => setOk(false), 2500)
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  // Ejemplo en vivo: qué gana un cliente por un servicio de $115.000.
  const ejemplo = Math.floor(115000 / 1000 * (Number(f.puntos_por_mil) || 0)) + (Number(f.puntos_por_servicio) || 0)

  return (
    <div className="space-y-6">
      <Bloque titulo="Estado del programa">
        <Interruptor label="Programa activo" ayuda="Si lo apagas, deja de otorgar y de dejar redimir. Los saldos se conservan."
          valor={!!f.activo} onCambio={(v) => set('activo', v)} />
        <Campo label="Nombre del programa" valor={f.nombre_programa ?? ''} onCambio={(v) => set('nombre_programa', v)} />
        <Campo label="Título en el portal" valor={f.titulo_portal ?? ''} onCambio={(v) => set('titulo_portal', v)} />
      </Bloque>

      <Bloque titulo="Cuántos puntos se ganan">
        <Numero label="Puntos por cada $1.000 del servicio" valor={f.puntos_por_mil} onCambio={(v) => set('puntos_por_mil', v)} paso={0.1} />
        <Numero label="Puntos fijos por servicio completado" valor={f.puntos_por_servicio} onCambio={(v) => set('puntos_por_servicio', v)} />
        <Numero label="Puntos por calificar un servicio" valor={f.puntos_por_resena} onCambio={(v) => set('puntos_por_resena', v)} />
        <Numero label="Puntos por referido que compra" valor={f.puntos_por_referido} onCambio={(v) => set('puntos_por_referido', v)} />
        <Numero label="Puntos de bienvenida" valor={f.puntos_bienvenida} onCambio={(v) => set('puntos_bienvenida', v)} />
        <p className="rounded-lg bg-brand-green/5 px-4 py-3 text-sm text-gray-600 sm:col-span-2">
          Con estas reglas, un servicio de $115.000 da <strong>{ejemplo} puntos</strong>.
        </p>
      </Bloque>

      <Bloque titulo="Reglas de uso">
        <Numero label="Saldo mínimo para redimir" valor={f.minimo_redencion} onCambio={(v) => set('minimo_redencion', v)} />
        <Numero label="Equivalencia de 1 punto en pesos" valor={f.valor_punto} onCambio={(v) => set('valor_punto', v)}
          ayuda="Solo informativo: es lo que el cliente ve como «equivalen a ...»." />
        <Numero label="Vigencia de los puntos (meses)" valor={f.vigencia_meses ?? ''} onCambio={(v) => set('vigencia_meses', v)}
          ayuda="Vacío = los puntos no vencen." />
      </Bloque>

      <Bloque titulo="Textos que ve el cliente">
        <Texto label="Cómo ganar puntos" valor={f.texto_como_ganar ?? ''} onCambio={(v) => set('texto_como_ganar', v)} />
        <Texto label="Términos y condiciones" valor={f.terminos ?? ''} onCambio={(v) => set('terminos', v)} />
      </Bloque>

      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <button onClick={guardar} disabled={guardando}
        className="flex items-center gap-2 rounded-xl bg-brand-green px-6 py-3 font-semibold text-white hover:bg-brand-green-dark disabled:opacity-60">
        {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : ok ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
        {ok ? 'Guardado' : 'Guardar reglas'}
      </button>
    </div>
  )
}

// ── Recompensas ──────────────────────────────────────────────────────────────

function Recompensas({ recompensas, onCambio }: { recompensas: any[]; onCambio: () => void }) {
  const [form, setForm] = useState<any>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function guardar() {
    setGuardando(true); setError('')
    try {
      await upsertRecompensa(form)
      setForm(null); onCambio()
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  async function alternar(r: any) {
    try { await archivarRecompensa(r.id, !r.activo); onCambio() }
    catch (e: any) { setError(e?.message ?? 'No se pudo cambiar.') }
  }

  const tipoSel = TIPOS_RECOMPENSA.find((t) => t.value === form?.tipo)

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {!form && (
        <button onClick={() => setForm({ ...RECOMPENSA_VACIA, orden: recompensas.length + 1 })}
          className="flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-dark">
          <Plus className="w-4 h-4" /> Nueva recompensa
        </button>
      )}

      {form && (
        <div className="space-y-4 rounded-2xl border-2 border-brand-green/30 bg-white p-5">
          <div className="flex items-center justify-between">
            <p className="font-bold text-gray-900">{form.id ? 'Editar recompensa' : 'Nueva recompensa'}</p>
            <button onClick={() => setForm(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Código *" valor={form.codigo} onCambio={(v) => setForm({ ...form, codigo: v })} />
            <Campo label="Nombre *" valor={form.nombre} onCambio={(v) => setForm({ ...form, nombre: v })} />
          </div>
          <Texto label="Descripción" valor={form.descripcion ?? ''} onCambio={(v) => setForm({ ...form, descripcion: v })} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">Tipo</label>
              <select value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                {TIPOS_RECOMPENSA.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {tipoSel && <p className="mt-1 text-xs text-gray-400">{tipoSel.ayuda}</p>}
            </div>
            <Numero label="Valor" valor={form.valor} onCambio={(v) => setForm({ ...form, valor: v })} />
            <Numero label="Costo en puntos *" valor={form.costo_puntos} onCambio={(v) => setForm({ ...form, costo_puntos: v })} />
            <Numero label="Unidades disponibles" valor={form.stock ?? ''} onCambio={(v) => setForm({ ...form, stock: v })}
              ayuda="Vacío = sin límite." />
            <Numero label="Vigencia del cupón (días)" valor={form.vence_dias} onCambio={(v) => setForm({ ...form, vence_dias: v })} />
            <Campo label="Icono" valor={form.icono ?? ''} onCambio={(v) => setForm({ ...form, icono: v })} />
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-gray-700">Quién la puede canjear</label>
              <select value={form.plan_minimo ?? ''} onChange={(e) => setForm({ ...form, plan_minimo: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                {PLANES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <Numero label="Orden" valor={form.orden} onCambio={(v) => setForm({ ...form, orden: v })} />
          </div>

          <div className="flex flex-wrap gap-6">
            <Interruptor label="Destacada" valor={!!form.destacada} onCambio={(v) => setForm({ ...form, destacada: v })} />
            <Interruptor label="Visible en el portal" valor={!!form.activo} onCambio={(v) => setForm({ ...form, activo: v })} />
          </div>

          <button onClick={guardar} disabled={guardando}
            className="flex items-center gap-2 rounded-xl bg-brand-green px-6 py-2.5 font-semibold text-white hover:bg-brand-green-dark disabled:opacity-60">
            {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Recompensa</th>
              <th className="px-4 py-3">Costo</th>
              <th className="px-4 py-3">Disponibles</th>
              <th className="px-4 py-3">Canjeadas</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {recompensas.map((r) => (
              <tr key={r.id} className={r.activo ? '' : 'opacity-50'}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{r.icono}</span>
                    <div>
                      <p className="font-semibold text-gray-900">{r.nombre}</p>
                      <p className="text-xs text-gray-400">{r.codigo}{r.plan_minimo ? ` · solo ${r.plan_minimo}` : ''}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-semibold">{Number(r.costo_puntos).toLocaleString('es-CO')} pts</td>
                <td className="px-4 py-3">{r.stock === null ? 'Sin límite' : r.stock}</td>
                <td className="px-4 py-3">{r.entregadas}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setForm({ ...r, stock: r.stock ?? '', plan_minimo: r.plan_minimo ?? '' })}
                      title="Editar" className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-brand-green">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => alternar(r)} title={r.activo ? 'Ocultar del portal' : 'Mostrar en el portal'}
                      className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-brand-green">
                      {r.activo ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {recompensas.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Todavía no hay recompensas.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Canjes ───────────────────────────────────────────────────────────────────

function Redenciones({ redenciones, onCambio }: { redenciones: any[]; onCambio: () => void }) {
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)

  async function accion(id: string, fn: () => Promise<void>) {
    setOcupado(id); setError('')
    try { await fn(); onCambio() }
    catch (e: any) { setError(e?.message ?? 'No se pudo completar.') }
    finally { setOcupado(null) }
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Canje</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Recompensa</th>
              <th className="px-4 py-3">Puntos</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {redenciones.map((r) => {
              const est = ESTADOS[r.estado] ?? ESTADOS.SOLICITADA
              const cerrada = ['ENTREGADA', 'ANULADA', 'RECHAZADA'].includes(r.estado)
              return (
                <tr key={r.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-900">{r.numero}</p>
                    <p className="text-xs text-gray-400">{r.codigo}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-900">{r.clientes?.nombre ?? '—'}</p>
                    <p className="text-xs text-gray-400">{r.clientes?.email ?? r.clientes?.telefono ?? ''}</p>
                  </td>
                  <td className="px-4 py-3">{r.nombre_recompensa}</td>
                  <td className="px-4 py-3 font-semibold">{Number(r.costo_puntos).toLocaleString('es-CO')}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${est.cls}`}>{est.label}</span>
                  </td>
                  <td className="px-4 py-3">
                    {!cerrada && (
                      <div className="flex justify-end gap-1">
                        <button disabled={ocupado === r.id}
                          onClick={() => accion(r.id, () => marcarRedencion(r.id, 'ENTREGADA'))}
                          title="Marcar como entregada"
                          className="rounded-lg p-2 text-gray-400 hover:bg-green-50 hover:text-green-600 disabled:opacity-40">
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                        <button disabled={ocupado === r.id}
                          onClick={() => {
                            const motivo = prompt('¿Por qué se anula? Los puntos se le devuelven al cliente.')
                            if (motivo) accion(r.id, () => anularRedencion(r.id, motivo))
                          }}
                          title="Anular y devolver los puntos"
                          className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
                          <Ban className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            {redenciones.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Todavía no hay canjes.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Ajuste manual ────────────────────────────────────────────────────────────

function Ajustes({ onCambio }: { onCambio: () => void }) {
  const [texto, setTexto] = useState('')
  const [resultados, setResultados] = useState<any[]>([])
  const [sel, setSel] = useState<any>(null)
  const [puntos, setPuntos] = useState('')
  const [motivo, setMotivo] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  async function buscar() {
    setBuscando(true); setError('')
    try { setResultados(await buscarClientes(texto)) }
    catch (e: any) { setError(e?.message ?? 'No se pudo buscar.') }
    finally { setBuscando(false) }
  }

  async function aplicar() {
    setGuardando(true); setError(''); setOk('')
    try {
      await ajustarPuntos(sel.id, Number(puntos), motivo)
      setOk(`Ajuste aplicado a ${sel.nombre}.`)
      setPuntos(''); setMotivo(''); setSel(null); setResultados([])
      onCambio()
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo aplicar.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Un ajuste queda en el libro de movimientos del cliente con tu usuario y el
        motivo que escribas. Usa números negativos para descontar.
      </p>

      <div className="flex gap-2">
        <input value={texto} onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && buscar()}
          placeholder="Buscar cliente por nombre o correo"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        <button onClick={buscar} disabled={buscando || texto.trim().length < 2}
          className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {buscando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Buscar
        </button>
      </div>

      {resultados.map((c) => (
        <button key={c.id} onClick={() => setSel(c)}
          className={`flex w-full items-center justify-between rounded-lg border-2 px-4 py-3 text-left ${
            sel?.id === c.id ? 'border-brand-green bg-green-50' : 'border-gray-200 hover:border-green-200'
          }`}>
          <span>
            <span className="block font-semibold text-gray-900">{c.nombre}</span>
            <span className="block text-xs text-gray-400">{c.email}</span>
          </span>
          <span className="font-semibold text-brand-green">{Number(c.puntos ?? 0).toLocaleString('es-CO')} pts</span>
        </button>
      ))}

      {sel && (
        <div className="space-y-4 rounded-2xl border-2 border-brand-green/30 bg-white p-5">
          <p className="font-bold text-gray-900">Ajustar los puntos de {sel.nombre}</p>
          <Numero label="Puntos (negativo para descontar)" valor={puntos} onCambio={setPuntos} />
          <Campo label="Motivo *" valor={motivo} onCambio={setMotivo} />
          <button onClick={aplicar} disabled={guardando || !puntos || !motivo.trim()}
            className="flex items-center gap-2 rounded-xl bg-brand-green px-6 py-2.5 font-semibold text-white hover:bg-brand-green-dark disabled:opacity-60">
            {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Aplicar ajuste
          </button>
        </div>
      )}

      {ok && <p className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{ok}</p>}
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    </div>
  )
}

// ── Piezas ───────────────────────────────────────────────────────────────────

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="mb-4 font-bold text-gray-900">{titulo}</p>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  )
}

function Campo({ label, valor, onCambio }: { label: string; valor: string; onCambio: (v: string) => void }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-gray-700">{label}</label>
      <input value={valor} onChange={(e) => onCambio(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
    </div>
  )
}

function Numero({ label, valor, onCambio, ayuda, paso = 1 }: {
  label: string; valor: any; onCambio: (v: string) => void; ayuda?: string; paso?: number
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-gray-700">{label}</label>
      <input type="number" step={paso} value={valor ?? ''} onChange={(e) => onCambio(e.target.value)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      {ayuda && <p className="mt-1 text-xs text-gray-400">{ayuda}</p>}
    </div>
  )
}

function Texto({ label, valor, onCambio }: { label: string; valor: string; onCambio: (v: string) => void }) {
  return (
    <div className="sm:col-span-2">
      <label className="mb-1.5 block text-sm font-semibold text-gray-700">{label}</label>
      <textarea rows={3} value={valor} onChange={(e) => onCambio(e.target.value)}
        className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm" />
    </div>
  )
}

function Interruptor({ label, ayuda, valor, onCambio }: {
  label: string; ayuda?: string; valor: boolean; onCambio: (v: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3">
      <button type="button" onClick={() => onCambio(!valor)} aria-pressed={valor}
        className={`relative mt-0.5 h-6 w-12 shrink-0 rounded-full transition-colors ${valor ? 'bg-brand-green' : 'bg-gray-300'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${valor ? 'left-6' : 'left-0.5'}`} />
      </button>
      <span>
        <span className="block text-sm font-semibold text-gray-700">{label}</span>
        {ayuda && <span className="block text-xs text-gray-400">{ayuda}</span>}
      </span>
    </div>
  )
}
