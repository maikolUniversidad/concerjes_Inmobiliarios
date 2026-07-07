import { DashboardShell } from '@/components/layout/DashboardShell'
import { PermisosProvider } from '@/components/permisos/PermisosProvider'
import { getPermisosUsuario } from '@/lib/permisos-server'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { permisos, rol, sinGating } = await getPermisosUsuario()

  return (
    <PermisosProvider permisos={permisos} rol={rol} sinGating={sinGating}>
      <DashboardShell>{children}</DashboardShell>
    </PermisosProvider>
  )
}
