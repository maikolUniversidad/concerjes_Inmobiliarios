import { Gift, Ticket, Sparkles, Users } from 'lucide-react'
import { requirePermiso } from '@/lib/permisos-server'
import {
  getParametrosPuntos, getRecompensas, getRedenciones, getResumenPuntos,
} from '../puntos-actions'
import PuntosClient from './PuntosClient'

export default async function PuntosPage() {
  await requirePermiso('ver_puntos_hogar')

  const [parametros, recompensas, redenciones, resumen] = await Promise.all([
    getParametrosPuntos().catch(() => null),
    getRecompensas().catch(() => []),
    getRedenciones().catch(() => []),
    getResumenPuntos().catch(() => ({ porEntregar: 0, entregadas: 0, puntosEnCirculacion: 0, clientesConPuntos: 0 })),
  ])

  const tarjetas = [
    { label: 'Por entregar',        value: String(resumen.porEntregar),                              icon: Ticket,   cls: 'text-yellow-600', bg: 'bg-yellow-50' },
    { label: 'Canjes entregados',   value: String(resumen.entregadas),                               icon: Gift,     cls: 'text-green-600',  bg: 'bg-green-50' },
    { label: 'Puntos en circulación', value: resumen.puntosEnCirculacion.toLocaleString('es-CO'),    icon: Sparkles, cls: 'text-brand-green', bg: 'bg-brand-green/10' },
    { label: 'Clientes con puntos', value: String(resumen.clientesConPuntos),                        icon: Users,    cls: 'text-blue-600',   bg: 'bg-blue-50' },
  ]

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Puntos y Recompensas</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cuántos puntos gana el cliente, qué puede cambiar por ellos y cómo van los canjes.
          Todo lo que definas aquí es lo que ve en el portal.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tarjetas.map((t) => (
          <div key={t.label} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${t.bg} ${t.cls}`}>
              <t.icon className="h-5 w-5" />
            </div>
            <p className="mt-3 text-2xl font-bold text-gray-900">{t.value}</p>
            <p className="text-sm text-gray-500">{t.label}</p>
          </div>
        ))}
      </div>

      <PuntosClient parametros={parametros} recompensas={recompensas} redenciones={redenciones} />
    </div>
  )
}
