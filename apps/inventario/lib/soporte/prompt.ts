// Arma un prompt en Markdown con TODO lo que se sabe de un ticket, para pegarlo
// en Claude (u otro chat de IA) y seguir el diagnóstico sin perder contexto.
// Lógica pura: sirve tanto antes de enviar el ticket como en su detalle.
import type { ContextoGuardado, SoporteMensaje } from './index'
import {
  ESTADO_SOPORTE_META, PRIORIDAD_SOPORTE_META, TIPO_SOPORTE_META, ZONA_SOPORTE, duracionLegible, fasesSoporte, legibleEstados,
  type EstadoSoporte, type TipoSoporte,
} from './index'

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

const f = (iso?: string | null) => iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'medium', timeZone: ZONA_SOPORTE }) : '—'
const hora = (iso: string) => new Date(iso).toLocaleTimeString('es-CO', { hour12: false, timeZone: ZONA_SOPORTE })
const etiqueta = (e?: string | null) => e ? `[${ESTADO_SOPORTE_META[e as EstadoSoporte]?.label ?? e}]` : ''
const kb = (b?: number | null) => b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`

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
    const { fases, estadoDe, solucionVigenteId } = fasesSoporte(mensajes, d.creado ?? mensajes[0].created_at)
    const ahora = new Date().toISOString()

    out.push('## Recorrido de estados')
    out.push('| # | Estado | Desde | Hasta | Duración | Cambió | Comentario |')
    out.push('|---|---|---|---|---|---|---|')
    fases.forEach((fa, i) => {
      const fin = fa.hasta ?? ahora
      out.push(`| ${i + 1} | ${ESTADO_SOPORTE_META[fa.estado]?.label ?? fa.estado}${fa.hasta ? '' : ' (actual)'} | ${f(fa.desde)} | ${fa.hasta ? f(fa.hasta) : '—'} | `
        + `${duracionLegible(new Date(fin).getTime() - new Date(fa.desde).getTime())} | ${fa.por ?? '—'} | ${(fa.comentario ?? '').replace(/\|/g, '/').replace(/\n/g, ' / ') || '—'} |`)
    })
    const resolucion = solucionVigenteId ? mensajes.find((m) => m.id === solucionVigenteId) : null
    if (resolucion) {
      out.push('')
      out.push(`**Punto de solución:** ${f(resolucion.created_at)} por ${resolucion.usuario_nombre ?? '—'} (marcado ⭐ abajo).`)
    }
    out.push('')

    const participantes = new Map<string, number>()
    let nAdj = 0
    for (const m of mensajes) {
      if (m.tipo !== 'SISTEMA') participantes.set(m.usuario_nombre ?? 'Usuario', (participantes.get(m.usuario_nombre ?? 'Usuario') ?? 0) + 1)
      if (m.adjunto_path) nAdj++
    }
    out.push(`## Chat completo (${mensajes.length} entradas · ${nAdj} adjuntos)`)
    if (participantes.size) out.push(`Participantes: ${[...participantes].map(([n, c]) => `${n} (${c})`).join(', ')}.`)
    out.push('Cada entrada lleva entre corchetes el estado del ticket cuando se escribió.')
    out.push('')
    for (const m of mensajes) {
      const enlace = m.adjunto_path ? d.enlaces?.[m.adjunto_path] : undefined
      if (m.tipo === 'SISTEMA') {
        const cambio = m.estado_anterior && m.estado_nuevo && m.estado_anterior !== m.estado_nuevo
        const [cab, ...resto] = (m.mensaje ?? '').split('\n')
        const star = m.id === solucionVigenteId ? ' ⭐ AQUÍ SE SOLUCIONÓ' : ''
        out.push(`### 🔖 ${f(m.created_at)} · ${m.usuario_nombre ?? 'Sistema'} · `
          + (cambio ? `${etiqueta(m.estado_anterior)} → ${etiqueta(m.estado_nuevo)}` : legibleEstados(cab)) + star)
        if (cambio && cab.includes('·')) out.push(legibleEstados(cab.slice(cab.indexOf('·') + 1).trim()))
        const com = resto.join('\n').trim()
        if (com) out.push(com.split('\n').map((l) => `> ${l}`).join('\n'))
        out.push('')
        continue
      }
      out.push(`**${f(m.created_at)} · ${m.usuario_nombre ?? 'Usuario'}** ${etiqueta(estadoDe[m.id])}`)
      if (m.mensaje) out.push(legibleEstados(m.mensaje).split('\n').map((l) => `> ${l}`).join('\n'))
      if (m.adjunto_path) {
        const desc = `${m.adjunto_nombre ?? 'archivo'} (${m.adjunto_mime ?? 'tipo desconocido'}${m.adjunto_bytes ? `, ${kb(m.adjunto_bytes)}` : ''})`
        if (enlace && m.adjunto_mime?.startsWith('image/')) out.push(`📎 ${desc}\n![${m.adjunto_nombre ?? 'imagen'}](${enlace})`)
        else out.push(`📎 ${desc}${enlace ? ` → ${enlace}` : ''}`)
      }
      out.push('')
    }
    out.push('_(los enlaces de adjuntos son temporales — 7 días)_')
    out.push('')
  }

  if (d.solucion) {
    out.push('## Solución registrada')
    out.push(d.solucion)
    out.push('')
  }

  return out.join('\n')
}
