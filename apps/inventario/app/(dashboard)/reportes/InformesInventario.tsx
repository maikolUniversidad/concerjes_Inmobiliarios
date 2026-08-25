'use client'
import { useMemo, useState } from 'react'
import { ClipboardList, Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { INFORMES, GRUPOS_INFORME, descargarInforme } from '@/lib/reportes/informes'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2.5 font-body text-sm outline-none focus:border-brand-green bg-white'

export function InformesInventario() {
  const [id, setId] = useState(INFORMES[0].id)
  const [cargando, setCargando] = useState(false)
  const [paso, setPaso] = useState('')
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null)

  const informe = useMemo(() => INFORMES.find(i => i.id === id) ?? INFORMES[0], [id])

  async function generar() {
    if (cargando) return
    setCargando(true); setResultado(null); setPaso('Consultando…')
    try {
      const filas = await descargarInforme(informe, createClient(), setPaso)
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
        <ClipboardList className="w-5 h-5 text-brand-green" />
        <h2 className="font-heading font-semibold text-lg text-gray-900">Informes de inventario</h2>
      </div>
      <p className="font-body text-sm text-gray-500 mb-4">
        Elige el informe y descárgalo en Excel, ya organizado y con todos los datos del producto.
      </p>

      <div className="grid sm:grid-cols-[1fr,auto] gap-3 items-end">
        <div>
          <label htmlFor="informe" className="font-body font-semibold text-xs text-gray-600 uppercase">
            Informe
          </label>
          <select id="informe" value={id} onChange={e => setId(e.target.value)} disabled={cargando}
            className={inputCls + ' mt-1 disabled:opacity-60'}>
            {GRUPOS_INFORME.map(grupo => (
              <optgroup key={grupo} label={grupo}>
                {INFORMES.filter(i => i.grupo === grupo).map(i => (
                  <option key={i.id} value={i.id}>{i.nombre}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <button onClick={generar} disabled={cargando}
          className="flex items-center justify-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-xl hover:bg-brand-green-dark transition-colors disabled:opacity-60 whitespace-nowrap">
          {cargando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {cargando ? 'Generando…' : 'Descargar Excel'}
        </button>
      </div>

      <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-4">
        <p className="font-body text-sm text-gray-600">{informe.descripcion}</p>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {informe.incluye.map(x => (
            <span key={x} className="font-body text-xs bg-white border border-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
              {x}
            </span>
          ))}
        </div>
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
