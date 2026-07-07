// Catálogo de permisos disponibles en la aplicación.
// Es la lista de capacidades que un rol puede otorgar. Las CLAVES coinciden con
// las que se guardan en `roles.permisos` (JSONB) y en `usuarios.permisos`.
// El catálogo es estable (mapea a funciones de la app); lo dinámico es la
// ASIGNACIÓN de estos permisos a cada rol, que vive en la base de datos.

export interface PermisoDef {
  key: string
  label: string
}

export interface GrupoPermiso {
  grupo: string
  permisos: PermisoDef[]
}

export const GRUPOS_PERMISOS: GrupoPermiso[] = [
  {
    grupo: 'Inventario',
    permisos: [
      { key: 'ver_productos',       label: 'Ver productos' },
      { key: 'editar_productos',    label: 'Crear / editar productos' },
      { key: 'ver_stock',           label: 'Ver stock' },
      { key: 'ajustar_stock',       label: 'Ajustar stock' },
      { key: 'ver_movimientos',     label: 'Ver movimientos' },
      { key: 'crear_movimientos',   label: 'Registrar movimientos' },
      { key: 'ver_arqueo',          label: 'Ver arqueos' },
      { key: 'realizar_arqueo',     label: 'Realizar arqueo / conteo' },
      { key: 'ver_bodegas',         label: 'Ver bodegas y ubicaciones' },
      { key: 'gestionar_bodegas',   label: 'Gestionar bodegas y ubicaciones' },
      { key: 'usar_scanner',        label: 'Usar buscador / escáner' },
      { key: 'generar_codigos',     label: 'Generar códigos de barras' },
    ],
  },
  {
    grupo: 'Gestión',
    permisos: [
      { key: 'ver_aprovisionamiento',    label: 'Ver aprovisionamiento' },
      { key: 'editar_aprovisionamiento', label: 'Editar plan de compras' },
      { key: 'ver_contratos',            label: 'Ver contratos / sedes' },
      { key: 'editar_contratos',         label: 'Editar contratos / sedes' },
      { key: 'ver_proveedores',          label: 'Ver proveedores' },
      { key: 'editar_proveedores',       label: 'Editar proveedores' },
      { key: 'ver_ordenes_compra',       label: 'Ver órdenes de compra' },
      { key: 'crear_ordenes_compra',     label: 'Crear / aprobar OC' },
      { key: 'ver_reportes',             label: 'Ver reportes' },
      { key: 'exportar_datos',           label: 'Exportar datos a Excel' },
    ],
  },
  {
    grupo: 'Administración',
    permisos: [
      { key: 'ver_documentos',       label: 'Ver documentos / galería' },
      { key: 'subir_documentos',     label: 'Subir / eliminar documentos' },
      { key: 'ver_usuarios',         label: 'Ver usuarios' },
      { key: 'gestionar_usuarios',   label: 'Crear / editar usuarios' },
      { key: 'gestionar_roles',      label: 'Gestionar roles y permisos' },
      { key: 'importar_datos',       label: 'Cargas masivas (importar)' },
      { key: 'ver_actividad_log',    label: 'Ver log de actividad' },
      { key: 'ver_historial',        label: 'Ver historial de cambios' },
      { key: 'ver_notificaciones',   label: 'Ver notificaciones / alertas' },
      { key: 'gestionar_alertas',    label: 'Configurar reglas de alerta' },
      { key: 'ver_configuracion',    label: 'Ver configuración' },
      { key: 'editar_configuracion', label: 'Editar configuración' },
    ],
  },
  {
    grupo: 'Gestión Humana',
    permisos: [
      { key: 'ver_personas',              label: 'Ver personas / colaboradores' },
      { key: 'gestionar_personas',        label: 'Crear / editar personas' },
      { key: 'importar_personas',         label: 'Cargue masivo de personas' },
      { key: 'ver_empresas_usuarias',     label: 'Ver empresas usuarias' },
      { key: 'gestionar_empresas_usuarias', label: 'Gestionar empresas usuarias' },
      { key: 'ver_documentos_rrhh',       label: 'Ver documentos de personas' },
      { key: 'gestionar_documentos_rrhh', label: 'Subir / eliminar documentos' },
      { key: 'gestionar_tipos_documentales', label: 'Gestionar árbol de tipos documentales' },
    ],
  },
  {
    grupo: 'Inteligencia Artificial',
    permisos: [
      { key: 'usar_ia_vision',    label: 'Usar visión IA' },
      { key: 'usar_ia_asistente', label: 'Usar asistente IA' },
      { key: 'ver_ia_analisis',   label: 'Ver análisis IA' },
    ],
  },
]

export const ALL_PERMISOS: PermisoDef[] = GRUPOS_PERMISOS.flatMap((g) => g.permisos)

export const TOTAL_PERMISOS = ALL_PERMISOS.length

export function emptyPermisos(): Record<string, boolean> {
  return Object.fromEntries(ALL_PERMISOS.map((p) => [p.key, false]))
}

export function countActivos(permisos: Record<string, boolean> | null | undefined): number {
  if (!permisos) return 0
  return Object.values(permisos).filter(Boolean).length
}

/** Devuelve la etiqueta legible de una clave de permiso. */
export function labelPermiso(key: string): string {
  return ALL_PERMISOS.find((p) => p.key === key)?.label ?? key
}

// ── Colores de badge por rol (estables por nombre, con fallback determinista) ──
const COLORES_BADGE = [
  'bg-red-100 text-red-700',
  'bg-orange-100 text-orange-700',
  'bg-blue-100 text-blue-700',
  'bg-purple-100 text-purple-700',
  'bg-green-100 text-green-700',
  'bg-teal-100 text-teal-700',
  'bg-amber-100 text-amber-700',
  'bg-pink-100 text-pink-700',
]

/** Color determinista para el badge de un rol, basado en su nombre. */
export function colorRol(nombre: string): string {
  let h = 0
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0
  return COLORES_BADGE[h % COLORES_BADGE.length]
}
