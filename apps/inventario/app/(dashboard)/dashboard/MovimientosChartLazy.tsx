'use client'
import dynamic from 'next/dynamic'

/**
 * El gráfico de movimientos, cargado aparte del resto del tablero.
 *
 * `recharts` pesa ~730 KB (205 KB comprimido) y entraba en el paquete inicial
 * de /dashboard, que es la pantalla que todo el mundo abre primero: se
 * descargaba antes de poder ver un solo número, para dibujar una barra de 224
 * píxeles de alto que está más abajo del pliegue. Así baja después, mientras
 * los KPI y las tablas ya se leen.
 *
 * `ssr: false` porque un gráfico no aporta nada en el HTML del servidor (mide
 * el ancho del contenedor para dibujarse), y el `loading` reserva el MISMO alto
 * (`h-56`) que el gráfico final, así que no hay salto de layout.
 *
 * Mismo patrón que `MapaLiveClient` con el mapa de Leaflet.
 */
export const MovimientosChart = dynamic(
  () => import('./MovimientosChart').then((m) => m.MovimientosChart),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-56 rounded-xl bg-gray-50 dark:bg-gray-800/50 animate-pulse"
        role="status"
        aria-label="Cargando el gráfico de movimientos"
      />
    ),
  },
)
