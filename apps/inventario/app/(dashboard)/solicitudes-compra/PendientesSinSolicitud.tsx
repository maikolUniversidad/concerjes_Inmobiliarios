'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, GitBranch, Plus } from 'lucide-react'
import { formatCOP, miles } from '@/lib/solicitudes-compra'
import { generarSolicitudPendiente } from './actions'

export interface PendienteFila {
  orden_insumo_id: string
  numero: string
  estado: string
  created_at: string
  urgente: boolean
  sede: string | null
  orden_origen: string | null
  items: number
  unidades: number
  valor_estimado: number
}

/**
 * Órdenes pendientes por falta de stock que todavía no generaron su solicitud.
 *
 * Es la puerta donde la solicitud sale gratis (decisión §7.1): el sistema ya
 * sabe qué producto, cuánto, para qué sede y quién lo pidió, así que no hay
 * nada que escribir. Por eso el panel va arriba de la lista y no escondido en
 * un formulario.
 */
export function PendientesSinSolicitud({
  pendientes,
  puedeSolicitar,
}: {
  pendientes: PendienteFila[]
  puedeSolicitar: boolean
}) {
  const router = useRouter()
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [enCurso, setEnCurso] = useState<string | null>(null)
  const [pendiente, iniciar] = useTransition()
  const [verTodas, setVerTodas] = useState(false)

  if (pendientes.length === 0) return null

  const unidades = pendientes.reduce((a, p) => a + p.unidades, 0)
  const valor = pendientes.reduce((a, p) => a + p.valor_estimado, 0)
  const visibles = verTodas ? pendientes : pendientes.slice(0, 6)

  function generar(p: PendienteFila) {
    setAviso(null)
    setEnCurso(p.orden_insumo_id)
    iniciar(async () => {
      const res = await generarSolicitudPendiente(p.orden_insumo_id)
      setEnCurso(null)
      if (res.error) { setAviso({ tipo: 'error', texto: res.error }); return }
      setAviso({ tipo: 'ok', texto: `Solicitud creada desde ${p.numero}.` })
      router.refresh()
    })
  }

  function generarTodas() {
    if (!confirm(`¿Generar la solicitud de compra de las ${pendientes.length} órdenes pendientes?`)) return
    setAviso(null)
    iniciar(async () => {
      let hechas = 0
      const errores: string[] = []
      for (const p of pendientes) {
        const res = await generarSolicitudPendiente(p.orden_insumo_id)
        if (res.error) errores.push(`${p.numero}: ${res.error}`)
        else hechas++
      }
      setAviso(errores.length === 0
        ? { tipo: 'ok', texto: `${hechas} solicitud(es) creada(s).` }
        : { tipo: 'error', texto: `${hechas} creada(s). Sin crear: ${errores.slice(0, 3).join(' · ')}` })
      router.refresh()
    })
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-orange-200 bg-orange-50/60 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-orange-200 px-4 py-3">
        <div>
          <p className="flex items-center gap-2 font-heading text-sm font-semibold text-orange-900">
            <AlertTriangle className="h-4 w-4" />
            Órdenes pendientes por falta de stock sin solicitud
          </p>
          <p className="mt-0.5 font-body text-xs text-orange-900/70">
            {pendientes.length} orden(es) · {miles(unidades)} unidades que una sede pidió y no se pudieron despachar
            {valor > 0 && <> · {formatCOP(valor)} estimados</>}
          </p>
        </div>
        {puedeSolicitar && pendientes.length > 1 && (
          <button type="button" onClick={generarTodas} disabled={pendiente}
            className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 font-body text-sm font-semibold text-white shadow-sm transition-colors hover:bg-orange-700 disabled:opacity-50">
            <Plus className="h-4 w-4" /> Generar las {pendientes.length}
          </button>
        )}
      </div>

      {aviso && (
        <div className={`border-b px-4 py-2 font-body text-sm ${
          aviso.tipo === 'ok' ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {aviso.texto}
        </div>
      )}

      <ul className="divide-y divide-orange-100">
        {visibles.map((p) => (
          <li key={p.orden_insumo_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <div className="min-w-[160px] flex-1">
              <p className="font-body text-sm font-semibold text-gray-900">
                <Link href={`/ordenes-insumo/${p.orden_insumo_id}`} className="hover:underline">{p.numero}</Link>
                {p.urgente && (
                  <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 font-body text-[10px] font-bold text-red-700">URGENTE</span>
                )}
              </p>
              <p className="font-body text-xs text-gray-500">
                {p.sede ?? 'sin sede'}
                {p.orden_origen && (
                  <>
                    {' · '}
                    <GitBranch className="inline h-3 w-3 align-[-2px]" />
                    {' '}de {p.orden_origen}
                  </>
                )}
              </p>
            </div>
            <p className="font-body text-xs text-gray-600">
              {p.items} producto(s) · {miles(p.unidades)} uds
              {p.valor_estimado > 0 && <> · {formatCOP(p.valor_estimado)}</>}
            </p>
            {puedeSolicitar && (
              <button type="button" onClick={() => generar(p)} disabled={pendiente}
                className="inline-flex items-center gap-1 rounded-lg border border-orange-300 bg-white px-2.5 py-1.5 font-body text-xs font-semibold text-orange-800 transition-colors hover:bg-orange-100 disabled:opacity-50">
                <Plus className="h-3.5 w-3.5" />
                {enCurso === p.orden_insumo_id ? 'Generando…' : 'Generar solicitud'}
              </button>
            )}
          </li>
        ))}
      </ul>

      {pendientes.length > visibles.length && (
        <button type="button" onClick={() => setVerTodas(true)}
          className="w-full border-t border-orange-100 px-4 py-2 font-body text-xs font-semibold text-orange-800 hover:bg-orange-100">
          Ver las {pendientes.length - visibles.length} restantes
        </button>
      )}
    </div>
  )
}
