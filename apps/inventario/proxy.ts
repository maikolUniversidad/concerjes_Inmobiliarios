import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  /**
   * Identidad del usuario SIN viaje de red al servidor de Auth.
   *
   * Esto corre en CADA petición que pasa el matcher de abajo: toda navegación,
   * toda ruta de API y todos los payloads RSC. Con `getUser()` era un viaje al
   * servidor de Auth ANTES de que la página empezara a renderizar, en cada
   * clic; de aquí salía el grueso de las 1.082.313 lecturas de `auth.users` de
   * los últimos 121 días.
   *
   * `getClaims()` verifica la firma del JWT en local contra el JWKS del
   * proyecto (llaves asimétricas ES256), que vive en una caché de módulo con
   * TTL de 10 minutos. Tres cosas que importan y que están comprobadas en el
   * código de auth-js, no supuestas:
   *
   *   · Sin argumento llama a `getSession()`, que refresca el token si está
   *     vencido o por vencer. O sea que el `setAll` de cookies de arriba sigue
   *     cumpliendo su función: renovar la sesión y dejar la cookie nueva en la
   *     respuesta. Si no refrescara, las sesiones se caerían al vencer.
   *   · Si el algoritmo fuera simétrico (HS*) o no hubiera WebCrypto, cae por
   *     su cuenta a `getUser()` en vez de confiar en un token sin verificar.
   *   · Rechaza un token con firma inválida, alterado o vencido.
   */
  const { data: claims } = await supabase.auth.getClaims()
  const user = claims?.claims ?? null

  const path = request.nextUrl.pathname
  const isAuthRoute   = path.startsWith('/login')
  const isClaveRoute  = path.startsWith('/cambiar-clave')
  // Rutas públicas: landing, APIs, el flujo público de Registro de Vacantes y
  // la página del QR de un punto de control (/q/<token>), que tiene que abrir
  // sin sesión: el conserje escanea una placa pegada a una pared y ahí decide
  // cómo seguir. La autoridad de esa página es la FIRMA del token, no la
  // cookie. Ver docs/puntos-qr-whatsapp/03-nomenclatura.md §3.
  // La app de campo (/campo) también: la usa quien NO tiene cuenta, con enlace
  // + PIN, y cada página resuelve su propio actor (actorDeCampo) y manda a
  // /campo/entrar si no hay ninguno. Mandarla a /login la dejaba sin salida.
  const isCampoRoute = path === '/campo' || path.startsWith('/campo/')
  const isPublicRoute =
    path === '/' ||
    path.startsWith('/api') ||
    path.startsWith('/registro-vacantes') ||
    path.startsWith('/q/') ||
    path.startsWith('/ingresar')

  if (!user && !isAuthRoute && !isPublicRoute && !isCampoRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // Volver a donde iba después de entrar (p. ej. el QR de un equipo).
    url.search = path === '/dashboard' ? '' : `?next=${encodeURIComponent(path + request.nextUrl.search)}`
    return NextResponse.redirect(url)
  }

  // Cuenta con contraseña temporal: no entra a ningún lado hasta cambiarla.
  // El bloqueo va aquí y no en cada página porque una contraseña que otro
  // conoce (la cédula, para los colaboradores de planta) deja de ser un
  // problema solo cuando NINGUNA ruta se puede abrir con ella.
  //
  // La marca se lee de los claims del token. OJO: la referencia oficial de
  // campos del JWT lista `user_metadata` como OPCIONAL, no garantizado, así que
  // aquí no se da por hecho que venga. Si el token NO la trae, se le pregunta al
  // servidor de Auth igual que antes; si la trae, se responde sin salir a la
  // red. La diferencia importa: con esta forma, el peor caso es perder el
  // ahorro, no apagar el bloqueo en silencio —que es la única falla que no se
  // podría tolerar—. Un `user_metadata` presente pero sin la llave sí se toma
  // como «no hay marca», igual que hacía el `=== true` de antes.
  const enRutaLibre = isClaveRoute || isPublicRoute || isAuthRoute
  let debeCambiar = false
  if (user && !enRutaLibre) {
    debeCambiar = user.user_metadata
      ? user.user_metadata.debe_cambiar_password === true
      : (await supabase.auth.getUser()).data.user?.user_metadata?.debe_cambiar_password === true
  }

  if (debeCambiar) {
    const url = request.nextUrl.clone()
    url.pathname = '/cambiar-clave'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }
  // `/cambiar-clave` queda abierta para cualquiera con sesión: obligatoria para
  // quien tiene contraseña temporal, y disponible para el que quiera cambiarla.

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
