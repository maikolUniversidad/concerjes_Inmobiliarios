import { describe, it, expect } from 'vitest'
import { correosInvalidos, esCorreo, separarCorreos, unirDestinos } from '@/lib/notificaciones/correos'
import { procesarFlujosPendientes } from '@/lib/notificaciones/worker'

describe('direcciones de correo del directorio', () => {
  it('separa listas escritas a mano o que vienen como arreglo', () => {
    expect(separarCorreos('A@x.co; b@y.co, c@z.co  d@w.co')).toEqual(['a@x.co', 'b@y.co', 'c@z.co', 'd@w.co'])
    expect(separarCorreos(['a@x.co', 'no-es-correo', ['b@y.co', 'a@x.co']])).toEqual(['a@x.co', 'b@y.co'])
    expect(separarCorreos(null)).toEqual([])
    expect(esCorreo(' citas@ips.com ')).toBe(true)
    expect(correosInvalidos('ok@x.co, malo@, tambien mal')).toEqual(['malo@', 'tambien', 'mal'])
  })

  it('un correo por destinatario, copias sin repetir y sin copiar a quien ya recibe', () => {
    expect(unirDestinos([
      { para: 'IPS@x.co', copia: ['lab@x.co', 'sel@x.co'] },
      { para: 'ips@x.co', copia: ['lab@x.co', 'otro@x.co'] },
      { para: 'sel@x.co', copia: [] },
      { para: 'mal', copia: [] },
    ])).toEqual([
      { para: 'ips@x.co', copia: ['lab@x.co', 'otro@x.co'] },
      { para: 'sel@x.co', copia: [] },
    ])
  })
})

// ── Motor de flujos con una base de datos de mentira ────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
function baseFalsa(tablas: Record<string, any[]>, rpc: Record<string, unknown>) {
  const inserts: { tabla: string; filas: any }[] = []
  const updates: { tabla: string; cambios: any; ids: string[] }[] = []
  const db = {
    rpc: async (nombre: string) => ({ data: rpc[nombre], error: null }),
    from(tabla: string) {
      let filas = [...(tablas[tabla] ?? [])]
      let modo: 'select' | 'update' | 'insert' = 'select'
      let cambios: any = null
      const q: any = {
        select: () => q,
        insert: (x: any) => { inserts.push({ tabla, filas: x }); modo = 'insert'; return q },
        update: (x: any) => { modo = 'update'; cambios = x; return q },
        eq: (c: string, v: unknown) => { filas = filas.filter((f) => f[c] === v); return q },
        in: (c: string, vs: unknown[]) => { filas = filas.filter((f) => vs.includes(f[c])); return q },
        lte: () => q, lt: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: filas[0] ?? null, error: null }),
        then: (ok: any, mal: any) => {
          if (modo === 'update') updates.push({ tabla, cambios, ids: filas.map((f) => f.id) })
          return Promise.resolve({ data: modo === 'select' ? filas : null, error: null, count: filas.length }).then(ok, mal)
        },
      }
      return q
    },
  }
  return { db, inserts, updates }
}

const pasoProgramado = (destinatarios: any, payload: any = {}) => ({
  id: 'ep1', ejecucion_id: 'e1', paso_id: 's1', orden: 1, estado: 'PROGRAMADO', intentos: 0,
  flujo_ejecuciones: { id: 'e1', estado: 'EN_CURSO', payload, entidad: 'candidatos', entidad_id: 'c1' },
  flujo_pasos: {
    id: 's1', flujo_id: 'f1', orden: 1, nombre: 'Correo', tipo: 'EMAIL', demora_minutos: 0, plantilla_id: null,
    asunto: 'Aviso', mensaje: 'Hola {{candidato_nombre}}: {{app_url}}/gestion-humana/postulaciones', destinatarios,
    severidad: 'INFO', enlace: null, webhook_url: null, verificacion: {}, detener_si_falla: true, activo: true,
  },
})

describe('flujos que escriben al directorio', () => {
  it('sin cuenta de correo conectada no encola nada y deja el paso omitido con el motivo', async () => {
    const { db, inserts, updates } = baseFalsa(
      { flujo_ejecucion_pasos: [pasoProgramado({ listas: ['SELECCION'] })] },
      { correo_envio_configurado: false },
    )
    const r = await procesarFlujosPendientes(db)
    expect(r.omitidos).toBe(1)
    expect(r.correos).toBe(0)
    expect(inserts.filter((i) => i.tabla === 'correo_saliente')).toEqual([])
    const marca = updates.find((u) => u.tabla === 'flujo_ejecucion_pasos')
    expect(marca?.cambios.estado).toBe('OMITIDO')
    expect(marca?.cambios.resultado).toContain('No hay una cuenta de correo conectada')
  })

  it('le escribe a la lista (con copias) y al centro médico del evento, sin repetir destinatarios', async () => {
    const { db, inserts } = baseFalsa({
      flujo_ejecucion_pasos: [pasoProgramado(
        { listas: ['SELECCION', 'INACTIVA'], entidades: ['ips'], correos: ['sel@empresa.co'] },
        { candidato_nombre: 'LAURA', ips_id: 'i1', ips_correo: 'viejo@ips.co' },
      )],
      directorio_listas: [{ codigo: 'SELECCION', activo: true }, { codigo: 'INACTIVA', activo: false }],
      directorio_contactos: [
        { lista_codigo: 'SELECCION', activo: true, correo: 'sel@empresa.co', correos_copia: ['jefe@empresa.co'] },
        { lista_codigo: 'SELECCION', activo: true, correo: null, correos_copia: [] },
        { lista_codigo: 'SELECCION', activo: false, correo: 'retirado@empresa.co', correos_copia: [] },
        { lista_codigo: 'INACTIVA', activo: true, correo: 'nadie@empresa.co', correos_copia: [] },
      ],
      ips: [{ id: 'i1', correo: 'citas@ips.co', correos_copia: ['lab@ips.co'] }],
    }, { correo_envio_configurado: true })

    const r = await procesarFlujosPendientes(db)
    expect(r.ejecutados).toBe(1)
    const cola = inserts.find((i) => i.tabla === 'correo_saliente')?.filas as any[]
    expect(cola.map((f) => [f.para, f.copia])).toEqual([
      ['sel@empresa.co', 'jefe@empresa.co'],
      ['citas@ips.co', 'lab@ips.co'],
    ])
    expect(cola[0].cuerpo_texto).toContain('Hola LAURA')
    expect(cola[0].cuerpo_texto).toMatch(/https?:\/\/\S+\/gestion-humana\/postulaciones/)
  })

  it('«Otra IPS» sin registro en el directorio: usa el correo que trae el evento', async () => {
    const { db, inserts } = baseFalsa({
      flujo_ejecucion_pasos: [pasoProgramado({ entidades: ['ips'] }, { ips_id: null, ips_correo: 'Nueva@IPS.co' })],
    }, { correo_envio_configurado: true })
    await procesarFlujosPendientes(db)
    const cola = inserts.find((i) => i.tabla === 'correo_saliente')?.filas as any[]
    expect(cola.map((f) => [f.para, f.copia])).toEqual([['nueva@ips.co', null]])
  })
})
