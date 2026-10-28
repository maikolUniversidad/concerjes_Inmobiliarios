'use client'

import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import {
  Send, Users, AlertTriangle, CheckCircle2, Clock, Ban, ListOrdered, Timer,
  Calculator, Search, ShieldAlert, Trash2, Plus, Eye,
} from 'lucide-react'
import {
  crearEnvio, calcularAudiencia, aprobarEnvio, cancelarEnvio, destinosDeEnvio,
  guardarOpcionMenu, borrarOpcionMenu, type DestinoFila,
} from './actions'
import { duracionEnPalabras } from '@/lib/envios/ritmo'
import { leerResumen, marcadoresDesconocidos, MOTIVO_EXCLUSION } from '@/lib/envios/audiencia'
import { dentroDeFranja, franjaEnPalabras, siguienteApertura } from '@/lib/envios/jornada'

/* ── Tipos de las filas que trae la página ────────────────────────────────── */

export interface EnvioResumen {
  envio_id: string
  grupo_id: string
  contrato: string | null
  nombre: string
  tipo: string
  estado: string
  es_emergencia: boolean
  plantilla_nombre: string | null
  prioridad: number
  programado_para: string | null
  total_destinos: number
  total_excluidos: number
  costo_estimado: string | number | null
  moneda: string
  created_at: string
  iniciado_at: string | null
  terminado_at: string | null
  pendientes: number
  aplazados: number
  encolados: number
  enviados: number
  entregados: number
  leidos: number
  respondidos: number
  fallidos: number
  omitidos: number
  excluidos: number
  cancelados: number
  en_emergencia: number
}

export interface OpcionMenu {
  id: string
  grupo_id: string | null
  cargo: string | null
  orden: number
  etiqueta: string
  descripcion: string | null
  accion: string
  texto: string | null
  requiere_permiso: string | null
  activo: boolean
}

export interface ContratoFila {
  id: string
  codigo: string
  nombre: string
  estado: string
  reglas: { permite_whatsapp: boolean; mensajeria_desde: string | null; mensajeria_hasta: string | null } | null
}

export interface SedeFila { id: string; nombre: string; grupo_id: string | null }
export interface PlantillaFila {
  id: string
  nombre: string
  categoria: string
  estado: string
  cuerpo: string
  variables: { pos: number; ejemplo?: string; descripcion?: string }[]
}
export interface CargoFila { cargo: string; grupo_id: string; personas: number; alcanzables: number }

/* ── Ayudas de presentación ───────────────────────────────────────────────── */

const tarjeta = 'rounded-xl border border-gray-200 bg-white p-4'
const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-[11px] font-semibold'
const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'
const labelCls = 'font-body text-xs font-semibold text-gray-500'

/** Un número de WhatsApp nunca se muestra completo: es dato personal, y quien
 *  mira el tablero no necesita el número para hacer su trabajo. Es la misma
 *  decisión que tomó la pantalla del bot en F9. */
function numeroCorto(valor: string | null): string {
  if (!valor) return '—'
  const n = valor.replace(/[^0-9]/g, '')
  if (n.length <= 6) return '••••'
  return `${n.slice(0, 2)}•••••${n.slice(-3)}`
}

function hora(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'America/Bogota',
  })
}

const COLOR_ESTADO: Record<string, string> = {
  BORRADOR: 'bg-gray-100 text-gray-700',
  CALCULADO: 'bg-amber-50 text-amber-700',
  APROBADO: 'bg-blue-50 text-blue-700',
  EN_CURSO: 'bg-blue-50 text-blue-700',
  COMPLETADO: 'bg-emerald-50 text-emerald-700',
  CANCELADO: 'bg-gray-100 text-gray-500',
  PENDIENTE: 'bg-amber-50 text-amber-700',
  APLAZADO: 'bg-orange-50 text-orange-700',
  ENCOLADO: 'bg-amber-50 text-amber-700',
  ENVIADO: 'bg-blue-50 text-blue-700',
  ENTREGADO: 'bg-blue-50 text-blue-700',
  LEIDO: 'bg-emerald-50 text-emerald-700',
  RESPONDIDO: 'bg-emerald-50 text-emerald-700',
  FALLIDO: 'bg-red-50 text-red-700',
  OMITIDO: 'bg-orange-50 text-orange-700',
  EXCLUIDO: 'bg-gray-100 text-gray-500',
}
const color = (e: string) => COLOR_ESTADO[e] ?? 'bg-gray-100 text-gray-700'

const ACCIONES_MENU: { valor: string; label: string }[] = [
  { valor: 'MIS_PUNTOS', label: 'Mis puntos de hoy' },
  { valor: 'PROXIMA_UBICACION', label: 'Mi próximo punto (ruta de hoy)' },
  { valor: 'NOVEDAD', label: 'Reportar una novedad' },
  { valor: 'SUPERVISOR', label: 'Hablar con el supervisor' },
  { valor: 'PRIVACIDAD', label: 'Mis permisos de datos' },
  { valor: 'AYUDA', label: 'Ayuda' },
  { valor: 'TEXTO', label: 'Un texto fijo' },
  { valor: 'MI_MAPA', label: 'Ver mi mapa (todavía no disponible)' },
  { valor: 'PQRS', label: 'Radicar una PQRS (todavía no disponible)' },
]

/* ── La pantalla ──────────────────────────────────────────────────────────── */

export function EnviosClient({
  envios, menu, contratos, sedes, plantillas, cargos,
  simulador, caudalMps, puedeGestionar, puedeMenu, puedeEmergencia,
}: {
  envios: EnvioResumen[]
  menu: OpcionMenu[]
  contratos: ContratoFila[]
  sedes: SedeFila[]
  plantillas: PlantillaFila[]
  cargos: CargoFila[]
  simulador: boolean
  caudalMps: number
  puedeGestionar: boolean
  puedeMenu: boolean
  puedeEmergencia: boolean
}) {
  const [pestana, setPestana] = useState<'envios' | 'nuevo' | 'menu'>('envios')

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-gray-900">Envíos masivos de WhatsApp</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            Un mensaje <strong>por persona</strong>, nunca a un grupo, al ritmo que admite el número
            ({caudalMps} mensajes por segundo) y solo dentro de la jornada de cada contrato.
          </p>
        </div>
        {simulador && (
          <span className={`${chip} bg-violet-50 text-violet-700`}>
            <ShieldAlert className="w-3.5 h-3.5" /> Simulador activo: nada sale a un teléfono
          </span>
        )}
      </header>

      <nav className="flex gap-1 border-b border-gray-200">
        {([
          ['envios', 'Envíos', envios.length],
          ['nuevo', 'Nuevo envío', null],
          ['menu', 'Menú del bot', menu.filter((m) => m.activo).length],
        ] as const).map(([id, label, n]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPestana(id as typeof pestana)}
            className={`px-3 py-2 font-body text-sm border-b-2 -mb-px ${
              pestana === id
                ? 'border-brand-green text-brand-green font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
            {n !== null && n > 0 && <span className="ml-1 text-xs text-gray-400">({n})</span>}
          </button>
        ))}
      </nav>

      {pestana === 'envios' && (
        <ListaEnvios envios={envios} caudalMps={caudalMps} puedeGestionar={puedeGestionar} />
      )}
      {pestana === 'nuevo' && (
        <NuevoEnvio
          contratos={contratos}
          sedes={sedes}
          plantillas={plantillas}
          cargos={cargos}
          caudalMps={caudalMps}
          puedeGestionar={puedeGestionar}
          puedeEmergencia={puedeEmergencia}
        />
      )}
      {pestana === 'menu' && (
        <MenuDelBot menu={menu} contratos={contratos} cargos={cargos} puedeMenu={puedeMenu} />
      )}
    </div>
  )
}

/* ── Pestaña 1: los envíos ────────────────────────────────────────────────── */

function ListaEnvios({
  envios, caudalMps, puedeGestionar,
}: { envios: EnvioResumen[]; caudalMps: number; puedeGestionar: boolean }) {
  const [abierto, setAbierto] = useState<string | null>(null)
  const [destinos, setDestinos] = useState<DestinoFila[]>([])
  const [filtro, setFiltro] = useState<string>('')
  const [cargando, setCargando] = useState(false)
  const [pendiente, empezar] = useTransition()

  async function ver(envioId: string, estado?: string) {
    setAbierto(envioId)
    setCargando(true)
    const r = await destinosDeEnvio(envioId, { estado: estado || null, limite: 100 })
    setCargando(false)
    if (r.error) {
      toast.error(r.error)
      return
    }
    setDestinos(r.filas ?? [])
  }

  function accion(fn: () => Promise<{ error?: string; ok?: boolean }>, exito: string) {
    empezar(async () => {
      const r = await fn()
      if (r.error) toast.error(r.error)
      else toast.success(exito)
    })
  }

  if (!envios.length) {
    return (
      <div className={`${tarjeta} text-center py-10`}>
        <Send className="w-8 h-8 text-gray-300 mx-auto" />
        <p className="font-body text-sm text-gray-500 mt-2">
          Todavía no hay envíos. En «Nuevo envío» se arma la audiencia y se ve a cuántas personas
          le llegaría antes de confirmar nada.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {envios.map((e) => {
        const pendientesDeSalir = e.pendientes + e.aplazados + e.encolados
        return (
          <div key={e.envio_id} className={tarjeta}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="font-display text-base text-gray-900 truncate">{e.nombre}</h2>
                  <span className={`${chip} ${color(e.estado)}`}>{e.estado}</span>
                  {e.es_emergencia && (
                    <span className={`${chip} bg-red-50 text-red-700`}>
                      <AlertTriangle className="w-3 h-3" /> emergencia
                    </span>
                  )}
                </div>
                <p className="font-body text-xs text-gray-500 mt-0.5">
                  {e.contrato ?? 'sin contrato'} · {e.tipo.toLowerCase()} · prioridad {e.prioridad}
                  {e.plantilla_nombre ? ` · plantilla ${e.plantilla_nombre}` : ' · texto libre'}
                </p>
                <p className="font-body text-xs text-gray-400 mt-0.5">
                  Creado {hora(e.created_at)}
                  {e.programado_para ? ` · programado ${hora(e.programado_para)}` : ''}
                  {e.total_destinos > 0 ? ` · ${duracionEnPalabras(e.total_destinos, caudalMps)} al caudal del número` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => ver(e.envio_id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 font-body text-xs text-gray-700 hover:bg-gray-50"
                >
                  <Eye className="w-3.5 h-3.5" /> Ver destinatarios
                </button>
                {puedeGestionar && e.estado === 'CALCULADO' && (
                  <button
                    type="button"
                    disabled={pendiente}
                    onClick={() => accion(() => aprobarEnvio(e.envio_id), 'Envío aprobado y programado.')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand-green text-white font-body text-xs font-semibold disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Aprobar y programar
                  </button>
                )}
                {puedeGestionar && ['BORRADOR', 'CALCULADO'].includes(e.estado) && (
                  <button
                    type="button"
                    disabled={pendiente}
                    onClick={() => accion(() => calcularAudiencia(e.envio_id), 'Audiencia recalculada.')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 font-body text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Calculator className="w-3.5 h-3.5" /> Recalcular
                  </button>
                )}
                {puedeGestionar && !['COMPLETADO', 'CANCELADO'].includes(e.estado) && (
                  <button
                    type="button"
                    disabled={pendiente}
                    onClick={() => {
                      const motivo = window.prompt('¿Por qué se cancela el envío?')
                      if (motivo === null) return
                      accion(() => cancelarEnvio(e.envio_id, motivo), 'Envío cancelado.')
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-200 font-body text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Ban className="w-3.5 h-3.5" /> Cancelar
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-3">
              <Dato n={e.total_destinos} l="destinatarios" />
              <Dato n={pendientesDeSalir} l="por salir" tono={pendientesDeSalir > 0 ? 'naranja' : undefined} />
              <Dato n={e.enviados + e.entregados + e.leidos + e.respondidos} l="salieron" />
              <Dato n={e.leidos + e.respondidos} l="leídos" />
              <Dato n={e.omitidos + e.fallidos} l="no salieron" tono={e.omitidos + e.fallidos > 0 ? 'rojo' : undefined} />
              <Dato n={e.excluidos} l="fuera de audiencia" />
            </div>

            {e.aplazados > 0 && (
              <p className="font-body text-xs text-orange-700 bg-orange-50 border border-orange-100 rounded-lg px-2 py-1.5 mt-2 inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                {e.aplazados} {e.aplazados === 1 ? 'mensaje quedó' : 'mensajes quedaron'} fuera de la
                jornada y {e.aplazados === 1 ? 'espera' : 'esperan'} la siguiente ventana hábil.
              </p>
            )}
            {e.costo_estimado != null && (
              <p className="font-body text-xs text-gray-500 mt-2">
                Costo estimado: {Number(e.costo_estimado).toLocaleString('es-CO')} {e.moneda}
              </p>
            )}

            {abierto === e.envio_id && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <div className="flex items-center gap-2 mb-2">
                  <Search className="w-3.5 h-3.5 text-gray-400" />
                  <select
                    value={filtro}
                    onChange={(ev) => {
                      setFiltro(ev.target.value)
                      ver(e.envio_id, ev.target.value)
                    }}
                    className="border border-gray-200 rounded-lg px-2 py-1 font-body text-xs bg-white"
                  >
                    <option value="">Todos los estados</option>
                    {['PENDIENTE', 'APLAZADO', 'ENCOLADO', 'ENVIADO', 'ENTREGADO', 'LEIDO',
                      'RESPONDIDO', 'OMITIDO', 'FALLIDO', 'EXCLUIDO', 'CANCELADO'].map((x) => (
                      <option key={x} value={x}>{x}</option>
                    ))}
                  </select>
                  <span className="font-body text-[11px] text-gray-400">
                    se muestran hasta 100 filas; los totales de arriba están contados en la base
                  </span>
                </div>
                {cargando ? (
                  <p className="font-body text-xs text-gray-400">Cargando…</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="font-body text-[11px] text-gray-400 uppercase">
                          <th className="py-1 pr-3">Persona</th>
                          <th className="py-1 pr-3">Número</th>
                          <th className="py-1 pr-3">Estado</th>
                          <th className="py-1 pr-3">Hora</th>
                          <th className="py-1">Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {destinos.map((d) => (
                          <tr key={d.id} className="border-t border-gray-100 font-body text-xs text-gray-700">
                            <td className="py-1.5 pr-3">
                              {d.persona ? `${d.persona.nombres} ${d.persona.apellidos}` : '—'}
                              {d.persona?.cargo && (
                                <span className="text-gray-400"> · {d.persona.cargo}</span>
                              )}
                            </td>
                            <td className="py-1.5 pr-3 tabular-nums text-gray-500">{numeroCorto(d.canal_valor)}</td>
                            <td className="py-1.5 pr-3">
                              <span className={`${chip} ${color(d.estado)}`}>{d.estado}</span>
                              {d.es_emergencia && <span className="ml-1 text-red-600">⚠</span>}
                            </td>
                            <td className="py-1.5 pr-3 text-gray-500">
                              {hora(d.enviado_at ?? d.programado_para)}
                              {d.aplazos > 0 && <span className="text-orange-600"> ·{d.aplazos}×</span>}
                            </td>
                            <td className="py-1.5 text-gray-500">
                              {d.exclusion_motivo
                                ? MOTIVO_EXCLUSION[d.exclusion_motivo] ?? d.exclusion_motivo
                                : d.omitido_motivo ?? d.error ?? ''}
                            </td>
                          </tr>
                        ))}
                        {!destinos.length && (
                          <tr>
                            <td colSpan={5} className="py-3 font-body text-xs text-gray-400">
                              No hay destinatarios con ese estado.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ── Pestaña 2: armar un envío ────────────────────────────────────────────── */

function NuevoEnvio({
  contratos, sedes, plantillas, cargos, caudalMps, puedeGestionar, puedeEmergencia,
}: {
  contratos: ContratoFila[]
  sedes: SedeFila[]
  plantillas: PlantillaFila[]
  cargos: CargoFila[]
  caudalMps: number
  puedeGestionar: boolean
  puedeEmergencia: boolean
}) {
  const [grupo, setGrupo] = useState<string>('')
  const [alcance, setAlcance] = useState<'CONTRATO' | 'SEDES' | 'PERSONAS' | 'LISTA'>('CONTRATO')
  const [emergencia, setEmergencia] = useState(false)
  const [plantilla, setPlantilla] = useState<string>('')
  const [resumen, setResumen] = useState<Record<string, unknown> | null>(null)
  const [envioId, setEnvioId] = useState<string | null>(null)
  const [cuando, setCuando] = useState<string>('')
  const [mensaje, setMensaje] = useState<string>('')
  const [pendiente, empezar] = useTransition()

  const contrato = contratos.find((c) => c.id === grupo) ?? null
  const sedesDelContrato = useMemo(() => sedes.filter((s) => s.grupo_id === grupo), [sedes, grupo])
  const cargosDelContrato = useMemo(
    () => cargos.filter((c) => c.grupo_id === grupo).sort((a, b) => b.alcanzables - a.alcanzables),
    [cargos, grupo],
  )
  const plantillaElegida = plantillas.find((p) => p.nombre === plantilla) ?? null
  const franja =
    contrato?.reglas?.mensajeria_desde && contrato?.reglas?.mensajeria_hasta
      ? { desde: contrato.reglas.mensajeria_desde, hasta: contrato.reglas.mensajeria_hasta }
      : null
  // Si no se eligió hora, el envío sale ahora: la previsualización usa eso.
  const momentoElegido = cuando ? new Date(cuando) : new Date()
  const marcadoresRaros = marcadoresDesconocidos(mensaje)

  if (!puedeGestionar) {
    return (
      <div className={tarjeta}>
        <p className="font-body text-sm text-gray-500">
          Para armar un envío hace falta el permiso de gestionar envíos masivos de WhatsApp.
        </p>
      </div>
    )
  }

  function enviarFormulario(fd: FormData) {
    empezar(async () => {
      const r = await crearEnvio(fd)
      if (r.error) {
        toast.error(r.error)
        return
      }
      setEnvioId(r.envioId ?? null)
      toast.success('Envío creado. Ahora se calcula a quién le llegaría.')
      if (r.envioId) {
        const a = await calcularAudiencia(r.envioId)
        if (a.error) toast.error(a.error)
        else setResumen(a.resumen ?? null)
      }
    })
  }

  const leido = leerResumen(resumen)
  const destinos = leido.destinos
  const excluidos = leido.excluidos

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
      <form action={enviarFormulario} className={`${tarjeta} space-y-4`}>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={labelCls}>Contrato *</span>
            <select
              name="grupo_id"
              value={grupo}
              onChange={(e) => setGrupo(e.target.value)}
              className={inputCls + ' mt-1 bg-white'}
            >
              <option value="">— Elegí el contrato —</option>
              {contratos.map((c) => (
                <option key={c.id} value={c.id} disabled={c.reglas?.permite_whatsapp === false}>
                  {c.nombre} ({c.codigo})
                  {c.reglas?.permite_whatsapp === false ? ' · sin WhatsApp habilitado' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Nombre del envío *</span>
            <input name="nombre" placeholder="Cambio de ingreso por obra" className={inputCls + ' mt-1'} />
          </label>
        </div>

        {franja && (
          <div className="font-body text-xs text-gray-500 space-y-1">
            <p className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-gray-400" />
              Jornada de mensajería de este contrato: {franjaEnPalabras(franja)}.
            </p>
            {/* La DECISIÓN de aplazar la toma la base; esto es el aviso previo,
                para que nadie confirme un envío creyendo que sale ya. */}
            {!dentroDeFranja(momentoElegido, franja) && !emergencia && (
              <p className="text-orange-700 bg-orange-50 border border-orange-100 rounded-lg px-2 py-1.5">
                A esa hora el contrato está fuera de jornada: el envío se aplazaría a la siguiente
                ventana, {hora(siguienteApertura(momentoElegido, franja).toISOString())}. Si no puede
                esperar, hace falta marcarlo como emergencia.
              </p>
            )}
          </div>
        )}

        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block">
            <span className={labelCls}>Tipo</span>
            <select name="tipo" className={inputCls + ' mt-1 bg-white'}>
              {['AVISO', 'RECORDATORIO', 'INSTRUCCION', 'CONVOCATORIA', 'EMERGENCIA'].map((t) => (
                <option key={t} value={t}>{t.toLowerCase()}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>A quién</span>
            <select
              name="alcance"
              value={alcance}
              onChange={(e) => setAlcance(e.target.value as typeof alcance)}
              className={inputCls + ' mt-1 bg-white'}
            >
              <option value="CONTRATO">Todo el contrato</option>
              <option value="SEDES">Sedes concretas</option>
              <option value="PERSONAS">Personas sueltas</option>
              <option value="LISTA">Una lista del directorio</option>
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Turno</span>
            <select name="turno" className={inputCls + ' mt-1 bg-white'}>
              <option value="CUALQUIERA">Sin importar el turno</option>
              <option value="EN_TURNO">Solo quien está en turno ahora</option>
              <option value="FUERA_TURNO">Solo quien no está en turno</option>
            </select>
          </label>
        </div>

        {alcance === 'SEDES' && (
          <label className="block">
            <span className={labelCls}>Sedes *</span>
            <select name="sedes" multiple size={5} className={inputCls + ' mt-1'}>
              {sedesDelContrato.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
            {!sedesDelContrato.length && (
              <span className="font-body text-[11px] text-gray-400">Elegí primero el contrato.</span>
            )}
          </label>
        )}

        {alcance === 'LISTA' && (
          <label className="block">
            <span className={labelCls}>Código de la lista del directorio *</span>
            <input name="lista" placeholder="SUPERVISORES" className={inputCls + ' mt-1'} />
            <span className="font-body text-[11px] text-gray-400">
              Se cruza por teléfono con los números de WhatsApp verificados: un contacto de la
              lista que no corresponde a una persona con WhatsApp no recibe nada.
            </span>
          </label>
        )}

        {alcance === 'PERSONAS' && (
          <label className="block">
            <span className={labelCls}>Identificadores de personas (uno por línea) *</span>
            <textarea
              name="personas"
              rows={3}
              className={inputCls + ' mt-1 font-mono text-xs'}
              placeholder="uuid de cada persona"
            />
          </label>
        )}

        <div>
          <span className={labelCls}>Rol (cargo de la nómina) — opcional</span>
          <select name="cargos" multiple size={4} className={inputCls + ' mt-1'}>
            {cargosDelContrato.map((c) => (
              <option key={c.cargo} value={c.cargo}>
                {c.cargo} · {c.alcanzables} de {c.personas} con WhatsApp
              </option>
            ))}
          </select>
          <span className="font-body text-[11px] text-gray-400">
            Sin elegir nada entran todos los cargos. «Con WhatsApp» significa número verificado y
            permiso de mensajería vigente: el resto queda fuera con su motivo.
          </span>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={labelCls}>Plantilla aprobada en Meta</span>
            <select
              name="plantilla"
              value={plantilla}
              onChange={(e) => setPlantilla(e.target.value)}
              className={inputCls + ' mt-1 bg-white'}
            >
              <option value="">— Sin plantilla (solo dentro de la ventana de 24 h) —</option>
              {plantillas.map((p) => (
                <option key={p.id} value={p.nombre}>
                  {p.nombre} · {p.estado}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Costo por mensaje (opcional)</span>
            <input name="costo_unitario" type="number" step="0.0001" min="0" className={inputCls + ' mt-1'} />
            <span className="font-body text-[11px] text-gray-400">
              Se configura a mano: la tarifa no se consulta por API.
            </span>
          </label>
        </div>

        {plantillaElegida && plantillaElegida.estado !== 'APPROVED' && (
          <p className="font-body text-xs text-orange-700 bg-orange-50 border border-orange-100 rounded-lg px-2 py-1.5 inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Esa plantilla está {plantillaElegida.estado} en Meta: fuera de la ventana de 24 horas no
            va a salir, y cada mensaje quedará omitido con ese motivo.
          </p>
        )}
        {!plantilla && (
          <p className="font-body text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 inline-flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            Sin plantilla, el mensaje solo le llega a quien escribió en las últimas 24 horas. Para
            un aviso masivo eso casi nunca pasa.
          </p>
        )}

        <label className="block">
          <span className={labelCls}>Mensaje {plantilla ? '(lo que se ve en la consola)' : '*'}</span>
          <textarea
            name="texto"
            rows={3}
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            className={inputCls + ' mt-1'}
            placeholder="Hola {nombre}: mañana el ingreso a {sede} es por la puerta 2."
          />
          <span className="font-body text-[11px] text-gray-400">
            Marcadores: {'{nombre}'} {'{sede}'} {'{cargo}'} {'{contrato}'} {'{hora}'} {'{fecha}'}{' '}
            {'{punto}'} {'{punto_nombre}'}. Los dos últimos son la próxima parada de la ruta de hoy.
          </span>
          {marcadoresRaros.length > 0 && (
            <span className="font-body text-[11px] text-orange-700 block mt-1">
              Esto no es un marcador y va a salir tal cual:{' '}
              {marcadoresRaros.map((m) => `{${m}}`).join(', ')}
            </span>
          )}
        </label>

        {plantilla && (
          <label className="block">
            <span className={labelCls}>Variables de la plantilla (una por línea, en orden)</span>
            <textarea
              name="variables"
              rows={3}
              className={inputCls + ' mt-1 font-mono text-xs'}
              placeholder={'{nombre}\nMañana el ingreso es por la puerta 2.'}
            />
            {plantillaElegida && (
              <span className="font-body text-[11px] text-gray-400 block mt-1">
                Cuerpo: «{plantillaElegida.cuerpo}»
              </span>
            )}
          </label>
        )}

        <div className="grid sm:grid-cols-3 gap-3">
          <label className="block">
            <span className={labelCls}>Prioridad</span>
            <select name="prioridad" defaultValue="8" className={inputCls + ' mt-1 bg-white'}>
              <option value="7">7 · antes que el resto de lo masivo</option>
              <option value="8">8 · normal</option>
              <option value="9">9 · lo último</option>
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Empezar a enviar</span>
            <input
              name="programado"
              type="datetime-local"
              value={cuando}
              onChange={(e) => setCuando(e.target.value)}
              className={inputCls + ' mt-1'}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Ritmo (mensajes por segundo)</span>
            <input
              name="escalon_mps"
              type="number"
              min="0.1"
              max={caudalMps}
              step="0.1"
              placeholder={String(caudalMps)}
              className={inputCls + ' mt-1'}
            />
            <span className="font-body text-[11px] text-gray-400">
              Nunca por encima de {caudalMps}: es el tope del número.
            </span>
          </label>
        </div>

        {puedeEmergencia && (
          <div className="border border-red-100 bg-red-50/40 rounded-xl p-3 space-y-2">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                name="es_emergencia"
                checked={emergencia}
                onChange={(e) => setEmergencia(e.target.checked)}
                className="accent-red-600 w-4 h-4 mt-0.5"
              />
              <span className="font-body text-sm text-gray-800">
                Es una emergencia: puede salir fuera de la jornada
                <span className="block font-body text-xs text-gray-500">
                  Saltar la jornada es la excepción del art. 3 de la Ley 2191 de 2022. Queda
                  registrado tu nombre como quien lo autorizó, y cada destinatario queda marcado.
                </span>
              </span>
            </label>
            {emergencia && (
              <label className="block">
                <span className={labelCls}>Por qué es una emergencia *</span>
                <input
                  name="emergencia_motivo"
                  placeholder="Evacuación de la sede por emergencia de gas"
                  className={inputCls + ' mt-1'}
                />
              </label>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={pendiente}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-green text-white font-body text-sm font-semibold disabled:opacity-50"
        >
          <Calculator className="w-4 h-4" />
          {pendiente ? 'Calculando…' : 'Crear y calcular la audiencia'}
        </button>
        <p className="font-body text-xs text-gray-400">
          Crear el envío no le escribe a nadie: primero se calcula a quién le llegaría, y el envío
          sale cuando lo aprobás en la pestaña «Envíos».
        </p>
      </form>

      <aside className={`${tarjeta} h-fit space-y-3`}>
        <h3 className="font-display text-sm text-gray-900 inline-flex items-center gap-1.5">
          <Users className="w-4 h-4 text-gray-400" /> A quién le llegaría
        </h3>
        {!resumen ? (
          <p className="font-body text-xs text-gray-500">
            Armá el envío y se calcula acá: cuántas personas entran, cuántas quedan fuera y por
            qué, cuánto costaría y cuánto tardaría.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Dato n={destinos} l="les llega" />
              <Dato n={excluidos} l="quedan fuera" tono={excluidos > 0 ? 'naranja' : undefined} />
            </div>
            <p className="font-body text-xs text-gray-500 inline-flex items-center gap-1.5">
              <Timer className="w-3.5 h-3.5 text-gray-400" />
              {duracionEnPalabras(destinos, caudalMps)} en salir, al ritmo del número.
            </p>
            {leido.exclusiones.length > 0 && (
              <ul className="space-y-1">
                {leido.exclusiones.map((x) => (
                  <li key={x.motivo} className="font-body text-xs text-gray-600">
                    <strong className="tabular-nums">{x.n}</strong> {x.legible}
                  </li>
                ))}
              </ul>
            )}
            {destinos === 0 && (
              <p className="font-body text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-2 py-1.5">
                No le llegaría a nadie. Lo más común es que falte el permiso de WhatsApp de las
                personas (el opt-in) o el número verificado.
              </p>
            )}
            {envioId && destinos > 0 && (
              <p className="font-body text-xs text-gray-500">
                El envío quedó <strong>calculado</strong>. Para que salga, aprobalo en la pestaña
                «Envíos».
              </p>
            )}
          </>
        )}
      </aside>
    </div>
  )
}

/* ── Pestaña 3: el menú del bot ───────────────────────────────────────────── */

function MenuDelBot({
  menu, contratos, cargos, puedeMenu,
}: { menu: OpcionMenu[]; contratos: ContratoFila[]; cargos: CargoFila[]; puedeMenu: boolean }) {
  const [pendiente, empezar] = useTransition()
  const [accion, setAccion] = useState('MIS_PUNTOS')

  // Agrupado por (contrato, cargo): así se ve de un golpe qué menú ve cada
  // quien, que es la pregunta que alguien se hace al mirar esta pantalla.
  const grupos = useMemo(() => {
    const m = new Map<string, OpcionMenu[]>()
    for (const o of menu) {
      const k = `${o.grupo_id ?? ''}|${o.cargo ?? ''}`
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(o)
    }
    return [...m.entries()].map(([k, filas]) => {
      const [g, c] = k.split('|')
      return {
        clave: k,
        contrato: g ? contratos.find((x) => x.id === g)?.nombre ?? 'contrato desconocido' : null,
        cargo: c || null,
        filas: filas.sort((a, b) => a.orden - b.orden),
      }
    })
  }, [menu, contratos])

  const cargosUnicos = useMemo(
    () => [...new Set(cargos.map((c) => c.cargo))].sort(),
    [cargos],
  )

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
      <div className="space-y-3">
        <p className="font-body text-sm text-gray-500">
          Lo que ve una persona cuando escribe <strong>MENÚ</strong>. Gana el menú más específico
          que exista para ella: primero el de su contrato y su cargo, después el de su contrato,
          después el de su cargo, y si no hay ninguno, el general. Máximo 10 opciones, que es lo que
          admite una lista de WhatsApp.
        </p>
        {grupos.map((g) => (
          <div key={g.clave} className={tarjeta}>
            <h3 className="font-display text-sm text-gray-900 inline-flex items-center gap-1.5">
              <ListOrdered className="w-4 h-4 text-gray-400" />
              {g.contrato ?? 'Todos los contratos'}
              {g.cargo ? ` · ${g.cargo}` : ' · todos los cargos'}
            </h3>
            <ul className="mt-2 divide-y divide-gray-100">
              {g.filas.map((o) => (
                <li key={o.id} className="py-1.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-body text-sm text-gray-800">
                      <span className="text-gray-400 tabular-nums mr-1.5">{o.orden}.</span>
                      {o.etiqueta}
                      {!o.activo && <span className="ml-1.5 text-xs text-gray-400">(apagada)</span>}
                    </p>
                    <p className="font-body text-xs text-gray-500">
                      {ACCIONES_MENU.find((a) => a.valor === o.accion)?.label ?? o.accion}
                      {o.descripcion ? ` · ${o.descripcion}` : ''}
                      {o.requiere_permiso ? ` · solo con permiso ${o.requiere_permiso}` : ''}
                    </p>
                  </div>
                  {puedeMenu && (
                    <button
                      type="button"
                      disabled={pendiente}
                      onClick={() =>
                        empezar(async () => {
                          const r = await borrarOpcionMenu(o.id)
                          if (r.error) toast.error(r.error)
                          else toast.success('Opción eliminada.')
                        })
                      }
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                      aria-label={`Eliminar ${o.etiqueta}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {puedeMenu && (
        <form
          action={(fd) =>
            empezar(async () => {
              const r = await guardarOpcionMenu(fd)
              if (r.error) toast.error(r.error)
              else toast.success('Opción guardada.')
            })
          }
          className={`${tarjeta} h-fit space-y-3`}
        >
          <h3 className="font-display text-sm text-gray-900 inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4 text-gray-400" /> Agregar una opción
          </h3>
          <label className="block">
            <span className={labelCls}>Contrato</span>
            <select name="grupo_id" className={inputCls + ' mt-1 bg-white'}>
              <option value="">Todos los contratos</option>
              {contratos.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelCls}>Cargo</span>
            <select name="cargo" className={inputCls + ' mt-1 bg-white'}>
              <option value="">Todos los cargos</option>
              {cargosUnicos.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
            <label className="block">
              <span className={labelCls}>Orden</span>
              <input name="orden" type="number" min={1} max={10} defaultValue={1} className={inputCls + ' mt-1'} />
            </label>
            <label className="block">
              <span className={labelCls}>Etiqueta * (máx. 24)</span>
              <input name="etiqueta" maxLength={24} className={inputCls + ' mt-1'} />
            </label>
          </div>
          <label className="block">
            <span className={labelCls}>Descripción (máx. 72)</span>
            <input name="descripcion" maxLength={72} className={inputCls + ' mt-1'} />
          </label>
          <label className="block">
            <span className={labelCls}>Qué hace</span>
            <select
              name="accion"
              value={accion}
              onChange={(e) => setAccion(e.target.value)}
              className={inputCls + ' mt-1 bg-white'}
            >
              {ACCIONES_MENU.map((a) => (
                <option key={a.valor} value={a.valor}>{a.label}</option>
              ))}
            </select>
          </label>
          {accion === 'TEXTO' && (
            <label className="block">
              <span className={labelCls}>Texto que responde *</span>
              <textarea name="texto" rows={3} className={inputCls + ' mt-1'} />
            </label>
          )}
          <label className="block">
            <span className={labelCls}>Solo para quien tenga este permiso</span>
            <input name="requiere_permiso" placeholder="gestionar_qr_ronda" className={inputCls + ' mt-1'} />
            <span className="font-body text-[11px] text-gray-400">
              En blanco = se le muestra a cualquiera.
            </span>
          </label>
          <button
            type="submit"
            disabled={pendiente}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-green text-white font-body text-sm font-semibold disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Guardar la opción
          </button>
        </form>
      )}
    </div>
  )
}

function Dato({ n, l, tono }: { n: number | string; l: string; tono?: 'rojo' | 'naranja' }) {
  const c = tono === 'rojo' ? 'text-red-700' : tono === 'naranja' ? 'text-orange-700' : 'text-gray-900'
  return (
    <div className="rounded-lg bg-gray-50 px-2 py-1.5">
      <p className={`font-display text-lg leading-none tabular-nums ${c}`}>{n}</p>
      <p className="font-body text-[11px] text-gray-500 mt-0.5">{l}</p>
    </div>
  )
}
