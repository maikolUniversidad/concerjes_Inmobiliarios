// Service worker de la PWA del trabajador (ADR-A). Scope: /campo/
//
// Se escribe a mano y no con `next-pwa`: el paquete instalado es viejo (5.6,
// pensado para Next 12) y lo que esta app necesita del service worker es poco y
// muy concreto. Un generador que reescribe el bundle entero para esto es más
// riesgo que ayuda.
//
// Qué hace, y qué NO:
//   · guarda el casco de la aplicación (`/campo`, el manifest, el icono) para
//     que la pantalla abra sin señal;
//   · responde a la navegación con la red primero y cae al caché cuando no hay
//     (en un sótano la red no falla: se queda colgada, así que hay un tope de
//     tiempo y después se usa el caché);
//   · NO cachea nada de `/api/` ni de Supabase. Las escrituras van por la cola
//     de IndexedDB, que es la que sabe reintentar y mantener el orden (ADR-D);
//     un service worker que "ayude" ahí duplicaría visitas.
//   · NO usa Background Sync: en iOS no existe, y la cola ya sincroniza cuando
//     la aplicación vuelve a tener señal.

const VERSION = 'ronda-campo-v1'
const CASCO = [
  '/campo',
  '/campo/manifest.webmanifest',
  '/icon.png',
]
const TOPE_RED_MS = 4000

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      // `addAll` falla entero si una sola URL falla: se agregan de a una para
      // que una pantalla que todavía no existe no deje la app sin casco.
      .then((c) => Promise.all(CASCO.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function esDeCampo(url) {
  return url.origin === self.location.origin
    && (url.pathname === '/campo' || url.pathname.startsWith('/campo/'))
    && !url.pathname.startsWith('/api/')
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.pathname.startsWith('/api/')) return
  if (!esDeCampo(url) && url.pathname !== '/icon.png') return

  e.respondWith((async () => {
    const cache = await caches.open(VERSION)

    // Red primero, con tope: en un sótano la petición se queda colgada y el
    // trabajador se queda mirando una pantalla en blanco.
    try {
      const red = await Promise.race([
        fetch(req),
        new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('lenta')), TOPE_RED_MS)),
      ])
      if (red && red.ok && red.type === 'basic') cache.put(req, red.clone())
      return red
    } catch {
      const guardada = await cache.match(req, { ignoreSearch: true })
      if (guardada) return guardada
      const inicio = await cache.match('/campo')
      if (inicio) return inicio
      return new Response(
        '<!doctype html><meta charset="utf-8"><title>Sin señal</title>'
        + '<body style="font-family:system-ui;padding:24px;text-align:center">'
        + '<h1 style="font-size:20px">Sin señal</h1>'
        + '<p>Abre la aplicación otra vez cuando tengas internet. Lo que ya hiciste está guardado en el celular.</p>',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
      )
    }
  })())
})
