import type { Metadata } from 'next'
import { Boxes, TrendingDown, TrendingUp, ArrowRightLeft, AlertCircle } from 'lucide-react'

export const metadata: Metadata = { title: 'Stock' }

const mockStock = [
  { ref:720, nombre:'CAFE SOCIAL ORGANICO', presentacion:'PAQUETE X LIBRA', cat:'A', real:183, disp:183, entrante:32, saliente:18, minimo:50, estado:'normal' },
  { ref:719, nombre:'CAFE SOCIAL TIPO BORBON', presentacion:'PAQUETE X LIBRA', cat:'A', real:387, disp:327, entrante:0, saliente:60, minimo:40, estado:'normal' },
  { ref:718, nombre:'JABON PARA LOZA LIQUIDO', presentacion:'GALON', cat:'A', real:188, disp:103, entrante:85, saliente:85, minimo:80, estado:'normal' },
  { ref:717, nombre:'JABON PARA LOZA LIQUIDO', presentacion:'TARRO X 500 ML', cat:'A', real:63, disp:41, entrante:22, saliente:22, minimo:30, estado:'bajo' },
  { ref:716, nombre:'HOMOLOGO JABON PARA LOZA', presentacion:'TARRO X 900 GR', cat:'D', real:0, disp:0, entrante:0, saliente:0, minimo:0, estado:'nd' },
  { ref:715, nombre:'JABON MULTIUSOS CONCENTRADO', presentacion:'TARRO X KILO', cat:'A', real:40, disp:16, entrante:24, saliente:24, minimo:20, estado:'bajo' },
  { ref:714, nombre:'LIMPIADOR MULTIUSOS DESINF.', presentacion:'GALON', cat:'B', real:12, disp:0, entrante:48, saliente:48, minimo:25, estado:'critico' },
]

const catColor: Record<string, string> = {
  A:'bg-green-100 text-green-700', B:'bg-blue-100 text-blue-700',
  C:'bg-amber-100 text-amber-700', D:'bg-gray-100 text-gray-400'
}
const estadoStyle: Record<string, string> = {
  normal:'bg-green-100 text-green-700',
  bajo:'bg-yellow-100 text-yellow-700',
  critico:'bg-red-100 text-red-700',
  nd:'bg-gray-100 text-gray-400'
}
const estadoLabel: Record<string, string> = { normal:'Normal', bajo:'Bajo', critico:'Crítico', nd:'N/D' }

export default function StockPage() {
  const criticos = mockStock.filter(s => s.estado === 'critico' || s.estado === 'bajo').length
  const totalReal = mockStock.reduce((a, s) => a + s.real, 0)
  const totalEntrante = mockStock.reduce((a, s) => a + s.entrante, 0)
  const totalSaliente = mockStock.reduce((a, s) => a + s.saliente, 0)

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Stock en Tiempo Real</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">Inventario actual · cantidad real, disponible, entrante y saliente</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: Boxes, label: 'Unidades totales', value: totalReal.toLocaleString(), color: 'text-blue-600', bg: 'bg-blue-50 border-blue-100' },
          { icon: TrendingUp, label: 'Entrante período', value: '+' + totalEntrante, color: 'text-green-600', bg: 'bg-green-50 border-green-100' },
          { icon: TrendingDown, label: 'Saliente período', value: '-' + totalSaliente, color: 'text-orange-600', bg: 'bg-orange-50 border-orange-100' },
          { icon: AlertCircle, label: 'Alertas stock', value: criticos.toString(), color: 'text-red-600', bg: 'bg-red-50 border-red-100' },
        ].map(k => (
          <div key={k.label} className={`rounded-xl border p-4 ${k.bg} flex items-start gap-3`}>
            <k.icon className={`w-5 h-5 mt-0.5 ${k.color}`} />
            <div>
              <p className="font-heading font-bold text-2xl text-gray-900">{k.value}</p>
              <p className={`font-body text-xs ${k.color}`}>{k.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabla stock */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Producto</th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Cat.</th>
                <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3 bg-gray-100/60">Real</th>
                <th className="text-right font-body font-semibold text-xs text-green-600 uppercase tracking-wide px-4 py-3 bg-green-50">Disponible</th>
                <th className="text-right font-body font-semibold text-xs text-blue-600 uppercase tracking-wide px-4 py-3 bg-blue-50">Entrante</th>
                <th className="text-right font-body font-semibold text-xs text-orange-600 uppercase tracking-wide px-4 py-3 bg-orange-50">Saliente</th>
                <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Mínimo</th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {mockStock.map(s => (
                <tr key={s.ref} className={`hover:bg-gray-50/50 transition-colors ${s.estado === 'critico' ? 'bg-red-50/20' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-400">{s.ref}</span>
                      <div>
                        <p className="font-body font-medium text-sm text-gray-900">{s.nombre}</p>
                        <p className="font-body text-xs text-gray-400">{s.presentacion}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-body font-bold text-xs px-2 py-0.5 rounded-full ${catColor[s.cat]}`}>{s.cat}</span>
                  </td>
                  <td className="px-4 py-3 text-right bg-gray-50/40">
                    <span className="font-heading font-bold text-base text-gray-900">{s.real}</span>
                  </td>
                  <td className="px-4 py-3 text-right bg-green-50/30">
                    <span className="font-heading font-semibold text-sm text-green-700">{s.disp}</span>
                  </td>
                  <td className="px-4 py-3 text-right bg-blue-50/30">
                    {s.entrante > 0
                      ? <span className="font-body text-sm text-blue-600 font-semibold">+{s.entrante}</span>
                      : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right bg-orange-50/30">
                    {s.saliente > 0
                      ? <span className="font-body text-sm text-orange-600 font-semibold">-{s.saliente}</span>
                      : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-body text-sm text-gray-500">{s.minimo || '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`font-body text-xs font-medium px-2.5 py-1 rounded-full ${estadoStyle[s.estado]}`}>
                      {estadoLabel[s.estado]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-gray-100 px-4 py-3 flex items-center justify-between">
          <p className="font-body text-xs text-gray-500">Mostrando 7 de 720 productos · actualizado ahora</p>
          <button className="flex items-center gap-1.5 text-brand-green font-body text-xs hover:underline">
            <ArrowRightLeft className="w-3.5 h-3.5" />
            Registrar movimiento
          </button>
        </div>
      </div>
    </div>
  )
}
