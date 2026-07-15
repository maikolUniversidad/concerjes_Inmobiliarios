'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, LogIn, ScanFace, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { getSupabase } from '@/lib/supabase/anon'
import { CapturaFacial, type ResultadoFacial } from '../registro-vacantes/CapturaFacial'

export function IngresarClient() {
  const router = useRouter()
  const [idInput, setIdInput] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [camara, setCamara] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function ingresar() {
    setError(null)
    const raw = idInput.trim()
    if (!raw || !password.trim()) { setError('Escribe tu documento (o correo) y tu contraseña.'); return }
    setCargando(true)
    try {
      let email = raw
      if (!raw.includes('@')) {
        // Resuelve el correo de login a partir del documento.
        const res = await fetch('/api/registro/resolver-email', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documento: raw }),
        })
        const j = await res.json()
        if (!j.email) { setError('No encontramos una cuenta con ese documento. Verifica o regístrate.'); return }
        email = j.email
      }
      const sb = getSupabase()
      const { error: err } = await sb.auth.signInWithPassword({ email, password: password.trim() })
      if (err) { setError('Documento o contraseña incorrectos.'); return }
      toast.success('¡Bienvenido!')
      router.push('/registro-vacantes')
    } catch {
      setError('No se pudo ingresar. Intenta de nuevo.')
    } finally {
      setCargando(false)
    }
  }

  async function onFacial(r: ResultadoFacial) {
    if (r.disponible === false) { toast.info('El ingreso por rostro no está disponible por ahora. Usa tu documento.'); return }
    if (r.ok && r.token_hash) {
      const sb = getSupabase()
      const { error: err } = await sb.auth.verifyOtp({ token_hash: r.token_hash, type: 'email' })
      if (err) { toast.error('No se pudo iniciar sesión con tu rostro. Usa tu documento.'); return }
      toast.success('¡Bienvenido!')
      router.push('/registro-vacantes')
      return
    }
    if (r.requiere2fa) {
      toast.info('Te reconocimos. Por seguridad, confirma con tu documento y contraseña para entrar.')
      return
    }
    if (r.resultado === 'NO_MATCH') toast.info('No te reconocimos. Ingresa con tu documento.')
    else if (r.resultado === 'LIVENESS_FAIL') toast.error('No pudimos verificar tu rostro. Intenta con mejor luz o usa tu documento.')
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-xl font-bold text-gray-900">Ingresar</h1>
        <p className="mt-1 text-sm text-gray-500">Entra para ver el estado de tu proceso y actualizar tus datos.</p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-gray-700">Número de documento o correo</label>
        <input
          value={idInput}
          onChange={(e) => setIdInput(e.target.value)}
          placeholder="1020304050"
          className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-gray-700">Contraseña</label>
        <div className="relative">
          <input
            type={showPass ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ingresar()}
            placeholder="Tu número de documento"
            className="w-full rounded-xl border border-gray-300 px-4 py-3 pr-11 text-base outline-none focus:border-brand-green focus:ring-2 focus:ring-brand-green/20"
          />
          <button type="button" onClick={() => setShowPass((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            {showPass ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-400">Si no la cambiaste, tu contraseña es tu número de documento.</p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <button
        onClick={ingresar}
        disabled={cargando}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green py-3 font-body text-base font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50"
      >
        {cargando ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />} Ingresar
      </button>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-gray-200" /><span className="text-xs text-gray-400">o</span><span className="h-px flex-1 bg-gray-200" />
      </div>

      <button
        onClick={() => setCamara(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-brand-green py-3 font-body text-base font-semibold text-brand-green hover:bg-brand-green/5"
      >
        <ScanFace className="h-5 w-5" /> Ingresar con mi rostro
      </button>

      {camara && (
        <CapturaFacial modo="login" onResultado={onFacial} onCerrar={() => setCamara(false)} />
      )}
    </div>
  )
}
