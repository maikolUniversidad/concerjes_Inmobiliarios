export type CategoriaRotacion = 'A' | 'B' | 'C' | 'D'
export type TipoInsumo =
  | 'CAFETERIA' | 'LIQUIDOS' | 'ASEO' | 'EPP' | 'PAPELERIA'
  | 'MAQUINARIA' | 'JARDINERIA' | 'REPUESTOS' | 'NO_DISPONIBLE' | 'OTROS'
export type GrupoContrato = 'CA' | 'MO' | 'MB' | 'PB' | 'AD'
export type TipoMovimiento = 'ENTRADA' | 'SALIDA' | 'TRASLADO' | 'AJUSTE' | 'DEVOLUCION'
export type EstadoOC = 'BORRADOR' | 'ENVIADA' | 'PARCIAL' | 'COMPLETA' | 'ANULADA'
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

export type Database = {
  public: {
    Tables: {
      productos: { Row: Producto; Insert: Partial<Producto>; Update: Partial<Producto> }
      stock: { Row: Stock; Insert: Partial<Stock>; Update: Partial<Stock> }
      proveedores: { Row: Proveedor; Insert: Partial<Proveedor>; Update: Partial<Proveedor> }
      grupos_contrato: { Row: GrupoContratoRow; Insert: Partial<GrupoContratoRow>; Update: Partial<GrupoContratoRow> }
      sedes: { Row: Sede; Insert: Partial<Sede>; Update: Partial<Sede> }
      pedidos_sede: { Row: PedidoSede; Insert: Partial<PedidoSede>; Update: Partial<PedidoSede> }
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
