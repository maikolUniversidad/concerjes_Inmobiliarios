import 'server-only'

// El reporte en PDF que cierra una visita.
//
// Va en el servidor y no en Postgres (ADR-E punto 2: «generar el reporte» es
// server action / route handler), y las imágenes van EMBEBIDAS y no por URL: una
// URL firmada vence a los 300 segundos y un reporte guardado tiene que seguir
// teniendo sus fotos el año que viene (ADR-C).
//
// Al final se calcula el `sha256` del PDF y se registra con
// `ronda_registrar_reporte()`. Ese hash es lo que permite, meses después,
// demostrar que el papel que tiene el cliente es el que salió del sistema.

import { createHash } from 'node:crypto'
import { getAdmin } from '@/lib/supabase/admin'
import { rutaReporte } from '@conserjes/ronda-core'

const PAGINA = { ancho: 595.28, alto: 841.89 }   // A4 en puntos
const MARGEN = { izq: 42, der: 42, arriba: 54, abajo: 48 }
const VERDE = { r: 0.18, g: 0.49, b: 0.2 }

/** pdf-lib escribe con fuentes WinAnsi: lo que no cabe ahí se reemplaza en vez
 *  de reventar a mitad del reporte. */
function t(s: unknown): string {
  return String(s ?? '')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/→/g, '->')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
}

const fecha = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('es-CO', {
        timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short',
      })
    : '-'

interface FilaVisita {
  id: string; numero: string; estado: string
  persona_nombre: string | null
  plantilla_codigo: string | null; plantilla_version: number | null
  inicio_servidor: string; fin_servidor: string | null
  inicio_dispositivo: string | null; fin_dispositivo: string | null
  duracion_seg: number | null; offline: boolean; demora_sync_seg: number | null
  desfase_reloj_seg: number | null
  lat: number | null; lng: number | null; precision_metros: number | null
  distancia_metros: number | null; dentro_geocerca: boolean | null
  ubicacion_dudosa: boolean; motivo_fuera_geocerca: string | null
  apertura_modo: string; canal: string; identidad_metodo: string
  incompleta_motivo: string | null; observacion: string | null
  faltantes: unknown
  ronda_puntos: { codigo: string; nombre: string; piso: string | null; sede_nombre: string | null } | null
  ronda_plantillas: { nombre: string } | null
  sedes: { nombre: string; direccion: string | null; ciudad: string | null } | null
}

export interface ResultadoReporte {
  ruta: string
  sha256: string
  paginas: number
  tamano: number
}

/**
 * Arma el PDF de la visita, lo sube a `reportes/{visita_id}/{numero}.pdf` y lo
 * registra con su hash. Idempotente en la práctica: volver a generarlo
 * reemplaza el archivo y la fila (es lo correcto cuando se corrige una visita).
 */
export async function generarReporteVisita(visitaId: string): Promise<ResultadoReporte> {
  const sb = getAdmin()

  const { data: vRaw, error } = await sb
    .from('ronda_visitas')
    .select(`id, numero, estado, persona_nombre, plantilla_codigo, plantilla_version,
             inicio_servidor, fin_servidor, inicio_dispositivo, fin_dispositivo,
             duracion_seg, offline, demora_sync_seg, desfase_reloj_seg,
             lat, lng, precision_metros, distancia_metros, dentro_geocerca,
             ubicacion_dudosa, motivo_fuera_geocerca, apertura_modo, canal,
             identidad_metodo, incompleta_motivo, observacion, faltantes,
             ronda_puntos ( codigo, nombre, piso, sede_nombre ),
             ronda_plantillas ( nombre ),
             sedes ( nombre, direccion, ciudad )`)
    .eq('id', visitaId)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer la visita: ${error.message}`)
  if (!vRaw) throw new Error('La visita no existe')
  const v = vRaw as unknown as FilaVisita
  if (!['COMPLETADA', 'INCOMPLETA'].includes(v.estado)) {
    throw new Error(`El reporte se genera cuando la visita está cerrada (está ${v.estado}).`)
  }

  const { data: respuestas } = await sb
    .from('ronda_respuestas')
    .select(`id, orden, tipo, valor_bool, valor_texto, valor_numero, valor_opciones,
             motivo, omitido, omision_motivo, transcripcion, entidad_codigo,
             ronda_plantilla_pasos ( titulo, config )`)
    .eq('visita_id', visitaId)
    .order('orden')
  const { data: evidencias } = await sb
    .from('ronda_evidencias')
    .select('id, respuesta_id, tipo, archivo_path, mime, sha256, origen, created_at')
    .eq('visita_id', visitaId)
    .order('created_at')
  const { data: firmas } = await sb
    .from('ronda_firmas')
    .select('quien, metodo, trazo_path, nombre_firmante, documento_firmante, alternativa_motivo, firmado_at')
    .eq('visita_id', visitaId)
  const { data: novedades } = await sb
    .from('ronda_novedades')
    .select('clase, titulo, descripcion, prioridad, estado_destino, destino_detalle')
    .eq('visita_id', visitaId)

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold)

  let pagina = pdf.addPage([PAGINA.ancho, PAGINA.alto])
  let y = PAGINA.alto - MARGEN.arriba
  const ancho = PAGINA.ancho - MARGEN.izq - MARGEN.der

  const salto = (alto: number) => {
    if (y - alto < MARGEN.abajo) {
      pagina = pdf.addPage([PAGINA.ancho, PAGINA.alto])
      y = PAGINA.alto - MARGEN.arriba
    }
  }
  const linea = (
    texto: string,
    op: { size?: number; font?: typeof normal; color?: [number, number, number]; gap?: number } = {},
  ) => {
    const size = op.size ?? 9.5
    salto(size + 6)
    pagina.drawText(t(texto), {
      x: MARGEN.izq, y, size, font: op.font ?? normal, maxWidth: ancho, lineHeight: size + 3,
      color: rgb(...(op.color ?? [0.2, 0.2, 0.2])),
    })
    const lineas = Math.max(1, Math.ceil(normal.widthOfTextAtSize(t(texto), size) / ancho))
    y -= (size + 3) * lineas + (op.gap ?? 2)
  }
  const titulo = (texto: string) => {
    salto(26)
    y -= 6
    pagina.drawText(t(texto), {
      x: MARGEN.izq, y, size: 11, font: negrita, color: rgb(VERDE.r, VERDE.g, VERDE.b),
    })
    y -= 16
    pagina.drawLine({
      start: { x: MARGEN.izq, y: y + 6 }, end: { x: PAGINA.ancho - MARGEN.der, y: y + 6 },
      thickness: 0.5, color: rgb(0.85, 0.85, 0.85),
    })
    y -= 4
  }

  // ── Encabezado ──────────────────────────────────────────────────────────────
  pagina.drawText(t('Reporte de visita'), {
    x: MARGEN.izq, y, size: 16, font: negrita, color: rgb(VERDE.r, VERDE.g, VERDE.b),
  })
  pagina.drawText(t(v.numero), {
    x: PAGINA.ancho - MARGEN.der - negrita.widthOfTextAtSize(t(v.numero), 14),
    y, size: 14, font: negrita, color: rgb(0.3, 0.3, 0.3),
  })
  y -= 24
  linea('Conserjes Inmobiliarios Ltda.', { size: 9, color: [0.45, 0.45, 0.45] })

  titulo('Dónde y quién')
  linea(`Punto: ${v.ronda_puntos?.codigo ?? '-'} — ${v.ronda_puntos?.nombre ?? '-'}`
        + (v.ronda_puntos?.piso ? ` (${v.ronda_puntos.piso})` : ''))
  linea(`Sede: ${v.sedes?.nombre ?? v.ronda_puntos?.sede_nombre ?? '-'}`
        + (v.sedes?.direccion ? ` — ${v.sedes.direccion}` : ''))
  linea(`Tarea: ${v.ronda_plantillas?.nombre ?? '-'} (${v.plantilla_codigo ?? '-'} v${v.plantilla_version ?? '-'})`)
  linea(`Quien la hizo: ${v.persona_nombre ?? '-'}`)
  linea(`Identificación: ${etiquetaIdentidad(v.identidad_metodo)} · apertura ${v.apertura_modo.toLowerCase()} · canal ${v.canal.toLowerCase()}`)

  titulo('Cuándo')
  linea(`Inicio (servidor): ${fecha(v.inicio_servidor)}`)
  linea(`Cierre (servidor): ${fecha(v.fin_servidor)}`)
  if (v.duracion_seg != null) linea(`Duración: ${Math.round(v.duracion_seg / 60)} minutos`)
  if (v.inicio_dispositivo) {
    linea(`Hora del celular al abrir: ${fecha(v.inicio_dispositivo)}`, { size: 8.5, color: [0.45, 0.45, 0.45] })
  }
  if (v.offline) {
    linea(`Hecha sin conexión y sincronizada ${Math.round((v.demora_sync_seg ?? 0) / 60)} minutos después. `
          + 'La hora que vale es la del servidor.', { size: 8.5, color: [0.45, 0.45, 0.45] })
  } else if (v.desfase_reloj_seg != null && v.desfase_reloj_seg > 120) {
    linea(`El reloj del celular iba ${Math.round(v.desfase_reloj_seg / 60)} minutos corrido frente al servidor.`,
      { size: 8.5, color: [0.45, 0.45, 0.45] })
  }

  titulo('Ubicación')
  if (v.lat == null) {
    linea('No se pudo leer la ubicación del celular.')
  } else {
    linea(`Coordenadas: ${v.lat}, ${v.lng}`
          + (v.precision_metros != null ? ` (±${Math.round(Number(v.precision_metros))} m)` : ''))
    if (v.distancia_metros != null) {
      linea(`Distancia al punto: ${Math.round(Number(v.distancia_metros))} m — `
            + (v.dentro_geocerca ? 'dentro de la geocerca' : 'FUERA de la geocerca'))
    }
    if (v.ubicacion_dudosa) {
      linea('La precisión reportada es peor que el radio de la geocerca: la ubicación quedó marcada como dudosa.',
        { size: 8.5, color: [0.5, 0.35, 0] })
    }
  }
  if (v.motivo_fuera_geocerca) linea(`Motivo: ${v.motivo_fuera_geocerca}`)

  // ── Pasos ───────────────────────────────────────────────────────────────────
  titulo('Lo que se hizo')
  const porRespuesta = new Map<string, { archivo_path: string; mime: string | null; sha256: string; origen: string }[]>()
  for (const e of (evidencias ?? []) as unknown as {
    respuesta_id: string | null; tipo: string; archivo_path: string
    mime: string | null; sha256: string; origen: string
  }[]) {
    if (e.tipo !== 'FOTO') continue
    const k = e.respuesta_id ?? 'sueltas'
    if (!porRespuesta.has(k)) porRespuesta.set(k, [])
    porRespuesta.get(k)!.push(e)
  }

  for (const r of (respuestas ?? []) as unknown as {
    id: string; orden: number; tipo: string
    valor_bool: boolean | null; valor_texto: string | null; valor_numero: string | null
    valor_opciones: string[] | null; motivo: string | null
    omitido: boolean; omision_motivo: string | null; transcripcion: string | null
    entidad_codigo: string | null
    ronda_plantilla_pasos: { titulo: string; config: Record<string, unknown> } | null
  }[]) {
    linea(`${r.orden}. ${r.ronda_plantilla_pasos?.titulo ?? 'Paso'}`, { font: negrita, gap: 0 })
    if (r.omitido) {
      linea(`   Se saltó: ${r.omision_motivo ?? 'sin motivo'}`, { color: [0.5, 0.35, 0] })
    } else {
      const valor = textoDeRespuesta(r)
      if (valor) linea(`   ${valor}`)
      if (r.motivo) linea(`   Motivo: ${r.motivo}`)
      if (r.transcripcion) linea(`   Nota de voz: "${r.transcripcion}"`, { size: 8.5 })
    }
    // Las fotos del paso, embebidas, dos por fila.
    const fotos = porRespuesta.get(r.id) ?? []
    if (fotos.length > 0) await dibujarFotos(fotos)
  }

  const sueltas = porRespuesta.get('sueltas') ?? []
  if (sueltas.length > 0) {
    titulo('Fotos de la visita')
    await dibujarFotos(sueltas)
  }

  // ── Novedades ───────────────────────────────────────────────────────────────
  const nov = (novedades ?? []) as {
    clase: string; titulo: string; descripcion: string | null; prioridad: string
    estado_destino: string; destino_detalle: string | null
  }[]
  if (nov.length > 0) {
    titulo('Novedades reportadas')
    for (const n of nov) {
      linea(`· [${n.clase} · ${n.prioridad}] ${n.titulo}`, { font: negrita, gap: 0 })
      if (n.descripcion) linea(`   ${n.descripcion}`)
      linea(`   ${n.estado_destino === 'CREADO' ? n.destino_detalle ?? 'Ticket creado' : 'Pendiente de convertir en orden de trabajo'}`,
        { size: 8.5, color: [0.45, 0.45, 0.45] })
    }
  }

  // ── Estado del cierre ───────────────────────────────────────────────────────
  titulo('Cierre')
  linea(`Estado: ${v.estado === 'COMPLETADA' ? 'Completada' : 'Incompleta'}`, { font: negrita })
  if (v.incompleta_motivo) linea(`Por qué quedó incompleta: ${v.incompleta_motivo}`)
  const faltantes = Array.isArray(v.faltantes) ? v.faltantes : []
  for (const f of faltantes as { titulo?: string; falta?: string }[]) {
    linea(`   Falta: ${f.titulo ?? ''} (${f.falta ?? ''})`, { size: 8.5, color: [0.5, 0.35, 0] })
  }
  if (v.observacion) linea(`Observación: ${v.observacion}`)

  // ── Firmas ──────────────────────────────────────────────────────────────────
  const fir = (firmas ?? []) as {
    quien: string; metodo: string; trazo_path: string | null
    nombre_firmante: string | null; documento_firmante: string | null
    alternativa_motivo: string | null; firmado_at: string
  }[]
  if (fir.length > 0) {
    titulo('Firmas')
    for (const f of fir) {
      salto(80)
      if (f.trazo_path) {
        const img = await bajarImagen(f.trazo_path)
        if (img) {
          try {
            const emb = img.mime.includes('png')
              ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes)
            const alto = 46
            const escala = alto / emb.height
            pagina.drawImage(emb, {
              x: MARGEN.izq, y: y - alto, width: emb.width * escala, height: alto,
            })
            y -= alto + 4
          } catch { /* una firma que no se puede dibujar no bota el reporte */ }
        }
      }
      linea(`${etiquetaQuien(f.quien)}: ${f.nombre_firmante ?? '-'}`
            + (f.documento_firmante ? ` · ${f.documento_firmante}` : ''), { gap: 0 })
      linea(`Método: ${f.metodo.toLowerCase()} · ${fecha(f.firmado_at)}`,
        { size: 8.5, color: [0.45, 0.45, 0.45], gap: 0 })
      if (f.alternativa_motivo) {
        linea(`No se usó verificación facial: ${textoAlternativa(f.alternativa_motivo)}`,
          { size: 8.5, color: [0.45, 0.45, 0.45] })
      }
    }
  }

  // ── Pie con las huellas de la evidencia ─────────────────────────────────────
  const todas = (evidencias ?? []) as { archivo_path: string; sha256: string; origen: string }[]
  if (todas.length > 0) {
    titulo('Huella de los archivos')
    linea('Cada archivo de evidencia se guarda con su SHA-256. Así se puede verificar, meses después, '
          + 'que la foto de este reporte es la que se tomó en el punto.',
      { size: 8.5, color: [0.45, 0.45, 0.45] })
    for (const e of todas) {
      linea(`${e.archivo_path.split('/').pop()} · ${e.origen.toLowerCase()} · ${e.sha256}`,
        { size: 7.5, color: [0.45, 0.45, 0.45], gap: 0 })
    }
  }

  const bytes = await pdf.save()
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const ruta = rutaReporte(v.id, v.numero)

  const { error: errSubida } = await sb.storage.from('rondas')
    .upload(ruta, bytes, { contentType: 'application/pdf', upsert: true })
  if (errSubida) throw new Error(`No se pudo guardar el reporte: ${errSubida.message}`)

  const { error: errReg } = await sb.rpc('ronda_registrar_reporte', {
    p_visita: v.id,
    p_pdf_path: ruta,
    p_sha256: sha256,
    p_paginas: pdf.getPageCount(),
    p_tamano: bytes.length,
  })
  if (errReg) throw new Error(`No se pudo registrar el reporte: ${errReg.message}`)

  return { ruta, sha256, paginas: pdf.getPageCount(), tamano: bytes.length }

  // ── Ayudas que usan el estado del documento ────────────────────────────────
  async function dibujarFotos(
    fotos: { archivo_path: string; mime: string | null }[],
  ): Promise<void> {
    const ANCHO = (ancho - 10) / 2
    for (let i = 0; i < fotos.length; i += 2) {
      const par = fotos.slice(i, i + 2)
      const imgs = []
      for (const f of par) {
        const img = await bajarImagen(f.archivo_path)
        if (!img) continue
        try {
          imgs.push(img.mime.includes('png')
            ? await pdf.embedPng(img.bytes) : await pdf.embedJpg(img.bytes))
        } catch { /* una foto ilegible no bota el reporte */ }
      }
      if (imgs.length === 0) continue
      const alto = Math.max(...imgs.map((im) => (ANCHO / im.width) * im.height))
      salto(alto + 10)
      let x = MARGEN.izq
      for (const im of imgs) {
        const h = (ANCHO / im.width) * im.height
        pagina.drawImage(im, { x, y: y - h, width: ANCHO, height: h })
        x += ANCHO + 10
      }
      y -= alto + 8
    }
  }
}

async function bajarImagen(
  ruta: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const { data, error } = await getAdmin().storage.from('rondas').download(ruta)
  if (error || !data) return null
  const bytes = new Uint8Array(await data.arrayBuffer())
  return { bytes, mime: data.type || (ruta.endsWith('.png') ? 'image/png' : 'image/jpeg') }
}

function textoDeRespuesta(r: {
  tipo: string; valor_bool: boolean | null; valor_texto: string | null
  valor_numero: string | null; valor_opciones: string[] | null; entidad_codigo: string | null
  ronda_plantilla_pasos: { config: Record<string, unknown> } | null
}): string {
  switch (r.tipo) {
    case 'CASILLA':
      return r.valor_bool === true ? 'Si' : r.valor_bool === false ? 'NO' : 'No aplica'
    case 'TEXTO':
      return r.valor_texto ?? ''
    case 'NUMERO': {
      const unidad = String(r.ronda_plantilla_pasos?.config?.unidad ?? '')
      return `${r.valor_numero ?? '-'}${unidad ? ' ' + unidad : ''}`
    }
    case 'SELECCION':
      return (r.valor_opciones ?? []).join(', ')
    case 'ESCANEO':
      return r.entidad_codigo ?? r.valor_texto ?? ''
    case 'FOTO':
      return ''
    default:
      return r.valor_texto ?? ''
  }
}

const etiquetaIdentidad = (m: string) =>
  m === 'CUENTA' ? 'cuenta del sistema'
    : m === 'ENLACE_PIN' ? 'enlace de un uso + PIN'
      : m === 'BOT' ? 'WhatsApp' : 'registrada desde la consola'

const etiquetaQuien = (q: string) =>
  q === 'TRABAJADOR' ? 'Trabajador' : q === 'CLIENTE' ? 'Cliente' : 'Supervisor'

const textoAlternativa = (m: string) =>
  m === 'SIN_CONSENTIMIENTO_BIOMETRICO'
    ? 'la persona no autorizó el tratamiento de datos biométricos (Ley 1581 de 2012)'
    : m
