'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import Link from 'next/link'
import {
  Loader2, Save, Plus, Trash2, X, ChevronUp, ChevronDown, Lock, Rocket, GitBranch,
  GitFork, BookOpen, Archive, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { DeleteButton } from '@/components/ui/DeleteButton'
import {
  ESTADO_PLANTILLA_META, PASO_META, TIPOS_PASO, RESPUESTA_CASILLA_LABEL,
  pasosCondicionables, puedeCondicionar, resumenConfig, validarConfigPaso, valoresCondicion,
  type ConfigPaso, type EstadoPlantilla, type TipoPaso,
} from '@/lib/ronda/pasos'
import {
  archivarPlantilla, eliminarPaso, eliminarPlantilla, guardarPaso, guardarPlantilla,
  moverPaso, nuevaVersion, publicarPlantilla, type ActionResult,
} from '../actions'

export interface PlantillaDetalle {
  id: string
  grupo_id: string | null
  tipo_actividad_id: string
  origen_plantilla_id: string | null
  codigo: string
  version: number
  nombre: string
  descripcion: string | null
  estado: EstadoPlantilla
  duracion_estimada_min: number | null
  exige_firma: boolean
  exige_geocerca: boolean
  publicada_at: string | null
  contrato: { codigo: string; nombre: string } | null
}

export interface PasoFila {
  id: string
  orden: number
  tipo: TipoPaso
  titulo: string
  ayuda: string | null
  obligatorio: boolean
  config: ConfigPaso
  instructivo_id: string | null
  instructivo_momento: 'ANTES' | 'DURANTE' | null
  condicion_paso_id: string | null
  condicion_valor: string | null
}

interface Instructivo { id: string; codigo: string; version: number; titulo: string; tipo: string }

const INICIAL: ActionResult = {}
const campo = 'w-full rounded-lg border border-gray-200 px-3 py-2 font-body text-sm focus:border-brand-green focus:outline-none disabled:bg-gray-50 disabled:text-gray-500'
const etiqueta = 'font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400'
const tarjeta = 'rounded-lg border border-gray-200 bg-white p-4 sm:p-5 space-y-4'

function Guardar({ label = 'Guardar', icono }: { label?: string; icono?: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : (icono ?? <Save className="w-4 h-4" />)}
      {label}
    </button>
  )
}

function useAviso(estado: ActionResult, exito: string, alTerminar?: () => void) {
  useEffect(() => {
    if (estado.error) toast.error(estado.error)
    else if (estado.ok) { toast.success(exito); alTerminar?.() }
    // `alTerminar` cambia en cada render: se deja fuera a propósito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, exito])
}

export function EditorPlantilla({
  plantilla, pasos, tipos, instructivos, versiones, puedeGestionar,
}: {
  plantilla: PlantillaDetalle
  pasos: PasoFila[]
  tipos: { id: string; codigo: string; nombre: string }[]
  instructivos: Instructivo[]
  versiones: { id: string; version: number; estado: string; publicada_at: string | null }[]
  puedeGestionar: boolean
}) {
  const borrador = plantilla.estado === 'BORRADOR'
  const editable = puedeGestionar && borrador

  const [estCab, accCab] = useActionState(guardarPlantilla, INICIAL)
  const [estPub, accPub] = useActionState(publicarPlantilla, INICIAL)
  const [estVer, accVer] = useActionState(nuevaVersion, INICIAL)
  useAviso(estCab, 'Plantilla guardada')
  useAviso(estPub, 'Plantilla publicada: desde ahora es la versión que se ejecuta')
  useEffect(() => { if (estVer.error) toast.error(estVer.error) }, [estVer])

  const [editando, setEditando] = useState<PasoFila | null>(null)
  const [creando, setCreando] = useState(false)
  const meta = ESTADO_PLANTILLA_META[plantilla.estado]

  // Problemas que impedirían publicar, calculados igual que la RPC, para que la
  // pantalla lo diga ANTES de intentarlo.
  const problemas = useMemo(() => {
    const out: string[] = []
    if (pasos.length === 0) out.push('No tiene ningún paso.')
    for (const p of pasos) {
      if (!p.condicion_paso_id) continue
      const dep = pasos.find((x) => x.id === p.condicion_paso_id)
      if (!dep) out.push(`El paso ${p.orden} depende de un paso que ya no está.`)
      else if (dep.orden >= p.orden) {
        out.push(`El paso ${p.orden} («${p.titulo}») depende del paso ${dep.orden}, que va después.`)
      }
    }
    for (const p of pasos) {
      const mal = validarConfigPaso(p.tipo, p.config)
      if (mal) out.push(`Paso ${p.orden} («${p.titulo}»): ${mal}`)
    }
    return out
  }, [pasos])

  return (
    <div className="space-y-5">
      {/* ── Cabecera ─────────────────────────────────────────────────────── */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-heading font-bold text-2xl text-gray-900">{plantilla.nombre}</h1>
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${meta.badge}`}>
            {meta.label}
          </span>
          {!borrador && (
            <span className="inline-flex items-center gap-1 font-body text-[11px] text-gray-500">
              <Lock className="w-3 h-3" /> congelada
            </span>
          )}
        </div>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          {plantilla.codigo} · versión {plantilla.version} ·{' '}
          {plantilla.contrato ? `contrato ${plantilla.contrato.codigo}` : 'catálogo general'}
        </p>
      </div>

      {!borrador && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 p-4 font-body text-sm text-gray-600">
          Esta versión está {meta.label.toLowerCase()} y no se puede cambiar: hay respuestas que
          apuntan a ella y tienen que seguir diciendo lo que se preguntó. Para cambiar el trabajo,
          saca una versión nueva.
        </p>
      )}

      {/* ── Acciones de versión ──────────────────────────────────────────── */}
      {puedeGestionar && (
        <div className={`${tarjeta} space-y-3`}>
          <h2 className="font-heading font-semibold text-gray-900 flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-brand-green" /> Versiones
          </h2>
          <div className="flex flex-wrap gap-2">
            {versiones.map((v) => (
              <Link key={v.id} href={`/rondas/plantillas/${v.id}`}
                className={`rounded-full px-2.5 py-1 font-body text-xs ${v.id === plantilla.id
                  ? 'bg-brand-green text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                v{v.version} · {ESTADO_PLANTILLA_META[v.estado as EstadoPlantilla]?.label ?? v.estado}
              </Link>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {borrador && (
              <form action={accPub}>
                <input type="hidden" name="id" value={plantilla.id} />
                <button type="submit" disabled={problemas.length > 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white disabled:opacity-50"
                  title={problemas.length ? 'Hay cosas por arreglar antes de publicar' : undefined}>
                  <Rocket className="w-4 h-4" /> Publicar esta versión
                </button>
              </form>
            )}
            {!borrador && (
              <form action={accVer}>
                <input type="hidden" name="id" value={plantilla.id} />
                <Guardar label="Sacar una versión nueva" icono={<GitFork className="w-4 h-4" />} />
              </form>
            )}
            {plantilla.estado === 'PUBLICADA' && (
              <DeleteButton action={archivarPlantilla} id={plantilla.id}
                mensaje="¿Archivar esta versión? Deja de asignarse, pero sus respuestas se siguen leyendo."
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 font-body text-sm font-semibold text-gray-600 hover:bg-gray-50">
                <Archive className="w-4 h-4" /> Archivar
              </DeleteButton>
            )}
            {borrador && (
              <DeleteButton action={eliminarPlantilla} id={plantilla.id}
                mensaje="¿Descartar este borrador? Se pierde con todos sus pasos."
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 font-body text-sm font-semibold text-gray-600 hover:bg-gray-50">
                <Trash2 className="w-4 h-4" /> Descartar el borrador
              </DeleteButton>
            )}
          </div>

          {borrador && problemas.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
              <p className="font-body text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Antes de publicar hay que arreglar:
              </p>
              <ul className="font-body text-xs text-amber-800 list-disc pl-5 space-y-0.5">
                {problemas.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Datos de la plantilla ────────────────────────────────────────── */}
      <form action={accCab} className={tarjeta}>
        <input type="hidden" name="id" value={plantilla.id} />
        <h2 className="font-heading font-semibold text-gray-900">Datos de la tarea</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1">
            <span className={etiqueta}>Nombre</span>
            <input name="nombre" defaultValue={plantilla.nombre} required disabled={!editable} className={campo} />
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Actividad</span>
            <select name="tipo_actividad_id" defaultValue={plantilla.tipo_actividad_id}
              disabled={!editable} className={campo}>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Tiempo estándar (min)</span>
            <input name="duracion_estimada_min" type="number" min={1} max={1440}
              defaultValue={plantilla.duracion_estimada_min ?? ''} disabled={!editable} className={campo} />
            <span className="font-body text-[11px] text-gray-400">
              Es contra este número que los informes comparan el tiempo real.
            </span>
          </label>
          <label className="space-y-1 sm:col-span-2 lg:col-span-3">
            <span className={etiqueta}>Descripción</span>
            <input name="descripcion" defaultValue={plantilla.descripcion ?? ''}
              disabled={!editable} className={campo} />
          </label>
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700">
            <input type="checkbox" name="exige_firma" defaultChecked={plantilla.exige_firma}
              disabled={!editable} className="rounded border-gray-300" />
            Exige firma al cerrar
          </label>
          <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700">
            <input type="checkbox" name="exige_geocerca" defaultChecked={plantilla.exige_geocerca}
              disabled={!editable} className="rounded border-gray-300" />
            Exige estar en el punto (geocerca)
          </label>
        </div>
        {editable && <div className="flex justify-end"><Guardar /></div>}
      </form>

      {/* ── Pasos ────────────────────────────────────────────────────────── */}
      <div className={tarjeta}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading font-semibold text-gray-900">
            Pasos <span className="font-body text-sm font-normal text-gray-400">({pasos.length})</span>
          </h2>
          {editable && (
            <button onClick={() => { setEditando(null); setCreando(true) }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white">
              <Plus className="w-4 h-4" /> Agregar paso
            </button>
          )}
        </div>

        {(creando || editando) && editable && (
          <FormularioPaso
            plantillaId={plantilla.id}
            paso={editando}
            pasos={pasos}
            instructivos={instructivos}
            ordenSugerido={pasos.length ? Math.max(...pasos.map((p) => p.orden)) + 1 : 1}
            alCerrar={() => { setEditando(null); setCreando(false) }}
          />
        )}

        {pasos.length === 0 ? (
          <p className="font-body text-sm text-gray-500">
            Todavía no hay pasos. Un paso es una cosa que el conserje hace y deja registrada:
            marcar una casilla, tomar una foto, medir, firmar.
          </p>
        ) : (
          <ol className="divide-y divide-gray-100">
            {pasos.map((p, i) => {
              const dep = p.condicion_paso_id ? pasos.find((x) => x.id === p.condicion_paso_id) : null
              const instr = instructivos.find((x) => x.id === p.instructivo_id)
              return (
                <li key={p.id} className="py-3 flex items-start gap-3">
                  <span className="mt-0.5 inline-flex w-6 h-6 shrink-0 items-center justify-center rounded-full bg-gray-100 font-body text-xs font-semibold text-gray-600 tabular-nums">
                    {p.orden}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-sm font-semibold text-gray-900">
                      {p.titulo}
                      {!p.obligatorio && (
                        <span className="ml-1.5 font-normal text-xs text-gray-400">(opcional)</span>
                      )}
                    </p>
                    <p className="font-body text-xs text-gray-500">
                      {PASO_META[p.tipo].label} · {resumenConfig(p.tipo, p.config)}
                    </p>
                    {dep && (
                      <p className="font-body text-xs text-indigo-600 mt-0.5">
                        Solo se muestra si el paso {dep.orden} responde «{
                          valoresCondicion(dep.tipo, dep.config)
                            .find((v) => v.valor === p.condicion_valor)?.etiqueta
                          ?? RESPUESTA_CASILLA_LABEL[p.condicion_valor as 'SI' | 'NO' | 'NO_APLICA']
                          ?? p.condicion_valor
                        }»
                      </p>
                    )}
                    {instr && (
                      <p className="font-body text-xs text-gray-500 mt-0.5 inline-flex items-center gap-1">
                        <BookOpen className="w-3 h-3" /> {instr.titulo} ({instr.tipo.toLowerCase()})
                        {p.instructivo_momento === 'DURANTE' ? ', durante' : ', antes'}
                      </p>
                    )}
                    {p.ayuda && (
                      <p className="font-body text-xs text-gray-400 mt-0.5">{p.ayuda}</p>
                    )}
                  </div>
                  {editable && (
                    <div className="flex items-center gap-1 shrink-0">
                      <form action={moverPaso}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="hacia" value="arriba" />
                        <button type="submit" disabled={i === 0}
                          className="inline-flex p-1 text-gray-400 hover:text-brand-green disabled:opacity-30"
                          title="Subir"><ChevronUp className="w-4 h-4" /></button>
                      </form>
                      <form action={moverPaso}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="hacia" value="abajo" />
                        <button type="submit" disabled={i === pasos.length - 1}
                          className="inline-flex p-1 text-gray-400 hover:text-brand-green disabled:opacity-30"
                          title="Bajar"><ChevronDown className="w-4 h-4" /></button>
                      </form>
                      <button onClick={() => { setCreando(false); setEditando(p) }}
                        className="font-body text-xs font-semibold text-brand-green hover:underline px-1">
                        Editar
                      </button>
                      <DeleteButton action={eliminarPaso} id={p.id}
                        mensaje="¿Borrar este paso? Si otro paso depende de él, la base no lo va a permitir."
                        className="inline-flex p-1 text-gray-400 hover:text-red-600">
                        <Trash2 className="w-3.5 h-3.5" />
                      </DeleteButton>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────────────────
   Formulario de un paso. La `config` se arma en el cliente según el tipo y
   viaja como JSON en un campo oculto; la server action la valida con la misma
   lógica que el CHECK de la base (lib/ronda/pasos.ts).
   ────────────────────────────────────────────────────────────────────────── */
function FormularioPaso({
  plantillaId, paso, pasos, instructivos, ordenSugerido, alCerrar,
}: {
  plantillaId: string
  paso: PasoFila | null
  pasos: PasoFila[]
  instructivos: Instructivo[]
  ordenSugerido: number
  alCerrar: () => void
}) {
  const [estado, accion] = useActionState(guardarPaso, INICIAL)
  const [tipo, setTipo] = useState<TipoPaso>(paso?.tipo ?? 'CASILLA')
  const [config, setConfig] = useState<ConfigPaso>(paso?.config ?? PASO_META[tipo].porDefecto)
  const [orden, setOrden] = useState<number>(paso?.orden ?? ordenSugerido)
  const [condPaso, setCondPaso] = useState<string>(paso?.condicion_paso_id ?? '')
  const [condValor, setCondValor] = useState<string>(paso?.condicion_valor ?? '')
  const [instructivo, setInstructivo] = useState<string>(paso?.instructivo_id ?? '')

  useAviso(estado, paso ? 'Paso guardado' : 'Paso agregado', alCerrar)

  const cambiarTipo = (t: TipoPaso) => {
    setTipo(t)
    setConfig(PASO_META[t].porDefecto)
  }

  // Solo se puede condicionar a un paso ANTERIOR y de respuesta discreta: una
  // foto o una firma no tienen un valor del que colgar una condición.
  const candidatos = useMemo(
    () => pasosCondicionables(pasos, { id: paso?.id, orden }).filter((p) => puedeCondicionar(p.tipo)),
    [pasos, paso?.id, orden],
  )
  const pasoDep = candidatos.find((p) => p.id === condPaso)
  const valores = pasoDep ? valoresCondicion(pasoDep.tipo, pasoDep.config) : []
  const problema = validarConfigPaso(tipo, config)

  return (
    <form action={accion} className="rounded-lg border border-brand-green/30 bg-brand-green/5 p-4 space-y-4">
      <input type="hidden" name="plantilla_id" value={plantillaId} />
      {paso && <input type="hidden" name="id" value={paso.id} />}
      <input type="hidden" name="config" value={JSON.stringify(config)} />
      <input type="hidden" name="condicion_paso_id" value={condPaso} />
      <input type="hidden" name="condicion_valor" value={condPaso ? condValor : ''} />
      <input type="hidden" name="instructivo_id" value={instructivo} />

      <div className="flex items-center justify-between">
        <h3 className="font-heading font-semibold text-gray-900">
          {paso ? `Editar el paso ${paso.orden}` : 'Paso nuevo'}
        </h3>
        <button type="button" onClick={alCerrar} className="text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1">
          <span className={etiqueta}>Orden</span>
          <input name="orden" type="number" min={1} max={200} value={orden}
            onChange={(e) => setOrden(Number(e.target.value))} className={campo} />
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>Tipo de paso</span>
          <select value={tipo} onChange={(e) => cambiarTipo(e.target.value as TipoPaso)} className={campo}>
            {TIPOS_PASO.map((t) => <option key={t} value={t}>{PASO_META[t].label}</option>)}
          </select>
          <input type="hidden" name="tipo" value={tipo} />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className={etiqueta}>Título (lo que ve el conserje)</span>
          <input name="titulo" defaultValue={paso?.titulo ?? ''} required
            placeholder="¿El baño estaba surtido?" className={campo} />
        </label>
        <label className="space-y-1 sm:col-span-2 lg:col-span-4">
          <span className={etiqueta}>Ayuda</span>
          <input name="ayuda" defaultValue={paso?.ayuda ?? ''} className={campo}
            placeholder={PASO_META[tipo].ayuda} />
        </label>
      </div>

      <p className="font-body text-xs text-gray-500">{PASO_META[tipo].ayuda}</p>

      <CamposConfig tipo={tipo} config={config} setConfig={setConfig} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 sm:col-span-2">
          <span className={etiqueta}>Instructivo</span>
          <select value={instructivo} onChange={(e) => setInstructivo(e.target.value)} className={campo}>
            <option value="">Sin instructivo</option>
            {instructivos.map((i) => (
              <option key={i.id} value={i.id}>
                {i.titulo} · {i.tipo.toLowerCase()} v{i.version}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>Cuándo se muestra</span>
          <select name="instructivo_momento" defaultValue={paso?.instructivo_momento ?? 'ANTES'}
            disabled={!instructivo} className={campo}>
            <option value="ANTES">Antes del paso</option>
            <option value="DURANTE">Durante el paso</option>
          </select>
        </label>
        <label className="space-y-1 flex flex-col justify-end">
          <span className="inline-flex items-center gap-2 font-body text-sm text-gray-700">
            <input type="checkbox" name="obligatorio" defaultChecked={paso?.obligatorio ?? true}
              className="rounded border-gray-300" />
            Obligatorio
          </span>
        </label>
      </div>

      {/* Paso condicional */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
        <p className="font-body text-xs font-semibold text-gray-600">
          Paso condicional (opcional): mostrar este paso solo si otro respondió algo
        </p>
        {candidatos.length === 0 ? (
          <p className="font-body text-xs text-gray-400">
            No hay pasos anteriores con respuesta de casilla o selección de los que colgar una condición.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className={etiqueta}>Depende del paso</span>
              <select value={condPaso}
                onChange={(e) => { setCondPaso(e.target.value); setCondValor('') }}
                className={campo}>
                <option value="">Siempre se muestra</option>
                {candidatos.map((p) => (
                  <option key={p.id} value={p.id}>{p.orden}. {p.titulo}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Cuando responda</span>
              <select value={condValor} onChange={(e) => setCondValor(e.target.value)}
                disabled={!condPaso} required={!!condPaso} className={campo}>
                <option value="">Elige la respuesta…</option>
                {valores.map((v) => <option key={v.valor} value={v.valor}>{v.etiqueta}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>

      {problema && (
        <p className="font-body text-xs text-red-600 inline-flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> {problema}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={alCerrar}
          className="rounded-lg border border-gray-200 px-3 py-2 font-body text-sm font-semibold text-gray-600">
          Cancelar
        </button>
        <Guardar label={paso ? 'Guardar el paso' : 'Agregar el paso'} />
      </div>
    </form>
  )
}

/** Los campos propios de cada tipo de paso. */
function CamposConfig({
  tipo, config, setConfig,
}: {
  tipo: TipoPaso
  config: ConfigPaso
  setConfig: (c: ConfigPaso) => void
}) {
  const set = (parcial: Partial<ConfigPaso>) => setConfig({ ...config, ...parcial })
  const numero = (v: string) => (v === '' ? undefined : Number(v))
  const caja = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4'

  switch (tipo) {
    case 'CASILLA':
      return (
        <div className="space-y-2">
          <p className="font-body text-xs text-gray-500">
            Las respuestas son siempre Sí, No y No aplica.
          </p>
          <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700">
            <input type="checkbox" checked={config.motivo_obligatorio_si_no !== false}
              onChange={(e) => set({ motivo_obligatorio_si_no: e.target.checked })}
              className="rounded border-gray-300" />
            Si responde No, exigir el motivo
          </label>
        </div>
      )

    case 'FOTO':
      return (
        <div className={caja}>
          <label className="space-y-1">
            <span className={etiqueta}>Mínimo de fotos</span>
            <input type="number" min={0} max={20} value={config.min ?? ''}
              onChange={(e) => set({ min: numero(e.target.value) })} className={campo} />
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Máximo de fotos</span>
            <input type="number" min={1} max={20} value={config.max ?? ''}
              onChange={(e) => set({ max: numero(e.target.value) })} className={campo} />
          </label>
          <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700 sm:col-span-2">
            <input type="checkbox" checked={!!config.solo_camara_vivo}
              onChange={(e) => set({ solo_camara_vivo: e.target.checked })}
              className="rounded border-gray-300" />
            Solo cámara en vivo (no deja subir una foto de la galería)
          </label>
          <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700 sm:col-span-2">
            <input type="checkbox" checked={!!config.exige_qr_en_encuadre}
              onChange={(e) => set({ exige_qr_en_encuadre: e.target.checked })}
              className="rounded border-gray-300" />
            El QR del punto tiene que salir en el encuadre
          </label>
        </div>
      )

    case 'VIDEO':
      return (
        <div className={caja}>
          <label className="space-y-1">
            <span className={etiqueta}>Duración máxima (s)</span>
            <input type="number" min={3} max={300} value={config.segundos_max ?? ''}
              onChange={(e) => set({ segundos_max: numero(e.target.value) })} className={campo} />
          </label>
        </div>
      )

    case 'TEXTO':
      return (
        <div className={caja}>
          <label className="space-y-1">
            <span className={etiqueta}>Mínimo de caracteres</span>
            <input type="number" min={0} max={4000} value={config.min_caracteres ?? ''}
              onChange={(e) => set({ min_caracteres: numero(e.target.value) })} className={campo} />
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Máximo de caracteres</span>
            <input type="number" min={1} max={4000} value={config.max_caracteres ?? ''}
              onChange={(e) => set({ max_caracteres: numero(e.target.value) })} className={campo} />
          </label>
        </div>
      )

    case 'NOTA_VOZ':
      return (
        <div className={caja}>
          <label className="space-y-1">
            <span className={etiqueta}>Duración máxima (s)</span>
            <input type="number" min={3} max={600} value={config.segundos_max ?? ''}
              onChange={(e) => set({ segundos_max: numero(e.target.value) })} className={campo} />
          </label>
          <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700 sm:col-span-2 sm:items-end">
            <input type="checkbox" checked={config.transcribir !== false}
              onChange={(e) => set({ transcribir: e.target.checked })} className="rounded border-gray-300" />
            Transcribir el audio
          </label>
        </div>
      )

    case 'NUMERO':
      return (
        <div className={caja}>
          <label className="space-y-1">
            <span className={etiqueta}>Mínimo</span>
            <input type="number" value={config.min ?? ''}
              onChange={(e) => set({ min: numero(e.target.value) })} className={campo} />
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Máximo</span>
            <input type="number" value={config.max ?? ''}
              onChange={(e) => set({ max: numero(e.target.value) })} className={campo} />
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Decimales</span>
            <input type="number" min={0} max={4} value={config.decimales ?? 0}
              onChange={(e) => set({ decimales: numero(e.target.value) })} className={campo} />
          </label>
          <label className="space-y-1">
            <span className={etiqueta}>Unidad</span>
            <input value={config.unidad ?? ''} placeholder="m3, L, °C"
              onChange={(e) => set({ unidad: e.target.value })} className={campo} />
          </label>
        </div>
      )

    case 'SELECCION': {
      const opciones = config.opciones ?? []
      const cambiar = (i: number, parcial: { valor?: string; etiqueta?: string }) => {
        const copia = opciones.map((o, j) => (j === i ? { ...o, ...parcial } : o))
        set({ opciones: copia })
      }
      return (
        <div className="space-y-3">
          <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700">
            <input type="checkbox" checked={!!config.multiple}
              onChange={(e) => set({ multiple: e.target.checked })} className="rounded border-gray-300" />
            Puede escoger varias
          </label>
          <div className="space-y-2">
            {opciones.map((o, i) => (
              <div key={i} className="flex gap-2">
                <input value={o.valor} onChange={(e) => cambiar(i, { valor: e.target.value.toUpperCase() })}
                  placeholder="VALOR" className={`${campo} max-w-[10rem]`} />
                <input value={o.etiqueta} onChange={(e) => cambiar(i, { etiqueta: e.target.value })}
                  placeholder="Lo que se lee en pantalla" className={campo} />
                <button type="button"
                  onClick={() => set({ opciones: opciones.filter((_, j) => j !== i) })}
                  className="inline-flex p-2 text-gray-400 hover:text-red-600">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          <button type="button"
            onClick={() => set({ opciones: [...opciones, { valor: '', etiqueta: '' }] })}
            className="inline-flex items-center gap-1.5 font-body text-xs font-semibold text-brand-green">
            <Plus className="w-3.5 h-3.5" /> Agregar opción
          </button>
        </div>
      )
    }

    case 'ESCANEO':
      return (
        <div className={caja}>
          <label className="space-y-1">
            <span className={etiqueta}>Qué se escanea</span>
            <select value={config.entidad ?? 'producto'}
              onChange={(e) => set({ entidad: e.target.value as 'producto' | 'maquinaria' })}
              className={campo}>
              <option value="producto">Código de insumo</option>
              <option value="maquinaria">Código de equipo</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700 sm:col-span-2 sm:items-end">
            <input type="checkbox" checked={config.exige_existente !== false}
              onChange={(e) => set({ exige_existente: e.target.checked })} className="rounded border-gray-300" />
            Tiene que existir en el inventario
          </label>
        </div>
      )

    case 'FIRMA':
      return (
        <div className={caja}>
          <label className="space-y-1">
            <span className={etiqueta}>Quién firma</span>
            <select value={config.quien ?? 'trabajador'}
              onChange={(e) => set({ quien: e.target.value as 'trabajador' | 'cliente' })}
              className={campo}>
              <option value="trabajador">El trabajador</option>
              <option value="cliente">El cliente</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700 sm:col-span-2 sm:items-end">
            <input type="checkbox" checked={!!config.permite_facial}
              onChange={(e) => set({ permite_facial: e.target.checked })} className="rounded border-gray-300" />
            Permitir validación facial en vez de trazo
          </label>
        </div>
      )

    default:
      return null
  }
}
