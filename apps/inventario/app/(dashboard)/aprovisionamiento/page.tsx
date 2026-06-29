import type { Metadata } from 'next'
import { RefreshCw, FileText, AlertTriangle, TrendingUp, Download, ChevronRight } from 'lucide-react'

export const metadata: Metadata = { title: 'Aprovisionamiento' }

// Replica lógica de la hoja "Aprov" del CMI Reabastecimiento
const mockAprov = [
  {
    ref: 720, codigo: 1,
    nombre: 'CAFE SOCIAL ORGANICO Y/O ARTESANAL', presentacion: 'PAQUETE X LIBRA',
    cat: 'A',
    stock_inicio: 183, stock_minimo: 50,
    pedido_ca: 8, pedido_mo: 12, pedido_mb: 6, pedido_pb: 4, pedido_ad: 2,
    pedido_calculado: 32, control_agotados: 0,
    sugerido_compra: 32, oc_pendiente: 0, adicional: 0,
    proveedor: 'CONSERJES', precio: 28500,
    total_compras: 32,
  },
  {
    ref: 719, codigo: 2,
    nombre: 'CAFE SOCIAL TIPO BORBON 100% TOSTADO', presentacion: 'PAQUETE X LIBRA',
    cat: 'A',
    stock_inicio: 387, stock_minimo: 40,
    pedido_ca: 15, pedido_mo: 20, pedido_mb: 10, pedido_pb: 8, pedido_ad: 5,
    pedido_calculado: 58, control_agotados: 0,
    sugerido_compra: 0, oc_pendiente: 60, adicional: 0,
    proveedor: 'CONSERJES', precio: 24000,
    total_compras: 0,
  },
  {
    ref: 718, codigo: 3,
    nombre: 'JABON PARA LOZA LIQUIDO CON FRAGANCIA', presentacion: 'GALON',
    cat: 'A',
    stock_inicio: 188, stock_minimo: 80,
    pedido_ca: 20, pedido_mo: 30, pedido_mb: 15, pedido_pb: 12, pedido_ad: 8,
    pedido_calculado: 85, control_agotados: 0,
    sugerido_compra: 85, oc_pendiente: 0, adicional: 10,
    proveedor: 'CONSERJES', precio: 45000,
    total_compras: 95,
  },
  {
    ref: 715, codigo: 6,
    nombre: 'JABON MULTIUSOS CONCENTRADO', presentacion: 'TARRO X KILO',
    cat: 'A',
    stock_inicio: 40, stock_minimo: 20,
    pedido_ca: 5, pedido_mo: 8, pedido_mb: 4, pedido_pb: 3, pedido_ad: 2,
    pedido_calculado: 22, control_agotados: 2,
    sugerido_compra: 24, oc_pendiente: 0, adicional: 0,
    proveedor: 'CONSERJES', precio: 18500,
    total_compras: 24,
  },
  {
    ref: 714, codigo: 7,
    nombre: 'LIMPIADOR MULTIUSOS DESINFECTANTE', presentacion: 'GALON',
    cat: 'B',
    stock_inicio: 12, stock_minimo: 25,
    pedido_ca: 10, pedido_mo: 15, pedido_mb: 8, pedido_pb: 6, pedido_ad: 4,
    pedido_calculado: 43, control_agotados: 5,
    sugerido_compra: 48, oc_pendiente: 0, adicional: 0,
    proveedor: 'CONSERJES', precio: 52000,
    total_compras: 48,
  },
]

function getCatColor(cat: string) {
  return { A: 'bg-green-100 text-green-700', B: 'bg-blue-100 text-blue-700', C: 'bg-amber-100 text-amber-700', D: 'bg-red-100 text-red-700' }[cat] ?? 'bg-gray-100 text-gray-700'
}

function getStockAlert(inicio: number, minimo: number) {
  if (inicio <= 0) return 'text-red-600 font-bold'
  if (inicio <= minimo) return 'text-red-600'
  if (inicio <= minimo * 1.5) return 'text-amber-600'
  return 'text-gray-900'
}

function formatCOP(n: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
}

export default function AprovisionamientoPage() {
  const periodo = 'JUNIO 2026'
  const totalComprar = mockAprov.reduce((s, r) => s + r.total_compras, 0)
  const valorTotal = mockAprov.reduce((s, r) => s + r.total_compras * r.precio, 0)
  const enAlerta = mockAprov.filter(r => r.stock_inicio <= r.stock_minimo).length

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading font-bold text-2xl text-gray-900">Aprovisionamiento</h1>
            <span className="bg-brand-green text-white font-body text-xs font-semibold px-2.5 py-1 rounded-full">{periodo}</span>
          </div>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            Planificación de compras basada en CMI Reabastecimiento · Hoja Aprov
          </p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 border border-gray-200 text-gray-600 font-body text-sm px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors">
            <Download className="w-4 h-4" />
            Exportar
          </button>
          <button className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm">
            <FileText className="w-4 h-4" />
            Generar OC
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Productos a comprar', value: mockAprov.filter(r => r.total_compras > 0).length.toString(), sub: 'de ' + mockAprov.length + ' en plan', color: 'border-blue-200 bg-blue-50 text-blue-700' },
          { label: 'Unidades totales', value: totalComprar.toString(), sub: 'en pedido calculado', color: 'border-green-200 bg-green-50 text-green-700' },
          { label: 'Valor estimado', value: formatCOP(valorTotal), sub: 'precio lista', color: 'border-purple-200 bg-purple-50 text-purple-700' },
          { label: 'En alerta stock', value: enAlerta.toString(), sub: 'bajo mínimo', color: 'border-red-200 bg-red-50 text-red-700' },
        ].map(k => (
          <div key={k.label} className={`rounded-xl border p-4 ${k.color}`}>
            <p className="font-heading font-bold text-2xl">{k.value}</p>
            <p className="font-body font-semibold text-xs mt-0.5">{k.label}</p>
            <p className="font-body text-xs opacity-70">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* Main CMI table */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-brand-green" />
          <h2 className="font-heading font-semibold text-sm text-gray-900">Plan de Reabastecimiento</h2>
          <span className="font-body text-xs text-gray-400">— Hoja Aprov digitalizada</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5 min-w-[40px]">REF</th>
                <th className="text-left font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5 min-w-[200px]">Producto</th>
                <th className="text-center font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5">Cat.</th>
                {/* Stock */}
                <th className="text-right font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5 bg-blue-50/50">Stock Ini.</th>
                <th className="text-right font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5 bg-blue-50/50">Mín.</th>
                {/* Pedidos por grupo */}
                <th className="text-right font-body font-semibold text-blue-600 uppercase tracking-wide px-3 py-2.5 bg-blue-50">C.A.</th>
                <th className="text-right font-body font-semibold text-purple-600 uppercase tracking-wide px-3 py-2.5 bg-purple-50">M.O.</th>
                <th className="text-right font-body font-semibold text-green-600 uppercase tracking-wide px-3 py-2.5 bg-green-50">M.B.</th>
                <th className="text-right font-body font-semibold text-orange-600 uppercase tracking-wide px-3 py-2.5 bg-orange-50">P.B.</th>
                <th className="text-right font-body font-semibold text-gray-600 uppercase tracking-wide px-3 py-2.5 bg-gray-100">A.D.</th>
                {/* Cálculo */}
                <th className="text-right font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5">Ped. Calc.</th>
                <th className="text-right font-body font-semibold text-red-500 uppercase tracking-wide px-3 py-2.5">Agotados</th>
                <th className="text-right font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5">Sug. Compra</th>
                <th className="text-right font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5">OC Pend.</th>
                <th className="text-right font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5">Adicional</th>
                <th className="text-right font-body font-semibold text-brand-green uppercase tracking-wide px-3 py-2.5 bg-green-50">Total</th>
                <th className="text-right font-body font-semibold text-gray-500 uppercase tracking-wide px-3 py-2.5">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {mockAprov.map(r => (
                <tr key={r.ref} className={`hover:bg-gray-50/50 transition-colors ${r.stock_inicio <= r.stock_minimo ? 'bg-red-50/30' : ''}`}>
                  <td className="px-3 py-2.5">
                    <span className="font-mono text-gray-500">{r.ref}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-gray-900 max-w-[200px] truncate">{r.nombre}</p>
                    <p className="text-gray-400">{r.presentacion}</p>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className={`font-bold px-1.5 py-0.5 rounded ${getCatColor(r.cat)}`}>{r.cat}</span>
                  </td>
                  <td className={`px-3 py-2.5 text-right font-bold bg-blue-50/30 ${getStockAlert(r.stock_inicio, r.stock_minimo)}`}>
                    {r.stock_inicio}
                    {r.stock_inicio <= r.stock_minimo && <AlertTriangle className="w-3 h-3 inline ml-1 text-red-500" />}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-500 bg-blue-50/30">{r.stock_minimo}</td>
                  <td className="px-3 py-2.5 text-right bg-blue-50/20">{r.pedido_ca || '—'}</td>
                  <td className="px-3 py-2.5 text-right bg-purple-50/20">{r.pedido_mo || '—'}</td>
                  <td className="px-3 py-2.5 text-right bg-green-50/20">{r.pedido_mb || '—'}</td>
                  <td className="px-3 py-2.5 text-right bg-orange-50/20">{r.pedido_pb || '—'}</td>
                  <td className="px-3 py-2.5 text-right bg-gray-50">{r.pedido_ad || '—'}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-gray-700">{r.pedido_calculado}</td>
                  <td className="px-3 py-2.5 text-right text-red-600">{r.control_agotados > 0 ? r.control_agotados : '—'}</td>
                  <td className="px-3 py-2.5 text-right font-semibold">{r.sugerido_compra}</td>
                  <td className="px-3 py-2.5 text-right text-amber-600">{r.oc_pendiente > 0 ? r.oc_pendiente : '—'}</td>
                  <td className="px-3 py-2.5 text-right">{r.adicional > 0 ? r.adicional : '—'}</td>
                  <td className={`px-3 py-2.5 text-right font-bold bg-green-50/50 ${r.total_compras > 0 ? 'text-brand-green' : 'text-gray-300'}`}>
                    {r.total_compras > 0 ? r.total_compras : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-600">
                    {r.total_compras > 0 ? formatCOP(r.total_compras * r.precio) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold">
                <td colSpan={15} className="px-3 py-2.5 text-right text-sm text-gray-700">TOTALES →</td>
                <td className="px-3 py-2.5 text-right text-brand-green font-bold text-sm bg-green-100">{totalComprar}</td>
                <td className="px-3 py-2.5 text-right text-gray-700 text-sm">{formatCOP(valorTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Navigation to group sheets */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-4">
        <p className="font-heading font-semibold text-sm text-gray-700 mb-3">Pedidos por Grupo de Contrato</p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {(['CA','MO','MB','PB','AD'] as const).map(g => (
            <a
              key={g}
              href={`/pedidos/${g.toLowerCase()}`}
              className="flex items-center justify-between gap-2 border border-gray-200 rounded-xl px-3 py-2.5 hover:border-brand-green hover:bg-green-50/30 transition-all group"
            >
              <div>
                <p className="font-heading font-bold text-sm text-gray-900">{g}</p>
                <p className="font-body text-xs text-gray-400">Ver pedidos</p>
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-brand-green transition-colors" />
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
