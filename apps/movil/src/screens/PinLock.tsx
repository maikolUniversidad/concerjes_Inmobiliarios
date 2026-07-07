import { useState } from 'react'
import { Lock, Delete, LogOut } from 'lucide-react'
import { verificarPin } from '../lib/pin'
import { supabase } from '../lib/supabase'

export function PinLock({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)

  async function pulsar(d: string) {
    if (pin.length >= 6) return
    const nuevo = pin + d
    setPin(nuevo); setError(false)
    if (nuevo.length >= 4) {
      // Intenta desbloquear al llegar a 4-6 dígitos
      if (await verificarPin(nuevo)) { onUnlock(); return }
      if (nuevo.length === 6) { setError(true); setPin('') }
    }
  }

  return (
    <div className="h-full flex flex-col items-center justify-center bg-gradient-to-b from-brand-green to-brand-green-dark px-8">
      <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center mb-4">
        <Lock className="w-7 h-7 text-white" />
      </div>
      <p className="text-white font-semibold mb-1">Ingresa tu PIN</p>
      <p className={`text-xs mb-6 ${error ? 'text-red-200' : 'text-white/60'}`}>{error ? 'PIN incorrecto, intenta de nuevo' : 'Para abrir sin conexión'}</p>

      <div className="flex gap-3 mb-8">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className={`w-3.5 h-3.5 rounded-full border-2 border-white/60 ${i < pin.length ? 'bg-white' : ''}`} />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(n => (
          <button key={n} onClick={() => pulsar(n)}
            className="w-16 h-16 rounded-full bg-white/10 text-white text-2xl font-light active:bg-white/25">{n}</button>
        ))}
        <div />
        <button onClick={() => pulsar('0')} className="w-16 h-16 rounded-full bg-white/10 text-white text-2xl font-light active:bg-white/25">0</button>
        <button onClick={() => setPin(pin.slice(0, -1))} className="w-16 h-16 rounded-full flex items-center justify-center text-white active:bg-white/10"><Delete className="w-6 h-6" /></button>
      </div>

      <button onClick={() => supabase.auth.signOut()} className="mt-8 flex items-center gap-1.5 text-white/70 text-sm">
        <LogOut className="w-4 h-4" /> Cerrar sesión
      </button>
    </div>
  )
}
