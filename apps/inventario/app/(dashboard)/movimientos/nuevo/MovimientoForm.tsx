'use client'
import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { AlertCircle, Loader2, Save } from 'lucide-react'
import Link from 'next/link'
import { registrarMovimiento, type ActionResult } from '../actions'
import type { TipoMovimiento } from '@/lib/types/database'

const TIPOS: { value: TipoMovimiento; label: string; hint: string }[] = [
  { value: 'ENTRADA', label: 'Entrada', hint: 'Suma al stock (compra, recepción de OC)' },
  { value: 'SALIDA', label: 'Salida', hint: 'Resta del stock (despacho a sede)' },
  { value: 'DEVOLUCION', label: 'Devolución', hint: 'Suma al stock (retorno de sede)' },
  { value: 'AJUSTE', label: 'Ajuste', hint: 'Fija el stock al valor indicado (corrección de conteo)' },
  { value: 'TRASLADO', label: 'Traslado', hint: 'Registra traslado, no altera el stock central' },
]

const labelCls = 'font-body font-semibold text-sm text-gray-700'
const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'

function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark transition-colors disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
      {pending ? 'Registrando...' : 'Registrar movimiento'}
    </button>
  )
}

interface Props {
  productos: { id: string; nombre_estandar: string; presentacion: string | null }[]
  sedes: { id: string; nombre: string }[]
  initialProducto?: string
  initialTipo?: TipoMovimiento
}

export function MovimientoForm({ productos, sedes, initialProducto, initialTipo }: Props) {
  const [state, formAction] = useActionState<ActionResult, FormData>(registrarMovimiento, {})
  const [tipo, setTipo] = useState<TipoMovimiento>(initialTipo ?? 'ENTRADA')
  const hint = TIPOS.find(t => t.value === tipo)?.hint

  return (
    <form action={formAction} className="space-y-6 max-w-2xl">
      {state.error && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="font-body text-sm text-red-700">{state.error}</p>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-4">
        <div>
          <label className={labelCls}>Tipo de movimiento *</label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2">
            {TIPOS.map(t => (
              <label key={t.value}
                className={`cursor-pointer text-center rounded-lg border px-2 py-2 font-body text-xs font-semibold transition-colors
                  ${tipo === t.value ? 'border-brand-green bg-green-50 text-brand-green' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                <input type="radio" name="tipo" value={t.value} checked={tipo === t.value}
                  onChange={() => setTipo(t.value)} className="sr-only" />
                {t.label}
              </label>
            ))}
          </div>
          {hint && <p className="font-body text-xs text-gray-400 mt-2">{hint}</p>}
        </div>

        <div>
          <label className={labelCls}>Producto *</label>
          <select name="producto_id" required defaultValue={initialProducto ?? ''} className={inputCls + ' mt-1 bg-white'}>
            <option value="" disabled>— Selecciona un producto —</option>
            {productos.map(p => (
              <option key={p.id} value={p.id}>
                {p.nombre_estandar}{p.presentacion ? ` · ${p.presentacion}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>{tipo === 'AJUSTE' ? 'Nueva cantidad real *' : 'Cantidad *'}</label>
            <input name="cantidad" type="number" min="0.01" step="0.01" required className={inputCls + ' mt-1'} placeholder="0" />
          </div>
          <div>
            <label className={labelCls}>Sede (opcional)</label>
            <select name="sede_id" defaultValue="" className={inputCls + ' mt-1 bg-white'}>
              <option value="">— Sin sede —</option>
              {sedes.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={labelCls}>Observación</label>
          <textarea name="observacion" rows={2} className={inputCls + ' mt-1 resize-none'}
            placeholder="Detalle del movimiento (opcional)" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SubmitBtn />
        <Link href="/movimientos" className="font-body text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5">Cancelar</Link>
      </div>
    </form>
  )
}
