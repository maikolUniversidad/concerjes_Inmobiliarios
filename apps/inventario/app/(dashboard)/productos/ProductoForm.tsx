'use client'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { AlertCircle, Loader2, Save } from 'lucide-react'
import Link from 'next/link'
import type { ActionResult } from './actions'
import { ImagePicker } from '@/components/ui/ImagePicker'
import { CATEGORIA_LABELS, type CategoriaRotacion, type TipoInsumo } from '@/lib/types/database'

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

  return (
    <form action={formAction} className="space-y-6 max-w-3xl">
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}

      {state.error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="font-body text-sm text-red-700">{state.error}</p>
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
            <input name="ref" type="number" defaultValue={defaults.ref ?? ''} className={inputCls + ' mt-1'} placeholder="Opcional" />
          </div>
          <div>
            <label className={labelCls}>Código</label>
            <input name="codigo" type="number" defaultValue={defaults.codigo ?? ''} className={inputCls + ' mt-1'} placeholder="Opcional" />
          </div>
        </div>

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
  )
}
