'use client'

import { useState } from 'react'
import { Eye, EyeOff, LogIn, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    // TODO: Supabase Auth signIn
    await new Promise((r) => setTimeout(r, 1000))
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-1/2 gradient-brand flex-col items-center justify-center p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5"
          style={{ backgroundImage: `radial-gradient(circle at 25px 25px, white 2px, transparent 0)`, backgroundSize: '60px 60px' }}
        />
        <div className="relative z-10 text-center text-white max-w-sm">
          <div className="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-8">
            <span className="font-heading font-bold text-3xl">CI</span>
          </div>
          <h1 className="font-heading font-bold text-4xl mb-4">Plataforma de Inventarios</h1>
          <p className="font-body text-green-200 text-lg leading-relaxed mb-8">
            Control inteligente de inventarios con IA para Conserjes Inmobiliarios Ltda.
          </p>
          <div className="space-y-3 text-left">
            {[
              '✅ Escáner de códigos de barras',
              '🤖 Reconocimiento visual con IA',
              '📊 Reportes y análisis predictivo',
              '🔔 Alertas de stock en tiempo real',
            ].map((item) => (
              <p key={item} className="font-body text-sm text-green-100">{item}</p>
            ))}
          </div>
        </div>
      </div>

      {/* Right login form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="w-16 h-16 bg-brand-green rounded-2xl flex items-center justify-center mx-auto mb-3">
              <span className="text-white font-heading font-bold text-xl">CI</span>
            </div>
            <h1 className="font-heading font-bold text-2xl text-brand-green">CI Inventario</h1>
          </div>

          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
            <h2 className="font-heading font-bold text-2xl text-gray-900 mb-2">Iniciar sesión</h2>
            <p className="font-body text-sm text-gray-500 mb-8">Ingresa tus credenciales corporativas</p>

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="font-body text-sm font-semibold text-gray-700 block mb-1.5">
                  Correo electrónico
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 font-body text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-colors"
                  placeholder="usuario@conserjesinmobiliarios.com"
                />
              </div>
              <div>
                <label className="font-body text-sm font-semibold text-gray-700 block mb-1.5">
                  Contraseña
                </label>
                <div className="relative">
                  <input
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 pr-12 font-body text-sm focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-colors"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2.5 bg-brand-green text-white font-body font-bold text-base py-3.5 rounded-xl hover:bg-brand-green-dark transition-all disabled:opacity-60 shadow-md"
              >
                {loading ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Ingresando...</>
                ) : (
                  <><LogIn className="w-5 h-5" /> Ingresar</>
                )}
              </button>
            </form>

            <p className="text-center font-body text-xs text-gray-400 mt-6">
              ¿Problemas para ingresar? Contacta al administrador del sistema.
            </p>
          </div>

          <p className="text-center font-body text-xs text-gray-400 mt-4">
            © {new Date().getFullYear()} Conserjes Inmobiliarios Ltda · NIT 800093388-2
          </p>
        </div>
      </div>
    </div>
  )
}
