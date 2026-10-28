import type { Metadata } from 'next'
import { MapPinned } from 'lucide-react'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import {
  getPersonasEnMapa, getPersonasSinUbicacion, getPuntosControlMapa,
  getSedesMapa, getTurnosRecorribles,
} from './datos'
import { MapaOperativoClient } from './MapaOperativoClient'

export const metadata: Metadata = { title: 'Mapa operativo' }
export const dynamic = 'force-dynamic'

/**
 * Mapa operativo (F8, §4.3 del complemento 2): dónde está cada quien, qué ruta
 * tiene y el recorrido de un turno pasado.
 *
 * Lo que NO se dibuja y por qué: polígonos de sede y planos por piso. Dependen
 * del levantamiento 2D/3D que §3.1 da por existente y que no está en el
 * repositorio (pendiente §10.1 nº 3). Mientras no llegue, la sede es un punto
 * con radio y el piso es una CAPA que se prende y se apaga, que es lo que los
 * datos de hoy permiten.
 */
export default async function MapaOperativoPage() {
  await requirePermiso('ver_mapa_operativo')
  const permisos = await getPermisosUsuario()
  const puedeRecorrido = permisos.puede('ver_recorrido_personas')

  // Si algo falla, el mapa se abre igual con lo que sí se pudo leer: una
  // pantalla de coordinación que no abre porque no hay puntos de control no
  // sirve de nada a las 6 de la mañana.
  const [personas, sinUbicacion, sedes, puntos, turnos] = await Promise.all([
    getPersonasEnMapa().catch(() => []),
    getPersonasSinUbicacion().catch(() => []),
    getSedesMapa().catch(() => []),
    getPuntosControlMapa().catch(() => []),
    puedeRecorrido ? getTurnosRecorribles().catch(() => []) : Promise.resolve([]),
  ])

  const enVivo = personas.filter((p) => p.en_vivo).length

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="font-heading flex items-center gap-2 text-2xl font-bold text-gray-900">
          <MapPinned className="h-6 w-6 text-brand-green" /> Mapa operativo
        </h1>
        <p className="font-body mt-0.5 text-sm text-gray-500">
          {personas.length === 0
            ? 'Nadie en turno con ubicación en este momento.'
            : `${personas.length} ${personas.length === 1 ? 'persona' : 'personas'} en turno · `
              + `${enVivo} con posición en vivo`}
          {sinUbicacion.length > 0 && ` · ${sinUbicacion.length} sin ubicación`}
          {'. '}
          Solo aparece quien tiene turno abierto: fuera del turno no se registra ni se muestra
          la ubicación de nadie.
        </p>
      </div>

      <MapaOperativoClient
        personasIniciales={personas}
        sinUbicacionIniciales={sinUbicacion}
        sedes={sedes}
        puntos={puntos}
        turnos={turnos}
        puedeRecorrido={puedeRecorrido}
      />
    </div>
  )
}
