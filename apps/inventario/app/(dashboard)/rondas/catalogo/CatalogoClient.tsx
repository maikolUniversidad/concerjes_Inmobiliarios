'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Loader2, Save, Plus, Trash2, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { DeleteButton } from '@/components/ui/DeleteButton'
import {
  CATEGORIAS_ACTIVIDAD, CATEGORIA_ACTIVIDAD_LABEL, type CategoriaActividad,
} from '@/lib/ronda/pasos'
import { eliminarTipo, guardarTipo, type ActionResult } from './actions'

export interface TipoFila {
  id: string
  grupo_id: string | null
  codigo: string
  nombre: string
  descripcion: string | null
  categoria: CategoriaActividad
  icono: string | null
  color: string | null
  orden: number
  activo: boolean
  contrato: { codigo: string; nombre: string } | null
  ronda_plantillas: { count: number }[] | null
}

const INICIAL: ActionResult = {}
const campo = 'w-full rounded-lg border border-gray-200 px-3 py-2 font-body text-sm focus:border-brand-green focus:outline-none disabled:bg-gray-50 disabled:text-gray-500'
const etiqueta = 'font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400'

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

export function CatalogoClient({
  tipos, contratos, puedeGestionar,
}: {
  tipos: TipoFila[]
  contratos: { id: string; codigo: string; nombre: string }[]
  puedeGestionar: boolean
}) {
  const [estado, accion] = useActionState(guardarTipo, INICIAL)
  const [editando, setEditando] = useState<TipoFila | null>(null)
  const [creando, setCreando] = useState(false)
  const [busca, setBusca] = useState('')
  const [soloActivos, setSoloActivos] = useState(true)

  useEffect(() => {
    if (estado.error) toast.error(estado.error)
    else if (estado.ok) {
      toast.success('Actividad guardada')
      setEditando(null)
      setCreando(false)
    }
  }, [estado])

  const filas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return tipos.filter((t) => {
      if (soloActivos && !t.activo) return false
      if (!q) return true
      return `${t.codigo} ${t.nombre} ${t.descripcion ?? ''}`.toLowerCase().includes(q)
    })
  }, [tipos, busca, soloActivos])

  const abierto = creando || !!editando
  const actual = editando

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar actividad…"
            className={`${campo} pl-8`} />
        </div>
        <label className="inline-flex items-center gap-1.5 font-body text-sm text-gray-600">
          <input type="checkbox" checked={soloActivos} onChange={(e) => setSoloActivos(e.target.checked)}
            className="rounded border-gray-300" />
          Solo activas
        </label>
        {puedeGestionar && (
          <button onClick={() => { setEditando(null); setCreando(true) }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white">
            <Plus className="w-4 h-4" /> Nueva actividad
          </button>
        )}
      </div>

      {abierto && (
        <form action={accion} className="rounded-lg border border-gray-200 bg-white p-4 sm:p-5 space-y-4">
          {actual && <input type="hidden" name="id" value={actual.id} />}
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-semibold text-gray-900">
              {actual ? `Editar ${actual.codigo}` : 'Nueva actividad'}
            </h2>
            <button type="button" onClick={() => { setEditando(null); setCreando(false) }}
              className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1">
              <span className={etiqueta}>Código</span>
              <input name="codigo" defaultValue={actual?.codigo ?? ''} required
                placeholder="LECTURA_MEDIDOR" className={campo} disabled={!!actual} />
              {actual && <span className="font-body text-[11px] text-gray-400">
                El código no se cambia: lo referencian las asignaciones.
              </span>}
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Nombre</span>
              <input name="nombre" defaultValue={actual?.nombre ?? ''} required
                placeholder="Lectura de medidor" className={campo} />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Categoría</span>
              <select name="categoria" defaultValue={actual?.categoria ?? 'OTRA'} className={campo}>
                {CATEGORIAS_ACTIVIDAD.map((c) => (
                  <option key={c} value={c}>{CATEGORIA_ACTIVIDAD_LABEL[c]}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Contrato</span>
              <select name="grupo_id" defaultValue={actual?.grupo_id ?? ''} className={campo}>
                <option value="">Todos los contratos (catálogo general)</option>
                {contratos.map((c) => (
                  <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Icono</span>
              <input name="icono" defaultValue={actual?.icono ?? ''} placeholder="Gauge" className={campo} />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Color</span>
              <input name="color" type="text" defaultValue={actual?.color ?? '#0ea5e9'}
                placeholder="#0ea5e9" className={campo} />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className={etiqueta}>Descripción</span>
              <input name="descripcion" defaultValue={actual?.descripcion ?? ''} className={campo} />
            </label>
            <label className="space-y-1">
              <span className={etiqueta}>Orden</span>
              <input name="orden" type="number" defaultValue={actual?.orden ?? 0} className={campo} />
            </label>
          </div>

          <label className="inline-flex items-center gap-2 font-body text-sm text-gray-700">
            <input type="checkbox" name="activo" defaultChecked={actual?.activo ?? true}
              className="rounded border-gray-300" />
            Activa (se puede usar en plantillas nuevas)
          </label>

          <div className="flex justify-end"><Guardar /></div>
        </form>
      )}

      {filas.length === 0 ? (
        <p className="font-body text-sm text-gray-500 rounded-lg border border-gray-200 bg-white p-6">
          No hay actividades que coincidan.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-left">
            <thead className="bg-gray-50">
              <tr className="font-body text-[11px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5">Actividad</th>
                <th className="px-4 py-2.5 hidden sm:table-cell">Categoría</th>
                <th className="px-4 py-2.5 hidden md:table-cell">Ámbito</th>
                <th className="px-4 py-2.5 hidden lg:table-cell text-right">Plantillas</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filas.map((t) => (
                <tr key={t.id} className={t.activo ? undefined : 'bg-gray-50/60'}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: t.color ?? '#9ca3af' }} />
                      <div>
                        <p className="font-body text-sm font-semibold text-gray-900">{t.nombre}</p>
                        <p className="font-body text-xs text-gray-400">
                          {t.codigo}{t.activo ? '' : ' · inactiva'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell font-body text-sm text-gray-600">
                    {CATEGORIA_ACTIVIDAD_LABEL[t.categoria]}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell font-body text-sm text-gray-600">
                    {t.contrato ? `${t.contrato.codigo}` : <span className="text-gray-400">Todos</span>}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell font-body text-sm text-gray-600 text-right tabular-nums">
                    {Number(t.ronda_plantillas?.[0]?.count ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {puedeGestionar && (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => { setCreando(false); setEditando(t) }}
                          className="font-body text-xs font-semibold text-brand-green hover:underline">
                          Editar
                        </button>
                        <DeleteButton action={eliminarTipo} id={t.id}
                          mensaje={`¿Borrar la actividad ${t.codigo}? Si alguna plantilla la usa, la base no lo va a permitir.`}
                          className="inline-flex text-gray-400 hover:text-red-600">
                          <Trash2 className="w-3.5 h-3.5" />
                        </DeleteButton>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
