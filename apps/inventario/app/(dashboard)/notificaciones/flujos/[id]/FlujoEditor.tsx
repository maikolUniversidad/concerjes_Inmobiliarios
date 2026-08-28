'use client'

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import {
  Plus, Save, Trash2, Loader2, X, ChevronUp, ChevronDown, Mail, Bell, Clock, Webhook,
  FlaskConical, History, ShieldQuestion, Ban,
} from 'lucide-react'
import {
  ESTADO_EJECUCION_LABELS, ESTADO_PASO_LABELS, OPERADOR_LABELS, TIPO_PASO_LABELS,
  type DestinatariosPaso, type EventoNotificacion, type FlujoEjecucion, type FlujoEjecucionPaso,
  type FlujoNotificacion, type FlujoPaso, type OperadorCondicion, type PlantillaCorreo,
  type RolUsuario, type SeveridadNotificacion, type TipoPasoFlujo, type VerificacionPaso,
} from '@/lib/types/database'
import {
  cancelarEjecucion, dispararPrueba, eliminarPaso, guardarPaso, moverPaso, type ActionResult,
} from '../actions'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'
const labelCls = 'font-body text-xs font-semibold text-gray-500'

const ROLES: RolUsuario[] = [
  'SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'COORDINADOR_COMPRAS', 'BODEGUERO', 'AUDITOR', 'OPERADOR_SEDE',
]
const SEVERIDADES: SeveridadNotificacion[] = ['INFO', 'EXITO', 'ADVERTENCIA', 'CRITICA']
const TIPOS = Object.keys(TIPO_PASO_LABELS) as TipoPasoFlujo[]
const OPERADORES = Object.keys(OPERADOR_LABELS) as OperadorCondicion[]

const ICONO_TIPO: Record<TipoPasoFlujo, typeof Mail> = {
  EMAIL: Mail, APP: Bell, ESPERA: Clock, WEBHOOK: Webhook,
}

type PlantillaLite = Pick<PlantillaCorreo, 'id' | 'codigo' | 'nombre' | 'asunto' | 'activa'>
type UsuarioLite = { id: string; nombre: string; email: string | null; rol: string }

const DEST_VACIO: DestinatariosPaso = { roles: [], usuarios: [], correos: [], campos: [] }

/** Convierte minutos a la unidad más legible para el formulario. */
function desglosarDemora(minutos: number): { valor: number; unidad: 'minutos' | 'horas' | 'dias' } {
  if (minutos > 0 && minutos % 1440 === 0) return { valor: minutos / 1440, unidad: 'dias' }
  if (minutos > 0 && minutos % 60 === 0) return { valor: minutos / 60, unidad: 'horas' }
  return { valor: minutos, unidad: 'minutos' }
}

function describirDemora(minutos: number): string {
  if (minutos <= 0) return 'de inmediato'
  const { valor, unidad } = desglosarDemora(minutos)
  const etiqueta = unidad === 'dias' ? 'día' : unidad === 'horas' ? 'hora' : 'minuto'
  return `${valor} ${etiqueta}${valor === 1 ? '' : 's'} después`
}

function GuardarBtn() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar paso
    </button>
  )
}

export function FlujoEditor({
  flujo, evento, pasos, plantillas, usuarios, ejecuciones, pasosEjecucion, puedeGestionar,
}: {
  flujo: FlujoNotificacion
  evento: EventoNotificacion | null
  pasos: FlujoPaso[]
  plantillas: PlantillaLite[]
  usuarios: UsuarioLite[]
  ejecuciones: FlujoEjecucion[]
  pasosEjecucion: FlujoEjecucionPaso[]
  puedeGestionar: boolean
}) {
  const [editando, setEditando] = useState<FlujoPaso | 'nuevo' | null>(null)
  const [ocupado, startOcupado] = useTransition()
  const [probando, startProbar] = useTransition()

  const plantillaPorId = useMemo(() => new Map(plantillas.map((p) => [p.id, p])), [plantillas])
  const pasosPorEjecucion = useMemo(() => {
    const mapa = new Map<string, FlujoEjecucionPaso[]>()
    for (const p of pasosEjecucion) mapa.set(p.ejecucion_id, [...(mapa.get(p.ejecucion_id) ?? []), p])
    return mapa
  }, [pasosEjecucion])

  function probar() {
    startProbar(async () => {
      const r = await dispararPrueba(flujo.id)
      if (r.error) { toast.error(r.error); return }
      toast.success(r.disparados
        ? 'Evento disparado. Revisa el historial de abajo.'
        : 'El evento se emitió pero ninguna condición se cumplió (o el flujo está desactivado).')
    })
  }

  function borrarPaso(p: FlujoPaso) {
    if (!confirm(`¿Eliminar el paso "${p.nombre || TIPO_PASO_LABELS[p.tipo].label}"?`)) return
    startOcupado(async () => {
      const r = await eliminarPaso(p.id, flujo.id)
      if (r.error) toast.error(r.error)
      else toast.success('Paso eliminado')
    })
  }

  function mover(p: FlujoPaso, direccion: 'arriba' | 'abajo') {
    startOcupado(async () => {
      const r = await moverPaso(p.id, flujo.id, direccion)
      if (r.error) toast.error(r.error)
    })
  }

  function cancelar(e: FlujoEjecucion) {
    startOcupado(async () => {
      const r = await cancelarEjecucion(e.id, flujo.id)
      if (r.error) toast.error(r.error)
      else toast.success('Ejecución cancelada')
    })
  }

  return (
    <div className="space-y-5">
      {/* Disparador */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className={labelCls}>Se dispara cuando ocurre</p>
            <p className="font-heading font-semibold text-sm text-gray-900 mt-0.5">
              {evento?.nombre ?? flujo.evento_codigo}
              <span className="font-body font-normal text-gray-400"> · {evento?.modulo ?? 'General'}</span>
            </p>
            {(flujo.condiciones?.reglas ?? []).length > 0 && (
              <p className="font-body text-xs text-gray-500 mt-1">
                Solo si {flujo.condiciones.modo === 'OR' ? 'se cumple alguna' : 'se cumplen todas'}:{' '}
                {flujo.condiciones.reglas.map((r, i) => (
                  <span key={i} className="inline-block bg-gray-50 rounded px-1.5 py-0.5 mr-1 mt-1">
                    {r.campo} {OPERADOR_LABELS[r.operador]} {r.valor}
                  </span>
                ))}
              </p>
            )}
            {!flujo.activo && (
              <p className="font-body text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mt-2 inline-block">
                El flujo está desactivado: no se disparará.
              </p>
            )}
          </div>
          {puedeGestionar && (
            <button onClick={probar} disabled={probando}
              className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 font-body text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              {probando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
              Probar flujo
            </button>
          )}
        </div>
      </div>

      {/* Pasos */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading font-semibold text-base text-gray-900">Pasos ({pasos.length})</h2>
          {puedeGestionar && (
            <button onClick={() => setEditando('nuevo')}
              className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark">
              <Plus className="w-4 h-4" /> Añadir paso
            </button>
          )}
        </div>

        {pasos.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center shadow-sm">
            <p className="font-body text-sm text-gray-500">
              Este flujo no hace nada todavía. Añade el primer paso: enviar un correo, notificar en la app
              o esperar y volver a comprobar el estado.
            </p>
          </div>
        ) : (
          pasos.map((p, i) => {
            const Icono = ICONO_TIPO[p.tipo]
            const plantilla = p.plantilla_id ? plantillaPorId.get(p.plantilla_id) : null
            const d = p.destinatarios ?? DEST_VACIO
            const destinos = [
              ...(d.roles ?? []).map((r) => `rol ${r}`),
              ...(d.usuarios ?? []).map((u) => usuarios.find((x) => x.id === u)?.nombre ?? 'usuario'),
              ...(d.correos ?? []),
              ...(d.campos ?? []).map((c) => `{{${c}}}`),
            ]
            return (
              <div key={p.id} className={`bg-white border rounded-2xl p-4 shadow-sm ${p.activo ? 'border-gray-100' : 'border-dashed border-gray-200 opacity-70'}`}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
                    <Icono className="w-4 h-4 text-brand-green" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-body text-[11px] text-gray-400">Paso {i + 1}</span>
                      <span className="font-heading font-semibold text-sm text-gray-900">
                        {p.nombre || TIPO_PASO_LABELS[p.tipo].label}
                      </span>
                      <span className="font-body text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {TIPO_PASO_LABELS[p.tipo].label}
                      </span>
                      <span className="font-body text-[11px] text-gray-400">{describirDemora(p.demora_minutos)}</span>
                      {!p.activo && (
                        <span className="font-body text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Desactivado</span>
                      )}
                    </div>

                    {p.tipo === 'EMAIL' && (
                      <p className="font-body text-xs text-gray-500 mt-1">
                        {plantilla ? <>Plantilla <strong>{plantilla.nombre}</strong></> : 'Mensaje escrito en el paso'}
                        {destinos.length > 0 && ` → ${destinos.join(', ')}`}
                      </p>
                    )}
                    {p.tipo === 'APP' && (
                      <p className="font-body text-xs text-gray-500 mt-1">
                        Notifica a {destinos.length > 0 ? destinos.join(', ') : 'nadie configurado'} · severidad {p.severidad}
                      </p>
                    )}
                    {p.tipo === 'WEBHOOK' && (
                      <p className="font-body text-xs text-gray-500 mt-1 truncate">POST a {p.webhook_url}</p>
                    )}

                    {p.verificacion?.tabla && p.verificacion?.campo && (
                      <p className="font-body text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mt-2 inline-flex items-center gap-1.5">
                        <ShieldQuestion className="w-3.5 h-3.5 shrink-0" />
                        Solo continúa si <code className="bg-white/60 px-1 rounded">{p.verificacion.tabla}.{p.verificacion.campo}</code>{' '}
                        {OPERADOR_LABELS[(p.verificacion.operador ?? '=') as OperadorCondicion]} «{p.verificacion.valor}»
                        {p.detener_si_falla && ' · si no, cancela el resto del flujo'}
                      </p>
                    )}
                  </div>

                  {puedeGestionar && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button onClick={() => mover(p, 'arriba')} disabled={ocupado || i === 0}
                        className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ChevronUp className="w-4 h-4" /></button>
                      <button onClick={() => mover(p, 'abajo')} disabled={ocupado || i === pasos.length - 1}
                        className="p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"><ChevronDown className="w-4 h-4" /></button>
                      <button onClick={() => setEditando(p)}
                        className="font-body text-xs text-brand-green font-semibold px-2 py-1 rounded hover:bg-green-50">Editar</button>
                      <button onClick={() => borrarPaso(p)} disabled={ocupado}
                        className="p-1.5 text-red-400 hover:text-red-600 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Historial */}
      <div className="space-y-3">
        <h2 className="font-heading font-semibold text-base text-gray-900 flex items-center gap-2">
          <History className="w-4 h-4 text-gray-400" /> Últimas ejecuciones
        </h2>
        {ejecuciones.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-2xl p-6 text-center shadow-sm">
            <p className="font-body text-sm text-gray-500">Este flujo aún no se ha disparado.</p>
          </div>
        ) : (
          ejecuciones.map((e) => {
            const est = ESTADO_EJECUCION_LABELS[e.estado]
            const suyos = pasosPorEjecucion.get(e.id) ?? []
            return (
              <div key={e.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-body text-[10px] px-2 py-0.5 rounded-full ${est.color}`}>{est.label}</span>
                    <span className="font-body text-xs text-gray-500">
                      {new Date(e.created_at).toLocaleString('es-CO')}
                    </span>
                    {e.entidad && <span className="font-body text-xs text-gray-400">· {e.entidad}</span>}
                  </div>
                  {puedeGestionar && e.estado === 'EN_CURSO' && (
                    <button onClick={() => cancelar(e)} disabled={ocupado}
                      className="flex items-center gap-1 font-body text-xs text-gray-500 border border-gray-200 rounded-lg px-2 py-1 hover:bg-gray-50 disabled:opacity-50">
                      <Ban className="w-3.5 h-3.5" /> Cancelar
                    </button>
                  )}
                </div>
                {suyos.length > 0 && (
                  <div className="mt-2 divide-y divide-gray-50">
                    {suyos.map((sp) => {
                      const ep = ESTADO_PASO_LABELS[sp.estado]
                      return (
                        <div key={sp.id} className="flex items-start gap-2 py-1.5">
                          <span className={`font-body text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${ep.color}`}>{ep.label}</span>
                          <div className="min-w-0 flex-1">
                            <p className="font-body text-xs text-gray-600">
                              Paso {sp.orden}
                              {sp.estado === 'PROGRAMADO'
                                ? ` · para ${new Date(sp.programado_para).toLocaleString('es-CO')}`
                                : sp.ejecutado_at ? ` · ${new Date(sp.ejecutado_at).toLocaleString('es-CO')}` : ''}
                            </p>
                            {sp.resultado && <p className="font-body text-[11px] text-gray-400">{sp.resultado}</p>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {editando && (
        <EditorPaso
          flujoId={flujo.id}
          paso={editando === 'nuevo' ? null : editando}
          evento={evento}
          plantillas={plantillas}
          usuarios={usuarios}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  )
}

// ── Editor de un paso ────────────────────────────────────────────────────────
function EditorPaso({
  flujoId, paso, evento, plantillas, usuarios, onCerrar,
}: {
  flujoId: string
  paso: FlujoPaso | null
  evento: EventoNotificacion | null
  plantillas: PlantillaLite[]
  usuarios: UsuarioLite[]
  onCerrar: () => void
}) {
  const [state, action] = useActionState<ActionResult, FormData>(guardarPaso, {})
  const [tipo, setTipo] = useState<TipoPasoFlujo>(paso?.tipo ?? 'EMAIL')
  const inicial = desglosarDemora(paso?.demora_minutos ?? 0)
  const [demora, setDemora] = useState(inicial.valor)
  const [unidad, setUnidad] = useState<'minutos' | 'horas' | 'dias'>(inicial.unidad)
  const [dest, setDest] = useState<DestinatariosPaso>({ ...DEST_VACIO, ...(paso?.destinatarios ?? {}) })
  const [verif, setVerif] = useState<VerificacionPaso>(paso?.verificacion ?? {})
  const [usaVerif, setUsaVerif] = useState(!!paso?.verificacion?.tabla)

  useEffect(() => {
    if (state.ok) { toast.success('Paso guardado'); onCerrar() }
    else if (state.error) toast.error(state.error)
  }, [state, onCerrar])

  const minutos = unidad === 'dias' ? demora * 1440 : unidad === 'horas' ? demora * 60 : demora
  const variables = evento?.variables ?? []

  function alternarRol(rol: RolUsuario) {
    setDest((d) => ({
      ...d,
      roles: d.roles.includes(rol) ? d.roles.filter((r) => r !== rol) : [...d.roles, rol],
    }))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <h2 className="font-heading font-bold text-lg text-gray-900">{paso ? 'Editar paso' : 'Nuevo paso'}</h2>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <form action={action} className="p-5 space-y-4">
          <input type="hidden" name="flujo_id" value={flujoId} />
          {paso && <input type="hidden" name="id" value={paso.id} />}
          {paso && <input type="hidden" name="orden" value={paso.orden} />}
          <input type="hidden" name="demora_minutos" value={minutos} />
          <input type="hidden" name="destinatarios" value={JSON.stringify(dest)} />
          <input type="hidden" name="verificacion" value={JSON.stringify(usaVerif ? verif : {})} />

          <div className="grid sm:grid-cols-2 gap-4">
            <label><span className={labelCls}>Nombre del paso</span>
              <input name="nombre" defaultValue={paso?.nombre ?? ''} placeholder="Aviso al coordinador" className={inputCls + ' mt-1'} /></label>
            <label><span className={labelCls}>Qué hace *</span>
              <select name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoPasoFlujo)}
                className={inputCls + ' mt-1 bg-white'}>
                {TIPOS.map((t) => <option key={t} value={t}>{TIPO_PASO_LABELS[t].label}</option>)}
              </select>
            </label>
          </div>
          <p className="font-body text-xs text-gray-400 -mt-2">{TIPO_PASO_LABELS[tipo].descripcion}</p>

          <div>
            <span className={labelCls}>Cuándo se ejecuta</span>
            <div className="flex items-center gap-2 mt-1">
              <input type="number" min={0} value={demora} onChange={(e) => setDemora(Math.max(0, Number(e.target.value)))}
                className="w-24 border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green" />
              <select value={unidad} onChange={(e) => setUnidad(e.target.value as 'minutos' | 'horas' | 'dias')}
                className="border border-gray-200 rounded-lg px-3 py-2 font-body text-sm bg-white">
                <option value="minutos">minutos</option>
                <option value="horas">horas</option>
                <option value="dias">días</option>
              </select>
              <span className="font-body text-xs text-gray-400">después de que ocurre el evento</span>
            </div>
          </div>

          {/* Correo */}
          {tipo === 'EMAIL' && (
            <div className="space-y-4 border border-gray-100 rounded-xl p-3">
              <label className="block"><span className={labelCls}>Plantilla</span>
                <select name="plantilla_id" defaultValue={paso?.plantilla_id ?? ''} className={inputCls + ' mt-1 bg-white'}>
                  <option value="">— Sin plantilla: escribo el mensaje aquí —</option>
                  {plantillas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </label>
              <label className="block"><span className={labelCls}>Asunto (opcional: reemplaza el de la plantilla)</span>
                <input name="asunto" defaultValue={paso?.asunto ?? ''} placeholder="Orden {{numero}} sigue pendiente" className={inputCls + ' mt-1'} /></label>
              <label className="block"><span className={labelCls}>Mensaje (si no usas plantilla)</span>
                <textarea name="mensaje" rows={3} defaultValue={paso?.mensaje ?? ''}
                  placeholder="Texto del correo. Puedes usar {{variables}} del evento." className={inputCls + ' mt-1'} /></label>
              <label className="block"><span className={labelCls}>Enlace del botón (ruta interna o URL)</span>
                <input name="enlace" defaultValue={paso?.enlace ?? ''} placeholder="/ordenes-insumo/{{orden_id}}" className={inputCls + ' mt-1'} /></label>
            </div>
          )}

          {/* Notificación en la app */}
          {tipo === 'APP' && (
            <div className="space-y-4 border border-gray-100 rounded-xl p-3">
              <div className="grid sm:grid-cols-2 gap-4">
                <label><span className={labelCls}>Título</span>
                  <input name="asunto" defaultValue={paso?.asunto ?? ''} placeholder="Orden {{numero}} pendiente" className={inputCls + ' mt-1'} /></label>
                <label><span className={labelCls}>Severidad</span>
                  <select name="severidad" defaultValue={paso?.severidad ?? 'INFO'} className={inputCls + ' mt-1 bg-white'}>
                    {SEVERIDADES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              </div>
              <label className="block"><span className={labelCls}>Descripción</span>
                <textarea name="mensaje" rows={2} defaultValue={paso?.mensaje ?? ''} className={inputCls + ' mt-1'} /></label>
              <label className="block"><span className={labelCls}>Enlace al que navega</span>
                <input name="enlace" defaultValue={paso?.enlace ?? ''} placeholder="/ordenes-insumo" className={inputCls + ' mt-1'} /></label>
            </div>
          )}

          {/* Webhook */}
          {tipo === 'WEBHOOK' && (
            <label className="block"><span className={labelCls}>URL del webhook *</span>
              <input name="webhook_url" defaultValue={paso?.webhook_url ?? ''} placeholder="https://…" className={inputCls + ' mt-1'} />
              <span className="font-body text-[11px] text-gray-400">Se envía un POST con el payload del evento.</span>
            </label>
          )}

          {/* Destinatarios */}
          {(tipo === 'EMAIL' || tipo === 'APP') && (
            <div className="border border-gray-100 rounded-xl p-3 space-y-3">
              <span className={labelCls}>¿A quién se le avisa?</span>

              <div>
                <p className="font-body text-[11px] text-gray-400 mb-1">Por rol</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {ROLES.map((r) => (
                    <label key={r} className="flex items-center gap-2 font-body text-xs text-gray-700">
                      <input type="checkbox" checked={dest.roles.includes(r)} onChange={() => alternarRol(r)}
                        className="accent-brand-green w-3.5 h-3.5" />
                      {r}
                    </label>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="font-body text-[11px] text-gray-400">Personas concretas</span>
                <select multiple value={dest.usuarios} size={4}
                  onChange={(e) => setDest((d) => ({ ...d, usuarios: [...e.target.selectedOptions].map((o) => o.value) }))}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 font-body text-xs mt-1">
                  {usuarios.map((u) => (
                    <option key={u.id} value={u.id}>{u.nombre} · {u.email ?? 'sin correo'}</option>
                  ))}
                </select>
              </label>

              {tipo === 'EMAIL' && (
                <>
                  <label className="block">
                    <span className="font-body text-[11px] text-gray-400">Correos fijos (separados por coma)</span>
                    <input value={dest.correos.join(', ')}
                      onChange={(e) => setDest((d) => ({ ...d, correos: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))}
                      placeholder="gerencia@empresa.com, calidad@empresa.com" className={inputCls + ' mt-1'} />
                  </label>
                  <label className="block">
                    <span className="font-body text-[11px] text-gray-400">
                      Correo tomado del evento (nombre del campo, p. ej. el correo del cliente)
                    </span>
                    <input value={dest.campos.join(', ')}
                      onChange={(e) => setDest((d) => ({ ...d, campos: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))}
                      placeholder="cliente_email" className={inputCls + ' mt-1'} />
                    {variables.length > 0 && (
                      <span className="font-body text-[11px] text-gray-400">
                        Campos disponibles: {variables.map((v) => v.clave).join(', ')}
                      </span>
                    )}
                  </label>
                </>
              )}
            </div>
          )}

          {/* Verificación: "si sigue pasando…" */}
          <div className="border border-gray-100 rounded-xl p-3 space-y-3">
            <label className="flex items-center gap-2 font-body text-xs text-gray-700">
              <input type="checkbox" checked={usaVerif} onChange={(e) => setUsaVerif(e.target.checked)}
                className="accent-brand-green w-4 h-4" />
              Antes de ejecutar, comprobar que la situación sigue igual
            </label>
            <p className="font-body text-[11px] text-gray-400">
              Es lo que convierte una espera en un escalamiento: se relee el registro en la base de datos y el paso
              solo continúa si la condición se mantiene. Ejemplo: <em>ordenes_insumo.estado sigue siendo PENDIENTE</em>.
            </p>

            {usaVerif && (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <label><span className="font-body text-[11px] text-gray-400">Tabla</span>
                    <input value={verif.tabla ?? ''} onChange={(e) => setVerif((v) => ({ ...v, tabla: e.target.value }))}
                      placeholder="ordenes_insumo" className={inputCls + ' mt-1'} /></label>
                  <label><span className="font-body text-[11px] text-gray-400">Columna identificadora</span>
                    <input value={verif.columna_id ?? ''} onChange={(e) => setVerif((v) => ({ ...v, columna_id: e.target.value }))}
                      placeholder="id" className={inputCls + ' mt-1'} /></label>
                  <label><span className="font-body text-[11px] text-gray-400">Campo del evento con ese identificador</span>
                    <input value={verif.campo_payload ?? ''} onChange={(e) => setVerif((v) => ({ ...v, campo_payload: e.target.value }))}
                      placeholder="orden_id" className={inputCls + ' mt-1'} /></label>
                  <label><span className="font-body text-[11px] text-gray-400">Campo a revisar</span>
                    <input value={verif.campo ?? ''} onChange={(e) => setVerif((v) => ({ ...v, campo: e.target.value }))}
                      placeholder="estado" className={inputCls + ' mt-1'} /></label>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <select value={verif.operador ?? '='} onChange={(e) => setVerif((v) => ({ ...v, operador: e.target.value as OperadorCondicion }))}
                    className="border border-gray-200 rounded-lg px-2 py-2 font-body text-xs bg-white">
                    {OPERADORES.map((op) => <option key={op} value={op}>{OPERADOR_LABELS[op]}</option>)}
                  </select>
                  <input value={verif.valor ?? ''} onChange={(e) => setVerif((v) => ({ ...v, valor: e.target.value }))}
                    placeholder="PENDIENTE" className="flex-1 min-w-[120px] border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green" />
                </div>
                <label className="flex items-center gap-2 font-body text-xs text-gray-700">
                  <input type="checkbox" name="detener_si_falla" defaultChecked={paso?.detener_si_falla ?? true}
                    className="accent-brand-green w-4 h-4" />
                  Si ya no se cumple, cancelar también los pasos siguientes
                </label>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 font-body text-xs text-gray-700">
            <input type="checkbox" name="activo" defaultChecked={paso?.activo ?? true} className="accent-brand-green w-4 h-4" />
            Paso activo
          </label>

          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            <GuardarBtn />
            <button type="button" onClick={onCerrar} className="font-body text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  )
}
