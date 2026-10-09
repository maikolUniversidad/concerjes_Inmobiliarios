// Arma un prompt en Markdown con TODO lo que se sabe de un ticket, para pegarlo
// en Claude (u otro chat de IA) y seguir el diagnóstico sin perder contexto.
// Lógica pura: sirve tanto antes de enviar el ticket como en su detalle.
import type { ContextoGuardado, SoporteMensaje } from './index'
import { ESTADO_SOPORTE_META, PRIORIDAD_SOPORTE_META, TIPO_SOPORTE_META, legibleEstados, type EstadoSoporte, type TipoSoporte } from './index'

export interface DatosPrompt {
  numero?: string | null
  tipo: TipoSoporte
  prioridad: string
  estado?: EstadoSoporte | null
  titulo: string
  descripcion?: string | null
  modulo?: string | null
  ruta?: string | null
  reportado?: string | null
  asignado?: string | null
  solucion?: string | null
  creado?: string | null
  contexto: ContextoGuardado
  mensajes?: SoporteMensaje[]
  /** { ruta en el bucket: URL firmada } para enlazar captura y adjuntos. */
  enlaces?: Record<string, string>
  capturaPath?: string | null
  /** URL absoluta del ticket en la app. */
  urlTicket?: string | null
}

const f = (iso?: string | null) => iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'medium' }) : '—'
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-CO', { hour12: false })

function bloque(lang: string, lineas: string[]): string {
  if (lineas.length === 0) return '_(sin datos)_\n'
  // Evita que un ``` dentro de un log rompa el bloque.
  return '```' + lang + '\n' + lineas.join('\n').replace(/```/g, "'''") + '\n```\n'
}

function tabla(obj: Record<string, unknown> | null | undefined): string {
  if (!obj) return '_(sin datos)_\n'
  const filas = Object.entries(obj)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `| ${k} | ${typeof v === 'object' ? JSON.stringify(v) : String(v)} |`)
  return filas.length ? ['| Dato | Valor |', '|---|---|', ...filas].join('\n') + '\n' : '_(sin datos)_\n'
}

export function construirPrompt(d: DatosPrompt): string {
  const c = d.contexto ?? {}
  const u = c.usuario
  const out: string[] = []

  out.push(`# ${d.numero ? `Ticket ${d.numero}: ` : ''}${d.titulo}`)
  out.push('')
  out.push('Eres un ingeniero de software senior. Te paso un reporte de la app interna **Conserjes Inmobiliarios** '
    + '(monorepo con Next.js App Router en `apps/inventario` + Supabase/Postgres con RLS y funciones RPC). '
    + 'Con estos datos: 1) explica la causa más probable, 2) dime qué archivos o funciones revisar, '
    + '3) propone la corrección concreta y 4) cómo verificarla. Si falta información, dime exactamente qué pedir.')
  out.push('')

  out.push('## Resumen')
  out.push(tabla({
    Tipo: TIPO_SOPORTE_META[d.tipo]?.label ?? d.tipo,
    Prioridad: PRIORIDAD_SOPORTE_META[d.prioridad]?.label ?? d.prioridad,
    Estado: d.estado ? ESTADO_SOPORTE_META[d.estado]?.label ?? d.estado : 'Sin enviar',
    Módulo: d.modulo ?? c.modulo,
    Ruta: d.ruta ?? c.url,
    'Título de la página': c.titulo_pagina,
    'Reportado por': d.reportado ?? u?.nombre,
    Asignado: d.asignado,
    Creado: d.creado ? f(d.creado) : f(c.capturado_at),
    'Versión desplegada': c.version,
    'Ticket en la app': d.urlTicket,
  }))

  out.push('## Descripción del usuario')
  out.push(d.descripcion?.trim() || '_(sin descripción)_')
  out.push('')

  if (u) {
    out.push('## Usuario')
    out.push(tabla({ Nombre: u.nombre, Correo: u.email, Rol: u.rol, 'Rol asignado': u.rol_nombre, Sede: u.sede, Id: u.id }))
  }

  const capturaUrl = d.capturaPath ? d.enlaces?.[d.capturaPath] : null
  if (capturaUrl) {
    out.push('## Captura de pantalla')
    out.push(`![captura](${capturaUrl})`)
    out.push('_(enlace temporal; si expiró, descárgala desde el ticket y adjúntala)_')
    out.push('')
  }

  out.push(`## Errores (${c.errores?.length ?? 0})`)
  out.push(bloque('text', (c.errores ?? []).map((e) => `[${hora(e.t)}] ${e.nivel.toUpperCase()} ${e.texto}`)))

  const fallidas = (c.red ?? []).filter((r) => r.estado === null || r.estado >= 400)
  out.push(`## Peticiones de red fallidas (${fallidas.length})`)
  out.push(bloque('text', fallidas.map((r) => `[${hora(r.t)}] ${r.metodo} ${r.url} → ${r.estado ?? 'SIN RESPUESTA'} (${r.ms} ms)${r.error ? ` ${r.error}` : ''}`)))

  out.push('## Lo que hizo el usuario antes de reportar')
  out.push(bloque('text', (c.acciones ?? []).map((a) => `[${hora(a.t)}] ${a.tipo}: ${a.detalle}`)))

  out.push(`## Consola (últimas ${c.consola?.length ?? 0} líneas)`)
  out.push(bloque('text', (c.consola ?? []).map((e) => `[${hora(e.t)}] ${e.nivel.toUpperCase().padEnd(5)} ${e.texto}`)))

  out.push(`## Todas las peticiones recientes (${c.red?.length ?? 0})`)
  out.push(bloque('text', (c.red ?? []).map((r) => `[${hora(r.t)}] ${r.metodo} ${r.estado ?? 'ERR'} ${r.ms}ms ${r.url}`)))

  out.push('## Navegador y dispositivo')
  out.push(tabla(c.navegador as Record<string, unknown>))
  out.push('## Pantalla')
  out.push(tabla(c.pantalla as Record<string, unknown>))
  out.push('## Rendimiento')
  out.push(tabla(c.rendimiento as Record<string, unknown>))
  if (c.almacenamiento) {
    out.push('## Claves en el almacenamiento local (solo nombres)')
    out.push(`- localStorage: ${c.almacenamiento.local.join(', ') || '—'}`)
    out.push(`- sessionStorage: ${c.almacenamiento.session.join(', ') || '—'}`)
    out.push('')
  }

  const mensajes = d.mensajes ?? []
  if (mensajes.length > 0) {
    out.push('## Seguimiento (chat y cambios de estado)')
    for (const m of mensajes) {
      const quien = m.tipo === 'SISTEMA' ? `SISTEMA (${m.usuario_nombre ?? '—'})` : (m.usuario_nombre ?? 'Usuario')
      const adj = m.adjunto_path
        ? ` 📎 ${m.adjunto_nombre ?? 'archivo'}${d.enlaces?.[m.adjunto_path] ? ` → ${d.enlaces[m.adjunto_path]}` : ''}`
        : ''
      out.push(`- **${f(m.created_at)} · ${quien}:** ${legibleEstados(m.mensaje ?? '').replace(/\n/g, ' / ')}${adj}`)
    }
    out.push('')
  }

  if (d.solucion) {
    out.push('## Solución registrada')
    out.push(d.solucion)
    out.push('')
  }

  return out.join('\n')
}
