'use client'

// Pantalla de activos del cliente (F6). Dos listas en una:
//   · los ACTIVOS, en árbol padre/hijo (§2.1), con su sede, su tipo, su estado
//     y si ya tienen placa;
//   · los TIPOS de activo, que son el catálogo del que cuelgan y de donde F7 va
//     a sacar los planes por tipo.
//
// El filtrado y la búsqueda son en memoria porque la página ya trae las filas
// del alcance del usuario (la RLS las acotó): no se vuelve a la base por
// escribir en la caja de buscar.

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import {
  ChevronRight, Cog, Loader2, Plus, QrCode, Save, Search, Tags, Trash2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  CATEGORIAS_ACTIVO, CATEGORIA_ACTIVO, CRITICIDAD, CRITICIDADES,
  ESTADOS_ACTIVO, ESTADO_ACTIVO, TIPOS_MEDIDOR, TIPO_MEDIDOR,
  acumulativoPorDefecto, estadoGarantia, ordenarJerarquia,
  type CategoriaActivo, type Criticidad, type EstadoActivo, type TipoMedidor,
} from '@/lib/activos'
import { formatearManual } from '@/lib/puntos-qr'
import {
  eliminarActivo, eliminarTipoActivo, guardarActivo, guardarTipoActivo,
  type ActionResult,
} from './actions'

export interface OpcionSede {
  id: string; nombre: string; ciudad: string | null
  contrato: string; contratoNombre: string; contratoEstado: string | null
  grupoId: string
}
export interface OpcionZona { id: string; sedeId: string; nombre: string; piso: string | null }
export interface OpcionPunto { id: string; sedeId: string; codigo: string; nombre: string }

export interface TipoActivoFila {
  id: string
  grupoId: string | null
  contrato: string | null
  codigo: string
  nombre: string
  descripcion: string | null
  categoria: CategoriaActivo
  icono: string | null
  criticidadSugerida: Criticidad
  vidaUtilMeses: number | null
  exigeMedidor: boolean
  medidorTipo: TipoMedidor | null
  medidorUnidad: string | null
  obligatorioNormativo: boolean
  normativa: string | null
  orden: number
  activo: boolean
  activos: number
}

export interface ActivoFila {
  id: string
  grupoId: string
  sedeId: string
  sedeNombre: string
  zonaId: string | null
  zonaNombre: string | null
  puntoId: string | null
  puntoCodigo: string | null
  tipoId: string | null
  tipoNombre: string | null
  padreId: string | null
  codigo: string
  nombre: string
  descripcion: string | null
  marca: string | null
  modelo: string | null
  serial: string | null
  ubicacionTexto: string | null
  piso: string | null
  fechaInstalacion: string | null
  garantiaHasta: string | null
  proveedorId: string | null
  criticidad: Criticidad
  estado: EstadoActivo
  activo: boolean
  medidores: number
  documentos: number
  qrVersiones: number
  qrActivo: { id: string; version: number; codigoManual: string } | null
}

const INICIAL: ActionResult = {}
const campo = 'w-full rounded-lg border border-gray-200 px-3 py-2 font-body text-sm focus:border-brand-green focus:outline-none disabled:bg-gray-50 disabled:text-gray-500'
const etiqueta = 'font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400'

function Guardar({ label = 'Guardar' }: { label?: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white disabled:opacity-60">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      {label}
    </button>
  )
}

export function ActivosClient({
  sedes, tipos, activos, zonas, puntos, proveedores, contratos, puedeGestionar,
}: {
  sedes: OpcionSede[]
  tipos: TipoActivoFila[]
  activos: ActivoFila[]
  zonas: OpcionZona[]
  puntos: OpcionPunto[]
  proveedores: { id: string; nombre: string }[]
  contratos: { id: string; codigo: string; nombre: string }[]
  puedeGestionar: boolean
}) {
  const router = useRouter()
  const [estadoActivo, accionActivo] = useActionState(guardarActivo, INICIAL)
  const [estadoTipo, accionTipo] = useActionState(guardarTipoActivo, INICIAL)
  const [, borrando] = useTransition()

  const [vista, setVista] = useState<'activos' | 'tipos'>('activos')
  const [editando, setEditando] = useState<ActivoFila | null>(null)
  const [creando, setCreando] = useState(false)
  const [editandoTipo, setEditandoTipo] = useState<TipoActivoFila | null>(null)
  const [creandoTipo, setCreandoTipo] = useState(false)
  const [busca, setBusca] = useState('')
  const [sedeFiltro, setSedeFiltro] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState('')

  // La sede elegida en el formulario manda sobre qué zonas y qué puntos se
  // pueden elegir: la base rechaza una zona de otra sede, y es mejor no
  // ofrecerla que explicar el error después.
  const [sedeForm, setSedeForm] = useState('')
  const [tipoForm, setTipoForm] = useState('')
  // La criticidad va controlada para que elegir el tipo DESPUÉS de abrir el
  // formulario aplique de verdad la que el tipo sugiere. Con `defaultValue` el
  // campo se quedaría en el valor con el que se montó y la sugerencia no
  // serviría de nada, que es lo que pasaba antes.
  const [criticidadForm, setCriticidadForm] = useState<Criticidad>('MEDIA')
  const [exigeMedidorForm, setExigeMedidorForm] = useState(false)
  const [medidorTipoForm, setMedidorTipoForm] = useState<TipoMedidor>('HORAS')
  // Controlada por el mismo motivo que la criticidad del activo: cambiar la
  // clase de medidor tiene que cambiar la unidad que se propone, y con
  // `defaultValue` el campo se quedaría con la del montaje.
  const [medidorUnidadForm, setMedidorUnidadForm] = useState(TIPO_MEDIDOR.HORAS.unidad)

  useEffect(() => {
    if (estadoActivo.error) toast.error(estadoActivo.error)
    else if (estadoActivo.ok) {
      toast.success('Activo guardado')
      setEditando(null); setCreando(false)
    }
  }, [estadoActivo])

  useEffect(() => {
    if (estadoTipo.error) toast.error(estadoTipo.error)
    else if (estadoTipo.ok) {
      toast.success('Tipo de activo guardado')
      setEditandoTipo(null); setCreandoTipo(false)
    }
  }, [estadoTipo])

  const filas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const filtrados = activos.filter((a) => {
      if (sedeFiltro && a.sedeId !== sedeFiltro) return false
      if (estadoFiltro && a.estado !== estadoFiltro) return false
      if (tipoFiltro && a.tipoId !== tipoFiltro) return false
      if (!q) return true
      return `${a.codigo} ${a.nombre} ${a.marca ?? ''} ${a.modelo ?? ''} ${a.serial ?? ''} ${a.ubicacionTexto ?? ''} ${a.sedeNombre}`
        .toLowerCase().includes(q)
    })
    return ordenarJerarquia(filtrados)
  }, [activos, busca, sedeFiltro, estadoFiltro, tipoFiltro])

  const tiposVisibles = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return tipos
    return tipos.filter((t) => `${t.codigo} ${t.nombre}`.toLowerCase().includes(q))
  }, [tipos, busca])

  const abierto = creando || !!editando
  const actual = editando
  const sedeElegida = sedeForm || actual?.sedeId || ''
  const zonasDeSede = zonas.filter((z) => z.sedeId === sedeElegida)
  const puntosDeSede = puntos.filter((p) => p.sedeId === sedeElegida)
  const grupoDeSede = sedes.find((s) => s.id === sedeElegida)?.grupoId ?? null
  // Un activo solo puede colgar de otro del MISMO contrato, y nunca de sí mismo.
  const padresPosibles = activos.filter(
    (a) => a.grupoId === grupoDeSede && a.id !== actual?.id)
  const tiposElegibles = tipos.filter(
    (t) => t.activo && (t.grupoId === null || t.grupoId === grupoDeSede))
  const tipoElegido = tipos.find((t) => t.id === (tipoForm || actual?.tipoId))

  function abrirNuevo() {
    setEditando(null); setCreando(true)
    setSedeForm(sedeFiltro || ''); setTipoForm(''); setCriticidadForm('MEDIA')
  }
  function abrirEdicion(a: ActivoFila) {
    setCreando(false); setEditando(a)
    setSedeForm(a.sedeId); setTipoForm(a.tipoId ?? ''); setCriticidadForm(a.criticidad)
  }
  function cerrar() {
    setEditando(null); setCreando(false); setSedeForm(''); setTipoForm('')
  }

  function borrarActivo(a: ActivoFila) {
    if (!confirm(`¿Borrar el activo ${a.codigo} — ${a.nombre}? Si ya tiene placa impresa, la base no lo va a permitir: déjalo en Retirado.`)) return
    borrando(async () => {
      const r = await eliminarActivo(a.id)
      if (r.error) toast.error(r.error)
      else { toast.success('Activo borrado'); router.refresh() }
    })
  }
  function borrarTipo(t: TipoActivoFila) {
    if (!confirm(`¿Borrar el tipo ${t.codigo}? Los activos que lo usen se quedan sin tipo.`)) return
    borrando(async () => {
      const r = await eliminarTipoActivo(t.id)
      if (r.error) toast.error(r.error)
      else { toast.success('Tipo borrado'); router.refresh() }
    })
  }

  return (
    <div className="space-y-4">
      {/* ── Barra de filtros ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder={vista === 'activos' ? 'Buscar por código, nombre, marca o serial…' : 'Buscar tipo…'}
            className={`${campo} pl-8`} />
        </div>

        {vista === 'activos' && (
          <>
            <select value={sedeFiltro} onChange={(e) => setSedeFiltro(e.target.value)}
              className={`${campo} w-auto`} aria-label="Sede">
              <option value="">Todas las sedes</option>
              {sedes.map((s) => (
                <option key={s.id} value={s.id}>{s.contrato} · {s.nombre}</option>
              ))}
            </select>
            <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}
              className={`${campo} w-auto`} aria-label="Tipo">
              <option value="">Todos los tipos</option>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
            <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value)}
              className={`${campo} w-auto`} aria-label="Estado">
              <option value="">Todos los estados</option>
              {ESTADOS_ACTIVO.map((e) => (
                <option key={e} value={e}>{ESTADO_ACTIVO[e].label}</option>
              ))}
            </select>
          </>
        )}

        <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
          <button onClick={() => setVista('activos')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 font-body text-sm ${vista === 'activos' ? 'bg-brand-green text-white' : 'bg-white text-gray-600'}`}>
            <Cog className="h-4 w-4" /> Activos
          </button>
          <button onClick={() => setVista('tipos')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 font-body text-sm ${vista === 'tipos' ? 'bg-brand-green text-white' : 'bg-white text-gray-600'}`}>
            <Tags className="h-4 w-4" /> Tipos ({tipos.length})
          </button>
        </div>

        {puedeGestionar && vista === 'activos' && !abierto && (
          <button onClick={abrirNuevo}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white">
            <Plus className="h-4 w-4" /> Nuevo activo
          </button>
        )}
        {puedeGestionar && vista === 'tipos' && !creandoTipo && !editandoTipo && (
          <button onClick={() => {
            setEditandoTipo(null); setCreandoTipo(true); setExigeMedidorForm(false)
            setMedidorTipoForm('HORAS'); setMedidorUnidadForm(TIPO_MEDIDOR.HORAS.unidad)
          }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white">
            <Plus className="h-4 w-4" /> Nuevo tipo
          </button>
        )}
      </div>

      {/* ── Formulario de activo ─────────────────────────────────────────── */}
      {vista === 'activos' && abierto && (
        <form action={accionActivo} className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
          {actual && <input type="hidden" name="id" value={actual.id} />}
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-semibold text-gray-900">
              {actual ? `Editar ${actual.codigo}` : 'Nuevo activo'}
            </h2>
            <button type="button" onClick={cerrar} className="text-gray-400 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1">
              <span className={etiqueta}>Sede</span>
              <select name="sede_id" required value={sedeElegida}
                onChange={(e) => setSedeForm(e.target.value)} className={campo}>
                <option value="">Elige la sede…</option>
                {sedes.map((s) => (
                  <option key={s.id} value={s.id}>{s.contrato} · {s.nombre}</option>
                ))}
              </select>
              <span className="font-body text-[11px] text-gray-400">
                El contrato lo deriva la base de la sede: no se elige a mano.
              </span>
            </label>

            <label className="space-y-1">
              <span className={etiqueta}>Código</span>
              <input name="codigo" defaultValue={actual?.codigo ?? ''}
                placeholder="(se genera solo)" className={campo} />
              <span className="font-body text-[11px] text-gray-400">
                Único por contrato. Si lo dejas vacío queda AC-000001.
              </span>
            </label>

            <label className="space-y-1">
              <span className={etiqueta}>Nombre</span>
              <input name="nombre" defaultValue={actual?.nombre ?? ''} required
                placeholder="Bomba de presión 1" className={campo} />
            </label>

            <label className="space-y-1">
              <span className={etiqueta}>Tipo de activo</span>
              <select name="activo_tipo_id" value={tipoForm || actual?.tipoId || ''}
                onChange={(e) => {
                  setTipoForm(e.target.value)
                  // Al crear, el tipo propone su criticidad; al editar no se
                  // pisa lo que la operación ya decidió para ESE activo.
                  const t = tipos.find((x) => x.id === e.target.value)
                  if (!actual && t) setCriticidadForm(t.criticidadSugerida)
                }} className={campo}>
                <option value="">Sin tipo</option>
                {tiposElegibles.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}{t.grupoId ? ` · ${t.contrato ?? 'contrato'}` : ''}
                  </option>
                ))}
              </select>
              {tipoElegido?.exigeMedidor && (
                <span className="font-body text-[11px] text-amber-600">
                  Este tipo suele llevar medidor de {TIPO_MEDIDOR[tipoElegido.medidorTipo ?? 'HORAS'].label.toLowerCase()}: defínelo en la ficha.
                </span>
              )}
            </label>

            <label className="space-y-1">
              <span className={etiqueta}>Zona</span>
              <select name="zona_id" defaultValue={actual?.zonaId ?? ''} className={campo}
                disabled={!sedeElegida}>
                <option value="">Sin zona</option>
                {zonasDeSede.map((z) => (
                  <option key={z.id} value={z.id}>{z.nombre}{z.piso ? ` · ${z.piso}` : ''}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className={etiqueta}>Punto de control</span>
              <select name="punto_id" defaultValue={actual?.puntoId ?? ''} className={campo}
                disabled={!sedeElegida}>
                <option value="">Sin punto</option>
                {puntosDeSede.map((p) => (
                  <option key={p.id} value={p.id}>{p.codigo} · {p.nombre}</option>
                ))}
              </select>
              <span className="font-body text-[11px] text-gray-400">
                Si el activo está donde ya hay una placa, cuélgalo del punto y no necesita placa propia.
              </span>
            </label>

            <label className="space-y-1">
              <span className={etiqueta}>Ubicación, en palabras</span>
              <input name="ubicacion_texto" defaultValue={actual?.ubicacionTexto ?? ''}
                placeholder="Cuarto de bombas, sótano 2" className={campo} />
            </label>

            <label className="space-y-1">
              <span className={etiqueta}>Piso</span>
              <input name="piso" defaultValue={actual?.piso ?? ''} placeholder="SÓTANO 2" className={campo} />
            </label>

            <label className="space-y-1">
              <span className={etiqueta}>Activo padre</span>
              <select name="padre_id" defaultValue={actual?.padreId ?? ''} className={campo}
                disabled={!sedeElegida}>
                <option value="">Ninguno</option>
                {padresPosibles.map((a) => (
                  <option key={a.id} value={a.id}>{a.codigo} · {a.nombre}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className={etiqueta}>Marca</span>
              <input name="marca" defaultValue={actual?.marca ?? ''} className={campo} />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Modelo</span>
              <input name="modelo" defaultValue={actual?.modelo ?? ''} className={campo} />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Serial</span>
              <input name="serial" defaultValue={actual?.serial ?? ''} className={campo} />
            </label>

            <label className="space-y-1">
              <span className={etiqueta}>Instalado el</span>
              <input type="date" name="fecha_instalacion"
                defaultValue={actual?.fechaInstalacion ?? ''} className={campo} />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Garantía hasta</span>
              <input type="date" name="garantia_hasta"
                defaultValue={actual?.garantiaHasta ?? ''} className={campo} />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Proveedor</span>
              <select name="proveedor_id" defaultValue={actual?.proveedorId ?? ''} className={campo}>
                <option value="">Sin proveedor</option>
                {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </label>

            <label className="space-y-1">
              <span className={etiqueta}>Criticidad</span>
              <select name="criticidad" value={criticidadForm}
                onChange={(e) => setCriticidadForm(e.target.value as Criticidad)}
                className={campo}>
                {CRITICIDADES.map((c) => (
                  <option key={c} value={c}>{CRITICIDAD[c].label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Estado</span>
              <select name="estado" defaultValue={actual?.estado ?? 'OPERATIVO'} className={campo}>
                {ESTADOS_ACTIVO.map((e) => (
                  <option key={e} value={e}>{ESTADO_ACTIVO[e].label}</option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-2 self-end font-body text-sm text-gray-700">
              <input type="checkbox" name="activo" defaultChecked={actual?.activo ?? true}
                className="rounded border-gray-300" />
              En uso
            </label>
          </div>

          <label className="block space-y-1">
            <span className={etiqueta}>Descripción</span>
            <textarea name="descripcion" defaultValue={actual?.descripcion ?? ''} rows={2}
              placeholder="Qué es y qué atiende" className={campo} />
          </label>
          <label className="block space-y-1">
            <span className={etiqueta}>Observaciones</span>
            <textarea name="observaciones" rows={2}
              placeholder="Lo que el técnico tiene que saber antes de ir" className={campo} />
          </label>

          <div className="flex items-center gap-2">
            <Guardar label={actual ? 'Guardar cambios' : 'Crear activo'} />
            <button type="button" onClick={cerrar}
              className="font-body text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          </div>
        </form>
      )}

      {/* ── Lista de activos ─────────────────────────────────────────────── */}
      {vista === 'activos' && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr className="font-body text-[11px] uppercase tracking-wide text-gray-400">
                <th className="px-3 py-2">Activo</th>
                <th className="px-3 py-2">Sede y lugar</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Placa</th>
                <th className="px-3 py-2 text-right">Ficha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filas.map(({ fila: a, nivel }) => {
                const gar = estadoGarantia(a.garantiaHasta)
                return (
                  <tr key={a.id} className="font-body text-sm">
                    <td className="px-3 py-2.5">
                      <div className="flex items-start gap-1.5" style={{ paddingLeft: nivel * 14 }}>
                        {nivel > 0 && <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-300" />}
                        <div className="min-w-0">
                          <span className="font-mono text-[11px] text-gray-400">{a.codigo}</span>
                          <p className="font-semibold text-gray-900">{a.nombre}</p>
                          {(a.marca || a.modelo) && (
                            <p className="text-xs text-gray-500">
                              {[a.marca, a.modelo].filter(Boolean).join(' ')}
                            </p>
                          )}
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${CRITICIDAD[a.criticidad].badge}`}>
                              {CRITICIDAD[a.criticidad].label}
                            </span>
                            {a.medidores > 0 && (
                              <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">
                                {a.medidores} medidor{a.medidores === 1 ? '' : 'es'}
                              </span>
                            )}
                            {a.documentos > 0 && (
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
                                {a.documentos} doc{a.documentos === 1 ? '' : 's'}
                              </span>
                            )}
                            {gar && (
                              <span className={`rounded px-1.5 py-0.5 text-[10px] ${gar.badge}`}>
                                {gar.vencida ? 'Sin garantía' : 'En garantía'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">
                      {a.sedeNombre}
                      <span className="block text-xs text-gray-400">
                        {[a.zonaNombre, a.piso, a.ubicacionTexto].filter(Boolean).join(' · ') || '—'}
                      </span>
                      {a.puntoCodigo && (
                        <span className="block text-xs text-gray-400">Punto {a.puntoCodigo}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{a.tipoNombre ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${ESTADO_ACTIVO[a.estado].badge}`}>
                        {ESTADO_ACTIVO[a.estado].label}
                      </span>
                      {!a.activo && (
                        <span className="mt-1 block text-[11px] text-gray-400">Fuera de uso</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {a.qrActivo ? (
                        <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                          <QrCode className="h-3.5 w-3.5 text-brand-green" />
                          <span className="font-mono">{formatearManual(a.qrActivo.codigoManual)}</span>
                          <span className="text-gray-400">v{a.qrActivo.version}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">
                          {a.puntoCodigo ? 'Usa la del punto' : 'Sin placa'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <Link href={`/rondas/activos/${a.id}`}
                          className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                          Abrir
                        </Link>
                        {puedeGestionar && (
                          <>
                            <button onClick={() => abrirEdicion(a)}
                              className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                              Editar
                            </button>
                            <button onClick={() => borrarActivo(a)} title="Borrar"
                              className="rounded-lg border border-gray-200 p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center font-body text-sm text-gray-400">
                    {activos.length === 0
                      ? 'Todavía no hay activos. Empieza por un tipo y después da de alta el primero.'
                      : 'Ningún activo coincide con el filtro.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Formulario de tipo ───────────────────────────────────────────── */}
      {vista === 'tipos' && (creandoTipo || editandoTipo) && (
        <form action={accionTipo} className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 sm:p-5">
          {editandoTipo && <input type="hidden" name="id" value={editandoTipo.id} />}
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-semibold text-gray-900">
              {editandoTipo ? `Editar ${editandoTipo.codigo}` : 'Nuevo tipo de activo'}
            </h2>
            <button type="button" onClick={() => { setEditandoTipo(null); setCreandoTipo(false) }}
              className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1">
              <span className={etiqueta}>Código</span>
              <input name="codigo" defaultValue={editandoTipo?.codigo ?? ''} required
                placeholder="PUERTA_AUTOMATICA" className={campo} disabled={!!editandoTipo} />
              {editandoTipo && (
                <span className="font-body text-[11px] text-gray-400">
                  El código no se cambia: lo referencian los activos.
                </span>
              )}
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Nombre</span>
              <input name="nombre" defaultValue={editandoTipo?.nombre ?? ''} required
                placeholder="Puerta automática" className={campo} />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Ámbito</span>
              <select name="grupo_id" defaultValue={editandoTipo?.grupoId ?? ''} className={campo}>
                <option value="">General (todos los contratos)</option>
                {contratos.map((c) => (
                  <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Categoría</span>
              <select name="categoria" defaultValue={editandoTipo?.categoria ?? 'OTRO'} className={campo}>
                {CATEGORIAS_ACTIVO.map((c) => (
                  <option key={c} value={c}>{CATEGORIA_ACTIVO[c]}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Criticidad sugerida</span>
              <select name="criticidad_sugerida"
                defaultValue={editandoTipo?.criticidadSugerida ?? 'MEDIA'} className={campo}>
                {CRITICIDADES.map((c) => (
                  <option key={c} value={c}>{CRITICIDAD[c].label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Vida útil (meses)</span>
              <input name="vida_util_meses" type="number" min={1}
                defaultValue={editandoTipo?.vidaUtilMeses ?? ''} className={campo} />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Orden</span>
              <input name="orden" type="number" defaultValue={editandoTipo?.orden ?? 0} className={campo} />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Icono (lucide)</span>
              <input name="icono" defaultValue={editandoTipo?.icono ?? ''}
                placeholder="door-open" className={campo} />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Norma que lo exige</span>
              <input name="normativa" defaultValue={editandoTipo?.normativa ?? ''}
                placeholder="NTC 2885 · recarga anual" className={campo} />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700">
              <input type="checkbox" name="exige_medidor" className="rounded border-gray-300"
                defaultChecked={editandoTipo?.exigeMedidor ?? false}
                onChange={(e) => setExigeMedidorForm(e.target.checked)} />
              Suele llevar medidor
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Clase de medidor</span>
              <select name="medidor_tipo" value={medidorTipoForm}
                onChange={(e) => {
                  const t = e.target.value as TipoMedidor
                  setMedidorTipoForm(t)
                  setMedidorUnidadForm(TIPO_MEDIDOR[t].unidad)
                }}
                disabled={!(exigeMedidorForm || editandoTipo?.exigeMedidor)} className={campo}>
                {TIPOS_MEDIDOR.map((t) => (
                  <option key={t} value={t}>{TIPO_MEDIDOR[t].label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Unidad</span>
              <input name="medidor_unidad" value={medidorUnidadForm}
                onChange={(e) => setMedidorUnidadForm(e.target.value)}
                disabled={!(exigeMedidorForm || editandoTipo?.exigeMedidor)} className={campo} />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700">
                <input type="checkbox" name="obligatorio_normativo" className="rounded border-gray-300"
                  defaultChecked={editandoTipo?.obligatorioNormativo ?? false} />
                Lo exige una norma
              </label>
              <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700">
                <input type="checkbox" name="activo" className="rounded border-gray-300"
                  defaultChecked={editandoTipo?.activo ?? true} />
                Activo
              </label>
            </div>
          </div>

          <label className="block space-y-1">
            <span className={etiqueta}>Descripción</span>
            <textarea name="descripcion" defaultValue={editandoTipo?.descripcion ?? ''} rows={2}
              className={campo} />
          </label>

          <div className="flex items-center gap-2">
            <Guardar label={editandoTipo ? 'Guardar cambios' : 'Crear tipo'} />
            <button type="button" onClick={() => { setEditandoTipo(null); setCreandoTipo(false) }}
              className="font-body text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          </div>
        </form>
      )}

      {/* ── Lista de tipos ───────────────────────────────────────────────── */}
      {vista === 'tipos' && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr className="font-body text-[11px] uppercase tracking-wide text-gray-400">
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Ámbito</th>
                <th className="px-3 py-2">Medidor</th>
                <th className="px-3 py-2">Norma</th>
                <th className="px-3 py-2">Activos</th>
                {puedeGestionar && <th className="px-3 py-2 text-right">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tiposVisibles.map((t) => (
                <tr key={t.id} className="font-body text-sm">
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-[11px] text-gray-400">{t.codigo}</span>
                    <p className="font-semibold text-gray-900">{t.nombre}</p>
                    <p className="text-xs text-gray-500">{CATEGORIA_ACTIVO[t.categoria]}</p>
                    {!t.activo && <p className="text-[11px] text-gray-400">Inactivo</p>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">
                    {t.grupoId ? (t.contrato ?? 'Un contrato') : 'General'}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">
                    {t.exigeMedidor
                      ? `${TIPO_MEDIDOR[t.medidorTipo ?? 'HORAS'].label}${t.medidorUnidad ? ` (${t.medidorUnidad})` : ''}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">
                    {t.obligatorioNormativo
                      ? <span className="text-amber-700">{t.normativa ?? 'Obligatorio'}</span>
                      : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{t.activos}</td>
                  {puedeGestionar && (
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button onClick={() => {
                          setCreandoTipo(false); setEditandoTipo(t)
                          setExigeMedidorForm(t.exigeMedidor)
                          setMedidorTipoForm(t.medidorTipo ?? 'HORAS')
                          setMedidorUnidadForm(t.medidorUnidad ?? TIPO_MEDIDOR[t.medidorTipo ?? 'HORAS'].unidad)
                        }}
                          className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                          Editar
                        </button>
                        <button onClick={() => borrarTipo(t)} title="Borrar"
                          className="rounded-lg border border-gray-200 p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {tiposVisibles.length === 0 && (
                <tr>
                  <td colSpan={puedeGestionar ? 6 : 5}
                    className="px-3 py-10 text-center font-body text-sm text-gray-400">
                    Ningún tipo coincide con la búsqueda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="font-body text-[11px] text-gray-400">
        El medidor de un tipo es solo una sugerencia: el medidor de verdad se define en la ficha
        del activo, y un contador ({TIPOS_MEDIDOR.filter(acumulativoPorDefecto).map((t) => TIPO_MEDIDOR[t].label.toLowerCase()).join(' y ')})
        no puede bajar.
      </p>
    </div>
  )
}
