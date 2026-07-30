import { requirePermiso } from '@/lib/permisos-server'

export default async function ServiciosHogarLayout({ children }: { children: React.ReactNode }) {
  await requirePermiso('ver_servicios_hogar')
  return <>{children}</>
}
