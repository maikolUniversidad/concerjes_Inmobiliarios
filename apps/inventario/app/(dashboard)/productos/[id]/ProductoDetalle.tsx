'use client'
import { useState } from 'react'
import { Edit2, TrendingUp, TrendingDown, ArrowLeftRight, Package, Trash2, Warehouse, MapPin, ChevronDown, ChevronUp, Building2, Share2, Lock, Loader2 } from 'lucide-react'
import { setCceTipo, setCceStockPropio } from '../actions'
import Link from 'next/link'
import { CATEGORIA_LABELS, type CategoriaRotacion } from '@/lib/types/database'
import { ProductoGaleria, type FotoItem } from '@/components/ui/ProductoGaleria'
import { DeleteButton } from '@/components/ui/DeleteButton'
import { eliminarProducto } from '../actions'
import { formatCOP } from '@/lib/utils'

interface Movimiento {
  tipo: string
  cantidad: number
  created_at: string
  observacion: string | null
}

interface CceBien {
  id: string
  bien: string
  especificacion: string | null
  presentacion: string | null
  cantidad_mensual: string | null
  precio_piso: boolean
}

type CceTipo = 'PROPIO' | 'COMPARTIDO' | null

interface Props {
  cceTipo: CceTipo
  stockCce: { cantidad_real: number; cantidad_disp: number } | null
  producto: {
    id: string
    ref: number | null
    codigo: number | null
    nombre_estandar: string
    presentacion: string | null
    complemento: string | null
    tipo_insumo: string
    cat_rotacion: CategoriaRotacion
    stock_minimo_def: number
    stock_minimo_asig: number
    stock_min_suger: number | null
    ind_rot_general: number | null
    ind_rot_mes: number | null
    precio_lista: number | null
    precio_lista2: number | null
    imagen_url: string | null
    activo: boolean
    sku: string | null
    ubicacion_bodega: string | null
    bodega_descripcion: string | null
    codigo_barras: string | null
    codigo_barras_formato: string | null
    codigo_barras_origen: string | null
    created_at?: string | null
    updated_at?: string | null
    stock: { cantidad_real: number; cantidad_disp: number; cantidad_entr: number; cantidad_sal: number } | null
    proveedor: { nombre: string; telefono: string | null; email: string | null } | null
    proveedor2: { nombre: string } | null
    ubicacion: {
      codigo: string
      nombre: string | null
      tipo: string | null
      foto_url: string | null
      pos_x: number | null
      pos_y: number | null
      bodega: { nombre: string; plano_url: string | null } | null
    } | null
    cce: CceBien | null
  }
  movimientos: Movimiento[]
  fotos: { id: string; url: string; storage_path: string | null; orden: number; es_principal: boolean }[]
}

const SIN = '—'
/** Devuelve el valor o un guion si está vacío/nulo. */
function val(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return SIN
  return String(v)
}

function Campo({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="font-body text-xs text-gray-400">{label}</p>
      <p className={`font-medium text-sm text-gray-900 ${mono ? 'font-mono' : 'font-body'}`}>{value}</p>
    </div>
  )
}

const ORIGEN_BADGE: Record<string, { label: string; cls: string }> = {
  ESCANEADO: { label: 'Escaneado del producto', cls: 'bg-blue-50 text-blue-700 border-blue-100' },
  GENERADO:  { label: 'Generado por nosotros',  cls: 'bg-green-50 text-green-700 border-green-100' },
}

function fechaCorta(iso?: string | null): string {
  if (!iso) return SIN
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
}

function MovIcon({ tipo }: { tipo: string }) {
  if (tipo === 'ENTRADA')  return <TrendingUp   className="w-4 h-4 text-green-600" />
  if (tipo === 'SALIDA')   return <TrendingDown  className="w-4 h-4 text-red-500"   />
  return                          <ArrowLeftRight className="w-4 h-4 text-blue-500"  />
}

export function ProductoDetalle({ producto: initial, movimientos, fotos, cceTipo: initialCceTipo, stockCce: initialStockCce }: Props) {
  const [imagenUrl, setImagenUrl] = useState(initial.imagen_url)
  const [cceOpen, setCceOpen] = useState(false)
  const [cceTipo, setCceTipoState] = useState<CceTipo>(initialCceTipo)
  const [tipoSaving, setTipoSaving] = useState(false)
  const [tipoError, setTipoError] = useState<string | null>(null)
  const [stockCce, setStockCce] = useState(initialStockCce)
  const [editingStock, setEditingStock] = useState(false)
  const [stockReal, setStockReal] = useState(initialStockCce?.cantidad_real ?? 0)
  const [stockDisp, setStockDisp] = useState(initialStockCce?.cantidad_disp ?? 0)
  const [stockSaving, setStockSaving] = useState(false)

  async function handleTipoChange(nuevoTipo: CceTipo) {
    setTipoSaving(true)
    setTipoError(null)
    const result = await setCceTipo(initial.id, nuevoTipo)
    setTipoSaving(false)
    if (result.error) { setTipoError(result.error); return }
    setCceTipoState(nuevoTipo)
    if (nuevoTipo === 'PROPIO' && !stockCce) {
      setStockCce({ cantidad_real: 0, cantidad_disp: 0 })
      setStockReal(0); setStockDisp(0)
    }
  }

  async function handleStockSave() {
    setStockSaving(true)
    const result = await setCceStockPropio(initial.id, stockReal, stockDisp)
    setStockSaving(false)
    if (result.error) { setTipoError(result.error); return }
    setStockCce({ cantidad_real: stockReal, cantidad_disp: stockDisp })
    setEditingStock(false)
  }

  // Construir lista de fotos: prioriza producto_fotos si existe, si no cae a imagen_url
  const fotoItems: FotoItem[] = fotos.length > 0
    ? fotos.map(f => ({ id: f.id, url: f.url, storagePath: f.storage_path ?? undefined, esPrincipal: f.es_principal, orden: f.orden }))
    : imagenUrl ? [{ url: imagenUrl, esPrincipal: true }] : []
  const cat = CATEGORIA_LABELS[initial.cat_rotacion]
  const stock = initial.stock
  const real  = stock?.cantidad_real ?? 0
  const minimo = initial.stock_minimo_def

  const stockStatus = real === 0         ? { label: 'Agotado', cls: 'bg-red-100 text-red-700' }
    : real <= minimo                     ? { label: 'Crítico', cls: 'bg-orange-100 text-orange-700' }
    : real <= minimo * 1.5               ? { label: 'Bajo',    cls: 'bg-yellow-100 text-yellow-700' }
    :                                      { label: 'Normal',  cls: 'bg-green-100 text-green-700' }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

      {/* Col izquierda: foto + info rápida */}
      <div className="space-y-4">
        {/* Galería de fotos */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <ProductoGaleria
            modo="directo"
            productoId={initial.id}
            initialFotos={fotoItems}
            onPrincipalChange={setImagenUrl}
          />
        </div>

        {/* Stock quick stats */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm space-y-3">
          <h3 className="font-heading font-semibold text-sm text-gray-700">Stock actual</h3>
          {[
            { label: 'Cantidad real',      value: real,                      color: 'text-gray-900' },
            { label: 'Disponible',         value: stock?.cantidad_disp ?? 0, color: 'text-green-700' },
            { label: 'Entrante',           value: stock?.cantidad_entr ?? 0, color: 'text-blue-700' },
            { label: 'Saliente',           value: stock?.cantidad_sal  ?? 0, color: 'text-orange-700' },
            { label: 'Stock mínimo',       value: minimo,                    color: 'text-gray-500' },
          ].map(s => (
            <div key={s.label} className="flex items-center justify-between">
              <span className="font-body text-xs text-gray-500">{s.label}</span>
              <span className={`font-heading font-bold text-sm ${s.color}`}>{s.value}</span>
            </div>
          ))}
          <div className="pt-1 border-t border-gray-100">
            <span className={`font-body text-xs font-medium px-2.5 py-1 rounded-full ${stockStatus.cls}`}>
              {stockStatus.label}
            </span>
          </div>
        </div>
      </div>

      {/* Col derecha: detalles completos */}
      <div className="lg:col-span-2 space-y-4">

        {/* Header del producto */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                  REF {initial.ref ?? initial.codigo}
                </span>
                <span className={`font-body font-bold text-xs px-2 py-0.5 rounded-full ${cat.bg} ${cat.color}`}>
                  Cat. {initial.cat_rotacion} · {cat.label}
                </span>
              </div>
              <h1 className="font-heading font-bold text-xl text-gray-900">{initial.nombre_estandar}</h1>
              {initial.presentacion && (
                <p className="font-body text-sm text-gray-500 mt-0.5">{initial.presentacion}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link href={`/productos/${initial.id}/editar`}
                className="flex items-center gap-2 border border-gray-200 text-gray-600 font-body text-sm px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors">
                <Edit2 className="w-3.5 h-3.5" />
                Editar
              </Link>
              <DeleteButton action={eliminarProducto} id={initial.id}
                mensaje={`¿Eliminar “${initial.nombre_estandar}”? Se ocultará del catálogo (se conserva el historial).`}
                className="flex items-center gap-2 border border-red-200 text-red-600 font-body text-sm px-3 py-2 rounded-xl hover:bg-red-50 transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
                Eliminar
              </DeleteButton>
            </div>
          </div>
        </div>

        {/* Detalles — se muestran TODOS los campos, aunque estén sin asignar */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <h3 className="font-heading font-semibold text-sm text-gray-700 mb-4">Información del producto</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
            <Campo label="REF" value={val(initial.ref)} mono />
            <Campo label="Código interno" value={val(initial.codigo)} mono />
            <Campo label="SKU interno" value={initial.sku ? <span className="text-brand-green">{initial.sku}</span> : 'Sin asignar'} mono />
            <Campo label="Tipo de insumo" value={val(initial.tipo_insumo)} />
            <Campo label="Categoría rotación" value={`${initial.cat_rotacion} · ${cat.label}`} />
            <Campo label="Presentación" value={val(initial.presentacion)} />
            <Campo label="Precio lista" value={initial.precio_lista ? formatCOP(initial.precio_lista) : SIN} />
            <Campo label="Precio lista 2" value={initial.precio_lista2 ? formatCOP(initial.precio_lista2) : SIN} />
            <Campo label="Estado" value={initial.activo ? 'Activo' : 'Inactivo'} />
            <Campo label="Índice rot. general" value={val(initial.ind_rot_general)} />
            <Campo label="Índice rot. mes" value={val(initial.ind_rot_mes)} />
            <Campo label="Stock mín. definido" value={val(initial.stock_minimo_def)} />
            <Campo label="Stock mín. asignado" value={val(initial.stock_minimo_asig)} />
            <Campo label="Stock mín. sugerido" value={val(initial.stock_min_suger)} />
          </div>

          {/* Código de barras / QR */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="font-body text-xs text-gray-400 mb-1.5">Código de barras / QR</p>
            {initial.codigo_barras ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-semibold text-sm text-gray-900 break-all">{initial.codigo_barras}</span>
                {initial.codigo_barras_formato && (
                  <span className="font-body text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{initial.codigo_barras_formato}</span>
                )}
                {initial.codigo_barras_origen && ORIGEN_BADGE[initial.codigo_barras_origen] && (
                  <span className={`font-body text-[11px] px-2 py-0.5 rounded-full border ${ORIGEN_BADGE[initial.codigo_barras_origen].cls}`}>
                    {ORIGEN_BADGE[initial.codigo_barras_origen].label}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-body text-sm text-gray-400">Sin asignar</span>
                <Link href="/codigos" className="font-body text-xs text-brand-green hover:underline font-semibold">Generar código →</Link>
              </div>
            )}
          </div>

          {/* Proveedores — siempre visibles */}
          <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="font-body text-xs text-gray-400 mb-1.5">Proveedor principal</p>
              {initial.proveedor ? (
                <div className="flex items-center gap-3 bg-green-50 rounded-xl px-3 py-2.5">
                  <Package className="w-4 h-4 text-brand-green shrink-0" />
                  <div className="min-w-0">
                    <p className="font-body font-semibold text-sm text-gray-900 truncate">{initial.proveedor.nombre}</p>
                    {initial.proveedor.telefono && (
                      <p className="font-body text-xs text-gray-500">{initial.proveedor.telefono}</p>
                    )}
                    {initial.proveedor.email && (
                      <p className="font-body text-xs text-gray-400 truncate">{initial.proveedor.email}</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="font-body text-sm text-gray-400">Sin asignar</p>
              )}
            </div>
            <div>
              <p className="font-body text-xs text-gray-400 mb-1.5">Proveedor secundario</p>
              {initial.proveedor2 ? (
                <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-3 py-2.5">
                  <Package className="w-4 h-4 text-gray-400 shrink-0" />
                  <p className="font-body font-semibold text-sm text-gray-900 truncate">{initial.proveedor2.nombre}</p>
                </div>
              ) : (
                <p className="font-body text-sm text-gray-400">Sin asignar</p>
              )}
            </div>
          </div>

          {/* Notas / Complemento — siempre visible */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="font-body text-xs text-gray-400 mb-1">Notas / Complemento</p>
            <p className="font-body text-sm text-gray-700">{initial.complemento || SIN}</p>
          </div>

          {/* Fechas */}
          <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap gap-x-6 gap-y-1">
            <span className="font-body text-xs text-gray-400">Creado: <span className="text-gray-600">{fechaCorta(initial.created_at)}</span></span>
            <span className="font-body text-xs text-gray-400">Actualizado: <span className="text-gray-600">{fechaCorta(initial.updated_at)}</span></span>
          </div>
        </div>

        {/* SKU y Ubicación en Bodega — siempre visible, aunque no tenga datos */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Warehouse className="w-4 h-4 text-brand-green" />
            <h3 className="font-heading font-semibold text-sm text-gray-700">SKU y Ubicación en Bodega</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="font-body text-xs text-gray-400">SKU interno</p>
              <p className={`font-mono font-semibold text-sm mt-0.5 ${initial.sku ? 'text-brand-green' : 'text-gray-400'}`}>
                {initial.sku || 'Sin asignar'}
              </p>
            </div>
            <div>
              <p className="font-body text-xs text-gray-400">Ubicación física</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <p className={`font-mono font-semibold text-sm ${initial.ubicacion_bodega ? 'text-gray-900' : 'text-gray-400'}`}>
                  {initial.ubicacion_bodega || 'Sin asignar'}
                </p>
              </div>
            </div>
            <div className="col-span-2">
              <p className="font-body text-xs text-gray-400">Descripción de ubicación</p>
              <p className="font-body text-sm text-gray-700 mt-0.5">{initial.bodega_descripcion || SIN}</p>
            </div>
          </div>

          {/* Ubicación relacionada en bodega — dónde queda físicamente (con foto) */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="font-body text-xs text-gray-400 mb-2">Ubicación relacionada en bodega</p>
            {initial.ubicacion ? (
              <div className="flex flex-col sm:flex-row gap-3 bg-gray-50 border border-gray-100 rounded-xl p-3">
                <div className="w-full sm:w-28 h-28 rounded-lg overflow-hidden bg-white border border-gray-100 shrink-0 flex items-center justify-center">
                  {initial.ubicacion.foto_url
                    ? <img src={initial.ubicacion.foto_url} alt={initial.ubicacion.codigo} className="w-full h-full object-cover" />
                    : <MapPin className="w-8 h-8 text-gray-300" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-heading font-bold text-sm text-gray-900">{initial.ubicacion.bodega?.nombre ?? 'Bodega'}</p>
                  <p className="font-mono text-sm text-brand-green">
                    {initial.ubicacion.codigo}{initial.ubicacion.nombre ? ` · ${initial.ubicacion.nombre}` : ''}
                  </p>
                  {initial.ubicacion.tipo && (
                    <span className="inline-block mt-1 font-body text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{initial.ubicacion.tipo}</span>
                  )}
                  {initial.ubicacion.bodega?.plano_url && initial.ubicacion.pos_x != null && initial.ubicacion.pos_y != null && (
                    <div className="relative mt-2 w-full max-w-[220px] rounded-lg overflow-hidden border border-gray-200">
                      <img src={initial.ubicacion.bodega.plano_url} alt="Plano de bodega" className="w-full h-auto block" />
                      <span
                        className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-green ring-2 ring-white shadow"
                        style={{ left: `${initial.ubicacion.pos_x}%`, top: `${initial.ubicacion.pos_y}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-body text-sm text-gray-400">Sin ubicación relacionada</span>
                <Link href={`/productos/${initial.id}/editar`} className="font-body text-xs text-brand-green hover:underline font-semibold">Relacionar →</Link>
              </div>
            )}
          </div>
        </div>

        {/* Colombia Compra Eficiente */}
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          {/* Header colapsable */}
          <button
            type="button"
            onClick={() => setCceOpen(o => !o)}
            className="w-full flex items-center justify-between gap-3 px-5 py-4 hover:bg-gray-50/50 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
              <h3 className="font-heading font-semibold text-sm text-gray-700 shrink-0">Colombia Compra Eficiente</h3>
              {initial.cce ? (
                <span className="font-body text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5 truncate">
                  {initial.cce.bien}
                </span>
              ) : (
                <span className="font-body text-xs text-gray-400">Sin categoría asignada</span>
              )}
              {cceTipo === 'PROPIO' && (
                <span className="font-body text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-100 rounded-full px-2 py-0.5 shrink-0">
                  PROPIO
                </span>
              )}
              {cceTipo === 'COMPARTIDO' && (
                <span className="font-body text-[10px] font-bold text-teal-700 bg-teal-50 border border-teal-100 rounded-full px-2 py-0.5 shrink-0">
                  COMPARTIDO
                </span>
              )}
            </div>
            {cceOpen
              ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
              : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
          </button>

          {cceOpen && (
            <div className="border-t border-gray-100">
              {/* ── Tipo de inventario CCE ── */}
              <div className="px-5 pt-4 pb-3 space-y-3">
                <p className="font-body text-xs text-gray-500 font-semibold uppercase tracking-wide">Tipo de inventario CCE</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {([
                    { val: null,          icon: null,    label: 'Sin inventario CCE',       desc: 'Este producto no participa en el inventario CCE',       cls: 'border-gray-200 bg-white',           sel: 'border-gray-400 bg-gray-50' },
                    { val: 'COMPARTIDO',  icon: Share2,  label: 'Compartido con Conserjes',  desc: 'CCE y Conserjes usan el mismo pool de stock',           cls: 'border-teal-200 bg-white',           sel: 'border-teal-500 bg-teal-50' },
                    { val: 'PROPIO',      icon: Lock,    label: 'Inventario propio CCE',     desc: 'CCE tiene sus propias unidades, separadas de Conserjes', cls: 'border-purple-200 bg-white',         sel: 'border-purple-500 bg-purple-50' },
                  ] as const).map(opt => {
                    const isSelected = cceTipo === opt.val
                    return (
                      <button
                        key={String(opt.val)}
                        type="button"
                        disabled={tipoSaving}
                        onClick={() => handleTipoChange(opt.val)}
                        className={`text-left border rounded-xl px-3 py-2.5 transition-all ${isSelected ? opt.sel + ' ring-1 ring-offset-1 ' + (opt.val === 'PROPIO' ? 'ring-purple-400' : opt.val === 'COMPARTIDO' ? 'ring-teal-400' : 'ring-gray-400') : opt.cls + ' hover:bg-gray-50'}`}
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {opt.icon && <opt.icon className={`w-3.5 h-3.5 ${opt.val === 'PROPIO' ? 'text-purple-600' : 'text-teal-600'}`} />}
                          <span className={`font-body font-semibold text-xs ${isSelected ? (opt.val === 'PROPIO' ? 'text-purple-800' : opt.val === 'COMPARTIDO' ? 'text-teal-800' : 'text-gray-800') : 'text-gray-700'}`}>
                            {opt.label}
                          </span>
                        </div>
                        <p className="font-body text-[10px] text-gray-500 leading-tight">{opt.desc}</p>
                      </button>
                    )
                  })}
                </div>
                {tipoSaving && (
                  <div className="flex items-center gap-2 text-gray-400">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="font-body text-xs">Guardando…</span>
                  </div>
                )}
                {tipoError && <p className="font-body text-xs text-red-600">{tipoError}</p>}
              </div>

              {/* ── Stock propio CCE (solo si PROPIO) ── */}
              {cceTipo === 'PROPIO' && (
                <div className="mx-5 mb-4 bg-purple-50 border border-purple-100 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-body text-xs font-semibold text-purple-700 uppercase tracking-wide">Stock propio CCE</p>
                    {!editingStock && (
                      <button type="button" onClick={() => setEditingStock(true)}
                        className="font-body text-xs text-purple-600 hover:underline">
                        Ajustar
                      </button>
                    )}
                  </div>
                  {!editingStock ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="font-body text-[10px] text-purple-500">Cantidad real</p>
                        <p className="font-heading font-bold text-xl text-purple-900">{stockCce?.cantidad_real ?? 0}</p>
                      </div>
                      <div>
                        <p className="font-body text-[10px] text-purple-500">Cantidad disponible</p>
                        <p className="font-heading font-bold text-xl text-purple-900">{stockCce?.cantidad_disp ?? 0}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="font-body text-[10px] text-purple-600 block mb-0.5">Cantidad real</label>
                          <input
                            type="number" min="0" step="1"
                            value={stockReal}
                            onChange={e => setStockReal(Number(e.target.value))}
                            className="w-full border border-purple-200 rounded-lg px-2 py-1.5 font-body text-sm outline-none focus:border-purple-400 bg-white"
                          />
                        </div>
                        <div>
                          <label className="font-body text-[10px] text-purple-600 block mb-0.5">Disponible</label>
                          <input
                            type="number" min="0" step="1"
                            value={stockDisp}
                            onChange={e => setStockDisp(Number(e.target.value))}
                            className="w-full border border-purple-200 rounded-lg px-2 py-1.5 font-body text-sm outline-none focus:border-purple-400 bg-white"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" disabled={stockSaving} onClick={handleStockSave}
                          className="flex items-center gap-1.5 bg-purple-600 text-white font-body text-xs px-3 py-1.5 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50">
                          {stockSaving && <Loader2 className="w-3 h-3 animate-spin" />}
                          Guardar
                        </button>
                        <button type="button" onClick={() => { setEditingStock(false); setStockReal(stockCce?.cantidad_real ?? 0); setStockDisp(stockCce?.cantidad_disp ?? 0) }}
                          className="font-body text-xs text-gray-500 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Stock compartido (solo si COMPARTIDO) ── */}
              {cceTipo === 'COMPARTIDO' && (
                <div className="mx-5 mb-4 bg-teal-50 border border-teal-100 rounded-xl p-4">
                  <p className="font-body text-xs font-semibold text-teal-700 uppercase tracking-wide mb-2">Stock compartido con Conserjes</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="font-body text-[10px] text-teal-500">Cantidad real (compartida)</p>
                      <p className="font-heading font-bold text-xl text-teal-900">{initial.stock?.cantidad_real ?? 0}</p>
                    </div>
                    <div>
                      <p className="font-body text-[10px] text-teal-500">Disponible (compartida)</p>
                      <p className="font-heading font-bold text-xl text-teal-900">{initial.stock?.cantidad_disp ?? 0}</p>
                    </div>
                  </div>
                  <p className="font-body text-[10px] text-teal-600 mt-2">
                    Estas unidades son del inventario de Conserjes. CCE y Conserjes comparten el mismo pool.
                  </p>
                </div>
              )}

              {/* ── Datos del bien CCE ── */}
              {initial.cce && (
                <div className="px-5 pb-5 pt-1 space-y-3 border-t border-gray-100">
                  <p className="font-body text-xs text-gray-500 font-semibold uppercase tracking-wide pt-3">Ficha del bien CCE</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                    <div className="sm:col-span-2">
                      <p className="font-body text-xs text-gray-400">Nombre de bien</p>
                      <p className="font-body font-semibold text-sm text-gray-900 mt-0.5">{initial.cce.bien}</p>
                    </div>
                    {initial.cce.presentacion && (
                      <div>
                        <p className="font-body text-xs text-gray-400">Presentación CCE</p>
                        <p className="font-body text-sm text-gray-700 mt-0.5">{initial.cce.presentacion}</p>
                      </div>
                    )}
                    {initial.cce.cantidad_mensual && (
                      <div>
                        <p className="font-body text-xs text-gray-400">Cantidad mensual referencia</p>
                        <p className="font-body text-sm text-gray-700 mt-0.5">{initial.cce.cantidad_mensual}</p>
                      </div>
                    )}
                    <div>
                      <p className="font-body text-xs text-gray-400">Precio piso</p>
                      <p className="font-body text-sm mt-0.5">
                        {initial.cce.precio_piso
                          ? <span className="text-green-700 font-semibold">Sí aplica</span>
                          : <span className="text-gray-400">No aplica</span>}
                      </p>
                    </div>
                  </div>
                  {initial.cce.especificacion && (
                    <div className="pt-2 border-t border-gray-100">
                      <p className="font-body text-xs text-gray-400 mb-1.5">Especificación técnica CCE</p>
                      <p className="font-body text-xs text-gray-600 whitespace-pre-line leading-relaxed bg-gray-50 rounded-xl px-4 py-3">
                        {initial.cce.especificacion}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {!initial.cce && (
                <div className="px-5 pb-5 pt-3">
                  <p className="font-body text-sm text-gray-400 text-center py-4">
                    Este producto no tiene una categoría CCE asignada.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Últimos movimientos */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <h3 className="font-heading font-semibold text-sm text-gray-700 mb-3">
            Últimos movimientos
          </h3>
          {movimientos.length === 0 ? (
            <p className="font-body text-sm text-gray-400 py-4 text-center">Sin movimientos registrados</p>
          ) : (
            <div className="space-y-2">
              {movimientos.map((m, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                    <MovIcon tipo={m.tipo} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-sm text-gray-900">
                      <span className="font-semibold">{m.tipo}</span>
                      {m.observacion && <span className="text-gray-500"> · {m.observacion}</span>}
                    </p>
                    <p className="font-body text-xs text-gray-400">
                      {new Date(m.created_at).toLocaleDateString('es-CO', {
                        day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'
                      })}
                    </p>
                  </div>
                  <span className={`font-heading font-bold text-sm shrink-0 ${
                    m.tipo === 'ENTRADA' ? 'text-green-600' :
                    m.tipo === 'SALIDA'  ? 'text-red-600'   : 'text-blue-600'
                  }`}>
                    {m.tipo === 'ENTRADA' ? '+' : m.tipo === 'SALIDA' ? '-' : ''}
                    {m.cantidad}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
