import { describe, it, expect, vi } from 'vitest'
import { capturar, desenvolver, conError } from '@/lib/resultado'
import { mensajeDeError } from '@/lib/errores'

describe('capturar (servidor)', () => {
  it('devuelve el dato cuando todo sale bien', async () => {
    expect(await capturar(async () => 42)).toEqual({ ok: true, data: 42 })
  })

  it('convierte un Error en { ok: false } con el mensaje real', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await capturar(async () => { throw new Error('El código y el nombre son obligatorios.') }))
      .toEqual({ ok: false, error: 'El código y el nombre son obligatorios.' })
  })

  it('toma el mensaje de un error de Supabase (objeto con message, no Error)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const errSupabase = { message: 'duplicate key value violates unique constraint', code: '23505' }
    expect(await capturar(async () => { throw errSupabase })).toEqual({ ok: false, error: errSupabase.message })
  })

  it('deja pasar redirect() y notFound() de Next', async () => {
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;replace;/login;307;' })
    await expect(capturar(async () => { throw redirect })).rejects.toBe(redirect)
    const notFound = Object.assign(new Error('NEXT_HTTP_ERROR_FALLBACK;404'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
    await expect(capturar(async () => { throw notFound })).rejects.toBe(notFound)
  })
})

describe('desenvolver / conError (cliente)', () => {
  it('devuelve el dato o lanza el mensaje real', () => {
    expect(desenvolver({ ok: true, data: 'x' })).toBe('x')
    expect(() => desenvolver({ ok: false, error: 'Sin permiso' })).toThrow('Sin permiso')
  })

  it('conError conserva argumentos y resultado de la acción', async () => {
    const accion = async (a: number, b: number) => ({ ok: true as const, data: a + b })
    expect(await conError(accion)(2, 3)).toBe(5)
    const falla = async () => ({ ok: false as const, error: 'El valor supera el saldo pendiente.' })
    await expect(conError(falla)()).rejects.toThrow('El valor supera el saldo pendiente.')
  })
})

describe('mensajeDeError', () => {
  it('cambia el mensaje censurado de producción por uno en español', () => {
    const censurado = new Error('An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.')
    expect(mensajeDeError(censurado, 'No se pudo guardar.')).toBe('No se pudo guardar.')
    expect(mensajeDeError(new Error('Sin stock'), 'No se pudo guardar.')).toBe('Sin stock')
  })
})
