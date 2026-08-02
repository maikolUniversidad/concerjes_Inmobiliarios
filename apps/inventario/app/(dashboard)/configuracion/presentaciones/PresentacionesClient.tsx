'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Loader2, Search, Package2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

export interface PresRow { id: string; nombre: string; activo: boolean }

export function PresentacionesClient({ presentaciones: init, puedeEditar }: { presentaciones: PresRow[]; puedeEditar: boolean }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [rows, setRows] = useState<PresRow[]>(init)
  const [nueva, setNueva] = useState('')
  const [q, setQ] = useState('')
  const [saving, setSaving] = useState(false)

  const filtradas = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? rows.filter((r) => r.nombre.toLowerCase().includes(t)) : rows
  }, [rows, q])

  async function agregar() {
    const nombre = nueva.trim().toUpperCase()
    if (!nombre) return
    if (rows.some((r) => r.nombre.toUpperCase() === nombre)) { toast.info('Esa presentación ya existe.'); return }
    setSaving(true)
    try {
      const { data, error } = await sb.from('presentaciones').insert({ nombre }).select('id, nombre, activo').single()
      if (error || !data) { toast.error(/row-level security/.test(error?.message ?? '') ? 'Sin permisos.' : 'No se pudo agregar.'); return }
      setRows((prev) => [...prev, data as PresRow].sort((a, b) => a.nombre.localeCompare(b.nombre)))
      setNueva('')
    } finally { setSaving(false) }
  }

  async function toggleActivo(r: PresRow) {
    const nuevo = !r.activo
    setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, activo: nuevo } : x))
    const { error } = await sb.from('presentaciones').update({ activo: nuevo }).eq('id', r.id)
    if (error) { toast.error('No se pudo actualizar.'); setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, activo: !nuevo } : x)) }
  }

  async function eliminar(r: PresRow) {
    if (!window.confirm(`¿Eliminar "${r.nombre}"?`)) return
    const prev = rows
    setRows((p) => p.filter((x) => x.id !== r.id))
    const { error } = await sb.from('presentaciones').delete().eq('id', r.id)
    if (error) { setRows(prev); toast.error('No se pudo eliminar.') }
  }

  return (
    <div className="space-y-4">
      <Link href="/configuracion" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green">
        <ArrowLeft className="w-4 h-4" /> Volver a Configuración
      </Link>

      {puedeEditar && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-center gap-2">
          <input value={nueva} onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') agregar() }}
            placeholder="Nueva presentación (ej. GALÓN, CAJA X 12)…"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green" />
          <button onClick={agregar} disabled={saving || !nueva.trim()}
            className="inline-flex items-center gap-1.5 bg-brand-green hover:bg-brand-green-dark text-white font-body font-semibold text-sm px-4 py-2 rounded-lg disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Agregar
          </button>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <Search className="w-4 h-4 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…"
            className="flex-1 font-body text-sm outline-none placeholder:text-gray-400" />
          <span className="font-body text-xs text-gray-400">{filtradas.length}</span>
        </div>
        <div className="divide-y divide-gray-50 max-h-[60vh] overflow-y-auto">
          {filtradas.length === 0 && (
            <div className="py-12 text-center"><Package2 className="w-10 h-10 text-gray-200 mx-auto mb-2" /><p className="font-body text-sm text-gray-400">Sin presentaciones.</p></div>
          )}
          {filtradas.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50/60">
              <span className={`font-body text-sm ${r.activo ? 'text-gray-800' : 'text-gray-400 line-through'}`}>{r.nombre}</span>
              {puedeEditar && (
                <div className="flex items-center gap-1">
                  <button onClick={() => toggleActivo(r)} title={r.activo ? 'Desactivar' : 'Activar'}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${r.activo ? 'bg-brand-green' : 'bg-gray-200'}`}>
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${r.activo ? 'translate-x-4' : 'translate-x-0.5'}`} />
                  </button>
                  <button onClick={() => eliminar(r)} className="p-1.5 rounded-lg text-gray-300 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
