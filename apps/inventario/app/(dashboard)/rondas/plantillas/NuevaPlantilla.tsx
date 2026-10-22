'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Loader2, Plus, Save, X } from 'lucide-react'
import { toast } from 'sonner'
import { crearPlantilla, type ActionResult } from './actions'

const INICIAL: ActionResult = {}
const campo = 'w-full rounded-lg border border-gray-200 px-3 py-2 font-body text-sm focus:border-brand-green focus:outline-none'
const etiqueta = 'font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400'

function Crear() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
      Crear y editar los pasos
    </button>
  )
}

export function NuevaPlantilla({
  tipos, contratos,
}: {
  tipos: { id: string; codigo: string; nombre: string }[]
  contratos: { id: string; codigo: string; nombre: string }[]
}) {
  const [estado, accion] = useActionState(crearPlantilla, INICIAL)
  const [abierto, setAbierto] = useState(false)

  useEffect(() => { if (estado.error) toast.error(estado.error) }, [estado])

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white">
        <Plus className="w-4 h-4" /> Nueva plantilla
      </button>
    )
  }

  return (
    <form action={accion}
      className="w-full rounded-lg border border-gray-200 bg-white p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading font-semibold text-gray-900">Nueva plantilla (versión 1)</h2>
        <button type="button" onClick={() => setAbierto(false)}
          className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="space-y-1">
          <span className={etiqueta}>Código</span>
          <input name="codigo" required placeholder="ASEO_BANOS" className={campo} />
          <span className="font-body text-[11px] text-gray-400">
            Se mantiene entre versiones; es lo que apuntan las asignaciones.
          </span>
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>Nombre</span>
          <input name="nombre" required placeholder="Aseo de baños" className={campo} />
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>Actividad</span>
          <select name="tipo_actividad_id" required className={campo} defaultValue="">
            <option value="" disabled>Elige una actividad…</option>
            {tipos.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>Contrato</span>
          <select name="grupo_id" className={campo} defaultValue="">
            <option value="">Todos los contratos (catálogo general)</option>
            {contratos.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className={etiqueta}>Tiempo estándar (min)</span>
          <input name="duracion_estimada_min" type="number" min={1} max={1440} placeholder="12"
            className={campo} />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className={etiqueta}>Descripción</span>
          <input name="descripcion" className={campo} />
        </label>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700">
          <input type="checkbox" name="exige_firma" className="rounded border-gray-300" />
          Exige firma al cerrar
        </label>
        <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700">
          <input type="checkbox" name="exige_geocerca" className="rounded border-gray-300" />
          Exige estar en el punto (geocerca)
        </label>
      </div>

      <div className="flex justify-end"><Crear /></div>
    </form>
  )
}
