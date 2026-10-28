'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Plus, Power, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  PRIORIDAD_PQRS_META, PRIORIDADES_PQRS, TIPO_PQRS_META, TIPOS_PQRS,
  type CategoriaPqrs,
} from '@/lib/pqrs'
import { cambiarActivoCategoria, guardarCategoria, type ResultadoCategoria } from './actions'

export interface ContratoBreve { id: string; codigo: string; nombre: string }

export function ListaCategorias({ categorias, contratos }: {
  categorias: CategoriaPqrs[]
  contratos: ContratoBreve[]
}) {
  const router = useRouter()
  const [editando, setEditando] = useState<CategoriaPqrs | 'nueva' | null>(null)
  const porContrato = new Map(contratos.map((c) => [c.id, c]))

  async function apagarEncender(c: CategoriaPqrs) {
    const r = await cambiarActivoCategoria(c.id, !c.activo)
    if (r.error) { toast.error(r.error); return }
    toast.success(c.activo ? `"${c.nombre}" ya no se ofrece.` : `"${c.nombre}" vuelve a ofrecerse.`)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => setEditando('nueva')}
        className="font-body inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 text-sm font-semibold text-white hover:bg-brand-green-dark"
      >
        <Plus className="h-4 w-4" /> Nueva categoría
      </button>

      {editando && (
        <Formulario
          categoria={editando === 'nueva' ? null : editando}
          contratos={contratos}
          onCerrar={() => setEditando(null)}
          onGuardado={() => { setEditando(null); router.refresh() }}
        />
      )}

      {/* `overflow-x-auto` y no `overflow-hidden`: con la tabla recortada, en un
          celular los botones de editar y apagar quedaban fuera y no había forma
          de llegar a ellos. */}
      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-left">
          <thead className="bg-gray-50">
            <tr className="font-body text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-4 py-2">Categoría</th>
              <th className="px-4 py-2">Aplica a</th>
              <th className="px-4 py-2">Nace como</th>
              <th className="px-4 py-2 text-center">Orden</th>
              <th className="px-4 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {categorias.length === 0 && (
              <tr><td colSpan={5} className="font-body px-4 py-8 text-center text-sm text-gray-500">
                No hay categorías. Crea la primera para que el QR pueda recibir reportes.
              </td></tr>
            )}
            {categorias.map((c) => (
              <tr key={c.id} className={c.activo ? '' : 'bg-gray-50/60 text-gray-400'}>
                <td className="px-4 py-2.5">
                  <p className="font-body text-sm font-semibold text-gray-900">{c.nombre}</p>
                  <p className="font-mono text-[11px] text-gray-400">{c.codigo}</p>
                  {c.descripcion && (
                    <p className="font-body mt-0.5 text-xs text-gray-500">{c.descripcion}</p>
                  )}
                </td>
                <td className="font-body px-4 py-2.5 text-sm text-gray-600">
                  {c.grupo_id
                    ? porContrato.get(c.grupo_id)
                      ? `${porContrato.get(c.grupo_id)!.codigo} · ${porContrato.get(c.grupo_id)!.nombre}`
                      : 'Un contrato'
                    : 'Todos los contratos'}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`font-body rounded-full px-2 py-0.5 text-xs font-semibold ${TIPO_PQRS_META[c.tipo_sugerido]?.cls}`}>
                    {TIPO_PQRS_META[c.tipo_sugerido]?.label ?? c.tipo_sugerido}
                  </span>
                  <span className={`font-body ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${PRIORIDAD_PQRS_META[c.prioridad_sugerida]?.cls}`}>
                    {PRIORIDAD_PQRS_META[c.prioridad_sugerida]?.label ?? c.prioridad_sugerida}
                  </span>
                </td>
                <td className="font-body px-4 py-2.5 text-center text-sm text-gray-500">{c.orden}</td>
                <td className="px-4 py-2.5 text-right">
                  <div className="inline-flex gap-1">
                    <button
                      onClick={() => setEditando(c)}
                      aria-label={`Editar ${c.nombre}`}
                      className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => apagarEncender(c)}
                      aria-label={c.activo ? `Apagar ${c.nombre}` : `Encender ${c.nombre}`}
                      title={c.activo ? 'Dejar de ofrecerla' : 'Volver a ofrecerla'}
                      className={`rounded-lg border p-1.5 ${
                        c.activo
                          ? 'border-gray-200 text-gray-500 hover:bg-gray-50'
                          : 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                      }`}
                    >
                      <Power className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Formulario({ categoria, contratos, onCerrar, onGuardado }: {
  categoria: CategoriaPqrs | null
  contratos: ContratoBreve[]
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [estado, accion, pendiente] = useActionState<ResultadoCategoria, FormData>(
    guardarCategoria, {})

  useEffect(() => {
    if (estado.ok) { toast.success('Categoría guardada.'); onGuardado() }
    else if (estado.error) toast.error(estado.error)
  }, [estado, onGuardado])

  return (
    <form action={accion} className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-semibold text-gray-900">
          {categoria ? `Editar "${categoria.nombre}"` : 'Nueva categoría'}
        </h2>
        <button type="button" onClick={onCerrar} aria-label="Cerrar" className="text-gray-400 hover:text-gray-600">
          <X className="h-4 w-4" />
        </button>
      </div>
      {categoria && <input type="hidden" name="id" value={categoria.id} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Nombre (lo lee el residente)">
          <input name="nombre" defaultValue={categoria?.nombre ?? ''} required maxLength={80}
            className="font-body w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green" />
        </Campo>
        <Campo etiqueta="Código (interno, no se muestra)">
          <input name="codigo" defaultValue={categoria?.codigo ?? ''} required maxLength={30}
            placeholder="LIMPIEZA"
            className="font-mono w-full rounded-lg border border-gray-200 px-3 py-2 text-sm uppercase outline-none focus:border-brand-green" />
        </Campo>
        <Campo etiqueta="Ayuda (opcional)" ancho="sm:col-span-2">
          <input name="descripcion" defaultValue={categoria?.descripcion ?? ''} maxLength={200}
            placeholder="Una zona quedó sucia o no se ha limpiado."
            className="font-body w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green" />
        </Campo>
        <Campo etiqueta="Aplica a">
          <select name="grupo_id" defaultValue={categoria?.grupo_id ?? ''}
            className="font-body w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
            <option value="">Todos los contratos</option>
            {contratos.map((c) => (
              <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Orden en la pantalla">
          <input name="orden" defaultValue={String(categoria?.orden ?? 50)} inputMode="numeric"
            className="font-body w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-green" />
        </Campo>
        <Campo etiqueta="Nace como tipo">
          <select name="tipo_sugerido" defaultValue={categoria?.tipo_sugerido ?? 'QUEJA'}
            className="font-body w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
            {TIPOS_PQRS.map((t) => <option key={t} value={t}>{TIPO_PQRS_META[t].label}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Nace con prioridad">
          <select name="prioridad_sugerida" defaultValue={categoria?.prioridad_sugerida ?? 'MEDIA'}
            className="font-body w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
            {PRIORIDADES_PQRS.map((p) => <option key={p} value={p}>{PRIORIDAD_PQRS_META[p].label}</option>)}
          </select>
        </Campo>
      </div>

      <label className="font-body flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" name="activo" defaultChecked={categoria ? categoria.activo : true}
          className="h-4 w-4 rounded border-gray-300" />
        Se ofrece a quien escanea el QR
      </label>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCerrar}
          className="font-body rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
          Cancelar
        </button>
        <button type="submit" disabled={pendiente}
          className="font-body inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
          {pendiente && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
        </button>
      </div>
    </form>
  )
}

function Campo({ etiqueta, ancho = '', children }: {
  etiqueta: string
  ancho?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${ancho}`}>
      <span className="font-body mb-1 block text-xs text-gray-500">{etiqueta}</span>
      {children}
    </label>
  )
}
