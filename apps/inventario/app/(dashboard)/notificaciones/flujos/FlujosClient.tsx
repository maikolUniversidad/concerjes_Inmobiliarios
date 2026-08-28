'use client'

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Plus, Save, Trash2, Loader2, X, Power, Zap, ListTree, PlayCircle, Settings2,
} from 'lucide-react'
import {
  OPERADOR_LABELS,
  type Condiciones, type EventoNotificacion, type FlujoNotificacion,
  type OperadorCondicion, type ReglaCondicion,
} from '@/lib/types/database'
import { alternarFlujo, eliminarFlujo, ejecutarPendientes, guardarFlujo, type ActionResult } from './actions'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'
const labelCls = 'font-body text-xs font-semibold text-gray-500'
const OPERADORES = Object.keys(OPERADOR_LABELS) as OperadorCondicion[]

function GuardarBtn() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar flujo
    </button>
  )
}

export function FlujosClient({
  flujos, eventos, pasosPorFlujo, puedeGestionar,
}: {
  flujos: FlujoNotificacion[]
  eventos: EventoNotificacion[]
  pasosPorFlujo: Record<string, number>
  puedeGestionar: boolean
}) {
  const [editando, setEditando] = useState<FlujoNotificacion | 'nuevo' | null>(null)
  const [borrando, startBorrar] = useTransition()
  const [alternando, startAlternar] = useTransition()
  const [ejecutando, startEjecutar] = useTransition()

  const eventoPorCodigo = useMemo(
    () => new Map(eventos.map((e) => [e.codigo, e])), [eventos],
  )

  function borrar(f: FlujoNotificacion) {
    if (!confirm(`¿Eliminar el flujo "${f.nombre}"? Se borran sus pasos y su historial.`)) return
    startBorrar(async () => {
      const r = await eliminarFlujo(f.id)
      if (r.error) toast.error(r.error)
      else toast.success('Flujo eliminado')
    })
  }

  function alternar(f: FlujoNotificacion) {
    startAlternar(async () => {
      const r = await alternarFlujo(f.id, !f.activo)
      if (r.error) toast.error(r.error)
      else toast.success(f.activo ? 'Flujo desactivado' : 'Flujo activado')
    })
  }

  function ejecutarAhora() {
    startEjecutar(async () => {
      const r = await ejecutarPendientes()
      if (r.error) toast.error(r.error)
      else toast.success(`Pasos ejecutados: ${r.ejecutados ?? 0} · omitidos: ${r.omitidos ?? 0} · correos: ${r.correos ?? 0}`)
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/notificaciones/eventos"
            className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 font-body text-xs text-gray-600 hover:bg-gray-50">
            <ListTree className="w-3.5 h-3.5" /> Catálogo de eventos ({eventos.length})
          </Link>
          {puedeGestionar && (
            <button onClick={ejecutarAhora} disabled={ejecutando}
              className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 font-body text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              {ejecutando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
              Ejecutar pasos pendientes
            </button>
          )}
        </div>
        {puedeGestionar && (
          <button onClick={() => setEditando('nuevo')}
            className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark">
            <Plus className="w-4 h-4" /> Nuevo flujo
          </button>
        )}
      </div>

      {flujos.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center shadow-sm">
          <Zap className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="font-body text-sm text-gray-500">
            Todavía no hay flujos. Crea el primero eligiendo un evento del catálogo.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {flujos.map((f) => {
            const evento = eventoPorCodigo.get(f.evento_codigo)
            const reglas = f.condiciones?.reglas ?? []
            return (
              <div key={f.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${f.activo ? 'bg-green-500' : 'bg-gray-300'}`} />
                      <span className="font-heading font-semibold text-sm text-gray-900">{f.nombre}</span>
                      {!f.activo && (
                        <span className="font-body text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Desactivado</span>
                      )}
                    </div>
                    {f.descripcion && <p className="font-body text-xs text-gray-500 mt-1">{f.descripcion}</p>}
                    <p className="font-body text-xs text-gray-400 mt-1">
                      Cuando ocurre <strong className="text-gray-600">{evento?.nombre ?? f.evento_codigo}</strong>
                      {reglas.length > 0 && ` y se cumplen ${reglas.length} condición(es)`}
                      {' · '}{pasosPorFlujo[f.id] ?? 0} paso(s)
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Link href={`/notificaciones/flujos/${f.id}`}
                      className="flex items-center gap-1 font-body text-xs text-brand-green font-semibold px-2.5 py-1.5 rounded-lg hover:bg-green-50">
                      <Settings2 className="w-3.5 h-3.5" /> Pasos e historial
                    </Link>
                    {puedeGestionar && (
                      <>
                        <button onClick={() => setEditando(f)}
                          className="font-body text-xs text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-50">Editar</button>
                        <button onClick={() => alternar(f)} disabled={alternando}
                          className="flex items-center gap-1 font-body text-xs text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => borrar(f)} disabled={borrando}
                          className="flex items-center gap-1 font-body text-xs text-red-500 px-2.5 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editando && (
        <EditorFlujo
          flujo={editando === 'nuevo' ? null : editando}
          eventos={eventos}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  )
}

// ── Editor del flujo (disparador + condiciones) ──────────────────────────────
function EditorFlujo({
  flujo, eventos, onCerrar,
}: { flujo: FlujoNotificacion | null; eventos: EventoNotificacion[]; onCerrar: () => void }) {
  const [state, action] = useActionState<ActionResult, FormData>(guardarFlujo, {})
  const [eventoCodigo, setEventoCodigo] = useState(flujo?.evento_codigo ?? eventos[0]?.codigo ?? '')
  const [condiciones, setCondiciones] = useState<Condiciones>(
    flujo?.condiciones ?? { modo: 'AND', reglas: [] },
  )

  useEffect(() => {
    if (state.ok) { toast.success('Flujo guardado'); onCerrar() }
    else if (state.error) toast.error(state.error)
  }, [state, onCerrar])

  const evento = eventos.find((e) => e.codigo === eventoCodigo)
  const variables = evento?.variables ?? []

  function actualizarRegla(i: number, cambio: Partial<ReglaCondicion>) {
    setCondiciones((c) => ({
      ...c,
      reglas: c.reglas.map((r, idx) => (idx === i ? { ...r, ...cambio } : r)),
    }))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-heading font-bold text-lg text-gray-900">{flujo ? 'Editar flujo' : 'Nuevo flujo'}</h2>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <form action={action} className="p-5 space-y-4">
          {flujo && <input type="hidden" name="id" value={flujo.id} />}
          <input type="hidden" name="condiciones" value={JSON.stringify(condiciones)} />

          <div className="grid sm:grid-cols-2 gap-4">
            <label><span className={labelCls}>Nombre *</span>
              <input name="nombre" required defaultValue={flujo?.nombre ?? ''}
                placeholder="Escalar órdenes sin aprobar" className={inputCls + ' mt-1'} /></label>
            <label><span className={labelCls}>Código</span>
              <input name="codigo" defaultValue={flujo?.codigo ?? ''} placeholder="Se genera del nombre" className={inputCls + ' mt-1'} /></label>
          </div>

          <label className="block"><span className={labelCls}>Descripción</span>
            <input name="descripcion" defaultValue={flujo?.descripcion ?? ''}
              placeholder="Qué resuelve este flujo" className={inputCls + ' mt-1'} /></label>

          <label className="block"><span className={labelCls}>Evento que lo dispara *</span>
            <select name="evento_codigo" required value={eventoCodigo} onChange={(e) => setEventoCodigo(e.target.value)}
              className={inputCls + ' mt-1 bg-white'}>
              {eventos.map((e) => (
                <option key={e.codigo} value={e.codigo}>{e.modulo} · {e.nombre}</option>
              ))}
            </select>
          </label>
          {evento?.descripcion && <p className="font-body text-xs text-gray-400 -mt-2">{evento.descripcion}</p>}

          {/* Condiciones */}
          <div className="border border-gray-100 rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className={labelCls}>Condiciones (opcional)</span>
              <div className="flex items-center gap-2">
                <select value={condiciones.modo}
                  onChange={(e) => setCondiciones((c) => ({ ...c, modo: e.target.value as 'AND' | 'OR' }))}
                  className="border border-gray-200 rounded-lg px-2 py-1 font-body text-xs bg-white">
                  <option value="AND">Se cumplen todas</option>
                  <option value="OR">Se cumple alguna</option>
                </select>
                <button type="button"
                  onClick={() => setCondiciones((c) => ({ ...c, reglas: [...c.reglas, { campo: variables[0]?.clave ?? '', operador: '=', valor: '' }] }))}
                  className="flex items-center gap-1 border border-gray-200 rounded-lg px-2 py-1 font-body text-xs text-gray-600 hover:bg-gray-50">
                  <Plus className="w-3 h-3" /> Condición
                </button>
              </div>
            </div>

            {condiciones.reglas.length === 0 ? (
              <p className="font-body text-xs text-gray-400">
                Sin condiciones el flujo se ejecuta cada vez que ocurre el evento.
              </p>
            ) : (
              <div className="space-y-2">
                {condiciones.reglas.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <input list={`vars-${i}`} value={r.campo} onChange={(e) => actualizarRegla(i, { campo: e.target.value })}
                      placeholder="campo" className="flex-1 min-w-[110px] border border-gray-200 rounded-lg px-2 py-1.5 font-body text-xs outline-none focus:border-brand-green" />
                    <datalist id={`vars-${i}`}>
                      {variables.map((v) => <option key={v.clave} value={v.clave}>{v.descripcion ?? ''}</option>)}
                    </datalist>
                    <select value={r.operador} onChange={(e) => actualizarRegla(i, { operador: e.target.value as OperadorCondicion })}
                      className="border border-gray-200 rounded-lg px-2 py-1.5 font-body text-xs bg-white">
                      {OPERADORES.map((op) => <option key={op} value={op}>{OPERADOR_LABELS[op]}</option>)}
                    </select>
                    {r.operador !== 'existe' && r.operador !== 'vacio' && (
                      <input value={r.valor} onChange={(e) => actualizarRegla(i, { valor: e.target.value })}
                        placeholder="valor" className="flex-1 min-w-[90px] border border-gray-200 rounded-lg px-2 py-1.5 font-body text-xs outline-none focus:border-brand-green" />
                    )}
                    <button type="button" onClick={() => setCondiciones((c) => ({ ...c, reglas: c.reglas.filter((_, idx) => idx !== i) }))}
                      className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
              </div>
            )}

            {variables.length > 0 && (
              <p className="font-body text-[11px] text-gray-400">
                Campos del evento: {variables.map((v) => v.clave).join(', ')}
              </p>
            )}
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 font-body text-xs text-gray-600">
              <input type="checkbox" name="activo" defaultChecked={flujo?.activo ?? true} className="accent-brand-green w-4 h-4" /> Flujo activo
            </label>
            <label className="flex items-center gap-2 font-body text-xs text-gray-600">
              Prioridad
              <input name="prioridad" type="number" min={1} defaultValue={flujo?.prioridad ?? 100}
                className="w-20 border border-gray-200 rounded-lg px-2 py-1 font-body text-xs" />
            </label>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            <GuardarBtn />
            <button type="button" onClick={onCerrar} className="font-body text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          </div>
          {!flujo && (
            <p className="font-body text-xs text-gray-400">
              Al guardar podrás añadir los pasos (correo, notificación, espera, escalamiento).
            </p>
          )}
        </form>
      </div>
    </div>
  )
}
