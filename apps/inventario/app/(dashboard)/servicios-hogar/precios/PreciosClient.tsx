'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, X, Save, Loader2, DollarSign } from 'lucide-react'
import { upsertTarifa, deleteTarifa } from '../actions'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

function fmt(v?: number | null) {
  if (!v) return '—'
  return `$${v.toLocaleString('es-CO')}`
}

const VACIO = {
  tipo_id: '', nombre: '', duracion_horas: 2,
  precio_unico: 0, precio_semanal: undefined as number | undefined,
  precio_quincenal: undefined as number | undefined,
  precio_mensual: undefined as number | undefined,
  personas_incluidas: 1, activo: true,
}

export default function PreciosClient({ tarifas, tipos }: { tarifas: any[]; tipos: any[] }) {
  const router = useRouter()
  const [filtroTipo, setFiltroTipo] = useState('')
  const [modal, setModal] = useState<any | null>(null)
  const [, startTransition] = useTransition()
  const [saving, setSaving] = useState(false)

  function abrir(t?: any) {
    setModal(t ? { ...t } : { ...VACIO, tipo_id: filtroTipo || tipos[0]?.id || '' })
  }

  function cerrar() { setModal(null) }

  async function guardar() {
    if (!modal) return
    setSaving(true)
    try {
      await upsertTarifa(modal)
      cerrar()
      startTransition(() => router.refresh())
    } finally {
      setSaving(false)
    }
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar esta tarifa?')) return
    await deleteTarifa(id)
    startTransition(() => router.refresh())
  }

  const filtradas = filtroTipo ? tarifas.filter((t: any) => t.tipo_id === filtroTipo) : tarifas

  const columnas: ColumnaTabla<any>[] = [
    {
      id: 'tipo', header: 'Tipo de servicio', prioridad: 2, tarjeta: 'subtitulo',
      valor: (t: any) => t.tipos_servicio_hogar?.nombre ?? 'Sin tipo',
      celda: (t: any) => (
        <span className="inline-flex items-center gap-1.5 text-gray-700">
          <span>{t.tipos_servicio_hogar?.icono}</span>
          {t.tipos_servicio_hogar?.nombre ?? 'Sin tipo'}
        </span>
      ),
    },
    { id: 'nombre', header: 'Nombre', valor: (t: any) => t.nombre ?? '', className: 'font-medium text-gray-900', tarjeta: 'titulo' },
    { id: 'duracion', header: 'Duración', valor: (t: any) => t.duracion_horas ?? 0, align: 'right', prioridad: 2, tarjeta: 'meta',
      celda: (t: any) => <span className="text-gray-600">{t.duracion_horas}h</span> },
    { id: 'personas', header: 'Personas', valor: (t: any) => t.personas_incluidas ?? 0, align: 'right', prioridad: 3, className: 'text-gray-600', tarjeta: 'meta' },
    {
      id: 'unico', header: 'Precio único', valor: (t: any) => t.precio_unico ?? 0, align: 'right', tarjeta: 'meta',
      copiaTexto: (t: any) => (t.precio_unico != null ? String(t.precio_unico) : ''),
      celda: (t: any) => <span className="font-semibold text-brand-green">{fmt(t.precio_unico)}</span>,
    },
    {
      id: 'semanal', header: 'Semanal', valor: (t: any) => t.precio_semanal ?? 0, align: 'right', prioridad: 3, tarjeta: 'meta',
      copiaTexto: (t: any) => (t.precio_semanal != null ? String(t.precio_semanal) : ''),
      celda: (t: any) => <span className="text-gray-600">{fmt(t.precio_semanal)}</span>,
    },
    {
      id: 'quincenal', header: 'Quincenal', valor: (t: any) => t.precio_quincenal ?? 0, align: 'right', prioridad: 3, tarjeta: 'meta',
      copiaTexto: (t: any) => (t.precio_quincenal != null ? String(t.precio_quincenal) : ''),
      celda: (t: any) => <span className="text-gray-600">{fmt(t.precio_quincenal)}</span>,
    },
    {
      id: 'mensual', header: 'Mensual', valor: (t: any) => t.precio_mensual ?? 0, align: 'right', prioridad: 2, tarjeta: 'meta',
      copiaTexto: (t: any) => (t.precio_mensual != null ? String(t.precio_mensual) : ''),
      celda: (t: any) => <span className="text-gray-600">{fmt(t.precio_mensual)}</span>,
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        {/* Filtro por tipo */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFiltroTipo('')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${!filtroTipo ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:border-green-300'}`}>
            Todos
          </button>
          {tipos.map((t: any) => (
            <button key={t.id} onClick={() => setFiltroTipo(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${filtroTipo === t.id ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:border-green-300'}`}>
              {t.icono} {t.nombre}
            </button>
          ))}
        </div>

        <button onClick={() => abrir()}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-green-dark transition-colors shadow-sm shrink-0">
          <Plus className="w-4 h-4" /> Nueva tarifa
        </button>
      </div>

      <TablaEstandar
        id="servicios-precios"
        titulo="Tarifas de servicios"
        modulo="Servicios del Hogar"
        entidad="tarifas_servicio_hogar"
        datos={filtradas}
        columnas={columnas}
        filaId={(t: any) => String(t.id)}
        busqueda="Buscar tarifa por nombre o tipo…"
        anchoAcciones="w-20"
        acciones={(t: any) => (
          <>
            <button onClick={() => abrir(t)} title="Editar tarifa"
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              <Pencil className="w-3.5 h-3.5 text-gray-400" />
            </button>
            <button onClick={() => eliminar(t.id)} title="Eliminar tarifa"
              className="p-1.5 rounded-lg hover:bg-red-50 transition-colors">
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
            </button>
          </>
        )}
        vacio={<p className="text-sm text-gray-400">No hay tarifas configuradas. Crea la primera con el botón superior.</p>}
      />

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={cerrar}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-bold text-gray-900">{modal.id ? 'Editar tarifa' : 'Nueva tarifa'}</h3>
              <button onClick={cerrar}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Tipo de servicio *</label>
                <select value={modal.tipo_id} onChange={e => setModal({ ...modal, tipo_id: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-green">
                  {tipos.map((t: any) => <option key={t.id} value={t.id}>{t.icono} {t.nombre}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Nombre *</label>
                <input value={modal.nombre} onChange={e => setModal({ ...modal, nombre: e.target.value })}
                  placeholder="Ej: Medio día"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-green" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Duración (horas) *</label>
                  <input type="number" step="0.5" value={modal.duracion_horas} onChange={e => setModal({ ...modal, duracion_horas: parseFloat(e.target.value) })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-green" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 mb-1.5 block">Personas</label>
                  <input type="number" value={modal.personas_incluidas} onChange={e => setModal({ ...modal, personas_incluidas: parseInt(e.target.value) })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-green" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'precio_unico', label: 'Precio único *' },
                  { key: 'precio_semanal', label: 'Precio semanal' },
                  { key: 'precio_quincenal', label: 'Precio quincenal' },
                  { key: 'precio_mensual', label: 'Precio mensual' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-xs font-semibold text-gray-600 mb-1.5 block">{label}</label>
                    <div className="relative">
                      <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input type="number" value={modal[key] ?? ''}
                        onChange={e => setModal({ ...modal, [key]: e.target.value ? parseFloat(e.target.value) : undefined })}
                        placeholder="0"
                        className="w-full pl-7 border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand-green" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-3 p-5 border-t">
              <button onClick={cerrar} className="flex-1 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button onClick={guardar} disabled={saving || !modal.nombre || !modal.tipo_id}
                className="flex-1 bg-brand-green text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-brand-green-dark disabled:opacity-60 transition-colors">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
