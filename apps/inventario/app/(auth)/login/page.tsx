'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Eye, EyeOff, LogIn, Loader2, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [show, setShow]         = useState(false)
  const [loading, setLoading]   = useState(false)
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const router = useRouter()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    if (authError) {
      setError(
        authError.message.includes('Invalid login credentials')
          ? 'Correo o contraseña incorrectos.'
          : authError.message.includes('Email not confirmed')
          ? 'Correo no confirmado. Contacta al administrador.'
          : 'Error al iniciar sesión. Intenta de nuevo.'
      )
      setLoading(false)
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">

      {/* Back */}
      <div className="p-4 sm:p-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-body text-sm text-gray-500 hover:text-brand-green transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al inicio
        </Link>
      </div>

      {/* Centered card */}
      <div className="flex-1 flex items-center justify-center px-4 pb-12">
        <div className="w-full max-w-[420px]">

          {/* Logo */}
          <div className="text-center mb-8">
            <Image
              src="/logo.png"
              alt="Conserjes Inmobiliarios"
              width={200}
              height={200}
              className="mx-auto object-contain mb-2"
              priority
            />
            <p className="font-body text-sm text-gray-500 mt-1">Plataforma de Inventarios</p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
            <h2 className="font-heading font-bold text-xl text-gray-900 mb-1">Iniciar sesión</h2>
            <p className="font-body text-sm text-gray-500 mb-7">Ingresa tus credenciales corporativas</p>

            {error && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-5">
                <p className="font-body text-sm text-red-700">{error}</p>
              </div>
            )}

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
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 font-body text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-colors placeholder:text-gray-400"
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
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 pr-12 font-body text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-colors placeholder:text-gray-400"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {show ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2.5 bg-brand-green text-white font-body font-bold text-base py-3.5 rounded-xl hover:bg-brand-green-dark transition-all disabled:opacity-60 shadow-md shadow-brand-green/30 mt-2"
              >
                {loading ? (
                  <><Loader2 className="w-5 h-5 animate-spin" /> Ingresando...</>
                ) : (
                  <><LogIn className="w-5 h-5" /> Ingresar</>
                )}
              </button>
            </form>

            <p className="text-center font-body text-xs text-gray-400 mt-6 leading-relaxed">
              ¿Problemas para ingresar?{' '}
              <span className="text-brand-green">Contacta al administrador del sistema.</span>
            </p>
          </div>

          <p className="text-center font-body text-xs text-gray-400 mt-5">
            © {new Date().getFullYear()} Conserjes Inmobiliarios Ltda · NIT 800093388-2
          </p>
        </div>
      </div>
    </div>
  )
}
