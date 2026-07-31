'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Mail, Lock, Eye, EyeOff, User, Phone, ArrowRight, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  getPortalSupabase, ingresarConOAuth, asegurarCliente, type ProveedorOAuth,
} from '@/lib/supabase/portal'
import { GoogleIcon, AppleIcon } from '../../_ui/OAuthIcons'

type Metodo = 'email' | 'whatsapp'
type Modo = 'login' | 'registro'

export function IngresarPortalClient() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') || '/portal'

  const [modo, setModo] = useState<Modo>('login')
  const [metodo, setMetodo] = useState<Metodo>('email')
  const [cargando, setCargando] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  // email + password
  const [nombre, setNombre] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)

  // whatsapp / otp
  const [telefono, setTelefono] = useState('')
  const [otpEnviado, setOtpEnviado] = useState(false)
  const [otp, setOtp] = useState('')

  function irAlPortal() {
    router.push(next)
  }

  async function conOAuth(provider: ProveedorOAuth) {
    setError(null)
    setCargando(provider)
    const { error } = await ingresarConOAuth(provider)
    if (error) {
      setCargando(null)
      setError(
        provider === 'apple'
          ? 'Apple aún no está habilitado. Prueba con Google o tu correo.'
          : 'Google aún no está habilitado. Prueba con tu correo.'
      )
    }
    // Si no hay error, el navegador redirige al proveedor.
  }

  async function conEmail() {
    setError(null); setAviso(null)
    const mail = email.trim().toLowerCase()
    if (!mail || !password.trim()) { setError('Escribe tu correo y contraseña.'); return }
    if (modo === 'registro' && !nombre.trim()) { setError('Escribe tu nombre.'); return }
    if (password.trim().length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return }

    setCargando('email')
    try {
      const sb = getPortalSupabase()
      if (modo === 'registro') {
        const { data, error } = await sb.auth.signUp({
          email: mail,
          password: password.trim(),
          options: {
            data: { nombre: nombre.trim(), tipo: 'cliente' },
            emailRedirectTo: `${window.location.origin}/portal/auth/callback`,
          },
        })
        if (error) { setError(traducir(error.message)); return }
        if (!data.session) {
          setAviso('Te enviamos un correo para confirmar tu cuenta. Revísalo y luego inicia sesión.')
          setModo('login')
          return
        }
        await asegurarCliente({ nombre: nombre.trim() })
        toast.success('¡Cuenta creada!')
        irAlPortal()
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: mail, password: password.trim() })
        if (error) { setError('Correo o contraseña incorrectos.'); return }
        await asegurarCliente()
        toast.success('¡Bienvenido!')
        irAlPortal()
      }
    } catch {
      setError('No se pudo procesar. Intenta de nuevo.')
    } finally {
      setCargando(null)
    }
  }

  async function enviarOtp() {
    setError(null); setAviso(null)
    const tel = normalizarTelefono(telefono)
    if (!tel) { setError('Escribe un número de WhatsApp válido (con indicativo).'); return }
    setCargando('otp')
    try {
      const sb = getPortalSupabase()
      const { error } = await sb.auth.signInWithOtp({ phone: tel })
      if (error) { setError('El ingreso por WhatsApp aún no está habilitado. Usa tu correo o Google.'); return }
      setOtpEnviado(true)
      setAviso('Te enviamos un código por WhatsApp/SMS. Escríbelo abajo.')
    } catch {
      setError('No se pudo enviar el código.')
    } finally {
      setCargando(null)
    }
  }

  async function verificarOtp() {
    setError(null)
    const tel = normalizarTelefono(telefono)
    if (!otp.trim()) { setError('Escribe el código que recibiste.'); return }
    setCargando('otp')
    try {
      const sb = getPortalSupabase()
      const { error } = await sb.auth.verifyOtp({ phone: tel!, token: otp.trim(), type: 'sms' })
      if (error) { setError('Código incorrecto o vencido.'); return }
      await asegurarCliente({ telefono: tel! })
      toast.success('¡Bienvenido!')
      irAlPortal()
    } catch {
      setError('No se pudo verificar el código.')
    } finally {
      setCargando(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="font-heading text-2xl font-bold text-gray-900">
          {modo === 'login' ? 'Ingresa a tu portal' : 'Crea tu cuenta'}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Agenda servicios, haz seguimiento y guarda tus direcciones.
        </p>
      </div>

      {/* OAuth */}
      <div className="grid grid-cols-1 gap-2.5">
        <button
          onClick={() => conOAuth('google')}
          disabled={!!cargando}
          className="flex items-center justify-center gap-3 rounded-xl border border-gray-300 bg-white py-3 font-body text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          {cargando === 'google' ? <Loader2 className="h-5 w-5 animate-spin" /> : <GoogleIcon />}
          Continuar con Google
        </button>
        <button
          onClick={() => conOAuth('apple')}
          disabled={!!cargando}
          className="flex items-center justify-center gap-3 rounded-xl bg-black py-3 font-body text-sm font-semibold text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
        >
          {cargando === 'apple' ? <Loader2 className="h-5 w-5 animate-spin" /> : <AppleIcon />}
          Continuar con Apple
        </button>
      </div>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-gray-200" />
        <span className="text-xs text-gray-400">o con</span>
        <span className="h-px flex-1 bg-gray-200" />
      </div>

      {/* Selector de método */}
      <div className="flex rounded-xl bg-gray-100 p-1">
        <button
          onClick={() => setMetodo('email')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${metodo === 'email' ? 'bg-white text-brand-green shadow-sm' : 'text-gray-500'}`}
        >
          <Mail className="h-4 w-4" /> Correo
        </button>
        <button
          onClick={() => setMetodo('whatsapp')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${metodo === 'whatsapp' ? 'bg-white text-brand-green shadow-sm' : 'text-gray-500'}`}
        >
          <Phone className="h-4 w-4" /> WhatsApp
        </button>
      </div>

      {/* Email + password */}
      {metodo === 'email' && (
        <div className="space-y-3">
          {modo === 'registro' && (
            <Campo icon={<User className="h-4 w-4" />}>
              <input
                value={nombre} onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre completo"
                className="w-full bg-transparent text-base outline-none"
              />
            </Campo>
          )}
          <Campo icon={<Mail className="h-4 w-4" />}>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com" autoComplete="email"
              className="w-full bg-transparent text-base outline-none"
            />
          </Campo>
          <Campo icon={<Lock className="h-4 w-4" />}>
            <input
              type={showPass ? 'text' : 'password'} value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && conEmail()}
              placeholder="Contraseña" autoComplete={modo === 'registro' ? 'new-password' : 'current-password'}
              className="w-full bg-transparent text-base outline-none"
            />
            <button type="button" onClick={() => setShowPass((v) => !v)} className="text-gray-400 hover:text-gray-600">
              {showPass ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </Campo>

          <button
            onClick={conEmail} disabled={!!cargando}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green py-3 font-body text-base font-semibold text-white transition-colors hover:bg-brand-green-dark disabled:opacity-50"
          >
            {cargando === 'email' ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
            {modo === 'login' ? 'Ingresar' : 'Crear cuenta'}
          </button>
        </div>
      )}

      {/* WhatsApp OTP */}
      {metodo === 'whatsapp' && (
        <div className="space-y-3">
          <Campo icon={<Phone className="h-4 w-4" />}>
            <input
              type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)}
              placeholder="+57 310 000 0000" disabled={otpEnviado}
              className="w-full bg-transparent text-base outline-none disabled:text-gray-400"
            />
          </Campo>
          {otpEnviado && (
            <Campo icon={<CheckCircle2 className="h-4 w-4" />}>
              <input
                inputMode="numeric" value={otp} onChange={(e) => setOtp(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && verificarOtp()}
                placeholder="Código de 6 dígitos"
                className="w-full bg-transparent text-base tracking-widest outline-none"
              />
            </Campo>
          )}
          <button
            onClick={otpEnviado ? verificarOtp : enviarOtp} disabled={!!cargando}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green py-3 font-body text-base font-semibold text-white transition-colors hover:bg-brand-green-dark disabled:opacity-50"
          >
            {cargando === 'otp' ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowRight className="h-5 w-5" />}
            {otpEnviado ? 'Verificar código' : 'Enviarme el código'}
          </button>
          {otpEnviado && (
            <button onClick={() => { setOtpEnviado(false); setOtp(''); setAviso(null) }} className="w-full text-center text-xs text-gray-400 hover:text-gray-600">
              Cambiar número
            </button>
          )}
        </div>
      )}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {aviso && <p className="rounded-lg bg-brand-green-bg px-3 py-2 text-sm text-brand-green-dark">{aviso}</p>}

      {metodo === 'email' && (
        <p className="text-center text-sm text-gray-500">
          {modo === 'login' ? '¿Aún no tienes cuenta? ' : '¿Ya tienes cuenta? '}
          <button
            onClick={() => { setModo(modo === 'login' ? 'registro' : 'login'); setError(null); setAviso(null) }}
            className="font-semibold text-brand-green underline underline-offset-4"
          >
            {modo === 'login' ? 'Regístrate' : 'Inicia sesión'}
          </button>
        </p>
      )}

      <p className="text-center text-xs text-gray-400">
        <Link href="/servicios-hogar" className="hover:text-gray-600">← Volver a Servicios del Hogar</Link>
      </p>
    </div>
  )
}

function Campo({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-gray-300 px-3.5 py-3 focus-within:border-brand-green focus-within:ring-2 focus-within:ring-brand-green/20">
      <span className="text-gray-400">{icon}</span>
      {children}
    </div>
  )
}

function normalizarTelefono(v: string): string | null {
  const limpio = v.replace(/[^\d+]/g, '')
  if (!limpio) return null
  if (limpio.startsWith('+')) return limpio.length >= 11 ? limpio : null
  // Sin indicativo: asumir Colombia (+57).
  const soloDigitos = limpio.replace(/\D/g, '')
  if (soloDigitos.length === 10) return `+57${soloDigitos}`
  if (soloDigitos.length >= 11) return `+${soloDigitos}`
  return null
}

function traducir(msg: string): string {
  if (/already registered|already exists/i.test(msg)) return 'Ese correo ya tiene una cuenta. Inicia sesión.'
  if (/password/i.test(msg)) return 'La contraseña no cumple los requisitos (mínimo 6 caracteres).'
  return 'No se pudo crear la cuenta. Verifica los datos.'
}
