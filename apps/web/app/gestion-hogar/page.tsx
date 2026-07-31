'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Session } from '@supabase/supabase-js'
import { Loader2, Lock, Mail, LogIn, ImageIcon, Star, LogOut, ShieldAlert, Users } from 'lucide-react'
import { getGestionSupabase } from '@/lib/supabase/gestion'
import { GaleriaAdmin } from './GaleriaAdmin'
import { ResenasAdmin } from './ResenasAdmin'
import { ConcerjesAdmin } from './ConcerjesAdmin'

type Estado = 'cargando' | 'login' | 'verificando' | 'no-staff' | 'ok'

export default function GestionHogarPage() {
  const [estado, setEstado] = useState<Estado>('cargando')
  const [session, setSession] = useState<Session | null>(null)
  const [nombre, setNombre] = useState<string | null>(null)
  const [tab, setTab] = useState<'galeria' | 'concerjes' | 'resenas'>('galeria')

  // login form
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function verificar(s: Session) {
    setEstado('verificando')
    setSession(s)
    try {
      const res = await fetch('/api/gestion-hogar/whoami', { headers: { Authorization: `Bearer ${s.access_token}` } })
      const j = await res.json()
      if (j.esStaff) { setNombre(j.nombre); setEstado('ok') }
      else setEstado('no-staff')
    } catch {
      setEstado('no-staff')
    }
  }

  useEffect(() => {
    const sb = getGestionSupabase()
    sb.auth.getSession().then(({ data }) => {
      if (data.session) verificar(data.session)
      else setEstado('login')
    })
  }, [])

  async function ingresar() {
    setError(null)
    if (!email.trim() || !password.trim()) { setError('Escribe tu correo y contraseña.'); return }
    setEntrando(true)
    const sb = getGestionSupabase()
    const { data, error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: password.trim() })
    setEntrando(false)
    if (error || !data.session) { setError('Correo o contraseña incorrectos.'); return }
    verificar(data.session)
  }

  async function salir() {
    await getGestionSupabase().auth.signOut()
    setSession(null); setEstado('login')
  }

  if (estado === 'cargando' || estado === 'verificando') {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-green" /></div>
  }

  if (estado === 'login') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-brand-green">
              <span className="font-heading text-lg font-bold text-white">CI</span>
            </div>
            <h1 className="font-heading text-xl font-bold text-gray-900">Gestión · Servicios del Hogar</h1>
            <p className="mt-1 text-sm text-gray-500">Acceso para personal autorizado.</p>
          </div>
          <div className="space-y-3 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
            <div className="flex items-center gap-2.5 rounded-xl border border-gray-300 px-3.5 py-3 focus-within:border-brand-green">
              <Mail className="h-4 w-4 text-gray-400" />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="correo@empresa.com" className="w-full bg-transparent outline-none" />
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-gray-300 px-3.5 py-3 focus-within:border-brand-green">
              <Lock className="h-4 w-4 text-gray-400" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && ingresar()} placeholder="Contraseña" className="w-full bg-transparent outline-none" />
            </div>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button onClick={ingresar} disabled={entrando}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green py-3 font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
              {entrando ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />} Ingresar
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (estado === 'no-staff') {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-amber-500" />
          <h1 className="mt-3 font-heading text-xl font-bold text-gray-900">Sin permisos</h1>
          <p className="mt-1 text-sm text-gray-500">Tu cuenta no tiene permisos para gestionar Servicios del Hogar. Contacta a un administrador.</p>
          <button onClick={salir} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-100">
            <LogOut className="h-4 w-4" /> Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  // estado === 'ok'
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/servicios-hogar" className="text-xs font-semibold text-brand-green hover:underline">← Servicios del Hogar</Link>
          <h1 className="font-heading text-2xl font-bold text-gray-900">Gestión de Servicios del Hogar</h1>
          {nombre && <p className="text-sm text-gray-500">Conectado como {nombre}</p>}
        </div>
        <button onClick={salir} className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100">
          <LogOut className="h-4 w-4" /> Salir
        </button>
      </header>

      <div className="mb-6 flex rounded-xl bg-gray-100 p-1">
        <button onClick={() => setTab('galeria')} className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-colors ${tab === 'galeria' ? 'bg-white text-brand-green shadow-sm' : 'text-gray-500'}`}>
          <ImageIcon className="h-4 w-4" /> Galería
        </button>
        <button onClick={() => setTab('concerjes')} className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-colors ${tab === 'concerjes' ? 'bg-white text-brand-green shadow-sm' : 'text-gray-500'}`}>
          <Users className="h-4 w-4" /> Concerjes
        </button>
        <button onClick={() => setTab('resenas')} className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-colors ${tab === 'resenas' ? 'bg-white text-brand-green shadow-sm' : 'text-gray-500'}`}>
          <Star className="h-4 w-4" /> Reseñas
        </button>
      </div>

      {session && tab === 'galeria' && <GaleriaAdmin session={session} />}
      {session && tab === 'concerjes' && <ConcerjesAdmin />}
      {session && tab === 'resenas' && <ResenasAdmin />}
    </div>
  )
}
