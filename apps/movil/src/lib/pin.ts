// PIN local para reabrir la app offline sin re-login. El PIN se guarda hasheado
// (SHA-256) en localStorage; el "desbloqueado" vive en sessionStorage (se pierde
// al cerrar la app → vuelve a pedir PIN).

const CLAVE_PIN = 'ci-pin-hash'
const CLAVE_UNLOCK = 'ci-unlocked'

async function sha256(txt: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function tienePin(): boolean {
  return !!localStorage.getItem(CLAVE_PIN)
}

export async function definirPin(pin: string): Promise<void> {
  localStorage.setItem(CLAVE_PIN, await sha256(pin))
  marcarDesbloqueado()
}

export function quitarPin(): void {
  localStorage.removeItem(CLAVE_PIN)
}

export async function verificarPin(pin: string): Promise<boolean> {
  const guardado = localStorage.getItem(CLAVE_PIN)
  if (!guardado) return true
  const ok = (await sha256(pin)) === guardado
  if (ok) marcarDesbloqueado()
  return ok
}

export function estaDesbloqueado(): boolean {
  return sessionStorage.getItem(CLAVE_UNLOCK) === '1'
}
export function marcarDesbloqueado(): void {
  sessionStorage.setItem(CLAVE_UNLOCK, '1')
}
export function bloquear(): void {
  sessionStorage.removeItem(CLAVE_UNLOCK)
}
