import { useState } from 'react'
import { Loader2, LogIn, WifiOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { estaEnLinea } from '../lib/sync'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    if (!estaEnLinea()) { setError('Necesitas conexión para iniciar sesión por primera vez.'); return }
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setLoading(false)
    if (error) {
      setError(error.message.includes('Invalid login') ? 'Correo o contraseña incorrectos.' : error.message)
    }
    // El cambio de sesión lo detecta App vía onAuthStateChange.
  }

  return (
    <div className="h-full flex flex-col items-center justify-center px-6 bg-gradient-to-b from-brand-green to-brand-green-dark">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-7">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-brand-green/10 flex items-center justify-center mx-auto mb-3">
            <span className="text-2xl">📦</span>
          </div>
          <h1 className="font-bold text-xl text-gray-900">Conserjes Inventario</h1>
          <p className="text-sm text-gray-500 mt-0.5">Inventario en tu bolsillo, con o sin internet</p>
        </div>

        {!estaEnLinea() && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-4">
            <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-xs text-amber-700">Sin conexión. El primer inicio de sesión requiere internet.</p>
          </div>
        )}

        <form onSubmit={entrar} className="space-y-3">
          {error && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="text-xs font-semibold text-gray-600">Correo</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-green mt-1"
              placeholder="tu@correo.com" autoComplete="username" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600">Contraseña</label>
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-brand-green mt-1"
              placeholder="••••••••" autoComplete="current-password" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-brand-green text-white font-semibold text-sm px-4 py-3 rounded-xl hover:bg-brand-green-dark transition-colors disabled:opacity-60 mt-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            Iniciar sesión
          </button>
        </form>
      </div>
      <p className="text-white/70 text-xs mt-6">Conserjes Inmobiliarios Ltda · NIT 800093388-2</p>
    </div>
  )
}
