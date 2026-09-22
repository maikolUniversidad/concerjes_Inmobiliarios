// Direcciones de correo del directorio y de los flujos de notificación.
// Sin dependencias: lo usan el worker (servidor) y los formularios.

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function esCorreo(v: unknown): v is string {
  return typeof v === 'string' && RE_CORREO.test(v.trim())
}

/**
 * "a@x.com; b@y.com, c@z.com" o ['a@x.com', …] → lista limpia, en minúscula y
 * sin repetir. Lo que no es un correo se descarta.
 */
export function separarCorreos(v: unknown): string[] {
  const partes: string[] = Array.isArray(v)
    ? v.flatMap((x) => separarCorreos(x))
    : typeof v === 'string' ? v.split(/[,;\s]+/) : []
  const vistos = new Set<string>()
  for (const p of partes) {
    const c = p.trim().toLowerCase()
    if (RE_CORREO.test(c)) vistos.add(c)
  }
  return [...vistos]
}

/** Lo que el usuario escribió y no es un correo (para avisarle en el formulario). */
export function correosInvalidos(texto: string): string[] {
  return texto.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean).filter((s) => !RE_CORREO.test(s))
}

export interface DestinoCorreo {
  para: string
  copia: string[]
}

/**
 * Un correo por destinatario principal; las copias de un mismo destinatario se
 * suman sin repetir, y quien ya recibe su propio correo no va además en copia.
 */
export function unirDestinos(lista: DestinoCorreo[]): DestinoCorreo[] {
  const porPara = new Map<string, Set<string>>()
  for (const d of lista) {
    const para = d.para.trim().toLowerCase()
    if (!RE_CORREO.test(para)) continue
    const copias = porPara.get(para) ?? new Set<string>()
    for (const c of d.copia) {
      const x = c.trim().toLowerCase()
      if (RE_CORREO.test(x) && x !== para) copias.add(x)
    }
    porPara.set(para, copias)
  }
  const principales = new Set(porPara.keys())
  return [...porPara.entries()].map(([para, copias]) => ({
    para, copia: [...copias].filter((c) => !principales.has(c)),
  }))
}
