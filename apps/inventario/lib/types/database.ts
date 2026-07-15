export type CategoriaRotacion = 'A' | 'B' | 'C' | 'D'
export type TipoInsumo =
  | 'CAFETERIA' | 'LIQUIDOS' | 'ASEO' | 'EPP' | 'PAPELERIA'
  | 'MAQUINARIA' | 'JARDINERIA' | 'REPUESTOS' | 'NO_DISPONIBLE' | 'OTROS'
export type GrupoContrato = 'CA' | 'MO' | 'MB' | 'PB' | 'AD'
export type TipoMovimiento = 'ENTRADA' | 'SALIDA' | 'TRASLADO' | 'AJUSTE' | 'DEVOLUCION'
export type EstadoOC = 'BORRADOR' | 'APROBADA' | 'ENVIADA' | 'PARCIAL' | 'COMPLETA' | 'ANULADA'
export type RolUsuario =
  | 'SUPER_ADMIN' | 'ADMIN' | 'SUPERVISOR' | 'COORDINADOR_COMPRAS'
  | 'BODEGUERO' | 'AUDITOR' | 'OPERADOR_SEDE'

export interface Producto {
  id: string
  ref: number | null
  codigo: number | null
  nombre_estandar: string
  presentacion: string | null
  complemento: string | null
  tipo_insumo: TipoInsumo
  cat_rotacion: CategoriaRotacion
  stock_minimo_asig: number
  stock_minimo_def: number
  stock_min_suger: number
  ind_rot_general: number | null
  ind_rot_mes: number | null
  proveedor_id: string | null
  precio_lista: number | null
  proveedor2_id: string | null
  precio_lista2: number | null
  imagen_url: string | null
  codigo_barras: string | null
  codigo_barras_formato: string | null
  codigo_barras_origen: string | null
  sku: string | null
  ubicacion_bodega: string | null
  bodega_descripcion: string | null
  ubicacion_id: string | null
  activo: boolean
  created_at: string
  updated_at: string
  // relations
  proveedor?: Proveedor
  proveedor2?: Proveedor
  stock?: Stock
}

export interface Stock {
  id: string
  producto_id: string
  cantidad_real: number
  cantidad_disp: number
  cantidad_entr: number
  cantidad_sal: number
  updated_at: string
  producto?: Producto
}

export interface Proveedor {
  id: string
  nombre: string
  nit: string | null
  contacto: string | null
  telefono: string | null
  email: string | null
  logo_url: string | null
  es_principal: boolean
  activo: boolean
  created_at: string
}

export interface GrupoContratoRow {
  id: string
  codigo: GrupoContrato
  nombre: string
  descripcion: string | null
  supervisor_id: string | null
  activo: boolean
}

export interface Sede {
  id: string
  grupo_id: string
  codigo_interno: string | null
  nombre: string
  zona: string | null
  ciudad: string
  col_excel: number | null
  responsable_id: string | null
  activo: boolean
  created_at: string
  grupo?: GrupoContratoRow
}

export interface PedidoSede {
  id: string
  sede_id: string
  producto_id: string
  periodo: string
  cantidad: number
  observacion: string | null
  creado_por: string | null
  created_at: string
  sede?: Sede
  producto?: Producto
}

export interface Rotacion {
  id: string
  producto_id: string
  grupo_id: string
  periodo: string
  consumo: number
  pendiente: number
  producto?: Producto
  grupo?: GrupoContratoRow
}

export interface Aprovisionamiento {
  id: string
  producto_id: string
  periodo: string
  stock_al_inicio: number | null
  pedido_calculado: number | null
  pedido_ajustado: number | null
  control_agotados: number
  sugerido_compra: number | null
  proveedor_sug_id: string | null
  precio_sugerido: number | null
  oc_pendiente: number
  adicional: number
  total_compras: number | null
  total_entradas: number | null
  saldo_insumos: number | null
  aprobado_por: string | null
  created_at: string
  updated_at: string
  producto?: Producto
  proveedor_sug?: Proveedor
}

export interface OrdenCompra {
  id: string
  numero_oc: string
  proveedor_id: string
  periodo: string
  fecha_emision: string
  fecha_entrega: string | null
  estado: EstadoOC
  valor_total: number | null
  observaciones: string | null
  creado_por: string
  aprobado_por: string | null
  created_at: string
  updated_at: string
  proveedor?: Proveedor
  items?: OCItem[]
}

export interface OCItem {
  id: string
  oc_id: string
  producto_id: string
  cantidad_ped: number
  cantidad_rec: number
  precio_unit: number
  subtotal: number
  producto?: Producto
}

export interface Movimiento {
  id: string
  tipo: TipoMovimiento
  producto_id: string
  cantidad: number
  sede_id: string | null
  oc_id: string | null
  periodo: string | null
  observacion: string | null
  usuario_id: string
  ia_origen: boolean
  created_at: string
  producto?: Producto
  sede?: Sede
}

export interface Usuario {
  id: string
  nombre: string
  email: string
  rol: RolUsuario
  grupo_id: string | null
  sede_id: string | null
  activo: boolean
  ultimo_acceso: string | null
  created_at: string
  grupo?: GrupoContratoRow
  sede?: Sede
}

export interface SedeProducto {
  id: string
  sede_id: string
  producto_id: string
  cantidad_maxima: number
  cantidad_minima: number | null
  activo: boolean
  observacion: string | null
  contrato_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // relations
  producto?: Producto
  sede?: Sede
}

export type EstadoOrdenInsumo =
  // Flujo de aprobación (coordinador de sede ⇄ central)
  | 'BORRADOR' | 'EN_REVISION' | 'CAMBIOS_SOLICITADOS' | 'APROBADA'
  // Bodega
  | 'PENDIENTE' | 'EN_ALISTAMIENTO' | 'ALISTADO' | 'DESPACHADO' | 'ANULADA'

export interface OrdenInsumo {
  id: string
  numero: string
  sede_id: string
  bodega_id: string | null
  estado: EstadoOrdenInsumo
  periodo: string | null
  observacion: string | null
  contrato_id: string | null
  creado_por: string | null
  alistamiento_iniciado_at: string | null
  alistado_at: string | null
  despachado_por: string | null
  despachado_at: string | null
  video_path: string | null
  video_mime: string | null
  created_at: string
  updated_at: string
  sede?: Sede
}

export interface OrdenInsumoItem {
  id: string
  orden_id: string
  producto_id: string
  cantidad_solicitada: number
  cantidad_maxima_ref: number | null
  cantidad_alistada: number
  alistado: boolean
  alistado_por: string | null
  alistado_at: string | null
  created_at: string
  producto?: Producto
}

export interface OrdenInsumoResponsable {
  id: string
  orden_id: string
  usuario_id: string
  created_at: string
}

export interface PrecioProveedor {
  id: string
  producto_id: string
  proveedor_id: string
  precio: number | null
  porcentaje_vs_conserjes: number | null
  vigente: boolean
  fecha_cotiz: string | null
  proveedor?: Proveedor
}

export interface ContactoWeb {
  id: string
  nombre: string
  empresa: string | null
  telefono: string
  email: string
  servicio: string | null
  mensaje: string
  leido: boolean
  created_at: string
}

// Permisos por rol
export const PERMISOS: Record<RolUsuario, string[]> = {
  SUPER_ADMIN: ['*'],
  ADMIN: [
    'productos.read', 'productos.write',
    'stock.read', 'stock.write',
    'movimientos.read', 'movimientos.write',
    'sedes.read', 'sedes.write',
    'pedidos.read', 'pedidos.write',
    'aprovisionamiento.read', 'aprovisionamiento.write',
    'oc.read', 'oc.write', 'oc.approve',
    'reportes.read',
    'usuarios.read', 'usuarios.write',
    'ia.read',
  ],
  SUPERVISOR: [
    'productos.read',
    'stock.read',
    'movimientos.read',
    'sedes.read',
    'pedidos.read', 'pedidos.write',
    'rotacion.read',
    'aprovisionamiento.read',
    'oc.read',
    'reportes.read',
    'ia.read',
  ],
  COORDINADOR_COMPRAS: [
    'productos.read',
    'stock.read',
    'proveedores.read', 'proveedores.write',
    'precios.read', 'precios.write',
    'aprovisionamiento.read', 'aprovisionamiento.write',
    'oc.read', 'oc.write',
    'reportes.read',
  ],
  BODEGUERO: [
    'productos.read',
    'stock.read', 'stock.write',
    'movimientos.read', 'movimientos.write',
    'scanner.use',
  ],
  AUDITOR: [
    'productos.read',
    'stock.read',
    'movimientos.read',
    'sedes.read',
    'pedidos.read',
    'rotacion.read',
    'aprovisionamiento.read',
    'oc.read',
    'reportes.read',
  ],
  OPERADOR_SEDE: [
    'productos.read',
    'pedidos.read', 'pedidos.write',
  ],
}

export function tienePermiso(rol: RolUsuario, permiso: string): boolean {
  const perms = PERMISOS[rol]
  return perms.includes('*') || perms.includes(permiso)
}

// Labels y colores para la UI
export const CATEGORIA_LABELS: Record<CategoriaRotacion, { label: string; color: string; bg: string }> = {
  A: { label: 'Alta rotación', color: 'text-green-700', bg: 'bg-green-100' },
  B: { label: 'Media rotación', color: 'text-blue-700', bg: 'bg-blue-100' },
  C: { label: 'Baja rotación', color: 'text-amber-700', bg: 'bg-amber-100' },
  D: { label: 'No disponible', color: 'text-red-700', bg: 'bg-red-100' },
}

export const GRUPO_LABELS: Record<GrupoContrato, { nombre: string; color: string }> = {
  CA: { nombre: 'C.A.', color: 'bg-blue-100 text-blue-800' },
  MO: { nombre: 'M.O.', color: 'bg-purple-100 text-purple-800' },
  MB: { nombre: 'M.B.', color: 'bg-green-100 text-green-800' },
  PB: { nombre: 'P.B.', color: 'bg-orange-100 text-orange-800' },
  AD: { nombre: 'A.D.', color: 'bg-gray-100 text-gray-800' },
}

export const ROL_LABELS: Record<RolUsuario, { label: string; color: string }> = {
  SUPER_ADMIN: { label: 'Super Admin', color: 'bg-red-100 text-red-800' },
  ADMIN: { label: 'Administrador', color: 'bg-purple-100 text-purple-800' },
  SUPERVISOR: { label: 'Supervisor', color: 'bg-blue-100 text-blue-800' },
  COORDINADOR_COMPRAS: { label: 'Coord. Compras', color: 'bg-amber-100 text-amber-800' },
  BODEGUERO: { label: 'Bodeguero', color: 'bg-green-100 text-green-800' },
  AUDITOR: { label: 'Auditor', color: 'bg-gray-100 text-gray-800' },
  OPERADOR_SEDE: { label: 'Operador Sede', color: 'bg-teal-100 text-teal-800' },
}

// ── Asistente IA: chat con historial y carpetas ──────────────────────────────
export type RolMensajeIA = 'user' | 'assistant' | 'system'

export interface IACarpeta {
  id: string
  user_id: string
  nombre: string
  color: string
  orden: number
  created_at: string
}

export interface IAConversacion {
  id: string
  user_id: string
  carpeta_id: string | null
  titulo: string
  modelo: string
  fijada: boolean
  created_at: string
  updated_at: string
}

export interface IAMensaje {
  id: string
  conversacion_id: string
  user_id: string
  role: RolMensajeIA
  content: string
  metadata: Record<string, unknown> | null
  created_at: string
}

// ── Notificaciones y Alertas ──────────────────────────────────────────────────
export type TipoNotificacion =
  | 'STOCK_BAJO' | 'STOCK_AGOTADO' | 'OC_CREADA' | 'OC_RECIBIDA' | 'OC_POR_VENCER'
  | 'MOVIMIENTO' | 'CONTACTO_WEB' | 'USUARIO_NUEVO' | 'SISTEMA'
export type SeveridadNotificacion = 'INFO' | 'EXITO' | 'ADVERTENCIA' | 'CRITICA'
export type EstadoNotificacion = 'NO_LEIDA' | 'LEIDA' | 'ARCHIVADA'

/** Regla parametrizable: define qué alerta existe y cómo se comporta. */
export interface ReglaAlerta {
  id: string
  codigo: TipoNotificacion
  nombre: string
  descripcion: string | null
  severidad: SeveridadNotificacion
  activa: boolean
  canal_app: boolean
  canal_email: boolean
  roles_destino: RolUsuario[]
  umbral: Record<string, unknown>
  es_sistema: boolean
  created_at: string
  updated_at: string
}

/** Instancia entregada a un usuario (bandeja). */
export interface Notificacion {
  id: string
  usuario_id: string
  tipo: TipoNotificacion
  severidad: SeveridadNotificacion
  titulo: string
  descripcion: string | null
  entidad: string | null
  entidad_id: string | null
  enlace: string | null
  metadata: Record<string, unknown> | null
  estado: EstadoNotificacion
  leido_at: string | null
  regla_codigo: TipoNotificacion | null
  created_at: string
}

export interface NotificacionPreferencias {
  usuario_id: string
  tipos_silenciados: TipoNotificacion[]
  email_activo: boolean
  updated_at: string
}

export const TIPO_NOTIFICACION_LABELS: Record<TipoNotificacion, { label: string; icon: string }> = {
  STOCK_BAJO:    { label: 'Stock bajo',                 icon: 'PackageMinus' },
  STOCK_AGOTADO: { label: 'Stock agotado',              icon: 'PackageX' },
  OC_CREADA:     { label: 'Orden de compra creada',     icon: 'FileText' },
  OC_RECIBIDA:   { label: 'Orden de compra recibida',   icon: 'PackageCheck' },
  OC_POR_VENCER: { label: 'Orden de compra por vencer', icon: 'CalendarClock' },
  MOVIMIENTO:    { label: 'Movimiento de inventario',   icon: 'ArrowLeftRight' },
  CONTACTO_WEB:  { label: 'Nuevo contacto web',         icon: 'Mail' },
  USUARIO_NUEVO: { label: 'Nuevo usuario',              icon: 'UserPlus' },
  SISTEMA:       { label: 'Mensaje del sistema',        icon: 'Megaphone' },
}

export const SEVERIDAD_LABELS: Record<SeveridadNotificacion, { label: string; color: string; bg: string; dot: string }> = {
  INFO:        { label: 'Información',  color: 'text-blue-700',  bg: 'bg-blue-50 border-blue-100',   dot: 'bg-blue-500' },
  EXITO:       { label: 'Éxito',       color: 'text-green-700', bg: 'bg-green-50 border-green-100', dot: 'bg-green-500' },
  ADVERTENCIA: { label: 'Advertencia', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-100', dot: 'bg-amber-500' },
  CRITICA:     { label: 'Crítica',     color: 'text-red-700',   bg: 'bg-red-50 border-red-100',     dot: 'bg-red-500' },
}

// ── Gestión Humana ───────────────────────────────────────────────────────────
export type EstadoPersona = 'ACTIVO' | 'RETIRADO' | 'SUSPENDIDO'
export type TipoDocumento = 'CC' | 'CE' | 'TI' | 'PA' | 'PEP' | 'NIT'

export interface EmpresaUsuaria {
  id: string
  nombre: string
  nit: string | null
  ciudad: string | null
  contacto: string | null
  telefono: string | null
  email: string | null
  activo: boolean
  created_at: string
  updated_at: string
}

export interface Persona {
  id: string
  tipo_doc: TipoDocumento
  documento: string
  nombres: string
  apellidos: string
  cargo: string | null
  empresa_usuaria_id: string | null
  sede_id: string | null
  fecha_ingreso: string | null
  estado: EstadoPersona
  email: string | null
  telefono: string | null
  direccion: string | null
  eps: string | null
  arl: string | null
  usuario_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  empresas_usuarias?: { id: string; nombre: string } | null
  sedes?: { id: string; nombre: string } | null
}

export interface TipoDocumental {
  id: string
  parent_id: string | null
  nombre: string
  descripcion: string | null
  orden: number
  created_at: string
}

export interface DocumentoPersona {
  id: string
  persona_id: string
  tipo_documental_id: string | null
  nombre_archivo: string
  archivo_path: string
  mime: string | null
  tamano: number | null
  subido_por: string | null
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      empresas_usuarias: { Row: EmpresaUsuaria; Insert: Partial<EmpresaUsuaria>; Update: Partial<EmpresaUsuaria> }
      personas: { Row: Persona; Insert: Partial<Persona>; Update: Partial<Persona> }
      tipos_documentales: { Row: TipoDocumental; Insert: Partial<TipoDocumental>; Update: Partial<TipoDocumental> }
      documentos_persona: { Row: DocumentoPersona; Insert: Partial<DocumentoPersona>; Update: Partial<DocumentoPersona> }
      reglas_alerta: { Row: ReglaAlerta; Insert: Partial<ReglaAlerta>; Update: Partial<ReglaAlerta> }
      notificaciones: { Row: Notificacion; Insert: Partial<Notificacion>; Update: Partial<Notificacion> }
      notificaciones_preferencias: { Row: NotificacionPreferencias; Insert: Partial<NotificacionPreferencias>; Update: Partial<NotificacionPreferencias> }
      ia_carpetas: { Row: IACarpeta; Insert: Partial<IACarpeta>; Update: Partial<IACarpeta> }
      ia_conversaciones: { Row: IAConversacion; Insert: Partial<IAConversacion>; Update: Partial<IAConversacion> }
      ia_mensajes: { Row: IAMensaje; Insert: Partial<IAMensaje>; Update: Partial<IAMensaje> }
      productos: { Row: Producto; Insert: Partial<Producto>; Update: Partial<Producto> }
      stock: { Row: Stock; Insert: Partial<Stock>; Update: Partial<Stock> }
      proveedores: { Row: Proveedor; Insert: Partial<Proveedor>; Update: Partial<Proveedor> }
      grupos_contrato: { Row: GrupoContratoRow; Insert: Partial<GrupoContratoRow>; Update: Partial<GrupoContratoRow> }
      sedes: { Row: Sede; Insert: Partial<Sede>; Update: Partial<Sede> }
      pedidos_sede: { Row: PedidoSede; Insert: Partial<PedidoSede>; Update: Partial<PedidoSede> }
      sede_productos: { Row: SedeProducto; Insert: Partial<SedeProducto>; Update: Partial<SedeProducto> }
      ordenes_insumo: { Row: OrdenInsumo; Insert: Partial<OrdenInsumo>; Update: Partial<OrdenInsumo> }
      orden_insumo_items: { Row: OrdenInsumoItem; Insert: Partial<OrdenInsumoItem>; Update: Partial<OrdenInsumoItem> }
      orden_insumo_responsables: { Row: OrdenInsumoResponsable; Insert: Partial<OrdenInsumoResponsable>; Update: Partial<OrdenInsumoResponsable> }
      rotacion: { Row: Rotacion; Insert: Partial<Rotacion>; Update: Partial<Rotacion> }
      aprovisionamiento: { Row: Aprovisionamiento; Insert: Partial<Aprovisionamiento>; Update: Partial<Aprovisionamiento> }
      ordenes_compra: { Row: OrdenCompra; Insert: Partial<OrdenCompra>; Update: Partial<OrdenCompra> }
      oc_items: { Row: OCItem; Insert: Partial<OCItem>; Update: Partial<OCItem> }
      movimientos: { Row: Movimiento; Insert: Partial<Movimiento>; Update: Partial<Movimiento> }
      usuarios: { Row: Usuario; Insert: Partial<Usuario>; Update: Partial<Usuario> }
      precios_proveedor: { Row: PrecioProveedor; Insert: Partial<PrecioProveedor>; Update: Partial<PrecioProveedor> }
      contactos_web: { Row: ContactoWeb; Insert: Partial<ContactoWeb>; Update: Partial<ContactoWeb> }
    }
  }
}
