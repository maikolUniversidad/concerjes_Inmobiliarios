'use client'
import { useActionState, useState, useRef } from 'react'
import { useFormStatus } from 'react-dom'
import { AlertCircle, Loader2, Save, QrCode, X, Camera, PackageSearch, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import type { ActionResult } from './actions'
import { ImagePicker } from '@/components/ui/ImagePicker'
import { BarcodeGenerator, type BarcodeFormat } from '@/components/ui/BarcodeGenerator'
import { BarcodeScanner } from '@/components/ui/BarcodeScanner'
import { createClient } from '@/lib/supabase/client'
import { CATEGORIA_LABELS, type CategoriaRotacion, type TipoInsumo } from '@/lib/types/database'

interface ProductoExistente {
  id: string
  nombre_estandar: string
  presentacion: string | null
  tipo_insumo: string
  codigo: number | null
  ref: number | null
}

const TIPOS = ['CAFETERIA', 'LIQUIDOS', 'ASEO', 'EPP', 'PAPELERIA', 'MAQUINARIA', 'JARDINERIA', 'REPUESTOS', 'OTROS']

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

export function ProductoForm({ action, proveedores, defaults = {}, submitLabel = 'Guardar producto', modo = 'crear' }: Props) {
  const [state, formAction] = useActionState<ActionResult, FormData>(action, {})
  const [showGenerator, setShowGenerator] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [genFormat, setGenFormat] = useState<BarcodeFormat>('CODE128')
  const [duplicado, setDuplicado] = useState<ProductoExistente | null>(null)
  const [checkingDup, setCheckingDup] = useState(false)
  const codigoRef = useRef<HTMLInputElement>(null)
  const refInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  async function handleScanDetected(value: string) {
    setShowScanner(false)
    // Llenar campo código si es numérico, sino REF
    if (/^\d+$/.test(value)) {
      if (codigoRef.current) codigoRef.current.value = value
    } else {
      // Para códigos alfanuméricos no podemos usar el campo number, ignorar o poner en complemento
      if (codigoRef.current) codigoRef.current.value = ''
    }

    // Buscar si ya existe un producto con ese código o ref
    setCheckingDup(true)
    setDuplicado(null)
    try {
      const num = parseInt(value)
      if (!isNaN(num)) {
        const { data } = await supabase
          .from('productos')
          .select('id, nombre_estandar, presentacion, tipo_insumo, codigo, ref')
          .or(`codigo.eq.${num},ref.eq.${num}`)
          .eq('activo', true)
          .limit(1)
          .single()
        if (data) setDuplicado(data as ProductoExistente)
      } else {
        // Buscar por codigo_barras si está disponible
        const { data } = await supabase
          .from('productos')
          .select('id, nombre_estandar, presentacion, tipo_insumo, codigo, ref')
          .eq('codigo_barras', value)
          .eq('activo', true)
          .limit(1)
          .single()
        if (data) setDuplicado(data as ProductoExistente)
      }
    } finally {
      setCheckingDup(false)
    }
  }

  return (
    <>
    {showScanner && (
      <BarcodeScanner
        onDetected={handleScanDetected}
        onClose={() => setShowScanner(false)}
      />
    )}

    <form action={formAction} className="space-y-6 max-w-3xl">
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

      {state.error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="font-body text-sm text-red-700">{state.error}</p>
        </div>
      )}

      {/* Alerta producto duplicado */}
      {checkingDup && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <Loader2 className="w-4 h-4 text-blue-500 shrink-0 animate-spin" />
          <p className="font-body text-sm text-blue-700">Verificando si el producto ya existe...</p>
        </div>
      )}
      {duplicado && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <div className="flex items-start gap-2">
            <PackageSearch className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-body font-semibold text-sm text-amber-800">Este producto ya existe en el inventario</p>
              <p className="font-body text-sm text-amber-700 mt-0.5 truncate">{duplicado.nombre_estandar}</p>
              {duplicado.presentacion && <p className="font-body text-xs text-amber-600">{duplicado.presentacion}</p>}
              <p className="font-mono text-xs text-amber-500 mt-0.5">
                {duplicado.codigo ? `Código: ${duplicado.codigo}` : ''}{duplicado.codigo && duplicado.ref ? ' · ' : ''}{duplicado.ref ? `REF: ${duplicado.ref}` : ''}
                {' · '}{duplicado.tipo_insumo}
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

      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <ImagePicker name="imagen_url" defaultUrl={defaults.imagen_url ?? null} folder="productos" />
      </div>

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
            <select name="tipo_insumo" defaultValue={defaults.tipo_insumo ?? 'OTROS'} className={inputCls + ' mt-1 bg-white'}>
              {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Categoría rotación</label>
            <select name="cat_rotacion" defaultValue={defaults.cat_rotacion ?? 'C'} className={inputCls + ' mt-1 bg-white'}>
              {(['A', 'B', 'C', 'D'] as CategoriaRotacion[]).map(c => <option key={c} value={c}>Cat. {c} — {CATEGORIA_LABELS[c].label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>REF</label>
            <input ref={refInputRef} name="ref" type="number" defaultValue={defaults.ref ?? ''} className={inputCls + ' mt-1'} placeholder="Opcional" />
          </div>
          <div>
            <label className={labelCls}>Código</label>
            <div className="flex gap-1.5 mt-1">
              <input ref={codigoRef} name="codigo" type="number" defaultValue={defaults.codigo ?? ''} className={inputCls + ' flex-1'} placeholder="Opcional" />
              <button
                type="button"
                title="Escanear código de barras / QR con la cámara"
                onClick={() => setShowScanner(true)}
                className="shrink-0 p-2 rounded-lg border border-gray-200 text-gray-500 hover:border-brand-green hover:text-brand-green transition-colors"
              >
                <Camera className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="Generar código de barras / QR"
                onClick={() => setShowGenerator(v => !v)}
                className={`shrink-0 p-2 rounded-lg border transition-colors ${showGenerator ? 'border-brand-green bg-green-50 text-brand-green' : 'border-gray-200 text-gray-500 hover:border-brand-green hover:text-brand-green'}`}
              >
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
            <BarcodeGenerator
              value={codigoRef.current?.value || refInputRef.current?.value || ''}
              format={genFormat}
              onAssign={(val) => {
                if (codigoRef.current && /^\d+$/.test(val)) codigoRef.current.value = val
              }}
            />
            <p className="font-body text-xs text-gray-500">
              Ingresa un valor en el campo Código o REF arriba para generar. Haz clic en <strong>Asignar</strong> para copiarlo al formulario.
            </p>
          </div>
        )}

        <div>
          <label className={labelCls}>Notas / Complemento</label>
          <textarea name="complemento" rows={2} defaultValue={defaults.complemento ?? ''} className={inputCls + ' mt-1 resize-none'} placeholder="Opcional" />
        </div>
      </div>

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
