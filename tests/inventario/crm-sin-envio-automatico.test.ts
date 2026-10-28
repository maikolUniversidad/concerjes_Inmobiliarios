// El candado ESTRUCTURAL: no existe un camino que mande una respuesta generada
// sin que una persona la apruebe.
//
// Las otras pruebas de esta regla miran el comportamiento
// (crm-aprobacion.test.ts) y la base (scripts/verificar-crm-f11.mjs). Esta mira
// el CÓDIGO, y existe porque el comportamiento se puede probar y sin embargo
// alguien puede abrir mañana un segundo camino: un `whatsapp_encolar` nuevo en
// otro archivo, un import en el módulo de IA, un `iniciado_por: 'BOT'` en una
// respuesta de agente. Eso no lo caza una prueba de comportamiento, porque el
// camino nuevo nunca se llamaría desde la prueba vieja.
//
// Lee los archivos de F11 y comprueba cuatro cosas:
//   1. `lib/crm/ia.ts` —lo único que habla con el modelo— no importa nada con
//      lo que se pueda enviar. No es que no lo llame: no lo tiene.
//   2. En todo el código del CRM, `crm_respuesta_aprobar` es la única RPC que
//      encola, y se llama en un solo lugar.
//   3. Ese lugar arma el envío con `prepararEnvio()` y le pasa el usuario de la
//      sesión.
//   4. La migración pone el candado también en la base.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { archivos, RAIZ } from '../proyecto/_fs'

const leer = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

/** El archivo SIN comentarios: lo que de verdad se ejecuta.
 *
 *  Hace falta porque estos módulos nombran `whatsapp_encolar` y
 *  `crm_respuesta_aprobar` muchas veces EN LOS COMENTARIOS, justamente para
 *  explicar por qué no se llaman desde ahí. Una prueba que mirara el texto
 *  crudo castigaría la documentación de la regla que está defendiendo. */
const soloCodigo = (fuente: string) => fuente
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split(/\r?\n/)
  .map((l) => {
    const i = l.indexOf('//')
    // Sin comillas antes: no es una URL ni una cadena con '//'.
    return i >= 0 && !/['"`]/.test(l.slice(0, i)) ? l.slice(0, i) : l
  })
  .join('\n')

const IA = 'apps/inventario/lib/crm/ia.ts'
const APROBACION = 'apps/inventario/lib/crm/aprobacion.ts'
const ACTIONS = 'apps/inventario/app/(dashboard)/rondas/crm/actions.ts'
const MIGRACION = 'supabase/migrations/20261028001200_puntos_qr_f11_crm_ia.sql'

describe('1. el módulo que habla con el modelo no puede enviar', () => {
  const fuente = soloCodigo(leer(IA))

  it('no importa nada que sirva para mandar un mensaje', () => {
    // Si alguien agrega uno de estos imports, el módulo de IA pasa a tener la
    // capacidad de enviar, y la regla deja de estar garantizada por la forma
    // del código.
    const prohibidos = [
      'whatsapp/salida', 'whatsapp/cliente', 'whatsapp/motor', 'whatsapp/mensajes',
      'supabase/server', 'supabase/client', '@supabase/supabase-js',
      'crm/aprobacion',
    ]
    for (const p of prohibidos) {
      expect(fuente.includes(`from '@/lib/${p}'`), `lib/crm/ia.ts importa ${p}`).toBe(false)
      expect(fuente.includes(`from '${p}'`), `lib/crm/ia.ts importa ${p}`).toBe(false)
      expect(fuente.includes(`from './${p.split('/').pop()}'`),
             `lib/crm/ia.ts importa ${p}`).toBe(false)
    }
  })

  it('no nombra ninguna RPC ni función de envío', () => {
    for (const nombre of ['whatsapp_encolar', 'crm_respuesta_aprobar', 'enviarMensaje',
                          'despachar', '.rpc(']) {
      expect(fuente.includes(nombre), `lib/crm/ia.ts menciona ${nombre}`).toBe(false)
    }
  })

  it('tampoco hace peticiones por su cuenta más allá del modelo', () => {
    // El SDK `openai` es la única salida a la red de este archivo.
    expect(fuente).not.toMatch(/\bfetch\s*\(/)
    expect(fuente.match(/^import .*$/gm)!.join('\n')).toMatch(/from 'openai'/)
  })
})

describe('2. crm_respuesta_aprobar es la única puerta, y se llama una sola vez', () => {
  // Todo el código del CRM: lib/crm y las rutas de la bandeja.
  const archivosCrm = [
    ...archivos(join(RAIZ, 'apps/inventario/lib/crm'), ['.ts']),
    ...archivos(join(RAIZ, 'apps/inventario/app/(dashboard)/rondas/crm'), ['.ts', '.tsx']),
  ]

  it('ningún archivo del CRM llama a whatsapp_encolar directamente', () => {
    // Saltarse `crm_respuesta_aprobar` para encolar a mano sería saltarse el
    // candado: `whatsapp_encolar` no exige que nadie apruebe.
    //
    // Se busca la LLAMADA (`rpc('whatsapp_encolar'`), no la palabra: los
    // comentarios de este módulo la nombran mucho, justamente para explicar por
    // qué no se llama desde acá.
    for (const f of archivosCrm) {
      expect(/rpc\(\s*['"`]whatsapp_encolar/.test(soloCodigo(readFileSync(f, 'utf8'))),
             `${f} llama a whatsapp_encolar sin pasar por crm_respuesta_aprobar`).toBe(false)
    }
  })

  it('crm_respuesta_aprobar se invoca exactamente una vez en todo el código', () => {
    const veces = archivosCrm
      .map((f) => (soloCodigo(readFileSync(f, 'utf8')).match(/'crm_respuesta_aprobar'/g) ?? []).length)
      .reduce((a, b) => a + b, 0)
    expect(veces, 'hay más de un camino de salida en el CRM').toBe(1)
  })

  it('y ese único lugar es la server action de aprobar', () => {
    expect(leer(ACTIONS)).toContain(`'crm_respuesta_aprobar'`)
  })
})

describe('3. la server action de aprobar pasa por el candado', () => {
  const fuente = soloCodigo(leer(ACTIONS))

  it('arma el envío con prepararEnvio(), no a mano', () => {
    expect(fuente).toContain(`from '@/lib/crm/aprobacion'`)
    expect(fuente).toMatch(/prepararEnvio\(\{/)
  })

  it('y le pasa el usuario de la sesión, no un valor fijo', () => {
    expect(fuente).toMatch(/aprobadoPor:\s*usuarioId/)
    // El id sale de `getUser()`, no de un campo del formulario: un `<input
    // name="aprobado_por">` lo podría poner cualquiera.
    expect(fuente).toMatch(/auth\.getUser\(\)/)
    expect(fuente).not.toMatch(/aprobado_por['"]\s*\)/)
  })

  it('si prepararEnvio dice que no, la acción corta ahí', () => {
    expect(fuente).toMatch(/if\s*\(!listo\.ok\)\s*return/)
  })

  it('lo que se manda sale de listo.envio, no del formulario', () => {
    expect(fuente).toMatch(/p_texto:\s*listo\.envio\.texto/)
    expect(fuente).toMatch(/p_aprobado_por:\s*listo\.envio\.aprobadoPor/)
  })

  it('la acción que guarda lo del modelo NO encola nada', () => {
    // `analizarCaso` llama al modelo y guarda. El cuerpo de esa función no debe
    // tener ninguna llamada de envío.
    const i = fuente.indexOf('export async function analizarCaso')
    const j = fuente.indexOf('export async function confirmarClasificacion')
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(i)
    const cuerpo = fuente.slice(i, j)
    expect(cuerpo).not.toContain('crm_respuesta_aprobar')
    expect(cuerpo).not.toContain('whatsapp_encolar')
    expect(cuerpo).toContain('crm_caso_ia_guardar')
  })
})

describe('4. el candado también está en la base de datos', () => {
  const sql = leer(MIGRACION)

  it('crm_respuesta_aprobar es la única función de F11 que encola', () => {
    // Se cuentan las LLAMADAS, no las menciones: los comentarios de la
    // migración nombran `whatsapp_encolar()` varias veces para explicar que
    // aprobar no se salta el portero de F9.
    const lineas = (t: string) => t.split(/\r?\n/)
      .filter((l) => !l.trimStart().startsWith('--') && l.includes('public.whatsapp_encolar('))
    const llamadas = lineas(sql)
    expect(llamadas.length, llamadas.join(' | ')).toBe(1)

    const encolan = sql.split('CREATE OR REPLACE FUNCTION')
      .filter((bloque) => lineas(bloque).length > 0)
    expect(encolan.length).toBe(1)
    expect(encolan[0].slice(0, 200)).toContain('crm_respuesta_aprobar')
  })

  it('crm_caso_ia_guardar —la que guarda lo del modelo— no encola nada', () => {
    const i = sql.indexOf('FUNCTION public.crm_caso_ia_guardar(')
    const j = sql.indexOf('FUNCTION public.crm_caso_ia_confirmar(')
    expect(i).toBeGreaterThan(-1)
    const cuerpo = sql.slice(i, j)
    expect(cuerpo).not.toContain('whatsapp_encolar')
  })

  it('exige p_aprobado_por y que exista en usuarios', () => {
    const i = sql.indexOf('FUNCTION public.crm_respuesta_aprobar(')
    const j = sql.indexOf('FUNCTION public.crm_sla_barrer(')
    const cuerpo = sql.slice(i, j)
    expect(cuerpo).toMatch(/v_quien IS NULL THEN\s*\n\s*RAISE EXCEPTION/)
    expect(cuerpo).toMatch(/NOT EXISTS \(SELECT 1 FROM usuarios WHERE id = v_quien\)/)
  })

  it('encola como AGENTE, nunca como BOT', () => {
    // El criterio de aceptación de la Fase 4 del documento 00 lo dice literal:
    // la respuesta confirmada queda con autor AGENTE, no BOT.
    const i = sql.indexOf('FUNCTION public.crm_respuesta_aprobar(')
    const cuerpo = sql.slice(i, sql.indexOf('FUNCTION public.crm_sla_barrer('))
    expect(cuerpo).toMatch(/p_iniciado_por\s*=>\s*'AGENTE'/)
    expect(cuerpo).not.toMatch(/p_iniciado_por\s*=>\s*'BOT'/)
  })

  it('la tabla tiene la restricción: aprobación con nombre, hora y texto', () => {
    expect(sql).toMatch(/CONSTRAINT ck_crm_casos_aprobacion CHECK/)
  })

  it('las escrituras de crm_casos y crm_sla no tienen política de RLS', () => {
    // Si alguien agrega una, aparece una segunda puerta para mover un caso o un
    // reloj sin pasar por las RPC.
    for (const m of sql.matchAll(/CREATE POLICY\s+(\w+)\s+ON\s+(\w+)\s+\n?\s*FOR\s+(\w+)/g)) {
      const [, politica, tabla, cmd] = m
      if (['crm_casos', 'crm_sla', 'crm_asignaciones', 'crm_caso_etiquetas'].includes(tabla)) {
        expect(cmd.toUpperCase(), `${politica} sobre ${tabla} concede ${cmd}`).toBe('SELECT')
      }
    }
  })
})

describe('el reparto de tablas entre fases', () => {
  const sql = leer(MIGRACION)

  it('F11 no crea las tablas de F10', () => {
    for (const t of ['crm_envios', 'crm_envio_destinos', 'crm_menu_opciones']) {
      expect(new RegExp(`CREATE\\s+TABLE[^;]*\\b${t}\\b`, 'i').test(sql),
             `F11 crea ${t}, que es de F10`).toBe(false)
    }
  })

  it('F11 no crea ni altera las tablas de otros módulos', () => {
    for (const p of ['mant_', 'activo_', 'pqrs_', 'persona_ubicacion_']) {
      expect(new RegExp(`CREATE\\s+TABLE[^;]*\\b${p}`, 'i').test(sql),
             `F11 crea una tabla ${p}*`).toBe(false)
      expect(new RegExp(`ALTER\\s+TABLE[^;]*\\b${p}`, 'i').test(sql),
             `F11 altera una tabla ${p}*`).toBe(false)
    }
  })

  it('usa el calendario de festivos COMPARTIDO y no crea uno propio', () => {
    expect(sql).toContain('pqrs_dias_no_habiles')
    expect(/CREATE\s+TABLE[^;]*dias_no_habiles/i.test(sql)).toBe(false)
    expect(/CREATE\s+TABLE[^;]*crm_festivos/i.test(sql)).toBe(false)
  })

  it('está en el bloque de migraciones reservado para F11', () => {
    const marca = Number(MIGRACION.match(/(\d{14})_/)![1])
    expect(marca).toBeGreaterThanOrEqual(20261028001200)
    expect(marca).toBeLessThanOrEqual(20261028001299)
  })
})
