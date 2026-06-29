'use client'
import { useState } from 'react'
import { Edit2, TrendingUp, TrendingDown, ArrowLeftRight, Package } from 'lucide-react'
import Link from 'next/link'
import { CATEGORIA_LABELS, type CategoriaRotacion } from '@/lib/types/database'
import { ProductoImageUpload } from '@/components/productos/ProductoImageUpload'
import { formatCOP } from '@/lib/utils'

interface Movimiento {
  tipo: string
  cantidad: number
  created_at: string
  observacion: string | null
}

interface Props {
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
    ind_rot_general: number | null
    ind_rot_mes: number | null
    precio_lista: number | null
    imagen_url: string | null
    activo: boolean
    stock: { cantidad_real: number; cantidad_disp: number; cantidad_entr: number; cantidad_sal: number } | null
    proveedor: { nombre: string; telefono: string | null; email: string | null } | null
    proveedor2: { nombre: string } | null
  }
  movimientos: Movimiento[]
}

function MovIcon({ tipo }: { tipo: string }) {
  if (tipo === 'ENTRADA')  return <TrendingUp   className="w-4 h-4 text-green-600" />
  if (tipo === 'SALIDA')   return <TrendingDown  className="w-4 h-4 text-red-500"   />
  return                          <ArrowLeftRight className="w-4 h-4 text-blue-500"  />
}

export function ProductoDetalle({ producto: initial, movimientos }: Props) {
  const [imagenUrl, setImagenUrl] = useState(initial.imagen_url)
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
        {/* Upload de foto */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <ProductoImageUpload
            productoId={initial.id}
            currentImageUrl={imagenUrl}
            productoNombre={initial.nombre_estandar}
            onUploadComplete={setImagenUrl}
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
            <Link href={`/productos/${initial.id}/editar`}
              className="flex items-center gap-2 border border-gray-200 text-gray-600 font-body text-sm px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors shrink-0">
              <Edit2 className="w-3.5 h-3.5" />
              Editar
            </Link>
          </div>
        </div>

        {/* Detalles */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
          <h3 className="font-heading font-semibold text-sm text-gray-700 mb-4">Información del producto</h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {[
              { label: 'Tipo de insumo',    value: initial.tipo_insumo },
              { label: 'Precio lista',      value: initial.precio_lista ? formatCOP(initial.precio_lista) : '—' },
              { label: 'Índice rot. gral',  value: initial.ind_rot_general ?? '—' },
              { label: 'Índice rot. mes',   value: initial.ind_rot_mes ?? '—' },
              { label: 'Stock mín. asig.',  value: initial.stock_minimo_asig ?? '—' },
              { label: 'Estado',            value: initial.activo ? 'Activo' : 'Inactivo' },
            ].map(d => (
              <div key={d.label}>
                <p className="font-body text-xs text-gray-400">{d.label}</p>
                <p className="font-body font-medium text-sm text-gray-900">{d.value}</p>
              </div>
            ))}
          </div>

          {/* Proveedores */}
          {initial.proveedor && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="font-body text-xs text-gray-400 mb-2">Proveedor principal</p>
              <div className="flex items-center gap-3 bg-green-50 rounded-xl px-3 py-2.5">
                <Package className="w-4 h-4 text-brand-green" />
                <div>
                  <p className="font-body font-semibold text-sm text-gray-900">{initial.proveedor.nombre}</p>
                  {initial.proveedor.telefono && (
                    <p className="font-body text-xs text-gray-500">{initial.proveedor.telefono}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {initial.complemento && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="font-body text-xs text-gray-400 mb-1">Notas / Complemento</p>
              <p className="font-body text-sm text-gray-700">{initial.complemento}</p>
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
