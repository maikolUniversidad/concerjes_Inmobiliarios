'use client'
import { useState } from 'react'
import { Download, FileSpreadsheet, Loader2, Database } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { exportarExcel, GRUPOS_EXPORT, TODAS_LAS_TABLAS, type TablaExport } from '@/lib/reportes/export'

export function ReportesExport() {
  const [cargando, setCargando] = useState<string | null>(null)
  const [progreso, setProgreso] = useState('')

  async function descargar(id: string, tablas: TablaExport[], nombre: string) {
    if (cargando) return
    setCargando(id); setProgreso('')
    try {
      const supabase = createClient()
      const fecha = new Date().toISOString().slice(0, 10)
      const res = await exportarExcel(supabase, tablas, `reporte_${nombre}_${fecha}.xlsx`,
        (hoja, i, total) => setProgreso(`${hoja} (${i}/${total})`))
      setProgreso(res.error ? `Error: ${res.error}` : `✓ ${res.filas.toLocaleString('es-CO')} filas`)
    } catch (e) {
      setProgreso('Error: ' + (e instanceof Error ? e.message : 'desconocido'))
    } finally {
      setCargando(null)
      setTimeout(() => setProgreso(''), 4000)
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <Database className="w-5 h-5 text-brand-green" />
        <h2 className="font-heading font-semibold text-lg text-gray-900">Exportar datos a Excel</h2>
      </div>
      <p className="font-body text-sm text-gray-500 mb-4">
        Descarga el modelo de datos completo (una hoja por tabla) o por área. Respeta tus permisos.
      </p>

      {/* Exportar todo */}
      <button
        onClick={() => descargar('todo', TODAS_LAS_TABLAS, 'completo')}
        disabled={!!cargando}
        className="w-full flex items-center justify-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-3 rounded-xl hover:bg-brand-green-dark transition-colors disabled:opacity-60 mb-3"
      >
        {cargando === 'todo' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {cargando === 'todo' ? `Generando... ${progreso}` : `Descargar TODO (${TODAS_LAS_TABLAS.length} tablas)`}
      </button>

      {/* Por dominio */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {GRUPOS_EXPORT.map(g => (
          <button key={g.id} onClick={() => descargar(g.id, g.tablas, g.id)} disabled={!!cargando}
            className="flex items-center gap-1.5 border border-gray-200 text-gray-700 font-body font-medium text-xs px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-60">
            {cargando === g.id ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : <FileSpreadsheet className="w-3.5 h-3.5 shrink-0 text-brand-green" />}
            <span className="truncate">{g.nombre}</span>
          </button>
        ))}
      </div>

      {progreso && !cargando && <p className="font-body text-xs text-gray-500 mt-3">{progreso}</p>}
    </div>
  )
}
