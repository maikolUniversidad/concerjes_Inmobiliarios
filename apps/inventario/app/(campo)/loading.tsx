import { PantallaCargandoCampo } from '@/components/campo/PantallaCargandoCampo'

/**
 * Carga del grupo (campo): la PWA del conserje.
 *
 * Las cinco páginas del grupo son `force-dynamic` y todas esperan al servidor
 * (sesión de campo, consentimientos, el punto del QR). Es donde más se nota:
 * se abre desde una placa pegada a una pared, en un celular, a veces con una
 * barra de señal. Sin esto, el conserje escanea y no pasa nada en pantalla.
 *
 * Se dibuja dentro del layout de campo (columna angosta `max-w-md`), así que
 * el componente solo pone su propio padding.
 */
export default function Loading() {
  return <PantallaCargandoCampo />
}
