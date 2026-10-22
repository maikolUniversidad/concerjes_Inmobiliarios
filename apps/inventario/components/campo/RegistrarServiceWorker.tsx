'use client'

import { useEffect } from 'react'

/**
 * Registra el service worker de `/campo/sw.js` con scope `/campo/`.
 *
 * El scope es lo importante: así lo que queda instalable y disponible sin señal
 * es la app de campo, no la consola entera —que no es una PWA y cuyo caché
 * confundiría a quien administra inventario desde un escritorio.
 *
 * En desarrollo no se registra: un service worker con el bundle de `next dev`
 * en caché es la forma más rápida de pasar una hora depurando un cambio que ya
 * estaba hecho.
 */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/campo/sw.js', { scope: '/campo/' })
      .catch((e) => console.warn('[campo] no se pudo registrar el service worker', e))
  }, [])
  return null
}
