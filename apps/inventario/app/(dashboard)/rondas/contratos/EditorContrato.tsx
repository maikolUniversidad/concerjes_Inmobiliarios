'use client'

import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import { Loader2, Save, Plus, Trash2, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { DeleteButton } from '@/components/ui/DeleteButton'
import {
  ESTADO_META, ESTADOS_CONTRATO, SERVICIO_LABEL, SERVICIOS_CONTRATO,
  TIPO_VIGENCIA_LABEL, TIPOS_VIGENCIA, diasParaVencer, estaVigente, fechaCorta,
  motivoNoVigente, textoVigencia,
  type ContratoFila, type ReglasContrato, type VigenciaFila,
} from '@/lib/contratos-conserjeria'
import {
  agregarVigencia, eliminarVigencia, guardarContrato, guardarReglas, guardarServicios,
  type ActionResult,
} from './actions'

const INICIAL: ActionResult = {}

function Guardar({ label = 'Guardar' }: { label?: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
      {label}
    </button>
  )
}

/** Avisa con un toast cuando la acción termina. */
function useAviso(estado: ActionResult, exito: string) {
  useEffect(() => {
    if (estado.error) toast.error(estado.error)
    else if (estado.ok) toast.success(exito)
  }, [estado, exito])
}

const campo = 'w-full rounded-lg border border-gray-200 px-3 py-2 font-body text-sm focus:border-brand-green focus:outline-none disabled:bg-gray-50 disabled:text-gray-500'
const etiqueta = 'font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400'
const tarjeta = 'rounded-lg border border-gray-200 bg-white p-4 sm:p-5 space-y-4'

export function EditorContrato({
  contrato, periodos, reglas, reglasExisten, clientes, puedeGestionar,
}: {
  contrato: ContratoFila
  periodos: VigenciaFila[]
  reglas: ReglasContrato
  reglasExisten: boolean
  clientes: { id: string; nombre: string }[]
  puedeGestionar: boolean
}) {
  const [estDatos, accDatos] = useActionState(guardarContrato, INICIAL)
  const [estServ, accServ] = useActionState(guardarServicios, INICIAL)
  const [estReglas, accReglas] = useActionState(guardarReglas, INICIAL)
  const [estVig, accVig] = useActionState(agregarVigencia, INICIAL)
  useAviso(estDatos, 'Contrato guardado')
  useAviso(estServ, 'Servicios guardados')
  useAviso(estReglas, 'Reglas guardadas')
  useAviso(estVig, 'Periodo agregado')

  const vigente = estaVigente(contrato, periodos)
  const motivo = motivoNoVigente(contrato, periodos)
  const dias = diasParaVencer(contrato, periodos)
  const meta = ESTADO_META[contrato.estado]
  const soloLectura = !puedeGestionar

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">{contrato.nombre}</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            {contrato.codigo}
            {contrato.numero ? ` · contrato nº ${contrato.numero}` : ''}
            {contrato.cliente_nombre ? ` · ${contrato.cliente_nombre}` : ''}
            {` · ${contrato.sedes} sedes`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 font-body text-xs font-semibold ${meta.badge}`}>
            {meta.label}
          </span>
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 font-body text-xs font-semibold ${
            vigente ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {vigente ? 'Vigente hoy' : 'No vigente hoy'}
          </span>
        </div>
      </div>

      {!vigente && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 font-body text-sm text-amber-800">
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <strong>Hoy no está vigente{motivo ? `: ${motivo}` : ''}.</strong>{' '}
            Mientras no lo esté, sus QR no abren visitas y sus puntos se ven en gris. No se apaga
            ningún QR: la vigencia se calcula al escanear, así que al renovar vuelven a servir sin
            tocar nada.
          </span>
        </p>
      )}

      {/* ── Datos y vigencia ─────────────────────────────────────────────── */}
      <form action={accDatos} className={tarjeta}>
        <input type="hidden" name="id" value={contrato.id} />
        <h2 className="font-heading font-semibold text-gray-900">Datos y vigencia</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1">
            <span className={etiqueta}>Nombre</span>
            <input name="nombre" defaultValue={contrato.nombre} className={campo}
              disabled={soloLectura} required minLength={3} />
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Número del contrato del cliente</span>
            <input name="numero" defaultValue={contrato.numero ?? ''} className={campo}
              disabled={soloLectura} placeholder="el del documento firmado" />
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Cliente</span>
            <select name="cliente_id" defaultValue={contrato.cliente_id ?? ''} className={campo}
              disabled={soloLectura}>
              <option value="">Sin cliente</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              {/* En solo lectura no llega el catálogo: se pinta el cliente que
                  tiene, y solo si no vino ya en la lista. */}
              {contrato.cliente_id && !clientes.some((c) => c.id === contrato.cliente_id) && (
                <option value={contrato.cliente_id}>{contrato.cliente_nombre}</option>
              )}
            </select>
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Estado</span>
            <select name="estado" defaultValue={contrato.estado} className={campo} disabled={soloLectura}>
              {ESTADOS_CONTRATO.map((e) => (
                <option key={e} value={e}>{ESTADO_META[e].label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Vigencia desde</span>
            <input type="date" name="vigencia_desde" defaultValue={contrato.vigencia_desde ?? ''}
              className={campo} disabled={soloLectura} />
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Vigencia hasta</span>
            <input type="date" name="vigencia_hasta" defaultValue={contrato.vigencia_hasta ?? ''}
              className={campo} disabled={soloLectura} />
            <span className="font-body text-xs text-gray-400">
              Vacío = sin fecha de fin pactada.
            </span>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className={etiqueta}>Objeto del contrato</span>
            {/* Un textarea deshabilitado recorta el objeto sin avisar (en móvil
                caben dos líneas) y no se puede enfocar para desplazarlo, así
                que en solo lectura se pinta el texto entero. */}
            {soloLectura ? (
              <p className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-body text-sm text-gray-500">
                {contrato.objeto || 'Sin objeto registrado'}
              </p>
            ) : (
              <textarea name="objeto" defaultValue={contrato.objeto ?? ''} rows={3}
                className={campo} />
            )}
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Color del arte</span>
            <input name="arte_color" defaultValue={contrato.arte_color ?? ''} className={campo}
              disabled={soloLectura} placeholder="p. ej. #1F7A45" />
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Idioma de los informes</span>
            <input name="idioma_reportes" defaultValue={contrato.idioma_reportes} className={campo}
              disabled={soloLectura} maxLength={5} />
          </label>
        </div>

        <p className="font-body text-xs text-gray-500">
          Vigencia efectiva: <strong>{textoVigencia(contrato, periodos)}</strong>
          {dias !== null && ` · ${dias >= 0 ? `faltan ${dias} días` : `venció hace ${-dias} días`}`}
          {periodos.length > 0 && ' · incluye las prórrogas de abajo'}
        </p>

        {puedeGestionar && <Guardar />}
      </form>

      {/* ── Servicios ────────────────────────────────────────────────────── */}
      <form action={accServ} className={tarjeta}>
        <input type="hidden" name="id" value={contrato.id} />
        <div>
          <h2 className="font-heading font-semibold text-gray-900">Servicios contratados</h2>
          <p className="font-body text-sm text-gray-500">
            El módulo solo ofrece los flujos de los servicios que estén activos.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {SERVICIOS_CONTRATO.map((s) => (
            <label key={s} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
              <input type="checkbox" name="servicio" value={s} disabled={soloLectura}
                defaultChecked={contrato.servicios.includes(s)}
                className="h-4 w-4 rounded border-gray-300 text-brand-green" />
              <span className="font-body text-sm text-gray-700">{SERVICIO_LABEL[s]}</span>
            </label>
          ))}
        </div>
        {puedeGestionar && <Guardar label="Guardar servicios" />}
      </form>

      {/* ── Reglas ───────────────────────────────────────────────────────── */}
      <form action={accReglas} className={tarjeta}>
        <input type="hidden" name="id" value={contrato.id} />
        <div>
          <h2 className="font-heading font-semibold text-gray-900">Reglas del contrato</h2>
          <p className="font-body text-sm text-gray-500">
            Parámetros, no código: lo que se cambie aquí manda sobre la operación de este contrato.
            {!reglasExisten && ' Todavía no hay reglas guardadas: lo que se ve son los valores por defecto.'}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1">
            <span className={etiqueta}>Retención de evidencia (meses)</span>
            <input type="number" name="retencion_evidencia_meses" min={1} max={120}
              defaultValue={reglas.retencion_evidencia_meses} className={campo} disabled={soloLectura} />
            <span className="font-body text-xs text-gray-400">
              Por defecto 12. Aplica a fotos, audio y ubicación.
            </span>
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Geocerca por defecto (metros)</span>
            <input type="number" name="geocerca_radio_m" min={5} max={5000}
              defaultValue={reglas.geocerca_radio_m} className={campo} disabled={soloLectura} />
            <span className="font-body text-xs text-gray-400">
              Cada punto la puede ajustar.
            </span>
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Mensajería desde</span>
            <input type="time" name="mensajeria_desde" defaultValue={reglas.mensajeria_desde?.slice(0, 5) ?? ''}
              className={campo} disabled={soloLectura} />
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Mensajería hasta</span>
            <input type="time" name="mensajeria_hasta" defaultValue={reglas.mensajeria_hasta?.slice(0, 5) ?? ''}
              className={campo} disabled={soloLectura} />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className={etiqueta}>Nivel de rigor antifraude</span>
            <input name="nivel_antifraude" defaultValue={reglas.nivel_antifraude ?? ''}
              className={campo} disabled={soloLectura} />
            <span className="font-body text-xs text-amber-700">
              Texto libre por ahora: los niveles los define el complemento 1, que todavía no ha
              llegado. Cuando llegue, este campo pasa a ser una lista cerrada.
            </span>
          </label>
        </div>

        <div className="space-y-2">
          {([
            ['permite_whatsapp', 'Permite WhatsApp', reglas.permite_whatsapp,
              'Sin esto, el bot no escribe a nadie de este contrato.'],
            ['pqrs_publico', 'PQRS pública por el QR', reglas.pqrs_publico,
              'Quien escanee sin sesión puede radicar una PQRS del punto.'],
            ['comparte_seguimiento_vivo', 'El cliente ve la ubicación en vivo', reglas.comparte_seguimiento_vivo,
              'Es el dato más sensible del módulo: por defecto está apagado.'],
          ] as const).map(([name, label, valor, nota]) => (
            <label key={name} className="flex items-start gap-2">
              <input type="checkbox" name={name} defaultChecked={valor} disabled={soloLectura}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-green" />
              <span>
                <span className="font-body text-sm text-gray-700">{label}</span>
                <span className="block font-body text-xs text-gray-400">{nota}</span>
              </span>
            </label>
          ))}
        </div>

        {puedeGestionar && <Guardar label="Guardar reglas" />}
      </form>

      {/* ── Prórrogas ────────────────────────────────────────────────────── */}
      <div className={tarjeta}>
        <div>
          <h2 className="font-heading font-semibold text-gray-900">Periodos, prórrogas y renovaciones</h2>
          <p className="font-body text-sm text-gray-500">
            Renovar agrega un periodo; nunca se pisa el histórico. El fin de la vigencia es el más
            tardío de todos.
          </p>
        </div>

        {periodos.length === 0 ? (
          <p className="font-body text-sm text-gray-400">
            Sin periodos registrados: manda la vigencia de arriba.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {periodos.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div>
                  <p className="font-body text-sm text-gray-800">
                    {TIPO_VIGENCIA_LABEL[p.tipo]} · {fechaCorta(p.desde)} → {p.hasta ? fechaCorta(p.hasta) : 'sin fin'}
                  </p>
                  {p.motivo && <p className="font-body text-xs text-gray-400">{p.motivo}</p>}
                </div>
                {puedeGestionar && (
                  <DeleteButton
                    action={eliminarVigencia}
                    id={p.id}
                    mensaje="Se borra el periodo y la vigencia vuelve a calcularse sin él. ¿Seguir?"
                    className="text-gray-400 hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </DeleteButton>
                )}
              </li>
            ))}
          </ul>
        )}

        {puedeGestionar && (
          <form action={accVig} className="grid gap-3 border-t border-gray-100 pt-4 sm:grid-cols-5 sm:items-end">
            <input type="hidden" name="id" value={contrato.id} />
            <label className="space-y-1">
              <span className={etiqueta}>Tipo</span>
              <select name="tipo" defaultValue="PRORROGA" className={campo}>
                {TIPOS_VIGENCIA.map((t) => <option key={t} value={t}>{TIPO_VIGENCIA_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Desde</span>
              <input type="date" name="desde" className={campo} required />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Hasta</span>
              <input type="date" name="hasta" className={campo} />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Motivo</span>
              <input name="motivo" className={campo} placeholder="opcional" />
            </label>
            <AgregarPeriodo />
          </form>
        )}
      </div>
    </div>
  )
}

function AgregarPeriodo() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-brand-green px-3 py-2 font-body text-sm font-semibold text-brand-green disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
      Agregar
    </button>
  )
}
