'use client'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { AlertCircle, Loader2, Save } from 'lucide-react'
import Link from 'next/link'
import { crearBodega, actualizarBodega, type ActionResult } from './actions'
import { ImagePicker } from '@/components/ui/ImagePicker'

export interface BodegaDefaults {
  id?: string; nombre?: string; codigo?: string | null; direccion?: string | null
  descripcion?: string | null; plano_url?: string | null; responsable_id?: string | null
}

const labelCls = 'font-body font-semibold text-sm text-gray-700'
const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark transition-colors disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {label}
    </button>
  )
}

export function BodegaForm({ usuarios, defaults = {}, modo = 'crear' }: {
  usuarios: { id: string; nombre: string }[]; defaults?: BodegaDefaults; modo?: 'crear' | 'editar'
}) {
  const action = modo === 'crear' ? crearBodega : actualizarBodega
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

      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="font-heading font-semibold text-lg text-gray-900">Datos de la bodega</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div><label className={labelCls}>Nombre *</label><input name="nombre" required defaultValue={defaults.nombre ?? ''} className={inputCls + ' mt-1'} placeholder="Ej: Bodega Central" /></div>
          <div><label className={labelCls}>Código</label><input name="codigo" defaultValue={defaults.codigo ?? ''} className={inputCls + ' mt-1'} placeholder="Ej: CENTRAL" /></div>
        </div>
        <div><label className={labelCls}>Dirección</label><input name="direccion" defaultValue={defaults.direccion ?? ''} className={inputCls + ' mt-1'} /></div>
        <div><label className={labelCls}>Descripción</label><textarea name="descripcion" rows={2} defaultValue={defaults.descripcion ?? ''} className={inputCls + ' mt-1 resize-none'} /></div>
        <div>
          <label className={labelCls}>Responsable</label>
          <select name="responsable_id" defaultValue={defaults.responsable_id ?? ''} className={inputCls + ' mt-1 bg-white'}>
            <option value="">— Sin responsable —</option>
            {usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <ImagePicker name="plano_url" defaultUrl={defaults.plano_url ?? null} bucket="galeria-fotos" folder="bodegas/planos" label="Plano / layout de la bodega" />
        <p className="font-body text-xs text-gray-400 mt-2">Sube una imagen del plano. Luego podrás marcar sobre ella dónde está cada estantería.</p>
      </div>

      <div className="flex items-center gap-3">
        <SubmitBtn label={modo === 'crear' ? 'Crear bodega' : 'Guardar cambios'} />
        <Link href={defaults.id ? `/bodegas/${defaults.id}` : '/bodegas'} className="font-body text-sm text-gray-500 hover:text-gray-700 px-4 py-2.5">Cancelar</Link>
      </div>
    </form>
  )
}
