'use client'
import { useActionState, useState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import {
  AlertCircle, Loader2, Save, QrCode, X,
  Camera, PackageSearch, ExternalLink, Warehouse, Hash,
} from 'lucide-react'
import Link from 'next/link'
import type { ActionResult } from './actions'
import { ImagePicker } from '@/components/ui/ImagePicker'
import { BarcodeGenerator, type BarcodeFormat } from '@/components/ui/BarcodeGenerator'
import { BarcodeScanner } from '@/components/ui/BarcodeScanner'
import { createClient } from '@/lib/supabase/client'
import { CATEGORIA_LABELS, type CategoriaRotacion, type TipoInsumo } from '@/lib/types/database'

const TIPOS: TipoInsumo[] = ['CAFETERIA', 'LIQUIDOS', 'ASEO', 'EPP', 'PAPELERIA', 'MAQUINARIA', 'JARDINERIA', 'REPUESTOS', 'OTROS']

const TIPO_SKU: Record<string, string> = {
  CAFETERIA: 'CAF', LIQUIDOS: 'LIQ', ASEO: 'ASE', EPP: 'EPP',
  PAPELERIA: 'PAP', MAQUINARIA: 'MAQ', JARDINERIA: 'JAR', REPUESTOS: 'REP', OTROS: 'OTR',
}

function generarSKU(tipo: string): string {
  const pref = TIPO_SKU[tipo] ?? 'OTR'
  const seq  = String(Math.floor(Math.random() * 9000) + 1000)
  return `CI-${pref}-${seq}`
}

// Genera un código numérico de 8 dígitos basado en timestamp
function generarCodigoNumerico(): string {
  return String(Date.now()).slice(-8)
}

export interface ProductoDefaults {
  id?: string
  nombre_estandar?: string
  presentacion?: string | null
  tipo_insumo?: TipoInsumo
  cat_rotacion?: CategoriaRotacion
  stock_minimo_def?: number
  precio_lista?: number | null
  proveedor_id?: string | null
  ref?: number | null
  codigo?: number | null
  complemento?: string | null
  imagen_url?: string | null
  sku?: string | null
  ubicacion_bodega?: string | null
  bodega_descripcion?: string | null
}

interface ProductoExistente {
  id: string
  nombre_estandar: string
  presentacion: string | null
  tipo_insumo: string
  codigo: number | null
  ref: number | null
}

const labelCls = 'font-body font-semibold text-sm text-gray-700'
const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark transition-colors disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
      {pending ? 'Guardando...' : label}
    </button>
  )
}

interface Props {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>
  proveedores: { id: string; nombre: string }[]
  defaults?: ProductoDefaults
  submitLabel?: string
  modo?: 'crear' | 'editar'
}

// Parsea "A-02-3" → { pasillo: 'A', estante: '02', nivel: '3' }
function parseUbicacion(ub: string | null | undefined) {
  if (!ub) return { pasillo: '', estante: '', nivel: '' }
  const parts = ub.split('-')
  return { pasillo: parts[0] ?? '', estante: parts[1] ?? '', nivel: parts[2] ?? '' }
}

export function ProductoForm({ action, proveedores, defaults = {}, submitLabel = 'Guardar producto', modo = 'crear' }: Props) {
  const [state, formAction] = useActionState<ActionResult, FormData>(action, {})

  // ── Campos reactivos para generador ──
  const [tipoInsumo, setTipoInsumo] = useState<string>(defaults.tipo_insumo ?? 'OTROS')
  const [codigoValue, setCodigoValue] = useState<string>(defaults.codigo ? String(defaults.codigo) : '')
  const [refValue, setRefValue] = useState<string>(defaults.ref ? String(defaults.ref) : '')

  // ── SKU y bodega ──
  const [skuValue, setSkuValue] = useState<string>(defaults.sku ?? '')
  const ub = parseUbicacion(defaults.ubicacion_bodega)
  const [pasillo, setPasillo] = useState(ub.pasillo)
  const [estante, setEstante] = useState(ub.estante)
  const [nivel, setNivel]     = useState(ub.nivel)

  // ── Generador / escáner ──
  const [showGenerator, setShowGenerator] = useState(false)
  const [genFormat, setGenFormat] = useState<BarcodeFormat>('CODE128')
  const [genValue, setGenValue] = useState('')
  const [showScanner, setShowScanner] = useState(false)

  // ── Duplicado ──
  const [duplicado, setDuplicado] = useState<ProductoExistente | null>(null)
  const [checkingDup, setCheckingDup] = useState(false)

  const supabase = createClient()

  // Al abrir el generador: usa valor existente o auto-genera uno nuevo
  function openGenerator() {
    const val = codigoValue || refValue || generarCodigoNumerico()
    setGenValue(val)
    setShowGenerator(true)
  }

  // Auto-generar SKU cuando se cambia el tipo y el SKU está vacío (solo en modo crear)
  useEffect(() => {
    if (modo === 'crear' && !skuValue) {
      setSkuValue(generarSKU(tipoInsumo))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoInsumo])

  function handleAssign(val: string) {
    setGenValue(val)
    // Llenar Código y REF con el valor generado
    if (/^\d+$/.test(val)) {
      setCodigoValue(val)
      if (!refValue) setRefValue(val)
    }
    setShowGenerator(false)
  }

  async function handleScanDetected(value: string) {
    setShowScanner(false)
    if (/^\d+$/.test(value)) {
      setCodigoValue(value)
      if (!refValue) setRefValue(value)
    }

    // Verificar duplicado
    setCheckingDup(true)
    setDuplicado(null)
    try {
      const num = parseInt(value)
      const query = !isNaN(num)
        ? supabase.from('productos').select('id,nombre_estandar,presentacion,tipo_insumo,codigo,ref').or(`codigo.eq.${num},ref.eq.${num}`).eq('activo', true)
        : supabase.from('productos').select('id,nombre_estandar,presentacion,tipo_insumo,codigo,ref').eq('codigo_barras', value).eq('activo', true)
      const { data } = await query.limit(1).maybeSingle()
      if (data) setDuplicado(data as ProductoExistente)
    } finally {
      setCheckingDup(false)
    }
  }

  const ubicacionPreview = [pasillo, estante, nivel].filter(Boolean).join('-')

  return (
    <>
    {showScanner && (
      <BarcodeScanner onDetected={handleScanDetected} onClose={() => setShowScanner(false)} />
    )}

    <form action={formAction} className="space-y-6 max-w-3xl">
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

      {state.error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="font-body text-sm text-red-700">{state.error}</p>
        </div>
      )}

      {checkingDup && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <Loader2 className="w-4 h-4 text-blue-500 shrink-0 animate-spin" />
          <p className="font-body text-sm text-blue-700">Verificando si el producto ya existe...</p>
        </div>
      )}

      {duplicado && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <PackageSearch className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-body font-semibold text-sm text-amber-800">Este producto ya existe en el inventario</p>
              <p className="font-body text-sm text-amber-700 mt-0.5 truncate">{duplicado.nombre_estandar}</p>
              {duplicado.presentacion && <p className="font-body text-xs text-amber-600">{duplicado.presentacion}</p>}
              <p className="font-mono text-xs text-amber-500 mt-0.5">
                {duplicado.codigo ? `Código: ${duplicado.codigo}` : ''}{duplicado.codigo && duplicado.ref ? ' · ' : ''}{duplicado.ref ? `REF: ${duplicado.ref}` : ''} · {duplicado.tipo_insumo}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Link href={`/productos/${duplicado.id}`}
                className="flex items-center gap-1 font-body text-xs text-amber-700 hover:text-amber-900 border border-amber-300 rounded-lg px-2.5 py-1.5 hover:bg-amber-100 transition-colors">
                <ExternalLink className="w-3 h-3" />
                Ver
              </Link>
              <button type="button" onClick={() => setDuplicado(null)} className="text-amber-400 hover:text-amber-600 p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Imagen */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <ImagePicker name="imagen_url" defaultUrl={defaults.imagen_url ?? null} folder="productos" />
      </div>

      {/* Información general */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-heading font-semibold text-lg text-gray-900">Información general</h2>

        <div>
          <label className={labelCls}>Nombre estándar *</label>
          <input name="nombre_estandar" required minLength={3} defaultValue={defaults.nombre_estandar ?? ''}
            className={inputCls + ' mt-1'} placeholder="Ej: JABON PARA LOZA LIQUIDO" />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Presentación</label>
            <input name="presentacion" defaultValue={defaults.presentacion ?? ''} className={inputCls + ' mt-1'} placeholder="Ej: GALON / TARRO X 500 ML" />
          </div>
          <div>
            <label className={labelCls}>Tipo de insumo</label>
            <select name="tipo_insumo" value={tipoInsumo} onChange={e => setTipoInsumo(e.target.value)} className={inputCls + ' mt-1 bg-white'}>
              {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Categoría rotación</label>
            <select name="cat_rotacion" defaultValue={defaults.cat_rotacion ?? 'C'} className={inputCls + ' mt-1 bg-white'}>
              {(['A', 'B', 'C', 'D'] as CategoriaRotacion[]).map(c => (
                <option key={c} value={c}>Cat. {c} — {CATEGORIA_LABELS[c].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>REF</label>
            <input name="ref" type="number" value={refValue} onChange={e => setRefValue(e.target.value)}
              className={inputCls + ' mt-1'} placeholder="Opcional" />
          </div>
          <div>
            <label className={labelCls}>Código</label>
            <div className="flex gap-1.5 mt-1">
              <input name="codigo" type="number" value={codigoValue} onChange={e => setCodigoValue(e.target.value)}
                className={inputCls + ' flex-1'} placeholder="Opcional" />
              <button type="button" title="Escanear con cámara"
                onClick={() => setShowScanner(true)}
                className="shrink-0 p-2 rounded-lg border border-gray-200 text-gray-500 hover:border-brand-green hover:text-brand-green transition-colors">
                <Camera className="w-4 h-4" />
              </button>
              <button type="button" title="Generar código"
                onClick={openGenerator}
                className={`shrink-0 p-2 rounded-lg border transition-colors ${showGenerator ? 'border-brand-green bg-green-50 text-brand-green' : 'border-gray-200 text-gray-500 hover:border-brand-green hover:text-brand-green'}`}>
                <QrCode className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Generador de código inline */}
        {showGenerator && (
          <div className="border border-brand-green/30 rounded-2xl p-4 bg-green-50/40 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-heading font-semibold text-sm text-gray-800">Generador de código</p>
              <button type="button" onClick={() => setShowGenerator(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {(['CODE128', 'QR', 'EAN13', 'CODE39'] as BarcodeFormat[]).map(f => (
                <button key={f} type="button" onClick={() => setGenFormat(f)}
                  className={`font-body text-xs px-3 py-1.5 rounded-lg border transition-colors ${genFormat === f ? 'border-brand-green bg-brand-green text-white' : 'border-gray-200 text-gray-600 hover:border-brand-green'}`}>
                  {f}
                </button>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <input
                value={genValue}
                onChange={e => setGenValue(e.target.value)}
                placeholder="Valor del código"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 font-mono text-sm outline-none focus:border-brand-green"
              />
              <button type="button" onClick={() => setGenValue(generarCodigoNumerico())}
                className="text-xs font-body text-gray-500 border border-gray-200 rounded-lg px-2.5 py-2 hover:bg-gray-50 transition-colors whitespace-nowrap">
                Auto
              </button>
            </div>
            {genValue && (
              <BarcodeGenerator
                value={genValue}
                format={genFormat}
                onAssign={handleAssign}
              />
            )}
            <p className="font-body text-xs text-gray-500">
              Al hacer clic en <strong>Asignar</strong> se llenarán automáticamente los campos REF y Código.
            </p>
          </div>
        )}

        <div>
          <label className={labelCls}>Notas / Complemento</label>
          <textarea name="complemento" rows={2} defaultValue={defaults.complemento ?? ''} className={inputCls + ' mt-1 resize-none'} placeholder="Opcional" />
        </div>
      </div>

      {/* SKU y Ubicación en Bodega */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Warehouse className="w-5 h-5 text-brand-green" />
          <h2 className="font-heading font-semibold text-lg text-gray-900">SKU y Ubicación en Bodega</h2>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>SKU interno</label>
            <div className="flex gap-1.5 mt-1">
              <input name="sku" value={skuValue} onChange={e => setSkuValue(e.target.value)}
                className={inputCls + ' flex-1 font-mono'} placeholder="Ej: CI-ASE-0042" />
              <button type="button" title="Regenerar SKU" onClick={() => setSkuValue(generarSKU(tipoInsumo))}
                className="shrink-0 p-2 rounded-lg border border-gray-200 text-gray-500 hover:border-brand-green hover:text-brand-green transition-colors">
                <Hash className="w-4 h-4" />
              </button>
            </div>
            <p className="font-body text-xs text-gray-400 mt-1">Identificador único del producto en bodega</p>
          </div>
          <div>
            <label className={labelCls}>Descripción / Bodega</label>
            <input name="bodega_descripcion" defaultValue={defaults.bodega_descripcion ?? ''}
              className={inputCls + ' mt-1'} placeholder="Ej: Bodega principal — Sede Norte" />
          </div>
        </div>

        <div>
          <label className={labelCls}>Ubicación física</label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            <div>
              <input name="ubicacion_pasillo" value={pasillo} onChange={e => setPasillo(e.target.value.toUpperCase())}
                maxLength={5} className={inputCls} placeholder="Pasillo (A)" />
              <p className="font-body text-xs text-gray-400 mt-0.5 text-center">Pasillo</p>
            </div>
            <div>
              <input name="ubicacion_estante" value={estante} onChange={e => setEstante(e.target.value)}
                maxLength={5} className={inputCls} placeholder="Estante (02)" />
              <p className="font-body text-xs text-gray-400 mt-0.5 text-center">Estante</p>
            </div>
            <div>
              <input name="ubicacion_nivel" value={nivel} onChange={e => setNivel(e.target.value)}
                maxLength={3} className={inputCls} placeholder="Nivel (3)" />
              <p className="font-body text-xs text-gray-400 mt-0.5 text-center">Nivel</p>
            </div>
          </div>
          {ubicacionPreview && (
            <p className="font-mono text-xs text-brand-green mt-1.5">
              Ubicación: <strong>{ubicacionPreview}</strong>
            </p>
          )}
        </div>
      </div>

      {/* Stock y precio */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-heading font-semibold text-lg text-gray-900">Stock y precio</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Stock mínimo</label>
            <input name="stock_minimo_def" type="number" min="0" step="0.01" defaultValue={defaults.stock_minimo_def ?? 0} className={inputCls + ' mt-1'} />
          </div>
          {modo === 'crear' && (
            <div>
              <label className={labelCls}>Stock inicial</label>
              <input name="stock_inicial" type="number" min="0" step="0.01" defaultValue="0" className={inputCls + ' mt-1'} />
            </div>
          )}
          <div>
            <label className={labelCls}>Precio de lista (COP)</label>
            <input name="precio_lista" type="number" min="0" step="0.01" defaultValue={defaults.precio_lista ?? ''} className={inputCls + ' mt-1'} placeholder="Opcional" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Proveedor</label>
          <select name="proveedor_id" defaultValue={defaults.proveedor_id ?? ''} className={inputCls + ' mt-1 bg-white'}>
            <option value="">— Sin proveedor —</option>
            {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        {modo === 'editar' && (
          <p className="font-body text-xs text-gray-400">
            La cantidad en stock se ajusta desde <Link href="/movimientos/nuevo" className="text-brand-green hover:underline">Movimientos</Link>, no desde aquí.
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <SubmitBtn label={submitLabel} />
        <Link href={defaults.id ? `/productos/${defaults.id}` : '/productos'} className="font-body text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5">
          Cancelar
        </Link>
      </div>
    </form>
    </>
  )
}
