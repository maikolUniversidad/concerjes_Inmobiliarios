// Motor de plantillas de documentos (sin dependencias).
//
// Sintaxis, pensada para que RRHH pueda editar las plantillas desde la app:
//
//   {{candidato.nombre_completo}}            valor (se escapa HTML)
//   {{{cargo.funciones_html}}}               valor sin escapar (HTML ya armado)
//   {{contrato.salario | moneda}}            filtros, encadenables con |
//   {{candidato.genero | defecto:"—"}}       filtro con argumento
//   {{#if candidato.es_femenino}}…{{else}}…{{/if}}
//   {{#each candidato.beneficiarios}} {{@numero}}. {{this.nombre_completo}} {{/each}}
//
// Los marcadores en MAYÚSCULAS reservados ({{FIRMA_TRABAJADOR}}, {{FECHA_FIRMA}},
// {{FOTO_CARNET}}, {{HUELLA}}…) se dejan intactos: los resuelve la firma o el
// visor en el momento de mostrar/firmar, no al generar.

export type Contexto = Record<string, unknown>

export const MARCADORES_RESERVADOS = [
  'FIRMA_TRABAJADOR', 'FECHA_FIRMA', 'FIRMA_EMPLEADOR', 'FIRMA_TESTIGO1', 'FIRMA_TESTIGO2',
  'FIRMA_EVALUADOR', 'FIRMA_RESPONSABLE', 'HUELLA', 'HUELLA_IZQUIERDA', 'FOTO_CARNET',
] as const

const RESERVADAS = new Set<string>(MARCADORES_RESERVADOS)

// ── AST ─────────────────────────────────────────────────────────────────────
type Nodo =
  | { t: 'texto'; v: string }
  | { t: 'var'; ruta: string; filtros: Filtro[]; raw: boolean }
  | { t: 'reservada'; nombre: string }
  | { t: 'if'; ruta: string; si: Nodo[]; no: Nodo[]; negado: boolean }
  | { t: 'each'; ruta: string; cuerpo: Nodo[] }

interface Filtro { nombre: string; arg?: string }

const RE_TOKEN = /\{\{\{\s*([^{}]+?)\s*\}\}\}|\{\{\s*([^{}]+?)\s*\}\}/g

interface Token { tipo: 'texto' | 'tag'; v: string; raw?: boolean }

function tokenizar(src: string): Token[] {
  const out: Token[] = []
  let pos = 0
  for (const m of src.matchAll(RE_TOKEN)) {
    const i = m.index ?? 0
    if (i > pos) out.push({ tipo: 'texto', v: src.slice(pos, i) })
    if (m[1] !== undefined) out.push({ tipo: 'tag', v: m[1].trim(), raw: true })
    else out.push({ tipo: 'tag', v: (m[2] ?? '').trim(), raw: false })
    pos = i + m[0].length
  }
  if (pos < src.length) out.push({ tipo: 'texto', v: src.slice(pos) })
  return out
}

function parsearFiltros(expr: string): { ruta: string; filtros: Filtro[] } {
  // "a.b | mayusculas | defecto:"—""
  const partes = dividirPipes(expr)
  const ruta = partes[0].trim()
  const filtros: Filtro[] = partes.slice(1).map((p) => {
    const s = p.trim()
    const i = s.indexOf(':')
    if (i < 0) return { nombre: s }
    let arg = s.slice(i + 1).trim()
    if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) arg = arg.slice(1, -1)
    return { nombre: s.slice(0, i).trim(), arg }
  })
  return { ruta, filtros }
}

/** Divide por `|` respetando comillas. */
function dividirPipes(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let q: string | null = null
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue }
    if (ch === '|') { out.push(cur); cur = ''; continue }
    cur += ch
  }
  out.push(cur)
  return out
}

function parsear(tokens: Token[]): Nodo[] {
  let i = 0
  function bloque(cierres: string[]): { nodos: Nodo[]; cierre: string | null } {
    const nodos: Nodo[] = []
    while (i < tokens.length) {
      const tk = tokens[i++]
      if (tk.tipo === 'texto') { nodos.push({ t: 'texto', v: tk.v }); continue }
      const v = tk.v
      if (cierres.includes(v)) return { nodos, cierre: v }
      if (v.startsWith('#if ') || v.startsWith('#unless ')) {
        const negado = v.startsWith('#unless ')
        const ruta = v.slice(negado ? 8 : 4).trim()
        const si = bloque(['else', '/if', '/unless'])
        let no: Nodo[] = []
        if (si.cierre === 'else') no = bloque(['/if', '/unless']).nodos
        nodos.push({ t: 'if', ruta, si: si.nodos, no, negado })
        continue
      }
      if (v.startsWith('#each ')) {
        const ruta = v.slice(6).trim()
        const cuerpo = bloque(['/each']).nodos
        nodos.push({ t: 'each', ruta, cuerpo })
        continue
      }
      if (RESERVADAS.has(v)) { nodos.push({ t: 'reservada', nombre: v }); continue }
      const { ruta, filtros } = parsearFiltros(v)
      nodos.push({ t: 'var', ruta, filtros, raw: !!tk.raw })
    }
    return { nodos, cierre: null }
  }
  return bloque([]).nodos
}

// ── Resolución de valores ───────────────────────────────────────────────────
type Alcance = { datos: unknown; meta?: Record<string, unknown> }

function leer(obj: unknown, clave: string): unknown {
  if (obj === null || obj === undefined) return undefined
  if (Array.isArray(obj) && /^\d+$/.test(clave)) return obj[Number(clave)]
  if (typeof obj === 'object') return (obj as Record<string, unknown>)[clave]
  return undefined
}

function resolver(ruta: string, pila: Alcance[]): unknown {
  if (ruta === 'this') return pila[pila.length - 1]?.datos
  if (ruta.startsWith('@')) return pila[pila.length - 1]?.meta?.[ruta]
  const segs = ruta.startsWith('this.') ? ruta.slice(5).split('.') : ruta.split('.')
  if (ruta.startsWith('this.')) {
    let cur: unknown = pila[pila.length - 1]?.datos
    for (const s of segs) cur = leer(cur, s)
    return cur
  }
  // Busca el primer alcance (de adentro hacia afuera) que tenga el primer segmento.
  for (let k = pila.length - 1; k >= 0; k--) {
    const base = pila[k].datos
    if (base && typeof base === 'object' && segs[0] in (base as Record<string, unknown>)) {
      let cur: unknown = base
      for (const s of segs) cur = leer(cur, s)
      return cur
    }
  }
  return undefined
}

function esVerdadero(v: unknown): boolean {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'string') return v.trim() !== '' && v.trim().toLowerCase() !== 'false'
  return true
}

// ── Filtros ─────────────────────────────────────────────────────────────────
const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

export function parsearFecha(v: unknown): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v
  if (typeof v !== 'string' || !v.trim()) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim())
  if (m) {
    // Fecha civil: se construye en local para que no se corra un día por la zona horaria.
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    if (v.length > 10) {
      const full = new Date(v)
      if (!isNaN(full.getTime())) return full
    }
    return isNaN(d.getTime()) ? null : d
  }
  const d2 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim())
  if (d2) return new Date(Number(d2[3]), Number(d2[2]) - 1, Number(d2[1]))
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

const p2 = (n: number) => String(n).padStart(2, '0')
export const fechaCorta = (d: Date) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`
export const fechaLarga = (d: Date) => `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`

export function formatoMoneda(v: unknown): string {
  const n = Number(v)
  if (!isFinite(n)) return ''
  return '$ ' + Math.round(n).toLocaleString('es-CO')
}

const UNIDADES = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve']
const DECENAS = ['', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

function menorMil(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cien'
  const c = Math.floor(n / 100), r = n % 100
  let s = CENTENAS[c]
  if (r > 0) {
    if (r < 30) s += (s ? ' ' : '') + UNIDADES[r]
    else {
      const d = Math.floor(r / 10), u = r % 10
      s += (s ? ' ' : '') + DECENAS[d] + (u ? ' y ' + UNIDADES[u] : '')
    }
  }
  return s
}

/** Número entero en letras (español), hasta miles de millones. "1" → "uno". */
export function numeroEnLetras(v: unknown): string {
  const n = Math.floor(Math.abs(Number(v)))
  if (!isFinite(n)) return ''
  if (n === 0) return 'cero'
  if (n === 1) return 'uno'
  const partes: string[] = []
  const mm = Math.floor(n / 1_000_000), miles = Math.floor((n % 1_000_000) / 1000), resto = n % 1000
  if (mm) partes.push(mm === 1 ? 'un millón' : `${menorMil(mm)} millones`)
  if (miles) partes.push(miles === 1 ? 'mil' : `${menorMil(miles)} mil`)
  if (resto) partes.push(resto === 1 && n > 1 ? 'uno' : menorMil(resto))
  return partes.join(' ').replace(/\s+/g, ' ').trim()
}

export function edadDesde(fecha: unknown, hoy = new Date()): number | null {
  const d = parsearFecha(fecha)
  if (!d) return null
  let e = hoy.getFullYear() - d.getFullYear()
  const m = hoy.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && hoy.getDate() < d.getDate())) e--
  return e
}

function aplicarFiltro(v: unknown, f: Filtro): { v: unknown; raw?: boolean } {
  const s = v === null || v === undefined ? '' : String(v)
  switch (f.nombre) {
    case 'mayusculas': return { v: s.toUpperCase() }
    case 'minusculas': return { v: s.toLowerCase() }
    // "BOGOTÁ D.C." → "Bogotá D.C." (también después de punto, guion o paréntesis)
    case 'capitalizar': return { v: s.toLowerCase().replace(/(^|[\s.(\-/])\p{L}/gu, (c) => c.toUpperCase()) }
    case 'fecha': { const d = parsearFecha(v); return { v: d ? fechaCorta(d) : '' } }
    case 'fecha_larga': { const d = parsearFecha(v); return { v: d ? fechaLarga(d) : '' } }
    case 'fecha_iso': { const d = parsearFecha(v); return { v: d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : '' } }
    case 'dia': { const d = parsearFecha(v); return { v: d ? p2(d.getDate()) : '' } }
    case 'mes': { const d = parsearFecha(v); return { v: d ? p2(d.getMonth() + 1) : '' } }
    case 'anio': { const d = parsearFecha(v); return { v: d ? String(d.getFullYear()) : '' } }
    case 'mes_nombre': { const d = parsearFecha(v); return { v: d ? MESES[d.getMonth()] : '' } }
    case 'edad': { const e = edadDesde(v); return { v: e === null ? '' : String(e) } }
    case 'moneda': return { v: formatoMoneda(v) }
    case 'numero': { const n = Number(v); return { v: isFinite(n) && s !== '' ? n.toLocaleString('es-CO') : '' } }
    case 'letras': return { v: s === '' ? '' : numeroEnLetras(v) }
    case 'si_no': return { v: v === true ? 'Sí' : v === false ? 'No' : '' }
    case 'x': return { v: esVerdadero(v) ? 'X' : '' }
    case 'defecto': return { v: esVerdadero(v) ? v : (f.arg ?? '') }
    case 'lista': return { v: Array.isArray(v) ? v.filter(Boolean).join(f.arg ?? ', ') : s }
    case 'lineas': return { v: Array.isArray(v) ? v.filter(Boolean).map((x) => escapar(String(x))).join('<br>') : escapar(s), raw: true }
    case 'vinetas': return { v: Array.isArray(v) ? '<ul>' + v.filter(Boolean).map((x) => `<li>${escapar(String(x))}</li>`).join('') + '</ul>' : escapar(s), raw: true }
    case 'puntos': {
      // 1000123456 → 1.000.123.456 (solo si es un número; si no, se deja igual)
      const limpio = s.replace(/\D/g, '')
      return { v: limpio === '' || limpio !== s.trim() ? s : Number(limpio).toLocaleString('es-CO') }
    }
    case 'largo': return { v: Array.isArray(v) ? String(v.length) : String(s.length) }
    case 'primero': return { v: Array.isArray(v) ? v[0] : s.split(/\s+/)[0] }
    case 'trim': return { v: s.trim() }
    // Comparaciones para casillas: {{candidato.tipo_documento | igual:"CC" | x}}
    case 'igual': return { v: normalizarComparacion(s) === normalizarComparacion(f.arg ?? '') }
    case 'distinto': return { v: normalizarComparacion(s) !== normalizarComparacion(f.arg ?? '') }
    case 'contiene': {
      const buscado = normalizarComparacion(f.arg ?? '')
      if (Array.isArray(v)) return { v: v.some((x) => normalizarComparacion(String(x)) === buscado) }
      return { v: buscado !== '' && normalizarComparacion(s).includes(buscado) }
    }
    default: return { v }
  }
}

function normalizarComparacion(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').trim().toUpperCase()
}

export function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ── Render ──────────────────────────────────────────────────────────────────
function render(nodos: Nodo[], pila: Alcance[]): string {
  let out = ''
  for (const n of nodos) {
    switch (n.t) {
      case 'texto': out += n.v; break
      case 'reservada': out += `{{${n.nombre}}}`; break
      case 'var': {
        let v = resolver(n.ruta, pila)
        let raw = n.raw
        for (const f of n.filtros) { const r = aplicarFiltro(v, f); v = r.v; if (r.raw) raw = true }
        const s = v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'Sí' : 'No') : Array.isArray(v) ? v.join(', ') : String(v)
        out += raw ? s : escapar(s)
        break
      }
      case 'if': {
        const ok = esVerdadero(resolver(n.ruta, pila))
        out += render(ok !== n.negado ? n.si : n.no, pila)
        break
      }
      case 'each': {
        const arr = resolver(n.ruta, pila)
        if (!Array.isArray(arr)) break
        arr.forEach((item, i) => {
          out += render(n.cuerpo, [...pila, { datos: item, meta: { '@index': i, '@numero': i + 1, '@primero': i === 0, '@ultimo': i === arr.length - 1 } }])
        })
        break
      }
    }
  }
  return out
}

/** Renderiza una plantilla con el contexto. Los marcadores reservados quedan intactos. */
export function renderizarPlantilla(html: string, contexto: Contexto): string {
  return render(parsear(tokenizar(html)), [{ datos: contexto }])
}

/** Variables (rutas) que usa una plantilla, sin las reservadas ni las de bloque. */
export function extraerVariables(html: string): string[] {
  const vars = new Set<string>()
  // Las rutas relativas al elemento del #each (this.x, @numero) no son del catálogo.
  const global = (ruta: string) => !ruta.startsWith('this') && !ruta.startsWith('@')
  const recorrer = (nodos: Nodo[]) => {
    for (const n of nodos) {
      if (n.t === 'var' && global(n.ruta)) vars.add(n.ruta)
      if (n.t === 'if') { if (global(n.ruta)) vars.add(n.ruta); recorrer(n.si); recorrer(n.no) }
      if (n.t === 'each') { if (global(n.ruta)) vars.add(n.ruta); recorrer(n.cuerpo) }
    }
  }
  recorrer(parsear(tokenizar(html)))
  return [...vars].sort()
}

/** Marcadores reservados presentes en la plantilla (firma, huella, foto…). */
export function marcadoresReservados(html: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(RE_TOKEN)) {
    const v = (m[1] ?? m[2] ?? '').trim()
    if (RESERVADAS.has(v)) out.add(v)
  }
  return [...out]
}

/**
 * Variables que la plantilla usa y que quedaron vacías con este contexto.
 * Sirve para avisar ANTES de generar ("falta la dirección del puesto").
 */
export function variablesVacias(html: string, contexto: Contexto): string[] {
  const vacias: string[] = []
  const recorrer = (nodos: Nodo[], pila: Alcance[]) => {
    for (const n of nodos) {
      if (n.t === 'var' && !n.ruta.startsWith('this') && !n.ruta.startsWith('@')) {
        // Un filtro `defecto` significa que el vacío está previsto.
        if (n.filtros.some((f) => f.nombre === 'defecto' || f.nombre === 'igual' || f.nombre === 'distinto' || f.nombre === 'contiene' || f.nombre === 'x')) continue
        const v = resolver(n.ruta, pila)
        if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) vacias.push(n.ruta)
      }
      // Solo cuenta la rama que de verdad se va a pintar.
      if (n.t === 'if') {
        const ok = esVerdadero(resolver(n.ruta, pila))
        recorrer(ok !== n.negado ? n.si : n.no, pila)
      }
    }
  }
  recorrer(parsear(tokenizar(html)), [{ datos: contexto }])
  return [...new Set(vacias)].sort()
}
