import type { ColumnaTabla } from '@/components/ui/tabla'
import { mesActualBogota, type FlujoProducto } from '@/lib/stock-flujo'

/**
 * Columnas "Alistamiento" y "Despacho" de las tablas de productos/stock.
 *  - Alistamiento: lo ya chuleado (ordenado) en órdenes que siguen en bodega.
 *    Es parte del reservado; debajo, lo que falta por alistar.
 *  - Despacho: lo que salió de bodega este mes; debajo, lo que va en tránsito.
 * El valor plano (filtro, orden, Excel) es el número principal; el Excel lleva
 * además "Por alistar" y "En tránsito" como columnas propias.
 */
export function columnasFlujo<T>(flujoDe: (fila: T) => FlujoProducto): ColumnaTabla<T>[] {
  const mes = mesActualBogota()
  return [
    {
      id: 'alistamiento',
      header: 'Alistamiento',
      valor: (f) => flujoDe(f).alistado,
      align: 'right',
      prioridad: 2,
      className: 'bg-indigo-50/30',
      headerClassName: 'bg-indigo-50 text-indigo-700',
      tarjeta: 'meta',
      celda: (f) => {
        const x = flujoDe(f)
        if (x.alistado === 0 && x.porAlistar === 0) return <span className="text-xs text-gray-300">—</span>
        return (
          <span
            className="inline-flex flex-col items-end leading-tight"
            title={`Alistado (ya ordenado, aún en bodega): ${x.alistado} en ${x.ordenesAlistado} orden(es)\nPor alistar: ${x.porAlistar} en ${x.ordenesPorAlistar} orden(es)`}
          >
            <span className={`font-heading text-sm font-semibold ${x.alistado > 0 ? 'text-indigo-700' : 'text-gray-300'}`}>{x.alistado}</span>
            {x.porAlistar > 0 && <span className="font-body text-[10px] text-gray-400 whitespace-nowrap">{x.porAlistar} por alistar</span>}
          </span>
        )
      },
    },
    {
      id: 'por_alistar',
      header: 'Por alistar',
      valor: (f) => flujoDe(f).porAlistar,
      align: 'right',
      prioridad: 3,
      tarjeta: 'oculto',
      className: 'text-xs text-gray-500',
    },
    {
      id: 'despacho',
      header: `Despacho (${mes})`,
      valor: (f) => flujoDe(f).despachadoMes,
      align: 'right',
      prioridad: 2,
      className: 'bg-sky-50/30',
      headerClassName: 'bg-sky-50 text-sky-700',
      tarjeta: 'meta',
      celda: (f) => {
        const x = flujoDe(f)
        if (x.despachadoMes === 0 && x.enTransito === 0) return <span className="text-xs text-gray-300">—</span>
        return (
          <span
            className="inline-flex flex-col items-end leading-tight"
            title={`Despachado en ${mes} (ya salió de bodega): ${x.despachadoMes}\nEn tránsito (despachado, sin recibir en la sede): ${x.enTransito} en ${x.ordenesEnTransito} orden(es)`}
          >
            <span className={`font-heading text-sm font-semibold ${x.despachadoMes > 0 ? 'text-sky-700' : 'text-gray-300'}`}>{x.despachadoMes}</span>
            {x.enTransito > 0 && <span className="font-body text-[10px] text-gray-400 whitespace-nowrap">{x.enTransito} en tránsito</span>}
          </span>
        )
      },
    },
    {
      id: 'en_transito',
      header: 'En tránsito',
      valor: (f) => flujoDe(f).enTransito,
      align: 'right',
      prioridad: 3,
      tarjeta: 'oculto',
      className: 'text-xs text-gray-500',
    },
  ]
}
