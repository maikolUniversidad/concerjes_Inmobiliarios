'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MapPin, Search, Loader2, Check, X, Pencil, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginado'
import { actualizarSedeOrden } from '../actions'

interface SedeOpt { id: string; nombre: string; grupo: string | null }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

/**
 * Sede de destino de la orden. Deja corregirla cuando se eligió mal al crear
 * el pedido: cambia solo el destino (los productos y el alistamiento siguen
 * igual) y queda registrado en la trazabilidad.
 *
 * El listado de sedes se carga cuando se abre el buscador, no al pintar la
 * página: son cientos de sedes y casi nunca hay que cambiarla.
 */
export function SedeEditor({ ordenId, sedeId, sedeNombre, grupo, direccion, estado, puedeEditar }: {
  ordenId: string
  sedeId: string | null
  sedeNombre: string | null
  grupo: string | null
  direccion: string | null
  estado: string
  puedeEditar: boolean
}) {
  const router = useRouter()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [editando, setEditando] = useState(false)
  const [sedes, setSedes] = useState<SedeOpt[]>([])
  const [cargando, setCargando] = useState(false)
  const [buscar, setBuscar] = useState('')
  const [pending, start] = useTransition()

  // Cerrada = el pedido ya llegó a su destino; el servidor también lo bloquea.
  const cerrada = ['ENTREGADO', 'RECIBIDO', 'ANULADA'].includes(estado)
  // Ya salió de bodega: el cambio no reescribe los movimientos de stock que
  // quedaron registrados hacia la sede anterior.
  const yaDespachada = ['DESPACHADO', 'EN_RUTA'].includes(estado)
  const editable = puedeEditar && !cerrada

  useEffect(() => {
    if (!editando || sedes.length > 0) return
    let vivo = true
    setCargando(true)
    // Paginado: PostgREST corta en 1.000 filas por respuesta.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    traerTodo<any>((desde, hasta) =>
      sb.from('sedes').select('id, nombre, grupo:grupos_contrato ( nombre )')
        .eq('activo', true).order('nombre').order('id').range(desde, hasta),
    )
      .then((filas) => {
        if (!vivo) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setSedes((filas as any[]).map((s) => ({ id: s.id, nombre: s.nombre, grupo: s.grupo?.nombre ?? null })))
      })
      .catch(() => { if (vivo) toast.error('No se pudo cargar el listado de sedes.') })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [editando, sedes.length, sb])

  /** Búsqueda inteligente: sin tildes y por varias palabras sueltas. */
  const filtradas = (() => {
    const q = norm(buscar.trim())
    if (!q) return sedes.slice(0, 20)
    const tokens = q.split(/\s+/)
    return sedes.filter((s) => {
      const hay = norm(`${s.nombre} ${s.grupo ?? ''}`)
      return tokens.every((t) => hay.includes(t))
    }).slice(0, 20)
  })()

  function cerrar() { setEditando(false); setBuscar('') }

  function elegir(s: SedeOpt) {
    if (s.id === sedeId) { cerrar(); return }
    if (yaDespachada && !confirm(
      `La orden ya fue despachada a «${sedeNombre ?? 'sin sede'}».\n\n`
      + `Cambiar el destino a «${s.nombre}» NO corrige las salidas de stock ya registradas a la sede anterior.\n\n`
      + '¿Continuar?',
    )) return
    start(async () => {
      const r = await actualizarSedeOrden(ordenId, s.id)
      if (r.error) { toast.error(r.error); return }
      toast.success(`Sede cambiada a ${s.nombre}`)
      cerrar()
      router.refresh()
    })
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-3">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="font-heading font-semibold text-sm text-gray-900 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-brand-green" /> Sede de destino
          </p>
          <p className="font-body text-sm text-gray-700 mt-1.5">
            {sedeNombre ?? 'Sin sede'}
            {grupo && <span className="text-gray-400"> · {grupo}</span>}
          </p>
          {direccion && <p className="font-body text-xs text-gray-400 mt-0.5">{direccion}</p>}
        </div>
        {editable && (
          editando ? (
            <button onClick={cerrar} disabled={pending}
              className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 font-body text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50">
              <X className="w-3.5 h-3.5" /> Cancelar
            </button>
          ) : (
            <button onClick={() => setEditando(true)}
              className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 font-body text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-green-50 hover:text-brand-green hover:border-brand-green/30 transition-colors">
              <Pencil className="w-3.5 h-3.5" /> Modificar sede
            </button>
          )
        )}
      </div>

      {editando && (
        <div className="space-y-2">
          {yaDespachada && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 font-body text-xs text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              La orden ya salió de bodega: cambiar la sede corrige el destino del pedido, pero no las salidas de stock ya registradas.
            </p>
          )}
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
              <Search className="w-4 h-4 text-gray-400 shrink-0" />
              <input autoFocus value={buscar} onChange={(e) => setBuscar(e.target.value)}
                placeholder="Escribe el nombre de la sede…"
                className="flex-1 bg-transparent font-body text-sm outline-none placeholder:text-gray-400" />
              {(cargando || pending) && <Loader2 className="w-4 h-4 text-gray-400 animate-spin shrink-0" />}
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {cargando ? (
                <p className="px-3 py-3 font-body text-sm text-gray-400">Cargando sedes…</p>
              ) : filtradas.length === 0 ? (
                <p className="px-3 py-3 font-body text-sm text-gray-400">
                  {buscar.trim() ? `Sin sedes que coincidan con «${buscar.trim()}».` : 'No hay sedes activas.'}
                </p>
              ) : (
                filtradas.map((s) => {
                  const actual = s.id === sedeId
                  return (
                    <button key={s.id} type="button" disabled={pending} onClick={() => elegir(s)}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-green-50 disabled:opacity-50 ${actual ? 'bg-green-50/60' : ''}`}>
                      <MapPin className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-body text-sm text-gray-800 truncate">{s.nombre}</span>
                        {s.grupo && <span className="block font-body text-xs text-gray-400">{s.grupo}</span>}
                      </span>
                      {actual && <Check className="w-3.5 h-3.5 text-brand-green shrink-0" />}
                    </button>
                  )
                })
              )}
            </div>
          </div>
          <p className="font-body text-xs text-gray-400">
            Cambiar la sede solo cambia el destino: los productos y las cantidades de la orden quedan igual.
          </p>
        </div>
      )}

      {puedeEditar && cerrada && (
        <p className="font-body text-xs text-gray-400">La orden ya está cerrada: la sede no se puede cambiar.</p>
      )}
    </div>
  )
}
