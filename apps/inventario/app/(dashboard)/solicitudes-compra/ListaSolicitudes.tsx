'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FileText, ShoppingCart } from 'lucide-react'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'
import {
  ESTADO_META, ORIGEN_META, PRIORIDAD_META, formatCOP, miles, puedeConvertirse,
  type EstadoSolicitud, type OrigenSolicitud, type PrioridadSolicitud,
} from '@/lib/solicitudes-compra'
import { convertirSolicitudEnOC } from './actions'

export interface SolicitudFila {
  id: string
  numero: string
  origen: OrigenSolicitud
  estado: EstadoSolicitud
  prioridad: PrioridadSolicitud
  sede: string | null
  proveedor: string | null
  solicitante: string | null
  created_at: string
  observacion: string | null
  motivo_cierre: string | null
  items: number
  unidades: number
  valor: number
  por_convertir: number
}

type Vista = 'activas' | 'convertidas' | 'todas'

export function ListaSolicitudes({
  solicitudes,
  puedeConvertir,
}: {
  solicitudes: SolicitudFila[]
  puedeConvertir: boolean
}) {
  const router = useRouter()
  const [vista, setVista] = useState<Vista>('activas')
  const [origen, setOrigen] = useState<OrigenSolicitud | ''>('')
  const [prioridad, setPrioridad] = useState<PrioridadSolicitud | ''>('')
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [pendiente, iniciar] = useTransition()

  const kpis = useMemo(() => {
    const activas = solicitudes.filter((s) => ESTADO_META[s.estado]?.activo)
    return {
      activas: activas.length,
      urgentes: activas.filter((s) => s.prioridad === 'URGENTE' || s.prioridad === 'ALTA').length,
      unidades: activas.reduce((a, s) => a + s.unidades, 0),
      valor: activas.reduce((a, s) => a + s.valor, 0),
    }
  }, [solicitudes])

  const filtradas = useMemo(() => solicitudes
    .filter((s) => vista === 'todas' ? true
      : vista === 'activas' ? ESTADO_META[s.estado]?.activo
      : !ESTADO_META[s.estado]?.activo)
    .filter((s) => !origen || s.origen === origen)
    .filter((s) => !prioridad || s.prioridad === prioridad)
    .sort((a, b) => (PRIORIDAD_META[a.prioridad]?.orden ?? 9) - (PRIORIDAD_META[b.prioridad]?.orden ?? 9)
      || b.created_at.localeCompare(a.created_at)),
  [solicitudes, vista, origen, prioridad])

  function convertir(fila: SolicitudFila) {
    if (!confirm(`¿Convertir ${fila.numero} en orden(es) de compra? Se crea una orden por proveedor, en borrador.`)) return
    setAviso(null)
    iniciar(async () => {
      const res = await convertirSolicitudEnOC(fila.id)
      if (res.error) { setAviso({ tipo: 'error', texto: res.error }); return }
      const ordenes = res.ordenes ?? []
      const resto = res.sinProveedor
        ? ` ${res.sinProveedor} producto(s) sin proveedor quedaron en la solicitud.`
        : ''
      setAviso({
        tipo: 'ok',
        texto: `${ordenes.length} orden(es) creada(s): ${ordenes.map((o) => `${o.numero} (${o.proveedor ?? 'sin proveedor'})`).join(', ')}.${resto}`,
      })
      router.refresh()
    })
  }

  const columnas: ColumnaTabla<SolicitudFila>[] = [
    {
      id: 'numero', header: 'N° solicitud', valor: (s) => s.numero, ancho: 'w-36', tarjeta: 'titulo',
      celda: (s) => (
        <Link href={`/solicitudes-compra/${s.id}`} className="font-mono text-sm text-brand-green hover:underline">
          {s.numero}
        </Link>
      ),
    },
    {
      id: 'origen', header: 'Origen', valor: (s) => ORIGEN_META[s.origen]?.label ?? s.origen,
      prioridad: 2, className: 'text-gray-600', tarjeta: 'meta',
    },
    {
      id: 'destino', header: 'Para', valor: (s) => s.sede ?? 'Bodega central',
      ancho: 'min-w-[150px]', className: 'text-gray-700', tarjeta: 'subtitulo',
    },
    {
      // Ojo: la vista de tarjetas esconde las columnas cuyo `valor` sale vacío.
      // «Por definir» tiene que ser un valor, no solo un texto en la celda, o en
      // móvil la solicitud sin proveedor no muestra nada y parece un dato perdido.
      id: 'proveedor', header: 'Proveedor sugerido', valor: (s) => s.proveedor ?? 'Por definir',
      prioridad: 2, className: 'text-gray-600', tarjeta: 'meta',
      celda: (s) => <>{s.proveedor ?? <span className="text-orange-500">por definir</span>}</>,
    },
    { id: 'items', header: 'Productos', valor: (s) => s.items, align: 'right', prioridad: 2, tarjeta: 'meta' },
    {
      id: 'unidades', header: 'Unidades', valor: (s) => s.unidades, align: 'right', tarjeta: 'meta',
      celda: (s) => <>{miles(s.unidades)}</>,
    },
    {
      id: 'valor', header: 'Valor est.', valor: (s) => s.valor, align: 'right', tarjeta: 'meta',
      copiaTexto: (s) => String(s.valor),
      celda: (s) => <span className="font-semibold text-gray-900">{s.valor > 0 ? formatCOP(s.valor) : '—'}</span>,
    },
    {
      id: 'prioridad', header: 'Prioridad', align: 'center', prioridad: 2, tarjeta: 'badge',
      valor: (s) => PRIORIDAD_META[s.prioridad]?.label ?? s.prioridad,
      celda: (s) => (
        <span className={`font-body text-xs font-medium px-2 py-0.5 rounded-full ${PRIORIDAD_META[s.prioridad]?.cls ?? ''}`}>
          {PRIORIDAD_META[s.prioridad]?.label ?? s.prioridad}
        </span>
      ),
    },
    {
      id: 'estado', header: 'Estado', align: 'center', tarjeta: 'badge',
      valor: (s) => ESTADO_META[s.estado]?.label ?? s.estado,
      celda: (s) => (
        <span className={`font-body text-xs font-medium px-2.5 py-1 rounded-full ${ESTADO_META[s.estado]?.cls ?? ''}`}>
          {ESTADO_META[s.estado]?.label ?? s.estado}
        </span>
      ),
    },
    {
      id: 'solicitante', header: 'Solicitada por', valor: (s) => s.solicitante ?? '',
      prioridad: 3, className: 'text-xs text-gray-500', tarjeta: 'meta',
    },
    {
      id: 'fecha', header: 'Creada', prioridad: 3, className: 'text-xs text-gray-500', tarjeta: 'meta',
      valor: (s) => new Date(s.created_at).toLocaleDateString('es-CO'),
    },
  ]

  const vistas: { k: Vista; label: string }[] = [
    { k: 'activas', label: 'Activas' },
    { k: 'convertidas', label: 'Cerradas' },
    { k: 'todas', label: 'Todas' },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {[
          { label: 'Solicitudes activas', v: String(kpis.activas), cls: 'text-gray-900' },
          { label: 'Urgentes o altas', v: String(kpis.urgentes), cls: 'text-red-600' },
          { label: 'Unidades por comprar', v: miles(kpis.unidades), cls: 'text-blue-600' },
          { label: 'Valor estimado', v: formatCOP(kpis.valor), cls: 'text-brand-green' },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-sm">
            <p className="font-body text-xs text-gray-500">{k.label}</p>
            <p className={`font-heading text-2xl font-bold ${k.cls}`}>{k.v}</p>
          </div>
        ))}
      </div>

      {aviso && (
        <div className={`rounded-xl border px-4 py-3 font-body text-sm ${
          aviso.tipo === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {aviso.texto}
          {aviso.tipo === 'ok' && (
            <>{' '}<Link href="/ordenes-compra" className="font-semibold underline">Ver órdenes de compra</Link></>
          )}
        </div>
      )}

      <TablaEstandar
        id="solicitudes-compra"
        titulo="Solicitudes de compra"
        modulo="Compras"
        entidad="solicitudes_compra"
        datos={filtradas}
        columnas={columnas}
        filaId={(s) => s.id}
        busqueda="Buscar por número, sede, proveedor o persona…"
        onFilaClick={(s) => router.push(`/solicitudes-compra/${s.id}`)}
        textoDetalle="Ver"
        anchoAcciones="w-32"
        herramientas={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl bg-gray-100 p-1">
              {vistas.map((v) => (
                <button key={v.k} onClick={() => setVista(v.k)} type="button"
                  className={`rounded-lg px-3 py-1.5 font-body text-xs font-semibold ${
                    vista === v.k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {v.label}
                </button>
              ))}
            </div>
            <select value={origen} onChange={(e) => setOrigen(e.target.value as OrigenSolicitud | '')}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 font-body text-sm">
              <option value="">Todos los orígenes</option>
              {(Object.keys(ORIGEN_META) as OrigenSolicitud[]).map((o) => (
                <option key={o} value={o}>{ORIGEN_META[o].label}</option>
              ))}
            </select>
            <select value={prioridad} onChange={(e) => setPrioridad(e.target.value as PrioridadSolicitud | '')}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 font-body text-sm">
              <option value="">Toda prioridad</option>
              {(Object.keys(PRIORIDAD_META) as PrioridadSolicitud[]).map((p) => (
                <option key={p} value={p}>{PRIORIDAD_META[p].label}</option>
              ))}
            </select>
          </div>
        }
        acciones={(s) => (
          puedeConvertir && puedeConvertirse(s.estado) && s.por_convertir > 0 ? (
            <button type="button" disabled={pendiente} onClick={() => convertir(s)}
              title="Crear una orden de compra por proveedor"
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 font-body text-[11px] font-semibold text-gray-600 transition-colors hover:border-brand-green hover:bg-green-50 hover:text-brand-green disabled:opacity-50">
              <ShoppingCart className="h-3 w-3" /> A orden
            </button>
          ) : null
        )}
        vacio={
          <>
            <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300" />
            <p className="font-heading text-lg font-bold text-gray-600">Todavía no hay solicitudes de compra</p>
            <p className="mt-1 font-body text-sm text-gray-400">
              Se generan desde Aprovisionamiento (lo recomendado) y desde las órdenes pendientes por falta de stock.
            </p>
          </>
        }
      />
    </div>
  )
}
