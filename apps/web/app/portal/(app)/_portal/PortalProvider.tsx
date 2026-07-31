'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getPortalSupabase } from '@/lib/supabase/portal'

export interface ClientePerfil {
  id: string
  nombre: string
  email: string | null
  telefono: string | null
  documento: string | null
  foto_url: string | null
  proveedor: string | null
}

interface PortalCtx {
  session: Session
  cliente: ClientePerfil | null
  cargando: boolean
  token: string | null
  refrescarCliente: () => Promise<void>
}

const Ctx = createContext<PortalCtx | null>(null)

export function usePortal(): PortalCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('usePortal debe usarse dentro de <PortalProvider>')
  return c
}

export function PortalProvider({
  session,
  children,
}: {
  session: Session
  children: React.ReactNode
}) {
  const [cliente, setCliente] = useState<ClientePerfil | null>(null)
  const [cargando, setCargando] = useState(true)

  const refrescarCliente = useCallback(async () => {
    const sb = getPortalSupabase()
    const { data } = await sb.from('clientes').select('*').eq('id', session.user.id).maybeSingle()
    setCliente((data as ClientePerfil) ?? null)
    setCargando(false)
  }, [session.user.id])

  useEffect(() => {
    refrescarCliente()
  }, [refrescarCliente])

  return (
    <Ctx.Provider
      value={{ session, cliente, cargando, token: session.access_token, refrescarCliente }}
    >
      {children}
    </Ctx.Provider>
  )
}
