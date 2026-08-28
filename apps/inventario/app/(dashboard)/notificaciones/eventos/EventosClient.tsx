'use client'

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import { toast } from 'sonner'
import { Plus, Save, Trash2, Loader2, X, Power, ChevronDown } from 'lucide-react'
import type { EventoNotificacion, FlujoNotificacion } from '@/lib/types/database'
import { alternarEvento, eliminarEvento, guardarEvento, type ActionResult } from '../flujos/actions'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'
const labelCls = 'font-body text-xs font-semibold text-gray-500'

type FlujoLite = Pick<FlujoNotificacion, 'id' | 'nombre' | 'evento_codigo' | 'activo'>

function GuardarBtn() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar evento
    </button>
  )
}

export function EventosClient({
  eventos, flujos, puedeGestionar,
}: { eventos: EventoNotificacion[]; flujos: FlujoLite[]; puedeGestionar: boolean }) {
  const [editando, setEditando] = useState<EventoNotificacion | 'nuevo' | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [ocupado, startOcupado] = useTransition()

  const flujosPorEvento = useMemo(() => {
    const mapa = new Map<string, FlujoLite[]>()
    for (const f of flujos) mapa.set(f.evento_codigo, [...(mapa.get(f.evento_codigo) ?? []), f])
    return mapa
  }, [flujos])

  const porModulo = useMemo(() => {
    const mapa = new Map<string, EventoNotificacion[]>()
    for (const e of eventos) {
      const m = e.modulo || 'General'
      mapa.set(m, [...(mapa.get(m) ?? []), e])
    }
    return [...mapa.entries()]
  }, [eventos])

  function borrar(e: EventoNotificacion) {
    if (!confirm(`¿Eliminar el evento "${e.nombre}"?`)) return
    startOcupado(async () => {
      const r = await eliminarEvento(e.id)
      if (r.error) toast.error(r.error)
      else toast.success('Evento eliminado')
    })
  }

  function alternar(e: EventoNotificacion) {
    startOcupado(async () => {
      const r = await alternarEvento(e.id, !e.activo)
      if (r.error) toast.error(r.error)
      else toast.success(e.activo ? 'Evento desactivado' : 'Evento activado')
    })
  }

  return (
    <div className="space-y-5">
      {puedeGestionar && (
        <div className="flex justify-end">
          <button onClick={() => setEditando('nuevo')}
            className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark">
            <Plus className="w-4 h-4" /> Nuevo evento
          </button>
        </div>
      )}

      {porModulo.map(([modulo, lista]) => (
        <div key={modulo} className="space-y-2">
          <h2 className="font-heading font-semibold text-sm text-gray-500 uppercase tracking-wide">{modulo}</h2>
          <div className="space-y-2">
            {lista.map((e) => {
              const suyos = flujosPorEvento.get(e.codigo) ?? []
              const open = abierto === e.id
              return (
                <div key={e.id} className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
                  <button type="button" onClick={() => setAbierto(open ? null : e.id)}
                    className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50/60 transition-colors">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${e.activo ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-heading font-semibold text-sm text-gray-900">{e.nombre}</span>
                        <code className="font-body text-[10px] bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded">{e.codigo}</code>
                        {!e.es_sistema && (
                          <span className="font-body text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">Personalizado</span>
                        )}
                        {!e.activo && (
                          <span className="font-body text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Desactivado</span>
                        )}
                      </div>
                      <p className="font-body text-xs text-gray-500 mt-0.5 line-clamp-1">{e.descripcion}</p>
                    </div>
                    <span className="font-body text-[11px] text-gray-400 hidden sm:block shrink-0">
                      {suyos.length} flujo{suyos.length !== 1 ? 's' : ''}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
                  </button>

                  {open && (
                    <div className="border-t border-gray-50 p-4 space-y-3">
                      {(e.variables ?? []).length > 0 && (
                        <div>
                          <p className={labelCls}>Datos que entrega el evento</p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {e.variables.map((v) => (
                              <span key={v.clave} className="font-body text-[11px] bg-gray-50 border border-gray-100 rounded-lg px-2 py-1 text-gray-600">
                                <code>{`{{${v.clave}}}`}</code>{v.descripcion ? ` · ${v.descripcion}` : ''}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div>
                        <p className={labelCls}>Flujos que escuchan este evento</p>
                        {suyos.length === 0 ? (
                          <p className="font-body text-xs text-gray-400 mt-1">
                            Ninguno todavía.{' '}
                            <Link href="/notificaciones/flujos" className="text-brand-green font-semibold hover:underline">Crear uno</Link>.
                          </p>
                        ) : (
                          <ul className="mt-1 space-y-1">
                            {suyos.map((f) => (
                              <li key={f.id}>
                                <Link href={`/notificaciones/flujos/${f.id}`}
                                  className="font-body text-xs text-brand-green hover:underline">
                                  {f.nombre}
                                </Link>
                                {!f.activo && <span className="font-body text-[10px] text-gray-400"> · desactivado</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {puedeGestionar && (
                        <div className="flex items-center gap-1 pt-2 border-t border-gray-50">
                          <button onClick={() => setEditando(e)}
                            className="font-body text-xs text-brand-green font-semibold px-2 py-1 rounded hover:bg-green-50">Editar</button>
                          <button onClick={() => alternar(e)} disabled={ocupado}
                            className="flex items-center gap-1 font-body text-xs text-gray-500 px-2 py-1 rounded hover:bg-gray-50 disabled:opacity-50">
                            <Power className="w-3.5 h-3.5" /> {e.activo ? 'Desactivar' : 'Activar'}
                          </button>
                          {!e.es_sistema && (
                            <button onClick={() => borrar(e)} disabled={ocupado}
                              className="flex items-center gap-1 font-body text-xs text-red-500 px-2 py-1 rounded hover:bg-red-50 ml-auto disabled:opacity-50">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {editando && (
        <EditorEvento evento={editando === 'nuevo' ? null : editando} onCerrar={() => setEditando(null)} />
      )}
    </div>
  )
}

function EditorEvento({ evento, onCerrar }: { evento: EventoNotificacion | null; onCerrar: () => void }) {
  const [state, action] = useActionState<ActionResult, FormData>(guardarEvento, {})

  useEffect(() => {
    if (state.ok) { toast.success('Evento guardado'); onCerrar() }
    else if (state.error) toast.error(state.error)
  }, [state, onCerrar])

  const variablesTexto = (evento?.variables ?? [])
    .map((v) => (v.descripcion ? `${v.clave}: ${v.descripcion}` : v.clave)).join('\n')

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl my-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-heading font-bold text-lg text-gray-900">{evento ? 'Editar evento' : 'Nuevo evento'}</h2>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <form action={action} className="p-5 space-y-4">
          {evento && <input type="hidden" name="id" value={evento.id} />}

          <div className="grid sm:grid-cols-2 gap-4">
            <label><span className={labelCls}>Nombre *</span>
              <input name="nombre" required defaultValue={evento?.nombre ?? ''}
                placeholder="Contrato por vencer" className={inputCls + ' mt-1'} /></label>
            <label><span className={labelCls}>Código {evento && <span className="text-gray-400">(fijo)</span>}</span>
              <input name="codigo" defaultValue={evento?.codigo ?? ''} disabled={!!evento}
                placeholder="CONTRATO_POR_VENCER" className={inputCls + ' mt-1 disabled:bg-gray-50 disabled:text-gray-500'} /></label>
          </div>

          <label className="block"><span className={labelCls}>Módulo</span>
            <input name="modulo" defaultValue={evento?.modulo ?? 'General'} className={inputCls + ' mt-1'} /></label>

          <label className="block"><span className={labelCls}>Descripción — cuándo ocurre</span>
            <textarea name="descripcion" rows={2} defaultValue={evento?.descripcion ?? ''}
              placeholder="Se emite cuando faltan 30 días para el vencimiento de un contrato." className={inputCls + ' mt-1'} /></label>

          <label className="block"><span className={labelCls}>Datos que entrega (una por línea, «clave: descripción»)</span>
            <textarea name="variables" rows={4} defaultValue={variablesTexto}
              placeholder={'contrato_id: ID del contrato\nsede: Nombre de la sede'} className={inputCls + ' mt-1 font-mono text-xs'} /></label>

          <label className="block"><span className={labelCls}>Payload de ejemplo (JSON, para las pruebas)</span>
            <textarea name="payload_ejemplo" rows={3} defaultValue={JSON.stringify(evento?.payload_ejemplo ?? {}, null, 2)}
              className={inputCls + ' mt-1 font-mono text-xs'} /></label>

          <label className="flex items-center gap-2 font-body text-xs text-gray-700">
            <input type="checkbox" name="activo" defaultChecked={evento?.activo ?? true} className="accent-brand-green w-4 h-4" />
            Evento activo
          </label>

          <p className="font-body text-[11px] text-gray-400">
            Un evento personalizado se emite desde el código con{' '}
            <code className="bg-gray-50 px-1 rounded">emitirEvento(supabase, {'{ codigo: \'…\' }'})</code>,
            o a mano con el botón «Probar flujo».
          </p>

          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            <GuardarBtn />
            <button type="button" onClick={onCerrar} className="font-body text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  )
}
