import { PantallaLimpiando } from '@/components/layout/PantallaLimpiando'

/**
 * Carga de TODO el grupo (dashboard).
 *
 * Al vivir en el grupo, Next envuelve en un Suspense a `children` del layout
 * —no al layout— así que esto se dibuja DENTRO del shell: el menú lateral, la
 * barra superior y la nav móvil se quedan quietos y solo cambia el contenido.
 *
 * Cubre las ~60 páginas anidadas del dashboard, que son `force-dynamic` y
 * antes dejaban la pantalla congelada mientras el servidor consultaba.
 * Los demás grupos —(auth), (campo), (print)— tienen su propio shell y
 * necesitarían su propio loading.tsx.
 */
export default function Loading() {
  return <PantallaLimpiando />
}
