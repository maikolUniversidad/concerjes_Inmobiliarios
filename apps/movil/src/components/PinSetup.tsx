import { useState } from 'react'
import { X, ShieldCheck, Trash2 } from 'lucide-react'
import { tienePin, definirPin, quitarPin } from '../lib/pin'

export function PinSetup({ onClose }: { onClose: () => void }) {
  const existe = tienePin()
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [msg, setMsg] = useState('')

  async function guardar() {
    if (!/^\d{4,6}$/.test(pin)) { setMsg('El PIN debe tener de 4 a 6 dígitos.'); return }
    if (pin !== pin2) { setMsg('Los PIN no coinciden.'); return }
    await definirPin(pin)
    onClose()
  }
  function eliminar() { quitarPin(); onClose() }

  const inputCls = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-green text-center tracking-[0.4em]'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center sm:justify-center" onClick={onClose}>
      <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900 flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-brand-green" /> {existe ? 'Cambiar PIN' : 'Configurar PIN'}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <p className="text-xs text-gray-500">Un PIN te deja reabrir la app sin conexión sin volver a iniciar sesión.</p>
        {msg && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{msg}</p>}
        <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} placeholder="PIN (4-6 dígitos)" className={inputCls} />
        <input type="password" inputMode="numeric" maxLength={6} value={pin2} onChange={e => setPin2(e.target.value.replace(/\D/g, ''))} placeholder="Repite el PIN" className={inputCls} />
        <button onClick={guardar} className="w-full bg-brand-green text-white font-semibold text-sm px-4 py-3 rounded-xl hover:bg-brand-green-dark">Guardar PIN</button>
        {existe && (
          <button onClick={eliminar} className="w-full flex items-center justify-center gap-2 text-red-600 text-sm py-2"><Trash2 className="w-4 h-4" /> Quitar PIN</button>
        )}
      </div>
    </div>
  )
}
