/**
 * Fotos de los servicios corporativos, en un solo lugar.
 *
 * Las usan la sección de servicios de la portada y la página /servicios, para
 * que ambas muestren la misma imagen por servicio y no se desincronicen.
 */
export const FOTOS_SERVICIO: Record<string, { src: string; alt: string }> = {
  aseo: {
    src: '/images/servicios-hogar/aseo-regular.jpg',
    alt: 'Colaboradora de Conserjes Inmobiliarios trapeando el piso de una sala',
  },
  cafeteria: {
    src: '/images/servicios/cafeteria.jpg',
    alt: 'Limpieza a fondo de una plancha de cocina industrial',
  },
  conserjeria: {
    src: '/images/servicios/conserjeria.jpg',
    alt: 'Conserje de Conserjes Inmobiliarios en la recepción de un edificio residencial',
  },
  jardineria: {
    src: '/images/servicios-hogar/jardin.jpg',
    alt: 'Cuidado de plantas en la terraza de un apartamento',
  },
  especiales: {
    src: '/images/servicios-hogar/post-obra.jpg',
    alt: 'Limpieza post-obra en un apartamento recién entregado',
  },
  alturas: {
    src: '/images/servicios/alturas.jpg',
    alt: 'Operarios con arnés lavando la fachada de vidrio de una torre corporativa',
  },
}
