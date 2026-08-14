'use client'
import { useState, useMemo } from 'react'
import { Search, Grid3X3, List, AlertTriangle, Eye, Pencil, ArrowLeftRight, Camera, SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { CATEGORIA_LABELS, type CategoriaRotacion, type TipoInsumo } from '@/lib/types/database'
import { BarcodeScanner } from '@/components/ui/BarcodeScanner'

interface CceBien {
  id: string
  bien: string
}

interface Producto {
  id: string
  ref: number | null
  codigo: number | null
  nombre_estandar: string
  presentacion: string | null
  tipo_insumo: TipoInsumo
  cat_rotacion: CategoriaRotacion
  stock_minimo_def: number
  imagen_url: string | null
  activo: boolean
  sku: string | null
  codigo_barras: string | null
  cce_tipo: 'PROPIO' | 'COMPARTIDO' | null
  stock: { cantidad_real: number; cantidad_disp: number } | null
  cce: CceBien | null
  stock_cce: { cantidad_real: number; cantidad_disp: number } | null
}

function getStockStatus(real: number, minimo: number) {
  if (real === 0)          return { label: 'Agotado', cls: 'bg-red-100 text-red-700' }
  if (real <= minimo)      return { label: 'Crítico', cls: 'bg-orange-100 text-orange-700' }
  if (real <= minimo * 1.5)return { label: 'Bajo',    cls: 'bg-yellow-100 text-yellow-700' }
  return                          { label: 'Normal',  cls: 'bg-green-100 text-green-700' }
}

export function ProductosClient({ productos, total }: { productos: Producto[]; total: number }) {
  const [search, setSearch]     = useState('')
  const [catFilter, setCat]     = useState('')
  const [tipoFilter, setTipo]   = useState('')
  const [stockFilter, setStock] = useState('')
  const [cceFilter, setCce]     = useState('')
  const [view, setView]         = useState<'grid' | 'list'>('grid')
  const [scannerOpen, setScannerOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qDigits = q.replace(/\D/g, '')
    const tokens = q.split(/\s+/).filter(Boolean)

    const matchOtros = (p: Producto) => {
      const matchCat  = !catFilter  || p.cat_rotacion === catFilter
      const matchTipo = !tipoFilter || p.tipo_insumo === tipoFilter
      const real    = p.stock?.cantidad_real ?? 0
      const minimo  = p.stock_minimo_def ?? 0
      const matchStock = !stockFilter || (
        stockFilter === 'agotado' ? real === 0 :
        stockFilter === 'critico' ? real > 0 && real <= minimo :
        stockFilter === 'normal'  ? real > minimo * 1.5 : true
      )
      const matchCce = !cceFilter || (
        cceFilter === 'cce'        ? p.cce !== null :
        cceFilter === 'propio'     ? p.cce_tipo === 'PROPIO' :
        cceFilter === 'compartido' ? p.cce_tipo === 'COMPARTIDO' :
        cceFilter === 'sin_cce'    ? p.cce === null : true
      )
      return matchCat && matchTipo && matchStock && matchCce
    }

    const evaluados = productos.map(p => {
      // Códigos de insumo del producto (código, REF, SKU, código de barras)
      const codigos = [p.codigo, p.ref, p.sku, p.codigo_barras]
        .filter(v => v !== null && v !== undefined && String(v).trim() !== '')
        .map(v => String(v).toLowerCase())
      const codigosDigits = codigos.map(c => c.replace(/\D/g, '')).filter(Boolean)
      // Incluye el nombre del bien CCE en la búsqueda de texto
      const cceBien = p.cce?.bien.toLowerCase() ?? ''
      const texto = `${p.nombre_estandar.toLowerCase()} ${codigos.join(' ')} ${cceBien}`

      let score = 0
      if (q) {
        const exacto = codigos.includes(q) || (!!qDigits && codigosDigits.includes(qDigits))
        const empieza = codigos.some(c => c.startsWith(q)) || (!!qDigits && codigosDigits.some(c => c.startsWith(qDigits)))
        const contieneCod = codigos.some(c => c.includes(q)) || (!!qDigits && codigosDigits.some(c => c.includes(qDigits)))
        const contieneTexto = tokens.every(t => texto.includes(t))
        score = exacto ? 4 : empieza ? 3 : contieneCod ? 2 : contieneTexto ? 1 : 0
      }
      return { p, score }
    })

    const res = evaluados.filter(x => (!q || x.score > 0) && matchOtros(x.p))
    // Con búsqueda, ordena por relevancia (coincidencia exacta de código primero)
    if (q) res.sort((a, b) => b.score - a.score)
    return res.map(x => x.p)
  }, [productos, search, catFilter, tipoFilter, stockFilter, cceFilter])

  // Stats
  const stats = useMemo(() => ({
    total: productos.length,
    catA:  productos.filter(p => p.cat_rotacion === 'A').length,
    critico: productos.filter(p => {
      const r = p.stock?.cantidad_real ?? 0
      return r <= (p.stock_minimo_def ?? 0)
    }).length,
    conCce: productos.filter(p => p.cce !== null).length,
  }), [productos])

  return (
    <>
      {/* Stats chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total productos',  value: stats.total,   color: 'bg-blue-50 text-blue-700 border-blue-100' },
          { label: 'Cat. A alta rot.', value: stats.catA,    color: 'bg-green-50 text-green-700 border-green-100' },
          { label: 'Stock crítico',    value: stats.critico, color: 'bg-red-50 text-red-700 border-red-100' },
          { label: '🏛 Colombia Compra', value: stats.conCce, color: 'bg-purple-50 text-purple-700 border-purple-100' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl border p-3 ${s.color}`}>
            <p className="font-heading font-bold text-xl">{s.value}</p>
            <p className="font-body text-xs mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters + view toggle */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-wrap gap-3 shadow-sm items-center">
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 flex-1 min-w-[200px] focus-within:border-brand-green transition-colors">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, código de insumo, REF, SKU o código de barras..."
            className="font-body text-sm flex-1 outline-none placeholder:text-gray-400"
          />
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            title="Escanear código de barras o QR"
            className="p-1 rounded-md text-gray-400 hover:text-brand-green hover:bg-green-50 transition-colors"
          >
            <Camera className="w-4 h-4" />
          </button>
        </div>

        {scannerOpen && (
          <BarcodeScanner
            onDetected={val => { setSearch(val); setScannerOpen(false) }}
            onClose={() => setScannerOpen(false)}
          />
        )}
        <select value={catFilter} onChange={e => setCat(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 font-body text-sm text-gray-700 outline-none focus:border-brand-green bg-white">
          <option value="">Categoría</option>
          {(['A','B','C','D'] as CategoriaRotacion[]).map(c =>
            <option key={c} value={c}>Cat. {c} — {CATEGORIA_LABELS[c].label}</option>
          )}
        </select>
        <select value={tipoFilter} onChange={e => setTipo(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 font-body text-sm text-gray-700 outline-none focus:border-brand-green bg-white">
          <option value="">Tipo</option>
          {['CAFETERIA','LIQUIDOS','ASEO','EPP','PAPELERIA','MAQUINARIA','JARDINERIA','REPUESTOS','OTROS'].map(t =>
            <option key={t} value={t}>{t}</option>
          )}
        </select>
        <select value={stockFilter} onChange={e => setStock(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 font-body text-sm text-gray-700 outline-none focus:border-brand-green bg-white">
          <option value="">Stock</option>
          <option value="critico">Crítico</option>
          <option value="agotado">Agotado</option>
          <option value="normal">Normal</option>
        </select>
        <select value={cceFilter} onChange={e => setCce(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 font-body text-sm text-gray-700 outline-none focus:border-brand-green bg-white">
          <option value="">🏛 CCE</option>
          <option value="cce">Con categoría CCE</option>
          <option value="propio">🔒 Propio CCE</option>
          <option value="compartido">↔ Compartido</option>
          <option value="sin_cce">Sin CCE</option>
        </select>

        {/* View toggle */}
        <div className="flex border border-gray-200 rounded-lg overflow-hidden ml-auto">
          <button onClick={() => setView('grid')}
            className={`p-2 transition-colors ${view === 'grid' ? 'bg-brand-green text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
            <Grid3X3 className="w-4 h-4" />
          </button>
          <button onClick={() => setView('list')}
            className={`p-2 transition-colors ${view === 'list' ? 'bg-brand-green text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Results count */}
      <p className="font-body text-xs text-gray-400">
        {filtered.length} de {total} productos
        {(search || catFilter || tipoFilter || stockFilter || cceFilter) ? ' (filtrado)' : ''}
      </p>

      {/* GRID view */}
      {view === 'grid' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map(p => {
            const cat    = CATEGORIA_LABELS[p.cat_rotacion]
            const real   = p.stock?.cantidad_real ?? 0
            const status = getStockStatus(real, p.stock_minimo_def)
            return (
              <div key={p.id}
                className="group bg-white border border-gray-100 rounded-2xl overflow-hidden hover:shadow-md hover:border-brand-green/30 transition-all duration-200 flex flex-col">
                <Link href={`/productos/${p.id}`} className="block">
                  {/* Foto */}
                  <div className="aspect-square bg-gray-50 relative overflow-hidden">
                    {p.imagen_url ? (
                      <Image
                        src={p.imagen_url}
                        alt={p.nombre_estandar}
                        fill
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
                      />
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-gray-300">
                        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                          <span className="text-2xl">📦</span>
                        </div>
                        <span className="font-body text-xs">Sin foto</span>
                      </div>
                    )}
                    <span className={`absolute top-2 left-2 font-body font-bold text-xs px-1.5 py-0.5 rounded-md ${cat.bg} ${cat.color}`}>
                      {p.cat_rotacion}
                    </span>
                    {real <= p.stock_minimo_def && real > 0 && (
                      <AlertTriangle className="absolute top-2 right-2 w-4 h-4 text-orange-500" />
                    )}
                  </div>
                  {/* Info */}
                  <div className="p-3 space-y-2">
                    <p className="font-body font-semibold text-xs text-gray-900 line-clamp-2 leading-tight">
                      {p.nombre_estandar}
                    </p>
                    <p className="font-body text-xs text-gray-400">{p.presentacion}</p>
                    {p.cce && (
                      <div className="flex items-center gap-1 flex-wrap">
                        <p className="font-body text-[10px] text-blue-600 bg-blue-50 rounded px-1.5 py-0.5 truncate flex-1 min-w-0" title={p.cce.bien}>
                          🏛 {p.cce.bien}
                        </p>
                        {p.cce_tipo === 'PROPIO' && (
                          <span className="font-body text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-100 rounded px-1 py-0.5 shrink-0">PROPIO</span>
                        )}
                        {p.cce_tipo === 'COMPARTIDO' && (
                          <span className="font-body text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-100 rounded px-1 py-0.5 shrink-0">COMPARTIDO</span>
                        )}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-1">
                      {real > 0 ? (
                        <span className="font-body text-xs text-gray-500">
                          <b className="font-heading text-sm text-gray-900">{real}</b> en stock
                        </span>
                      ) : (
                        <span className="font-body text-xs font-bold text-red-600">No hay</span>
                      )}
                      <span className={`font-body text-xs px-1.5 py-0.5 rounded-full shrink-0 ${status.cls}`}>
                        {status.label}
                      </span>
                    </div>
                  </div>
                </Link>
                {/* Barra de acciones */}
                <div className="mt-auto grid grid-cols-4 border-t border-gray-100 divide-x divide-gray-100">
                  <Link href={`/productos/${p.id}`} title="Ver detalle"
                    className="flex items-center justify-center py-2 text-gray-400 hover:text-brand-green hover:bg-green-50 transition-colors">
                    <Eye className="w-4 h-4" />
                  </Link>
                  <Link href={`/productos/${p.id}/editar`} title="Editar producto"
                    className="flex items-center justify-center py-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                    <Pencil className="w-4 h-4" />
                  </Link>
                  <Link href={`/movimientos/nuevo?producto=${p.id}`} title="Registrar movimiento"
                    className="flex items-center justify-center py-2 text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors">
                    <ArrowLeftRight className="w-4 h-4" />
                  </Link>
                  <Link href={`/movimientos/nuevo?producto=${p.id}&tipo=AJUSTE`} title="Ajustar unidades"
                    className="flex items-center justify-center py-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                    <SlidersHorizontal className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* LIST view */}
      {view === 'list' && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3 w-12"></th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">REF</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Producto</th>
                  <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Cat.</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">CCE</th>
                  <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Stock</th>
                  <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Estado</th>
                  <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(p => {
                  const cat    = CATEGORIA_LABELS[p.cat_rotacion]
                  const real   = p.stock?.cantidad_real ?? 0
                  const status = getStockStatus(real, p.stock_minimo_def)
                  return (
                    <tr key={p.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="w-10 h-10 rounded-xl overflow-hidden bg-gray-100 shrink-0">
                          {p.imagen_url ? (
                            <Image
                              src={p.imagen_url}
                              alt={p.nombre_estandar}
                              width={40} height={40}
                              className="object-cover w-full h-full"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-lg">📦</div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                          {p.ref ?? p.codigo}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 max-w-[250px]">
                        <p className="font-body font-medium text-sm text-gray-900 truncate">{p.nombre_estandar}</p>
                        <p className="font-body text-xs text-gray-400">{p.presentacion}</p>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`font-body font-bold text-xs px-2 py-1 rounded-full ${cat.bg} ${cat.color}`}>
                          {p.cat_rotacion}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 max-w-[220px]">
                        {p.cce ? (
                          <div className="space-y-0.5">
                            <span className="font-body text-xs text-blue-600 bg-blue-50 rounded px-1.5 py-0.5 truncate block" title={p.cce.bien}>
                              🏛 {p.cce.bien}
                            </span>
                            {p.cce_tipo === 'PROPIO' && (
                              <span className="font-body text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-100 rounded px-1.5 py-0.5 inline-block">
                                📦 Propio CCE: {p.stock_cce?.cantidad_real ?? 0} uds
                              </span>
                            )}
                            {p.cce_tipo === 'COMPARTIDO' && (
                              <span className="font-body text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-100 rounded px-1.5 py-0.5 inline-block">
                                ↔ Compartido
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="font-body text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {real > 0 ? (
                          <>
                            <span className="font-heading font-bold text-base text-gray-900">{real}</span>
                            <span className="font-body text-xs text-gray-400 ml-1">en stock / mín {p.stock_minimo_def}</span>
                          </>
                        ) : (
                          <span className="font-body text-sm font-bold text-red-600">No hay</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`font-body text-xs font-medium px-2.5 py-1 rounded-full ${status.cls}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-0.5">
                          <Link href={`/productos/${p.id}`} title="Ver detalle"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-brand-green hover:bg-green-50 transition-colors">
                            <Eye className="w-4 h-4" />
                          </Link>
                          <Link href={`/productos/${p.id}/editar`} title="Editar producto"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                            <Pencil className="w-4 h-4" />
                          </Link>
                          <Link href={`/movimientos/nuevo?producto=${p.id}`} title="Registrar movimiento"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors">
                            <ArrowLeftRight className="w-4 h-4" />
                          </Link>
                          <Link href={`/movimientos/nuevo?producto=${p.id}&tipo=AJUSTE`} title="Ajustar unidades"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                            <SlidersHorizontal className="w-4 h-4" />
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="font-heading font-bold text-lg">No se encontraron productos</p>
          <p className="font-body text-sm mt-1">Ajusta los filtros o agrega nuevos productos</p>
        </div>
      )}
    </>
  )
}
