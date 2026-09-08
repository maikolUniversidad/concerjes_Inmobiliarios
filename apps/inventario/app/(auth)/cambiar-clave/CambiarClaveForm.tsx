'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, KeyRound, Loader2, Check, ShieldAlert, ArrowLeft, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  /** true cuando la cuenta todavía tiene la contraseña temporal. */
  obligatorio: boolean
  correo: string
  documento: string
  nombre: string
}

/** Longitud mínima. Auth exige 6; aquí se pide más porque la temporal es pública. */
const MINIMO = 8

interface Regla {
  id: string
  texto: string
  cumple: (clave: string, documento: string, correo: string) => boolean
}

// Las reglas se muestran en pantalla y se evalúan en vivo: es más útil ver qué
// falta que recibir un error después de enviar.
const REGLAS: Regla[] = [
  {
    id: 'largo',
    texto: `Al menos ${MINIMO} caracteres`,
    cumple: (c) => c.length >= MINIMO,
  },
  {
    id: 'letra',
    texto: 'Al menos una letra',
    cumple: (c) => /\p{L}/u.test(c),
  },
  {
    id: 'numero',
    texto: 'Al menos un número',
    cumple: (c) => /\d/.test(c),
  },
  {
    // La razón de ser de esta pantalla: la contraseña temporal es la cédula, y
    // la cédula está en la nómina, en los informes y en el carnet.
    id: 'ni-documento',
    texto: 'No puede ser tu documento ni tu usuario',
    cumple: (c, documento, correo) => {
      const v = c.trim().toLowerCase()
      if (!v) return false
      const usuario = correo.split('@')[0].toLowerCase()
      return v !== documento.trim().toLowerCase() && v !== usuario && !/^\d+$/.test(v)
    },
  },
]

export function CambiarClaveForm({ obligatorio, correo, documento, nombre }: Props) {
  const router = useRouter()
  const [clave, setClave] = useState('')
  const [confirma, setConfirma] = useState('')
  const [ver, setVer] = useState(false)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [listo, setListo] = useState(false)

  const estado = useMemo(
    () => REGLAS.map((r) => ({ ...r, ok: r.cumple(clave, documento, correo) })),
    [clave, documento, correo],
  )
  const cumpleTodo = estado.every((r) => r.ok)
  const coinciden = clave.length > 0 && clave === confirma
  const puedeEnviar = cumpleTodo && coinciden && !cargando

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (!puedeEnviar) return
    setError('')
    setCargando(true)

    const supabase = createClient()
    // La marca se apaga en el mismo llamado que cambia la contraseña: si se
    // hicieran por separado, un fallo en el segundo dejaría la cuenta girando
    // para siempre en esta pantalla.
    const { error: err } = await supabase.auth.updateUser({
      password: clave,
      data: { debe_cambiar_password: false, password_cambiada_at: new Date().toISOString() },
    })

    if (err) {
      const m = err.message.toLowerCase()
      setError(
        m.includes('different from the old')
          ? 'La contraseña nueva tiene que ser distinta de la actual.'
          : m.includes('weak') || m.includes('short')
          ? 'Esa contraseña es demasiado débil. Prueba con una más larga.'
          : err.message,
      )
      setCargando(false)
      return
    }

    setListo(true)
    // `getUser()` del middleware vuelve a preguntarle a Auth, así que ya verá la
    // marca apagada y dejará pasar.
    router.push('/dashboard')
    router.refresh()
  }

  async function salir() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col">
      <div className="p-4 sm:p-6">
        {obligatorio ? (
          <button
            onClick={salir}
            className="inline-flex items-center gap-2 font-body text-sm text-gray-500 hover:text-brand-green transition-colors"
          >
            <LogOut className="w-4 h-4" /> Cerrar sesión
          </button>
        ) : (
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 font-body text-sm text-gray-500 hover:text-brand-green transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Volver
          </button>
        )}
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-12">
        <div className="w-full max-w-[460px]">
          <div className="text-center mb-8">
            <Image src="/logo.png" alt="Conserjes Inmobiliarios" width={200} height={200}
              className="mx-auto object-contain mb-2" priority />
            <p className="font-body text-sm text-gray-500 mt-1">Plataforma de Inventarios</p>
          </div>

          <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8">
            <h2 className="font-heading font-bold text-xl text-gray-900 mb-1">
              {obligatorio ? 'Crea tu contraseña' : 'Cambiar contraseña'}
            </h2>
            <p className="font-body text-sm text-gray-500 mb-5">
              {nombre ? `Hola, ${nombre.split(' ')[0]}. ` : ''}
              {obligatorio
                ? 'Antes de entrar necesitas una contraseña que solo tú conozcas.'
                : 'Elige una contraseña nueva para tu cuenta.'}
            </p>

            {obligatorio && (
              <div className="flex gap-2.5 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 mb-5">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="font-body text-xs text-amber-900">
                  Entraste con una contraseña temporal: <strong>tu número de documento</strong>.
                  Ese número aparece en la nómina, en los informes y en tu carnet, así que
                  cualquiera que lo tenga podría entrar como tú. Cámbiala para continuar.
                </p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-5">
                <p className="font-body text-sm text-red-700">{error}</p>
              </div>
            )}

            <form onSubmit={guardar} className="space-y-5">
              <div>
                <label htmlFor="clave" className="font-body text-sm font-semibold text-gray-700 block mb-1.5">
                  Contraseña nueva
                </label>
                <div className="relative">
                  <input
                    id="clave"
                    type={ver ? 'text' : 'password'}
                    value={clave}
                    onChange={(e) => setClave(e.target.value)}
                    required
                    autoFocus
                    autoComplete="new-password"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 pr-12 font-body text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-colors placeholder:text-gray-400"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setVer((v) => !v)}
                    aria-label={ver ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {ver ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="confirma" className="font-body text-sm font-semibold text-gray-700 block mb-1.5">
                  Repítela
                </label>
                <input
                  id="confirma"
                  type={ver ? 'text' : 'password'}
                  value={confirma}
                  onChange={(e) => setConfirma(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 font-body text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green transition-colors placeholder:text-gray-400"
                  placeholder="••••••••"
                />
                {confirma.length > 0 && !coinciden && (
                  <p className="font-body text-xs text-red-600 mt-1.5">Las dos contraseñas no son iguales.</p>
                )}
              </div>

              <ul className="space-y-1.5">
                {estado.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                      r.ok ? 'bg-brand-green text-white' : 'border border-gray-300 bg-white'
                    }`}>
                      {r.ok && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                    </span>
                    <span className={`font-body text-xs ${r.ok ? 'text-gray-600' : 'text-gray-400'}`}>
                      {r.texto}
                    </span>
                  </li>
                ))}
              </ul>

              <button
                type="submit"
                disabled={!puedeEnviar}
                className="w-full flex items-center justify-center gap-2 bg-brand-green hover:bg-brand-green-dark disabled:opacity-40 disabled:cursor-not-allowed text-white font-body font-semibold text-sm px-4 py-3 rounded-xl transition-colors"
              >
                {cargando || listo
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Guardando…</>
                  : <><KeyRound className="w-4 h-4" /> Guardar y continuar</>}
              </button>
            </form>
          </div>

          <p className="font-body text-xs text-gray-400 text-center mt-5">
            Tu usuario sigue siendo <strong className="text-gray-500">{correo}</strong>
            {documento && !correo.startsWith(documento) ? '' : ' (puedes entrar solo con tu cédula)'}.
          </p>
        </div>
      </div>
    </div>
  )
}
