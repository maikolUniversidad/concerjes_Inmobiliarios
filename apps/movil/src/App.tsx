import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Loader2 } from 'lucide-react'
import { supabase } from './lib/supabase'
import { Login } from './screens/Login'
import { PinLock } from './screens/PinLock'
import { Layout, type Tab } from './components/Layout'
import { PermisosProvider } from './components/Permisos'
import { Productos } from './screens/Productos'
import { Stock } from './screens/Stock'
import { Movimientos } from './screens/Movimientos'
import { Bodegas } from './screens/Bodegas'
import { Arqueo } from './screens/Arqueo'
import { tienePin, estaDesbloqueado, marcarDesbloqueado, bloquear } from './lib/pin'

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined) // undefined = cargando
  const [tab, setTab] = useState<Tab>('productos')
  const [unlocked, setUnlocked] = useState(estaDesbloqueado())

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN') { marcarDesbloqueado(); setUnlocked(true) }
      if (event === 'SIGNED_OUT') { bloquear(); setUnlocked(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin text-brand-green" />
        <p className="text-sm">Cargando…</p>
      </div>
    )
  }

  if (!session) return <Login />

  // Sesión cacheada + PIN configurado y no desbloqueado → pedir PIN (apertura offline)
  if (tienePin() && !unlocked) return <PinLock onUnlock={() => setUnlocked(true)} />

  return (
    <PermisosProvider userId={session.user.id}>
      <Layout session={session} tab={tab} onTab={setTab}>
        {tab === 'productos' && <Productos />}
        {tab === 'stock' && <Stock />}
        {tab === 'movimientos' && <Movimientos />}
        {tab === 'bodegas' && <Bodegas />}
        {tab === 'arqueo' && <Arqueo />}
      </Layout>
    </PermisosProvider>
  )
}
