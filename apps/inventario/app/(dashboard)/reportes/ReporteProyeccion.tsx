'use client'
import { useState } from 'react'
import { TrendingUp, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { descargarReporteProyeccion } from '@/lib/reportes/reporte-proyeccion'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 font-body text-sm outline-none focus:border-brand-green bg-white disabled:opacity-60'

const HOJAS = ['Inventario (real, reservado, disponible)', 'Consumo por mes', 'Proyección y compra sugerida', 'Estadísticas con fórmulas', 'Conteo físico vs. sistema']

/** Reporte de inventario con estadísticas y proyección por la diferencia (real − reservado). */
export function ReporteProyeccion() {
  const [meses, setMeses] = useState(6)
  const [dias, setDias] = useState(30)
  const [cargando, setCargando] = useState(false)
  const [paso, setPaso] = useState('')
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null)

  async function generar() {
    if (cargando) return
    setCargando(true); setResultado(null); setPaso('Consultando…')
    try {
      const filas = await descargarReporteProyeccion(createClient(), { meses, diasCompra: dias }, setPaso)
      setResultado({ ok: true, texto: `Descargado · ${filas.toLocaleString('es-CO')} filas` })
    } catch (e) {
      setResultado({ ok: false, texto: e instanceof Error ? e.message : 'Error desconocido' })
    } finally {
      setCargando(false); setPaso('')
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <TrendingUp className="w-5 h-5 text-brand-green" />
        <h2 className="font-heading font-semibold text-lg text-gray-900">Inventario, consumo y proyección</h2>
      </div>
      <p className="font-body text-sm text-gray-500 mb-4">
        Excel con el stock real, lo reservado en pedidos sin despachar y la diferencia disponible; el consumo
        de cada mes y la proyección: días de cobertura, fecha de agotamiento, tendencia y cuánto comprar.
        Lo que ya está en negativo (se pidió más de lo que hay) sale en rojo. Todo por ítem y nombre.
      </p>

      <div className="grid sm:grid-cols-[1fr,1fr,auto] gap-3 items-end">
        <div>
          <label htmlFor="proy-meses" className="font-body font-semibold text-xs text-gray-600 uppercase">Historia de consumo</label>
          <select id="proy-meses" value={meses} onChange={e => setMeses(Number(e.target.value))} disabled={cargando} className={inputCls + ' mt-1'}>
            <option value={3}>Últimos 3 meses</option>
            <option value={6}>Últimos 6 meses</option>
            <option value={12}>Últimos 12 meses</option>
          </select>
        </div>
        <div>
          <label htmlFor="proy-dias" className="font-body font-semibold text-xs text-gray-600 uppercase">Comprar para cubrir</label>
          <select id="proy-dias" value={dias} onChange={e => setDias(Number(e.target.value))} disabled={cargando} className={inputCls + ' mt-1'}>
            <option value={15}>15 días</option>
            <option value={30}>30 días</option>
            <option value={45}>45 días</option>
            <option value={60}>60 días</option>
            <option value={90}>90 días</option>
          </select>
        </div>
        <button onClick={generar} disabled={cargando}
          className="flex items-center justify-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-brand-green-dark transition-colors disabled:opacity-60 whitespace-nowrap">
          {cargando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {cargando ? 'Generando…' : 'Descargar Excel'}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-4">
        {HOJAS.map(h => (
          <span key={h} className="font-body text-xs bg-gray-50 border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{h}</span>
        ))}
      </div>

      {cargando && paso && (
        <p className="font-body text-xs text-gray-500 mt-3 flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> {paso}
        </p>
      )}
      {!cargando && resultado && (
        <p className={`font-body text-xs mt-3 flex items-center gap-1.5 ${resultado.ok ? 'text-brand-green' : 'text-red-600'}`}>
          {resultado.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
          {resultado.texto}
        </p>
      )}
    </div>
  )
}
