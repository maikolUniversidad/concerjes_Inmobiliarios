// Configuración declarativa de las cargas masivas por entidad.
// Usada por la plantilla, el parser, el preview y la server action de upsert.

export type ColType = 'text' | 'number' | 'enum' | 'email' | 'fecha' | 'booleano'

export interface ColumnDef {
  key: string
  label: string
  type: ColType
  required?: boolean
  enumValues?: readonly string[]
  ejemplo: string | number
  ayuda?: string
  /** Solo numéricas: rango permitido y si debe ser entero. */
  min?: number
  max?: number
  entero?: boolean
  /** Otros encabezados que también se aceptan para esta columna. */
  alias?: readonly string[]
}

export interface EntityConfig {
  id: 'productos' | 'proveedores' | 'usuarios' | 'personas' | 'empresas_usuarias' | 'sedes'
  label: string
  /** Campos (en orden de prioridad) usados para detectar duplicados y actualizar. */
  matchKeys: string[]
  matchLabel: string
  columns: ColumnDef[]
  instrucciones: string[]
}

const TIPO_INSUMO = ['CAFETERIA', 'LIQUIDOS', 'ASEO', 'EPP', 'PAPELERIA', 'MAQUINARIA', 'JARDINERIA', 'REPUESTOS', 'NO_DISPONIBLE', 'OTROS'] as const
const CAT_ROT = ['A', 'B', 'C', 'D'] as const
const ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'COORDINADOR_COMPRAS', 'BODEGUERO', 'AUDITOR', 'OPERADOR_SEDE'] as const
const TIPO_DOC = ['CC', 'CE', 'TI', 'PA', 'PEP', 'NIT'] as const
const ESTADO_PERSONA = ['ACTIVO', 'RETIRADO', 'SUSPENDIDO'] as const

export const PRODUCTOS_CONFIG: EntityConfig = {
  id: 'productos',
  label: 'Productos',
  matchKeys: ['ref', 'codigo', 'nombre_estandar'],
  matchLabel: 'REF, código o nombre',
  instrucciones: [
    'Completa una fila por producto. No borres ni renombres la fila de encabezados.',
    'Si la REF (o código, o nombre) ya existe, el producto se ACTUALIZA; si no, se CREA.',
    'tipo_insumo debe ser uno de: ' + TIPO_INSUMO.join(', ') + '.',
    'cat_rotacion debe ser A, B, C o D.',
    'stock_inicial solo aplica a productos nuevos (los existentes mantienen su stock).',
    'Los precios admiten separador de miles y símbolo de peso: 18.900, $ 18.900 y 18900 son lo mismo.',
    'Un texto que no sea un número (por ejemplo "no aplica") se marca como error; no entra como cero.',
  ],
  columns: [
    { key: 'ref', label: 'ref', type: 'number', entero: true, min: 0, ejemplo: 1001, ayuda: 'Número REF del Excel maestro (opcional pero recomendado)' },
    { key: 'codigo', label: 'codigo', type: 'number', entero: true, min: 0, ejemplo: 1001, ayuda: 'Código correlativo (opcional)' },
    { key: 'nombre_estandar', label: 'nombre_estandar', type: 'text', required: true, alias: ['nombre', 'producto', 'descripcion'], ejemplo: 'JABON PARA LOZA LIQUIDO', ayuda: 'Nombre estándar del producto (obligatorio)' },
    { key: 'presentacion', label: 'presentacion', type: 'text', alias: ['unidad', 'presentacion_unidad'], ejemplo: 'GALON', ayuda: 'Presentación / unidad' },
    { key: 'tipo_insumo', label: 'tipo_insumo', type: 'enum', enumValues: TIPO_INSUMO, alias: ['tipo'], ejemplo: 'ASEO' },
    { key: 'cat_rotacion', label: 'cat_rotacion', type: 'enum', enumValues: CAT_ROT, alias: ['rotacion', 'categoria_rotacion'], ejemplo: 'A' },
    { key: 'stock_minimo_def', label: 'stock_minimo_def', type: 'number', min: 0, alias: ['stock_minimo', 'minimo'], ejemplo: 50, ayuda: 'Stock mínimo definido' },
    { key: 'precio_lista', label: 'precio_lista', type: 'number', min: 0, alias: ['precio', 'valor', 'precio_unitario'], ejemplo: 18900, ayuda: 'Precio de lista en COP' },
    { key: 'stock_inicial', label: 'stock_inicial', type: 'number', min: 0, alias: ['stock', 'cantidad'], ejemplo: 120, ayuda: 'Solo para productos nuevos' },
    { key: 'complemento', label: 'complemento', type: 'text', alias: ['observaciones', 'notas'], ejemplo: 'Aroma limón', ayuda: 'Notas / detalles (opcional)' },
  ],
}

export const PROVEEDORES_CONFIG: EntityConfig = {
  id: 'proveedores',
  label: 'Proveedores',
  matchKeys: ['nit', 'nombre'],
  matchLabel: 'NIT o nombre',
  instrucciones: [
    'Completa una fila por proveedor. No borres la fila de encabezados.',
    'Si el NIT (o el nombre) ya existe, el proveedor se ACTUALIZA; si no, se CREA.',
    'es_principal admite: SI / NO (o true / false).',
  ],
  columns: [
    { key: 'nombre', label: 'nombre', type: 'text', required: true, alias: ['razon_social', 'proveedor'], ejemplo: 'DETALGRAF S.A.S', ayuda: 'Nombre del proveedor (obligatorio)' },
    { key: 'nit', label: 'nit', type: 'text', alias: ['documento', 'identificacion'], ejemplo: '900123456-7', ayuda: 'NIT (recomendado para no duplicar)' },
    { key: 'contacto', label: 'contacto', type: 'text', alias: ['persona_contacto'], ejemplo: 'Juan Pérez' },
    { key: 'telefono', label: 'telefono', type: 'text', alias: ['celular', 'tel'], ejemplo: '3201234567' },
    { key: 'email', label: 'email', type: 'email', alias: ['correo', 'correo_electronico'], ejemplo: 'ventas@detalgraf.com' },
    { key: 'es_principal', label: 'es_principal', type: 'booleano', alias: ['principal'], ejemplo: 'NO', ayuda: 'SI / NO' },
  ],
}

export const USUARIOS_CONFIG: EntityConfig = {
  id: 'usuarios',
  label: 'Usuarios',
  matchKeys: ['email'],
  matchLabel: 'email',
  instrucciones: [
    'Completa una fila por usuario. No borres la fila de encabezados.',
    'Si el email ya existe, se ACTUALIZAN solo las columnas que traiga el archivo.',
    'Si el email es nuevo, se CREA el registro de usuario en el directorio.',
    'rol debe ser uno de: ' + ROLES.join(', ') + '.',
    'activo admite SI / NO.',
  ],
  columns: [
    { key: 'nombre', label: 'nombre', type: 'text', required: true, alias: ['nombre_completo'], ejemplo: 'Andrea López', ayuda: 'Nombre completo (obligatorio)' },
    { key: 'email', label: 'email', type: 'email', required: true, alias: ['correo', 'correo_electronico'], ejemplo: 'a.lopez@conserjesinmobiliarios.com', ayuda: 'Email (obligatorio, clave única)' },
    { key: 'rol', label: 'rol', type: 'enum', enumValues: ROLES, alias: ['perfil'], ejemplo: 'AUDITOR' },
    { key: 'telefono', label: 'telefono', type: 'text', alias: ['celular', 'tel'], ejemplo: '3001234567' },
    { key: 'activo', label: 'activo', type: 'booleano', alias: ['estado'], ejemplo: 'SI', ayuda: 'SI / NO' },
  ],
}

export const PERSONAS_CONFIG: EntityConfig = {
  id: 'personas',
  label: 'Personas',
  matchKeys: ['documento'],
  matchLabel: 'número de documento',
  instrucciones: [
    'Completa una fila por persona. No borres la fila de encabezados (sí puedes quitar columnas que no uses).',
    'Si el "documento" ya existe, la persona se ACTUALIZA; si no, se CREA.',
    'tipo_doc debe ser uno de: ' + TIPO_DOC.join(', ') + '.',
    'estado debe ser: ' + ESTADO_PERSONA.join(', ') + '.',
    'empresa_usuaria: escribe el nombre. Si no existe, se crea automáticamente.',
    'sede: escribe el nombre exacto de una sede existente (opcional).',
    'fecha_ingreso admite AAAA-MM-DD, DD/MM/AAAA o una celda con formato de fecha de Excel.',
    'Toda persona NUEVA recibe acceso a la plataforma: usuario = email (o documento@conserje.local si no hay email) y contraseña = número de documento.',
    'rol: nombre del rol de acceso (ej. Conserje, Coordinador). Si se deja vacío o no existe, se asigna "Conserje".',
  ],
  columns: [
    { key: 'tipo_doc', label: 'tipo_doc', type: 'enum', enumValues: TIPO_DOC, alias: ['tipo_documento'], ejemplo: 'CC' },
    { key: 'documento', label: 'documento', type: 'text', required: true, alias: ['numero_documento', 'cedula', 'identificacion'], ejemplo: '1020304050', ayuda: 'Número de documento (obligatorio, clave única). También es la contraseña inicial.' },
    { key: 'nombres', label: 'nombres', type: 'text', required: true, alias: ['nombre'], ejemplo: 'María Fernanda', ayuda: 'Nombres (obligatorio)' },
    { key: 'apellidos', label: 'apellidos', type: 'text', required: true, alias: ['apellido'], ejemplo: 'Gómez Ruiz', ayuda: 'Apellidos (obligatorio)' },
    { key: 'cargo', label: 'cargo', type: 'text', ejemplo: 'Servicios Generales' },
    { key: 'rol', label: 'rol', type: 'text', alias: ['perfil'], ejemplo: 'Conserje', ayuda: 'Rol de acceso a la plataforma (por defecto Conserje)' },
    { key: 'empresa_usuaria', label: 'empresa_usuaria', type: 'text', alias: ['empresa', 'cliente'], ejemplo: 'Transmilenio S.A.', ayuda: 'Nombre de la empresa usuaria' },
    { key: 'sede', label: 'sede', type: 'text', ejemplo: 'Sede Norte', ayuda: 'Nombre exacto de una sede existente' },
    { key: 'fecha_ingreso', label: 'fecha_ingreso', type: 'fecha', alias: ['ingreso', 'fecha_de_ingreso'], ejemplo: '2026-01-15', ayuda: 'AAAA-MM-DD o DD/MM/AAAA' },
    { key: 'estado', label: 'estado', type: 'enum', enumValues: ESTADO_PERSONA, ejemplo: 'ACTIVO' },
    { key: 'email', label: 'email', type: 'email', alias: ['correo', 'correo_electronico'], ejemplo: 'mgomez@correo.com' },
    { key: 'telefono', label: 'telefono', type: 'text', alias: ['celular', 'tel'], ejemplo: '3001234567' },
    { key: 'direccion', label: 'direccion', type: 'text', ejemplo: 'Cra 10 # 20-30' },
    { key: 'eps', label: 'eps', type: 'text', ejemplo: 'Sura EPS' },
    { key: 'arl', label: 'arl', type: 'text', ejemplo: 'ARL Sura' },
  ],
}

export const EMPRESAS_USUARIAS_CONFIG: EntityConfig = {
  id: 'empresas_usuarias',
  label: 'Clientes (Empresas usuarias)',
  matchKeys: ['nombre', 'nit'],
  matchLabel: 'nombre o NIT',
  instrucciones: [
    'Completa una fila por cliente (empresa usuaria). No borres la fila de encabezados.',
    'Si el nombre (o el NIT) ya existe, el cliente se ACTUALIZA; si no, se CREA.',
    'El nombre es obligatorio y único.',
  ],
  columns: [
    { key: 'nombre', label: 'nombre', type: 'text', required: true, alias: ['razon_social', 'cliente', 'empresa'], ejemplo: 'Transmilenio S.A.', ayuda: 'Nombre del cliente (obligatorio, clave única)' },
    { key: 'nit', label: 'nit', type: 'text', alias: ['documento', 'identificacion'], ejemplo: '900.000.000-1', ayuda: 'NIT (recomendado para no duplicar)' },
    { key: 'ciudad', label: 'ciudad', type: 'text', ejemplo: 'Bogotá D.C.' },
    { key: 'contacto', label: 'contacto', type: 'text', alias: ['persona_contacto'], ejemplo: 'Ana Ramírez' },
    { key: 'telefono', label: 'telefono', type: 'text', alias: ['celular', 'tel'], ejemplo: '6011234567' },
    { key: 'email', label: 'email', type: 'email', alias: ['correo', 'correo_electronico'], ejemplo: 'contacto@cliente.com' },
  ],
}

export const SEDES_CONFIG: EntityConfig = {
  id: 'sedes',
  label: 'Sedes',
  matchKeys: ['codigo_interno', 'nombre'],
  matchLabel: 'código interno o nombre',
  instrucciones: [
    'Completa una fila por sede. No borres la fila de encabezados.',
    'Si el código interno (o el nombre) ya existe, la sede se ACTUALIZA; si no, se CREA.',
    'grupo es OBLIGATORIO: usa el código del grupo de contrato (CA, MO, MB, PB, AD).',
    'Si el grupo no existe, la fila se marca con error.',
  ],
  columns: [
    { key: 'grupo', label: 'grupo', type: 'text', required: true, alias: ['grupo_contrato', 'codigo_grupo'], ejemplo: 'CA', ayuda: 'Código del grupo de contrato: CA, MO, MB, PB o AD' },
    { key: 'nombre', label: 'nombre', type: 'text', required: true, alias: ['sede'], ejemplo: 'Portal Norte', ayuda: 'Nombre de la sede (obligatorio)' },
    { key: 'codigo_interno', label: 'codigo_interno', type: 'text', alias: ['codigo'], ejemplo: 'CA-001', ayuda: 'Código interno (recomendado para no duplicar)' },
    { key: 'zona', label: 'zona', type: 'text', ejemplo: 'Norte' },
    { key: 'ciudad', label: 'ciudad', type: 'text', ejemplo: 'Bogotá D.C.' },
  ],
}

export const IMPORT_CONFIGS: Record<string, EntityConfig> = {
  productos: PRODUCTOS_CONFIG,
  proveedores: PROVEEDORES_CONFIG,
  usuarios: USUARIOS_CONFIG,
  personas: PERSONAS_CONFIG,
  empresas_usuarias: EMPRESAS_USUARIAS_CONFIG,
  sedes: SEDES_CONFIG,
}


// ─── Normalización y validación compartidas ─────────────────────────────────

/** Quita tildes y diacriticos (para comparar encabezados y claves). */
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g')
export function sinTildes(v: string): string {
  return v.normalize('NFD').replace(DIACRITICOS, '')
}

export function normalizaClave(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

/**
 * Normaliza un encabezado del archivo para poder emparejarlo con una columna:
 * sin tildes, en minúsculas y con un solo guion bajo entre palabras.
 * Así "Precio Lista", "PRECIO-LISTA" y "precio_lista" son lo mismo.
 */
export function normalizaEncabezado(v: unknown): string {
  return sinTildes(String(v ?? ''))
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Devuelve la columna que corresponde a un encabezado (por clave, etiqueta o alias). */
export function columnaDeEncabezado(config: EntityConfig, encabezado: unknown): ColumnDef | null {
  const h = normalizaEncabezado(encabezado)
  if (!h) return null
  return config.columns.find((c) =>
    normalizaEncabezado(c.key) === h ||
    normalizaEncabezado(c.label) === h ||
    (c.alias ?? []).some((a) => normalizaEncabezado(a) === h)) ?? null
}

// ─── Lectura de valores ──────────────────────────────────────────────────────

/**
 * Lee un número escrito como lo escribe la gente en Colombia.
 *
 * Reglas (en es-CO el punto separa miles y la coma los decimales):
 *   "18.900"      → 18900     (un punto seguido de 3 dígitos = miles)
 *   "1.234.567"   → 1234567
 *   "$ 18.900,50" → 18900.5
 *   "18,5"        → 18.5      (la coma es decimal)
 *   "18.5"        → 18.5      (un punto que NO agrupa miles es decimal)
 *   "(1.500)"     → -1500     (paréntesis contables)
 *   "no aplica"   → null      (antes entraba como 0, en silencio)
 *
 * Devuelve null cuando el texto no es un número: el llamador lo reporta como
 * error en vez de guardar un valor inventado.
 */
export function aNumero(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'boolean' || raw instanceof Date) return null

  let s = String(raw ?? '').replace(/\s/g, '')
  if (!s) return null

  // Paréntesis contables y símbolos de moneda.
  const negativo = /^\(.*\)$/.test(s) || s.startsWith('-')
  s = s.replace(/^\(|\)$/g, '').replace(/^[+-]/, '')
  s = s.replace(/^(COP|\$|US\$)/i, '')
  if (!/^[\d.,]+$/.test(s)) return null

  const puntos = (s.match(/\./g) ?? []).length
  const comas = (s.match(/,/g) ?? []).length

  if (puntos > 0 && comas > 0) {
    // El separador decimal es el último que aparece; el otro agrupa miles.
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.'
    const miles = decimal === ',' ? '.' : ','
    s = s.split(miles).join('').replace(decimal, '.')
  } else if (comas > 1) {
    s = s.split(',').join('')                 // 1,234,567 → formato inglés
  } else if (comas === 1) {
    s = s.replace(',', '.')                   // decimal colombiano
  } else if (puntos > 1) {
    s = s.split('.').join('')                 // 1.234.567
  } else if (puntos === 1) {
    // Un solo punto: es separador de miles si agrupa exactamente 3 dígitos.
    const [ent, dec] = s.split('.')
    if (ent !== '' && dec.length === 3) s = ent + dec
  }

  if (!/^\d*\.?\d+$/.test(s)) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  return negativo ? -n : n
}

const MS_DIA = 86_400_000
/** Excel cuenta los días desde el 30/12/1899 (con el bug del año 1900 incluido). */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

const iso = (a: number, m: number, d: number): string | null => {
  const f = new Date(Date.UTC(a, m - 1, d))
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Lee una fecha en AAAA-MM-DD, DD/MM/AAAA, DD-MM-AAAA, un Date (lo que entrega
 * Excel) o un serial de Excel, y la devuelve como AAAA-MM-DD.
 * Devuelve null si no es una fecha real (31/02/2026, por ejemplo).
 */
export function aFecha(raw: unknown): string | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null
    return iso(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate())
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0 || raw > 60_000) return null
    const f = new Date(EXCEL_EPOCH + Math.round(raw) * MS_DIA)
    return iso(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate())
  }

  const s = String(raw ?? '').trim()
  if (!s) return null

  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s)
  if (m) return iso(+m[1], +m[2], +m[3])

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s)
  if (m) return iso(+m[3], +m[2], +m[1])

  // Fecha con hora (lo que sale al pegar desde otro sistema).
  m = /^(\d{4})-(\d{2})-(\d{2})[T ]/.exec(s)
  if (m) return iso(+m[1], +m[2], +m[3])

  return null
}

const AFIRMATIVOS = new Set(['si', 'sí', 'true', 'verdadero', '1', 'x', 'yes', 'y', 's', 'activo'])
const NEGATIVOS = new Set(['no', 'false', 'falso', '0', 'n', 'inactivo', '-'])

/** Lee un SI/NO del Excel. Devuelve null si el texto no se reconoce. */
export function aBooleano(raw: unknown): boolean | null {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0
  const s = sinTildes(normalizaClave(raw))
  if (!s) return null
  if (AFIRMATIVOS.has(s) || AFIRMATIVOS.has(normalizaClave(raw))) return true
  if (NEGATIVOS.has(s)) return false
  return null
}

/**
 * Versión tolerante de aBooleano: lo que no se reconozca cuenta como "no".
 * Se conserva para el código que solo necesita un booleano y no puede fallar.
 */
export function parseBool(v: unknown): boolean {
  return aBooleano(v) === true
}

// ─── Validación de filas ─────────────────────────────────────────────────────

export interface FilaParseada {
  _fila: number
  [key: string]: unknown
}

export type EstadoFila = 'nuevo' | 'actualizar' | 'error' | 'duplicado' | 'omitido'

export interface FilaValidada {
  fila: number
  /** Solo las columnas que traen valor: lo vacío NO se envía (no pisa lo que ya existe). */
  datos: Record<string, unknown>
  estado: EstadoFila
  errores: string[]
  /** Observaciones que no impiden cargar la fila. */
  avisos: string[]
  claveMostrada: string
}

const vacio = (v: unknown) => v === undefined || v === null || String(v).trim() === ''

/** Valida y clasifica una fila contra el conjunto de claves existentes. */
export function validarFila(
  config: EntityConfig,
  fila: FilaParseada,
  existentes: Set<string>,
): FilaValidada {
  const errores: string[] = []
  const avisos: string[] = []
  const datos: Record<string, unknown> = {}

  for (const col of config.columns) {
    const raw = fila[col.key]

    if (vacio(raw)) {
      if (col.required) errores.push(`Falta "${col.label}"`)
      // Las columnas vacías se omiten: al actualizar no se borra lo que ya hay.
      continue
    }

    switch (col.type) {
      case 'number': {
        const n = aNumero(raw)
        if (n === null) {
          errores.push(`"${col.label}" no es un número válido (${String(raw).trim()})`)
        } else if (col.entero && !Number.isInteger(n)) {
          errores.push(`"${col.label}" debe ser un número entero`)
        } else if (col.min !== undefined && n < col.min) {
          errores.push(`"${col.label}" no puede ser menor que ${col.min}`)
        } else if (col.max !== undefined && n > col.max) {
          errores.push(`"${col.label}" no puede ser mayor que ${col.max}`)
        } else {
          datos[col.key] = n
        }
        break
      }
      case 'enum': {
        const up = sinTildes(String(raw).trim().toUpperCase()).replace(/\s+/g, '_')
        if (!col.enumValues!.includes(up)) {
          errores.push(`"${col.label}" debe ser: ${col.enumValues!.join(' / ')}`)
        } else {
          datos[col.key] = up
        }
        break
      }
      case 'email': {
        const e = String(raw).trim()
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) errores.push(`"${col.label}" no es un email válido (${e})`)
        else datos[col.key] = e.toLowerCase()
        break
      }
      case 'fecha': {
        const f = aFecha(raw)
        if (f === null) {
          errores.push(`"${col.label}" no es una fecha válida (usa AAAA-MM-DD o DD/MM/AAAA)`)
        } else {
          datos[col.key] = f
        }
        break
      }
      case 'booleano': {
        const b = aBooleano(raw)
        if (b === null) errores.push(`"${col.label}" debe ser SI o NO`)
        else datos[col.key] = b
        break
      }
      default:
        datos[col.key] = String(raw).trim().replace(/\s+/g, ' ')
    }
  }

  // ¿Nuevo o actualizar? Por la primera matchKey con valor.
  let claveMostrada = ''
  let existe = false
  for (const mk of config.matchKeys) {
    const val = datos[mk]
    if (vacio(val)) continue
    if (!claveMostrada) claveMostrada = `${mk}=${val}`
    if (existentes.has(`${mk}:${normalizaClave(val)}`)) { existe = true; break }
  }

  if (!claveMostrada && errores.length === 0) {
    avisos.push('Sin clave para identificarla; se creará como nueva.')
  }

  const estado: EstadoFila = errores.length ? 'error' : existe ? 'actualizar' : 'nuevo'
  return { fila: fila._fila, datos, estado, errores, avisos, claveMostrada: claveMostrada || '—' }
}

/** Huella de la fila para detectar repetidos DENTRO del mismo archivo. */
function huella(config: EntityConfig, datos: Record<string, unknown>): string | null {
  for (const mk of config.matchKeys) {
    const val = datos[mk]
    if (!vacio(val)) return `${mk}:${normalizaClave(val)}`
  }
  return null
}

/** ¿La fila es la de ejemplo que trae la plantilla y que no se borró? */
function esFilaEjemplo(config: EntityConfig, fila: FilaParseada): boolean {
  const conValor = config.columns.filter((c) => !vacio(fila[c.key]))
  if (conValor.length < 2) return false
  return conValor.every((c) => normalizaClave(fila[c.key]) === normalizaClave(c.ejemplo))
}

export interface ResultadoValidacion {
  filas: FilaValidada[]
  resumen: Record<EstadoFila, number>
}

/**
 * Valida el archivo completo. Además de lo de cada fila, detecta:
 *  - filas repetidas dentro del propio archivo (se cargarían dos veces),
 *  - la fila de ejemplo de la plantilla, si se olvidó borrarla.
 */
export function validarLote(
  config: EntityConfig,
  filas: FilaParseada[],
  existentes: Set<string>,
): ResultadoValidacion {
  const vistas = new Map<string, number>()
  const validadas = filas.map((cruda) => {
    if (esFilaEjemplo(config, cruda)) {
      return {
        fila: cruda._fila, datos: {}, estado: 'omitido' as const, errores: [],
        avisos: ['Es la fila de ejemplo de la plantilla; no se carga.'],
        claveMostrada: '—',
      }
    }

    const v = validarFila(config, cruda, existentes)
    if (v.estado === 'error') return v

    const h = huella(config, v.datos)
    if (h) {
      const anterior = vistas.get(h)
      if (anterior !== undefined) {
        return {
          ...v,
          estado: 'duplicado' as const,
          avisos: [...v.avisos, `Repetida: la fila ${anterior} ya trae ${v.claveMostrada}.`],
        }
      }
      vistas.set(h, v.fila)
    }
    return v
  })

  const resumen: Record<EstadoFila, number> = {
    nuevo: 0, actualizar: 0, error: 0, duplicado: 0, omitido: 0,
  }
  for (const f of validadas) resumen[f.estado]++

  return { filas: validadas, resumen }
}
