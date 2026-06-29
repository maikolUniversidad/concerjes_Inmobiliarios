'use client'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { AlertCircle, Loader2, ClipboardCheck } from 'lucide-react'
import Link from 'next/link'
import { crearArqueo, type ActionResult } from '../actions'

const TIPOS = ['CAFETERIA', 'LIQUIDOS', 'ASEO', 'EPP', 'PAPELERIA', 'MAQUINARIA', 'JARDINERIA', 'REPUESTOS', 'OTROS']
const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'

function SubmitBtn() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark transition-colors disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
      {pending ? 'Preparando conteo...' : 'Iniciar arqueo'}
    </button>
  )
}

export function ArqueoNuevoForm() {
  const [state, formAction] = useActionState<ActionResult, FormData>(crearArqueo, {})
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
          <label className="font-body font-semibold text-sm text-gray-700">Nombre del arqueo *</label>
          <input name="nombre" required className={inputCls + ' mt-1'} placeholder="Ej: Arqueo mensual bodega central — Junio 2026" />
        </div>
        <div>
          <label className="font-body font-semibold text-sm text-gray-700">Descripción</label>
          <textarea name="descripcion" rows={2} className={inputCls + ' mt-1 resize-none'} placeholder="Notas, responsables, alcance... (opcional)" />
        </div>
        <div>
          <label className="font-body font-semibold text-sm text-gray-700">Alcance</label>
          <select name="filtro_tipo" defaultValue="" className={inputCls + ' mt-1 bg-white'}>
            <option value="">Todo el inventario activo</option>
            {TIPOS.map(t => <option key={t} value={t}>Solo {t}</option>)}
          </select>
          <p className="font-body text-xs text-gray-400 mt-1">
            Se tomará una “foto” del stock actual de cada producto. Luego varias personas pueden contar en simultáneo.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SubmitBtn />
        <Link href="/arqueo" className="font-body text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5">Cancelar</Link>
      </div>
    </form>
  )
}
