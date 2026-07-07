// Configuración declarativa de las cargas masivas por entidad.
// Usada por la plantilla, el parser, el preview y la server action de upsert.

export type ColType = 'text' | 'number' | 'enum' | 'email'

export interface ColumnDef {
  key: string
  label: string
  type: ColType
  required?: boolean
  enumValues?: readonly string[]
  ejemplo: string | number
  ayuda?: string
}

export interface EntityConfig {
  id: 'productos' | 'proveedores' | 'usuarios' | 'personas'
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
    'Los valores numéricos no llevan separador de miles ni símbolo de moneda.',
  ],
  columns: [
    { key: 'ref', label: 'ref', type: 'number', ejemplo: 1001, ayuda: 'Número REF del Excel maestro (opcional pero recomendado)' },
    { key: 'codigo', label: 'codigo', type: 'number', ejemplo: 1001, ayuda: 'Código correlativo (opcional)' },
    { key: 'nombre_estandar', label: 'nombre_estandar', type: 'text', required: true, ejemplo: 'JABON PARA LOZA LIQUIDO', ayuda: 'Nombre estándar del producto (obligatorio)' },
    { key: 'presentacion', label: 'presentacion', type: 'text', ejemplo: 'GALON', ayuda: 'Presentación / unidad' },
    { key: 'tipo_insumo', label: 'tipo_insumo', type: 'enum', enumValues: TIPO_INSUMO, ejemplo: 'ASEO' },
    { key: 'cat_rotacion', label: 'cat_rotacion', type: 'enum', enumValues: CAT_ROT, ejemplo: 'A' },
    { key: 'stock_minimo_def', label: 'stock_minimo_def', type: 'number', ejemplo: 50, ayuda: 'Stock mínimo definido' },
    { key: 'precio_lista', label: 'precio_lista', type: 'number', ejemplo: 18900, ayuda: 'Precio de lista en COP' },
    { key: 'stock_inicial', label: 'stock_inicial', type: 'number', ejemplo: 120, ayuda: 'Solo para productos nuevos' },
    { key: 'complemento', label: 'complemento', type: 'text', ejemplo: 'Aroma limón', ayuda: 'Notas / detalles (opcional)' },
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
    { key: 'nombre', label: 'nombre', type: 'text', required: true, ejemplo: 'DETALGRAF S.A.S', ayuda: 'Nombre del proveedor (obligatorio)' },
    { key: 'nit', label: 'nit', type: 'text', ejemplo: '900123456-7', ayuda: 'NIT (recomendado para no duplicar)' },
    { key: 'contacto', label: 'contacto', type: 'text', ejemplo: 'Juan Pérez' },
    { key: 'telefono', label: 'telefono', type: 'text', ejemplo: '3201234567' },
    { key: 'email', label: 'email', type: 'email', ejemplo: 'ventas@detalgraf.com' },
    { key: 'es_principal', label: 'es_principal', type: 'text', ejemplo: 'NO', ayuda: 'SI / NO' },
  ],
}

export const USUARIOS_CONFIG: EntityConfig = {
  id: 'usuarios',
  label: 'Usuarios',
  matchKeys: ['email'],
  matchLabel: 'email',
  instrucciones: [
    'Completa una fila por usuario. No borres la fila de encabezados.',
    'Si el email ya existe, se ACTUALIZAN sus datos (nombre, rol, teléfono, estado).',
    'Si el email es nuevo, se CREA el registro de usuario en el directorio.',
    'rol debe ser uno de: ' + ROLES.join(', ') + '.',
    'activo admite SI / NO.',
  ],
  columns: [
    { key: 'nombre', label: 'nombre', type: 'text', required: true, ejemplo: 'Andrea López', ayuda: 'Nombre completo (obligatorio)' },
    { key: 'email', label: 'email', type: 'email', required: true, ejemplo: 'a.lopez@conserjesinmobiliarios.com', ayuda: 'Email (obligatorio, clave única)' },
    { key: 'rol', label: 'rol', type: 'enum', enumValues: ROLES, ejemplo: 'AUDITOR' },
    { key: 'telefono', label: 'telefono', type: 'text', ejemplo: '3001234567' },
    { key: 'activo', label: 'activo', type: 'text', ejemplo: 'SI', ayuda: 'SI / NO' },
  ],
}

export const PERSONAS_CONFIG: EntityConfig = {
  id: 'personas',
  label: 'Personas',
  matchKeys: ['documento'],
  matchLabel: 'número de documento',
  instrucciones: [
    'Completa una fila por persona. No borres ni renombres la fila de encabezados.',
    'Si el "documento" ya existe, la persona se ACTUALIZA; si no, se CREA.',
    'tipo_doc debe ser uno de: ' + TIPO_DOC.join(', ') + '.',
    'estado debe ser: ' + ESTADO_PERSONA.join(', ') + '.',
    'empresa_usuaria: escribe el nombre. Si no existe, se crea automáticamente.',
    'sede: escribe el nombre exacto de una sede existente (opcional).',
    'fecha_ingreso admite formato AAAA-MM-DD o DD/MM/AAAA.',
  ],
  columns: [
    { key: 'tipo_doc', label: 'tipo_doc', type: 'enum', enumValues: TIPO_DOC, ejemplo: 'CC' },
    { key: 'documento', label: 'documento', type: 'text', required: true, ejemplo: '1020304050', ayuda: 'Número de documento (obligatorio, clave única)' },
    { key: 'nombres', label: 'nombres', type: 'text', required: true, ejemplo: 'María Fernanda', ayuda: 'Nombres (obligatorio)' },
    { key: 'apellidos', label: 'apellidos', type: 'text', required: true, ejemplo: 'Gómez Ruiz', ayuda: 'Apellidos (obligatorio)' },
    { key: 'cargo', label: 'cargo', type: 'text', ejemplo: 'Servicios Generales' },
    { key: 'empresa_usuaria', label: 'empresa_usuaria', type: 'text', ejemplo: 'Transmilenio S.A.', ayuda: 'Nombre de la empresa usuaria' },
    { key: 'sede', label: 'sede', type: 'text', ejemplo: 'Sede Norte', ayuda: 'Nombre exacto de una sede existente' },
    { key: 'fecha_ingreso', label: 'fecha_ingreso', type: 'text', ejemplo: '2026-01-15', ayuda: 'AAAA-MM-DD o DD/MM/AAAA' },
    { key: 'estado', label: 'estado', type: 'enum', enumValues: ESTADO_PERSONA, ejemplo: 'ACTIVO' },
    { key: 'email', label: 'email', type: 'email', ejemplo: 'mgomez@correo.com' },
    { key: 'telefono', label: 'telefono', type: 'text', ejemplo: '3001234567' },
    { key: 'direccion', label: 'direccion', type: 'text', ejemplo: 'Cra 10 # 20-30' },
    { key: 'eps', label: 'eps', type: 'text', ejemplo: 'Sura EPS' },
    { key: 'arl', label: 'arl', type: 'text', ejemplo: 'ARL Sura' },
  ],
}

export const IMPORT_CONFIGS: Record<string, EntityConfig> = {
  productos: PRODUCTOS_CONFIG,
  proveedores: PROVEEDORES_CONFIG,
  usuarios: USUARIOS_CONFIG,
  personas: PERSONAS_CONFIG,
}

// ─── Normalización y validación compartidas ─────────────────────────────────

export function normalizaClave(v: unknown): string {
  return String(v ?? '').trim().toLowerCase()
}

export interface FilaParseada {
  _fila: number
  [key: string]: unknown
}

export interface FilaValidada {
  fila: number
  datos: Record<string, unknown>
  estado: 'nuevo' | 'actualizar' | 'error'
  errores: string[]
  claveMostrada: string
}

export function parseBool(v: unknown): boolean {
  const s = normalizaClave(v)
  return s === 'si' || s === 'sí' || s === 'true' || s === '1' || s === 'x' || s === 'yes'
}

/** Valida y clasifica una fila contra el conjunto de claves existentes. */
export function validarFila(
  config: EntityConfig,
  fila: FilaParseada,
  existentes: Set<string>,
): FilaValidada {
  const errores: string[] = []
  const datos: Record<string, unknown> = {}

  for (const col of config.columns) {
    const raw = fila[col.key]
    const vacio = raw === undefined || raw === null || String(raw).trim() === ''

    if (col.required && vacio) {
      errores.push(`Falta "${col.label}"`)
      continue
    }
    if (vacio) { datos[col.key] = null; continue }

    if (col.type === 'number') {
      const n = Number(String(raw).replace(/[^0-9.-]/g, ''))
      if (!Number.isFinite(n)) errores.push(`"${col.label}" no es un número válido`)
      else datos[col.key] = n
    } else if (col.type === 'enum') {
      const up = String(raw).trim().toUpperCase()
      if (!col.enumValues!.includes(up)) errores.push(`"${col.label}" debe ser: ${col.enumValues!.join('/')}`)
      else datos[col.key] = up
    } else if (col.type === 'email') {
      const e = String(raw).trim()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) errores.push(`"${col.label}" no es un email válido`)
      else datos[col.key] = e.toLowerCase()
    } else {
      datos[col.key] = String(raw).trim()
    }
  }

  // ¿Nuevo o actualizar? Por la primera matchKey con valor.
  let claveMostrada = ''
  let existe = false
  for (const mk of config.matchKeys) {
    const val = datos[mk]
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      if (!claveMostrada) claveMostrada = `${mk}=${val}`
      if (existentes.has(`${mk}:${normalizaClave(val)}`)) { existe = true; break }
    }
  }

  const estado: FilaValidada['estado'] = errores.length ? 'error' : existe ? 'actualizar' : 'nuevo'
  return { fila: fila._fila, datos, estado, errores, claveMostrada: claveMostrada || '—' }
}
