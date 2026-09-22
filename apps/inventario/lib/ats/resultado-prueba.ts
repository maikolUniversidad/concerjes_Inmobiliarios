// Resultado imprimible de una prueba de selección (aptitud o conocimientos):
// es el PDF que RRHH descarga desde el expediente. Lleva la foto de perfil
// ({{FOTO_CARNET}}), los datos del postulante, las respuestas, el puntaje o el
// perfil, la firma por escritura de nombre y la evidencia del envío.

import { escapar } from '@/lib/documentos/plantilla'

export interface PreguntaResultado {
  id: string
  orden: number
  enunciado: string
  opciones: { clave: string; texto: string }[] | null
  respuesta_correcta?: string | null
  dimension?: string | null
}

export interface DatosResultadoPrueba {
  empresa?: { razon_social?: string | null; nit?: string | null } | null
  candidato: {
    nombre: string; tipo_documento?: string | null; numero_documento?: string | null
    cargo?: string | null; ciudad?: string | null
  }
  prueba: { nombre: string; tipo: string; tiempo_limite_min?: number | null; requiere_firma?: boolean | null }
  preguntas: PreguntaResultado[]
  intento: {
    estado: string; iniciado_at?: string | null; finalizado_at?: string | null
    respuestas?: Record<string, string> | null; puntaje?: number | null; puntaje_max?: number | null
    perfil?: Record<string, Record<string, number>> | null
    firma_nombre?: string | null; firma_documento?: string | null; ip?: string | null; hash?: string | null
  }
  /** Momento de la impresión (para el encabezado). */
  ahora?: Date
}

const t = (v: unknown) => escapar(v === null || v === undefined || v === '' ? '—' : String(v))

const ESTADOS: Record<string, string> = {
  FINALIZADA: 'Completada', EXPIRADA: 'Enviada fuera de tiempo', EN_CURSO: 'Sin terminar',
}

export function fechaHoraBogota(valor: string | Date | null | undefined): string {
  if (!valor) return '—'
  const f = valor instanceof Date ? valor : new Date(valor)
  if (Number.isNaN(f.getTime())) return '—'
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(f)
}

/** Minutos entre el inicio y el envío (mínimo 1). */
export function duracionMinutos(desde?: string | null, hasta?: string | null): number | null {
  if (!desde || !hasta) return null
  const ms = new Date(hasta).getTime() - new Date(desde).getTime()
  return Number.isFinite(ms) && ms >= 0 ? Math.max(1, Math.round(ms / 60000)) : null
}

/** Perfil de la prueba de aptitud: cuántas veces eligió A o B en cada dimensión. */
export function perfilDeRespuestas(preguntas: PreguntaResultado[], respuestas: Record<string, string>): Record<string, { A: number; B: number }> {
  const perfil: Record<string, { A: number; B: number }> = {}
  for (const q of [...preguntas].sort((a, b) => a.orden - b.orden)) {
    const r = respuestas[q.id]
    if (r !== 'A' && r !== 'B') continue
    const dim = q.dimension || 'General'
    perfil[dim] ??= { A: 0, B: 0 }
    perfil[dim][r]++
  }
  return perfil
}

const soloDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

export function htmlResultadoPrueba(d: DatosResultadoPrueba): string {
  const preguntas = [...d.preguntas].sort((a, b) => a.orden - b.orden)
  const resp = d.intento.respuestas ?? {}
  const esConocimientos = d.prueba.tipo === 'CONOCIMIENTOS' || !!d.intento.puntaje_max
  const opcion = (q: PreguntaResultado, clave: string | undefined) => (q.opciones ?? []).find((o) => o.clave === clave)
  const min = duracionMinutos(d.intento.iniciado_at, d.intento.finalizado_at)
  const c = d.candidato

  const partes: string[] = []
  partes.push(`<div class="hoja">
  <table class="encabezado"><tr>
    <td class="logo"><img src="/logo-horizontal.png" alt="${t(d.empresa?.razon_social ?? 'Conserjes Inmobiliarios')}"></td>
    <td class="titulo">Resultado de la prueba<br>${t(d.prueba.nombre)}</td>
    <td class="version">Impreso: ${fechaHoraBogota(d.ahora ?? new Date())}${d.empresa?.nit ? `<br>NIT ${t(d.empresa.nit)}` : ''}</td>
  </tr></table>

  <h2>Datos del postulante</h2>
  <table>
    <tr><td class="etiqueta">Nombre</td><td>${t(c.nombre)}</td><td rowspan="4" class="centro" style="width:110px">{{FOTO_CARNET}}</td></tr>
    <tr><td class="etiqueta">Documento</td><td>${t([c.tipo_documento, c.numero_documento].filter(Boolean).join(' '))}</td></tr>
    <tr><td class="etiqueta">Cargo</td><td>${t(c.cargo)}</td></tr>
    <tr><td class="etiqueta">Ciudad</td><td>${t(c.ciudad)}</td></tr>
  </table>
  <table>
    <tr>
      <td class="etiqueta">Estado</td><td>${t(ESTADOS[d.intento.estado] ?? d.intento.estado)}</td>
      <td class="etiqueta">Inicio</td><td>${fechaHoraBogota(d.intento.iniciado_at)}</td>
      <td class="etiqueta">Envío</td><td>${fechaHoraBogota(d.intento.finalizado_at)}</td>
    </tr>
    <tr>
      <td class="etiqueta">Duración</td><td>${min !== null ? `${min} min` : '—'}</td>
      <td class="etiqueta">Tiempo límite</td><td>${d.prueba.tiempo_limite_min ? `${d.prueba.tiempo_limite_min} min` : 'Sin límite'}</td>
      <td class="etiqueta">Preguntas</td><td>${preguntas.length}</td>
    </tr>
  </table>`)

  if (esConocimientos) {
    const max = d.intento.puntaje_max ?? preguntas.filter((q) => q.respuesta_correcta).length
    const puntaje = d.intento.puntaje ?? 0
    const pct = max ? Math.round((puntaje / max) * 100) : 0
    partes.push(`<div class="caja"><strong>Puntaje: ${puntaje} / ${max}</strong> (${pct} %) · respuestas correctas ${puntaje} de ${max}</div>
  <table>
    <tr><th style="width:26px">#</th><th>Pregunta</th><th>Respondió</th><th style="width:60px" class="centro">Correcta</th><th style="width:80px">Resultado</th></tr>
    ${preguntas.map((q, i) => {
      const r = resp[q.id]
      const op = opcion(q, r)
      const ok = !!r && !!q.respuesta_correcta && r === q.respuesta_correcta
      const res = !r ? 'Sin responder' : ok ? '✓ Correcta' : '✗ Incorrecta'
      return `<tr><td class="centro">${i + 1}</td><td>${t(q.enunciado)}</td><td>${r ? `${t(r.toLowerCase())}) ${t(op?.texto)}` : '—'}</td><td class="centro">${t(q.respuesta_correcta?.toLowerCase())}</td><td>${res}</td></tr>`
    }).join('\n    ')}
  </table>`)
  } else {
    const perfil = d.intento.perfil && Object.keys(d.intento.perfil).length ? d.intento.perfil : perfilDeRespuestas(preguntas, resp)
    partes.push(`<p class="nota">Prueba de elección forzada A/B, sin puntaje numérico: describe cómo actúa la persona en cada dimensión evaluada.</p>
  <h3>Perfil por dimensión</h3>
  <table>
    <tr><th>Dimensión</th><th style="width:90px" class="centro">Eligió A</th><th style="width:90px" class="centro">Eligió B</th></tr>
    ${Object.entries(perfil).map(([dim, v]) => `<tr><td>${t(dim)}</td><td class="centro">${v.A ?? 0}</td><td class="centro">${v.B ?? 0}</td></tr>`).join('\n    ')}
  </table>
  <h3>Respuestas</h3>
  <table>
    <tr><th style="width:26px">#</th><th>Situación</th><th style="width:150px">Dimensión</th><th>Respuesta elegida</th></tr>
    ${preguntas.map((q, i) => {
      const r = resp[q.id]
      const op = opcion(q, r)
      return `<tr><td class="centro">${i + 1}</td><td>${t(q.enunciado)}</td><td>${t(q.dimension)}</td><td>${r ? `${t(r)}. ${t(op?.texto)}` : '—'}</td></tr>`
    }).join('\n    ')}
  </table>`)
  }

  const coincide = !!d.intento.firma_documento && soloDigitos(d.intento.firma_documento) === soloDigitos(c.numero_documento)
  partes.push(`<table class="firmas"><tr>
    <td>${d.intento.firma_nombre
      ? `<strong>${t(d.intento.firma_nombre)}</strong><br><span class="pequeno">Firma por escritura de nombre · cédula de verificación ${t(d.intento.firma_documento)}${coincide ? ' (coincide con el registro)' : ''}</span>`
      : `<span class="pequeno">Prueba presentada en línea por el titular de la cuenta del postulante.</span>`}</td>
    <td>{{FIRMA_EVALUADOR}}<br><span class="pequeno">Revisó (Gestión Humana)</span></td>
  </tr></table>
  <div class="sello-digital">Presentada en línea${d.intento.finalizado_at ? ` el ${fechaHoraBogota(d.intento.finalizado_at)}` : ''}${d.intento.ip ? ` desde la IP ${t(d.intento.ip)}` : ''}.${d.intento.hash ? ` Huella SHA-256 del envío: ${t(d.intento.hash)}.` : ''}</div>
</div>`)
  return partes.join('\n')
}
