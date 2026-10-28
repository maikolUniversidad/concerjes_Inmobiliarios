// La verificación de la firma del webhook de WhatsApp.
//
// POR QUÉ ESTAS PRUEBAS Y NO OTRAS: la firma es el ÚNICO control de
// autenticidad de `/api/whatsapp/webhook`. No hay cookie, no hay token de
// sesión, no hay IP de confianza, porque Meta no se puede autenticar de otra
// forma. Un bug acá es un bot que cualquiera puede manejar: abrir visitas,
// cerrarlas y escribirle a 6.000 personas desde el número de la empresa.
//
// Y el reto de suscripción tiene su propia trampa: si falla, Meta no entrega
// NADA y el síntoma es «no llegan mensajes», sin ningún error en ninguna parte.

import { describe, expect, it } from 'vitest'
import { createHmac } from 'node:crypto'
import { firmar, resolverReto, verificarFirma } from '@/lib/whatsapp/firma'

const SECRETO = '00000000000000000000000000000000' // de ejemplo, como el del ADR
const CUERPO = '{"object":"whatsapp_business_account","entry":[{"id":"102290129340398"}]}'

describe('verificarFirma', () => {
  it('acepta una firma correcta', () => {
    expect(verificarFirma(CUERPO, firmar(CUERPO, SECRETO), SECRETO)).toEqual({ ok: true })
  })

  it('rechaza una firma de otro cuerpo', () => {
    const otra = firmar(CUERPO + ' ', SECRETO)
    expect(verificarFirma(CUERPO, otra, SECRETO)).toEqual({ ok: false, motivo: 'FIRMA_INVALIDA' })
  })

  it('rechaza una firma hecha con otro secreto', () => {
    const otra = firmar(CUERPO, 'ffffffffffffffffffffffffffffffff')
    expect(verificarFirma(CUERPO, otra, SECRETO)).toEqual({ ok: false, motivo: 'FIRMA_INVALIDA' })
  })

  it('rechaza cuando no viene el header', () => {
    expect(verificarFirma(CUERPO, null, SECRETO)).toEqual({ ok: false, motivo: 'SIN_FIRMA' })
    expect(verificarFirma(CUERPO, undefined, SECRETO)).toEqual({ ok: false, motivo: 'SIN_FIRMA' })
    expect(verificarFirma(CUERPO, '', SECRETO)).toEqual({ ok: false, motivo: 'SIN_FIRMA' })
  })

  it('rechaza un header sin el prefijo sha256=', () => {
    const hex = createHmac('sha256', SECRETO).update(CUERPO).digest('hex')
    expect(verificarFirma(CUERPO, hex, SECRETO)).toEqual({ ok: false, motivo: 'SIN_FIRMA' })
    expect(verificarFirma(CUERPO, `sha1=${hex}`, SECRETO)).toEqual({ ok: false, motivo: 'SIN_FIRMA' })
  })

  it('SIN SECRETO CONFIGURADO rechaza, nunca acepta', () => {
    // Es la prueba más importante del archivo: un despliegue al que le falta la
    // variable no puede ser un despliegue permisivo. Si esto devolviera ok,
    // olvidar una variable de entorno abriría el bot al mundo.
    expect(verificarFirma(CUERPO, firmar(CUERPO, SECRETO), null)).toEqual({ ok: false, motivo: 'SIN_SECRETO' })
    expect(verificarFirma(CUERPO, firmar(CUERPO, SECRETO), '')).toEqual({ ok: false, motivo: 'SIN_SECRETO' })
  })

  it('rechaza una firma que no es hexadecimal de 64 caracteres', () => {
    // `timingSafeEqual` LANZA si los búferes no miden igual: si no se valida la
    // forma antes, un header corto tumba el endpoint en vez de rechazarlo.
    for (const malo of ['sha256=', 'sha256=abc', 'sha256=' + 'z'.repeat(64), 'sha256=' + 'a'.repeat(63), 'sha256=' + 'a'.repeat(65)]) {
      expect(() => verificarFirma(CUERPO, malo, SECRETO)).not.toThrow()
      expect(verificarFirma(CUERPO, malo, SECRETO).ok).toBe(false)
    }
  })

  it('acepta mayúsculas en el hexadecimal', () => {
    const hex = createHmac('sha256', SECRETO).update(CUERPO).digest('hex').toUpperCase()
    expect(verificarFirma(CUERPO, `sha256=${hex}`, SECRETO)).toEqual({ ok: true })
  })

  it('tolera espacios alrededor del header', () => {
    expect(verificarFirma(CUERPO, `  ${firmar(CUERPO, SECRETO)}  `, SECRETO)).toEqual({ ok: true })
  })

  it('funciona con tildes, ñ y emoji en el cuerpo', () => {
    // Los textos del bot son en español y llevan emoji. Si la firma se
    // calculara sobre otra codificación, todos los mensajes con «ñ» fallarían.
    const c = JSON.stringify({ text: { body: 'Ubicación confirmada ✅ en la portería · 18 m — niño' } })
    expect(verificarFirma(c, firmar(c, SECRETO), SECRETO)).toEqual({ ok: true })
  })

  it('funciona con una barra escapada, que es donde se rompe re-serializar', () => {
    // Meta puede mandar `\/` escapado. `JSON.parse` + `JSON.stringify` lo
    // devuelve como `/`, y ahí el hash ya no cuadra. Por eso se firma el texto
    // CRUDO y nunca uno reconstruido.
    const crudo = '{"url":"https:\\/\\/ejemplo.invalid\\/foto.jpg"}'
    expect(verificarFirma(crudo, firmar(crudo, SECRETO), SECRETO)).toEqual({ ok: true })
    const reserializado = JSON.stringify(JSON.parse(crudo))
    expect(reserializado).not.toBe(crudo)
    expect(verificarFirma(reserializado, firmar(crudo, SECRETO), SECRETO).ok).toBe(false)
  })

  it('un cuerpo vacío con su firma es válido; con otra firma, no', () => {
    expect(verificarFirma('', firmar('', SECRETO), SECRETO)).toEqual({ ok: true })
    expect(verificarFirma('', firmar('x', SECRETO), SECRETO).ok).toBe(false)
  })

  it('aguanta un cuerpo grande sin romperse', () => {
    const grande = JSON.stringify({ entry: Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })) })
    expect(verificarFirma(grande, firmar(grande, SECRETO), SECRETO)).toEqual({ ok: true })
  })
})

describe('resolverReto (el GET de suscripción)', () => {
  const reto = (p: Record<string, string>) => new URLSearchParams(p)

  it('devuelve el challenge con el token correcto', () => {
    const r = resolverReto(
      reto({ 'hub.mode': 'subscribe', 'hub.verify_token': 'secreto-local', 'hub.challenge': '1158201444' }),
      'secreto-local',
    )
    expect(r).toEqual({ ok: true, challenge: '1158201444' })
  })

  it('rechaza con el token equivocado', () => {
    const r = resolverReto(
      reto({ 'hub.mode': 'subscribe', 'hub.verify_token': 'otro', 'hub.challenge': '1158201444' }),
      'secreto-local',
    )
    expect(r).toEqual({ ok: false, motivo: 'VERIFY_TOKEN' })
  })

  it('rechaza un token que es un prefijo del correcto', () => {
    // Sin igualar longitudes, una comparación perezosa aceptaría el prefijo.
    const r = resolverReto(
      reto({ 'hub.mode': 'subscribe', 'hub.verify_token': 'secreto', 'hub.challenge': 'x' }),
      'secreto-local',
    )
    expect(r.ok).toBe(false)
  })

  it('rechaza un hub.mode que no es subscribe', () => {
    for (const modo of ['unsubscribe', 'SUBSCRIBE', '', 'suscribe']) {
      const r = resolverReto(
        reto({ 'hub.mode': modo, 'hub.verify_token': 'secreto-local', 'hub.challenge': 'x' }),
        'secreto-local',
      )
      expect(r, `modo: ${modo}`).toEqual({ ok: false, motivo: 'VERIFY_TOKEN' })
    }
  })

  it('rechaza si falta el challenge o el token', () => {
    expect(resolverReto(reto({ 'hub.mode': 'subscribe', 'hub.verify_token': 'secreto-local' }), 'secreto-local').ok).toBe(false)
    expect(resolverReto(reto({ 'hub.mode': 'subscribe', 'hub.challenge': 'x' }), 'secreto-local').ok).toBe(false)
  })

  it('sin verify token configurado rechaza', () => {
    const r = resolverReto(
      reto({ 'hub.mode': 'subscribe', 'hub.verify_token': 'cualquiera', 'hub.challenge': 'x' }),
      null,
    )
    expect(r).toEqual({ ok: false, motivo: 'SIN_SECRETO' })
  })

  it('devuelve el challenge TAL CUAL, sin tocarlo', () => {
    // Meta compara byte a byte lo que devolvemos. Recortar, parsear a número o
    // envolver en JSON hace que marque el endpoint como no verificado.
    const raro = '0012 34\n56'
    const r = resolverReto(
      reto({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tk', 'hub.challenge': raro }),
      'tk',
    )
    expect(r).toEqual({ ok: true, challenge: raro })
  })
})
