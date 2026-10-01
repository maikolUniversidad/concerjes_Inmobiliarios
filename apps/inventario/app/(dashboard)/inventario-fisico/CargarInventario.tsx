'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X, FileSpreadsheet, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { traerTodo } from '@/lib/supabase/paginado'
import { detectarColumnas, aNumero, periodoDe, type FilaArchivo } from '@/lib/inventario-fisico'
import { aplicarInventarioFisico } from './actions'

interface Vista {
  archivo: string
  hoja: string
  filas: FilaArchivo[]
  duplicados: number[]
  sinCantidad: number
  enCero: number
  unidades: number
  nuevos: FilaArchivo[]
  cambios: number
  noHallados: number
}

const fmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 })
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })

/** Lee el Excel del conteo: primera hoja que tenga ITEM / NOMBRE / CANTIDADES. */
async function leerArchivo(file: File): Promise<{ hoja: string; filas: FilaArchivo[] }> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const valor = (v: unknown): unknown => {
    if (v && typeof v === 'object') {
      const o = v as { richText?: { text: string }[]; result?: unknown; text?: unknown }
      if (o.richText) return o.richText.map(t => t.text).join('')
      if (o.result !== undefined) return o.result
      if (o.text !== undefined) return o.text
      return null
    }
    return v
  }
  for (const ws of wb.worksheets) {
    const head = (ws.getRow(1).values as unknown[]).slice(1).map(valor)
    const col = detectarColumnas(head)
    if (!col) continue
    const filas: FilaArchivo[] = []
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = (ws.getRow(r).values as unknown[]).slice(1).map(valor)
      const codigo = aNumero(row[col.codigo])
      const nombre = String(row[col.nombre] ?? '').trim().replace(/\s+/g, ' ')
      if (codigo === null || codigo < 1 || !nombre) continue
      const pres = col.presentacion >= 0 ? String(row[col.presentacion] ?? '').trim().replace(/\s+/g, ' ') : ''
      filas.push({ codigo: Math.trunc(codigo), nombre, presentacion: pres || null, cantidad: aNumero(row[col.cantidad]) })
    }
    return { hoja: ws.name, filas }
  }
  throw new Error('No encontré una hoja con las columnas ITEM, NOMBRE ESTANDAR y CANTIDADES.')
}

export function CargarInventario({ periodos, onClose }: { periodos: string[]; onClose: () => void }) {
  const router = useRouter()
  const [periodo, setPeriodo] = useState(periodoDe(new Date()))
  const [fechaCorte, setFechaCorte] = useState(hoy())
  const [observacion, setObservacion] = useState('')
  const [vista, setVista] = useState<Vista | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendiente, startTransition] = useTransition()

  const periodoNorm = periodo.trim().replace(/\s+/g, ' ').toUpperCase()
  const repetido = periodos.includes(periodoNorm)

  async function elegir(file: File | undefined) {
    if (!file) return
    setError(null)
    setVista(null)
    setLeyendo(true)
    try {
      const { hoja, filas } = await leerArchivo(file)
      if (!filas.length) throw new Error('La hoja no trae filas con ITEM y nombre.')

      const vistos = new Set<number>()
      const duplicados = new Set<number>()
      for (const f of filas) (vistos.has(f.codigo) ? duplicados : vistos).add(f.codigo)

      // Catálogo actual para anticipar qué va a pasar al aplicar
      const supabase = createClient()
      const catalogo = await traerTodo<{ codigo: number | null; activo: boolean; stock: { cantidad_real: number } | null }>(
        (desde, hasta) => supabase.from('productos')
          .select('codigo, activo, stock ( cantidad_real )')
          .order('id').range(desde, hasta) as never)
      const porCod = new Map(catalogo.filter(p => p.codigo !== null).map(p => [Number(p.codigo), p]))

      const nuevos = filas.filter(f => !porCod.has(f.codigo))
      const cambios = filas.filter(f => {
        const p = porCod.get(f.codigo)
        return p && f.cantidad !== null && Number(p.stock?.cantidad_real ?? 0) !== f.cantidad
      }).length
      const noHallados = catalogo.filter(p => p.activo && (p.codigo === null || !vistos.has(Number(p.codigo)))).length

      setVista({
        archivo: file.name,
        hoja,
        filas,
        duplicados: [...duplicados],
        sinCantidad: filas.filter(f => f.cantidad === null).length,
        enCero: filas.filter(f => f.cantidad === 0).length,
        unidades: filas.reduce((s, f) => s + (f.cantidad ?? 0), 0),
        nuevos,
        cambios,
        noHallados,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLeyendo(false)
    }
  }

  function aplicar() {
    if (!vista) return
    setError(null)
    startTransition(async () => {
      const r = await aplicarInventarioFisico({
        periodo: periodoNorm, fechaCorte, archivo: vista.archivo, observacion, items: vista.filas,
      })
      if (r.error) { setError(r.error); return }
      // Recién aplicado, se abre su informe comparativo contra los conteos anteriores
      if (r.id) router.push(`/inventario-fisico/${r.id}`)
      else { router.refresh(); onClose() }
    })
  }

  const bloqueado = !vista || vista.duplicados.length > 0 || repetido || !periodoNorm || pendiente

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={pendiente ? undefined : onClose} />
      <div className="fixed inset-x-0 bottom-0 sm:inset-0 z-50 sm:flex sm:items-center sm:justify-center sm:p-6 pointer-events-none">
        <div className="pointer-events-auto bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-heading font-bold text-lg text-gray-900">Cargar inventario físico</h2>
            <button onClick={onClose} disabled={pendiente} className="p-1 rounded hover:bg-gray-100" aria-label="Cerrar">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="p-5 space-y-4 font-body text-sm">
            <p className="text-gray-500">
              Excel con las columnas <b>ITEM | NOMBRE ESTANDAR | PRESENTACION | CANTIDADES</b> (ITEM = código del producto).
              Al aplicar, el stock queda igual a lo contado y cada cambio se registra como ajuste. Los productos que no
              vengan se conservan y se marcan como no hallados.
            </p>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-gray-600">
                Periodo
                <input value={periodo} onChange={e => setPeriodo(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-gray-900 uppercase" />
                {repetido && <span className="text-xs text-red-600">Ya hay un inventario con ese periodo.</span>}
              </label>
              <label className="flex flex-col gap-1 text-gray-600">
                Fecha de corte
                <input type="date" value={fechaCorte} onChange={e => setFechaCorte(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-gray-900" />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-gray-600">
              Observación (opcional)
              <input value={observacion} onChange={e => setObservacion(e.target.value)} placeholder="Quién contó, bodega, novedades…"
                className="border border-gray-200 rounded-lg px-3 py-2 text-gray-900" />
            </label>

            <label className="flex items-center gap-3 border-2 border-dashed border-gray-200 rounded-xl px-4 py-4 cursor-pointer hover:border-brand-green/50">
              {leyendo ? <Loader2 className="w-6 h-6 text-brand-green animate-spin" /> : <FileSpreadsheet className="w-6 h-6 text-brand-green" />}
              <span className="text-gray-600">{vista ? vista.archivo : leyendo ? 'Leyendo archivo…' : 'Elegir archivo .xlsx'}</span>
              <input type="file" accept=".xlsx" className="hidden" onChange={e => elegir(e.target.files?.[0])} />
            </label>

            {vista && (
              <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                <p className="text-gray-700">Hoja <b>{vista.hoja}</b>: {fmt.format(vista.filas.length)} productos, {fmt.format(vista.unidades)} unidades.</p>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-gray-600">
                  <li>Stock que cambia: <b className="text-gray-900">{vista.cambios}</b></li>
                  <li>En cero: <b className="text-gray-900">{vista.enCero}</b></li>
                  <li>Productos nuevos: <b className="text-gray-900">{vista.nuevos.length}</b></li>
                  <li>Celda vacía (no se toca): <b className="text-gray-900">{vista.sinCantidad}</b></li>
                  <li className="col-span-2">Activos que no vienen (quedan como no hallados): <b className="text-gray-900">{vista.noHallados}</b></li>
                </ul>
                {vista.nuevos.length > 0 && (
                  <p className="text-xs text-gray-500">
                    Se crearán: {vista.nuevos.slice(0, 5).map(f => `${f.codigo} ${f.nombre}`).join(', ')}
                    {vista.nuevos.length > 5 ? ` y ${vista.nuevos.length - 5} más` : ''}.
                  </p>
                )}
                {vista.duplicados.length > 0 && (
                  <p className="flex items-start gap-1.5 text-red-600">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    ITEM repetidos en el archivo: {vista.duplicados.join(', ')}. Corrígelos antes de aplicar.
                  </p>
                )}
                {vista.duplicados.length === 0 && (
                  <p className="flex items-center gap-1.5 text-green-700"><CheckCircle2 className="w-4 h-4" /> Listo para aplicar.</p>
                )}
              </div>
            )}

            {error && <p className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</p>}
          </div>

          <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-100">
            <button onClick={onClose} disabled={pendiente}
              className="px-4 py-2 rounded-lg font-body text-sm font-semibold text-gray-600 hover:bg-gray-100">Cancelar</button>
            <button onClick={aplicar} disabled={bloqueado}
              className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-50 disabled:cursor-not-allowed">
              {pendiente && <Loader2 className="w-4 h-4 animate-spin" />} Aplicar inventario
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
