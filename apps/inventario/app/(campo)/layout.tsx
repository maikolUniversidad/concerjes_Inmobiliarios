import type { Metadata, Viewport } from 'next'
import { RegistrarServiceWorker } from '@/components/campo/RegistrarServiceWorker'

// La PWA del trabajador (ADR-A, decisión §1.1): grupo de rutas propio dentro de
// `apps/inventario`, con su manifest y su service worker, separado de la
// consola.
//
// Por qué un grupo de rutas y no otra aplicación: el QR es una etiqueta pegada
// en una pared y lo que abre es un navegador. Aquí se reusan auth, RLS,
// permisos y componentes ya probados, y «escanear y hacer» no exige instalar
// nada. El módulo de `apps/movil` es una fase posterior y comparte el motor por
// `packages/ronda-core`.
//
// Por qué el manifest es un archivo de `public/campo/` y no `app/manifest.ts`:
// un manifest en la raíz haría instalable TODA la consola, que no es una PWA.
// Con el scope en `/campo/`, lo que se instala es la app de campo.
//
// Diseño: botones grandes, textos cortos, mucho contraste. Esto lo usa gente con
// guantes, de noche, con una mano y un celular de gama baja.

export const metadata: Metadata = {
  title: { default: 'Mi ronda', template: '%s · Mi ronda' },
  description: 'Ejecución de rondas en el punto de control',
  manifest: '/campo/manifest.webmanifest',
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Mi ronda' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // No se deja hacer zoom por accidente con el pulgar mientras se firma, pero
  // `maximumScale` queda en 2 y no en 1: bloquear el zoom del todo es una
  // barrera de accesibilidad para quien no ve bien de cerca.
  maximumScale: 2,
  viewportFit: 'cover',
  themeColor: '#2e7d32',
}

export default function CampoLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 text-[17px] leading-relaxed text-gray-900">
      <RegistrarServiceWorker />
      <div className="mx-auto w-full max-w-md pb-24">{children}</div>
    </div>
  )
}
