import { requirePermiso } from '@/lib/permisos-server'

export default async function LogisticaLayout({ children }: { children: React.ReactNode }) {
  await requirePermiso('ver_logistica')
  return <>{children}</>
}
