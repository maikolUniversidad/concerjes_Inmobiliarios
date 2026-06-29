'use client'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { AlertCircle, Loader2, Save } from 'lucide-react'
import Link from 'next/link'
import { crearProducto, type ActionResult } from '../actions'
import { CATEGORIA_LABELS, type CategoriaRotacion } from '@/lib/types/database'

const TIPOS = ['CAFETERIA', 'LIQUIDOS', 'ASEO', 'EPP', 'PAPELERIA', 'MAQUINARIA', 'JARDINERIA', 'REPUESTOS', 'OTROS']

function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark transition-colors disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
      {pending ? 'Guardando...' : 'Guardar producto'}
    </button>
  )
}

const labelCls = 'font-body font-semibold text-sm text-gray-700'
const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'

export function NuevoProductoForm({ proveedores }: { proveedores: { id: string; nombre: string }[] }) {
  const [state, formAction] = useActionState<ActionResult, FormData>(crearProducto, {})

  return (
    <form action={formAction} className="space-y-6 max-w-3xl">
      {state.error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="font-body text-sm text-red-700">{state.error}</p>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-heading font-semibold text-lg text-gray-900">Información general</h2>

        <div>
          <label className={labelCls}>Nombre estándar *</label>
          <input name="nombre_estandar" required minLength={3} className={inputCls + ' mt-1'}
            placeholder="Ej: JABON PARA LOZA LIQUIDO" />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Presentación</label>
            <input name="presentacion" className={inputCls + ' mt-1'} placeholder="Ej: GALON / TARRO X 500 ML" />
          </div>
          <div>
            <label className={labelCls}>Tipo de insumo</label>
            <select name="tipo_insumo" defaultValue="OTROS" className={inputCls + ' mt-1 bg-white'}>
              {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Categoría rotación</label>
            <select name="cat_rotacion" defaultValue="C" className={inputCls + ' mt-1 bg-white'}>
              {(['A', 'B', 'C', 'D'] as CategoriaRotacion[]).map(c =>
                <option key={c} value={c}>Cat. {c} — {CATEGORIA_LABELS[c].label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>REF</label>
            <input name="ref" type="number" className={inputCls + ' mt-1'} placeholder="Opcional" />
          </div>
          <div>
            <label className={labelCls}>Código</label>
            <input name="codigo" type="number" className={inputCls + ' mt-1'} placeholder="Opcional" />
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-heading font-semibold text-lg text-gray-900">Stock y precio</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Stock mínimo</label>
            <input name="stock_minimo_def" type="number" min="0" step="0.01" defaultValue="0" className={inputCls + ' mt-1'} />
          </div>
          <div>
            <label className={labelCls}>Stock inicial</label>
            <input name="stock_inicial" type="number" min="0" step="0.01" defaultValue="0" className={inputCls + ' mt-1'} />
          </div>
          <div>
            <label className={labelCls}>Precio de lista (COP)</label>
            <input name="precio_lista" type="number" min="0" step="0.01" className={inputCls + ' mt-1'} placeholder="Opcional" />
          </div>
        </div>
        <div>
          <label className={labelCls}>Proveedor</label>
          <select name="proveedor_id" defaultValue="" className={inputCls + ' mt-1 bg-white'}>
            <option value="">— Sin proveedor —</option>
            {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SubmitBtn />
        <Link href="/productos" className="font-body text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5">
          Cancelar
        </Link>
      </div>
    </form>
  )
}
