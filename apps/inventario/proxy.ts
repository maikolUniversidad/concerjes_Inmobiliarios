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

  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isAuthRoute   = path.startsWith('/login')
  const isClaveRoute  = path.startsWith('/cambiar-clave')
  // Rutas públicas: landing, APIs y el flujo público de Registro de Vacantes.
  const isPublicRoute =
    path === '/' ||
    path.startsWith('/api') ||
    path.startsWith('/registro-vacantes') ||
    path.startsWith('/ingresar')

  if (!user && !isAuthRoute && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Cuenta con contraseña temporal: no entra a ningún lado hasta cambiarla.
  // El bloqueo va aquí y no en cada página porque una contraseña que otro
  // conoce (la cédula, para los colaboradores de planta) deja de ser un
  // problema solo cuando NINGUNA ruta se puede abrir con ella.
  if (user?.user_metadata?.debe_cambiar_password === true
      && !isClaveRoute && !isPublicRoute && !isAuthRoute) {
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
