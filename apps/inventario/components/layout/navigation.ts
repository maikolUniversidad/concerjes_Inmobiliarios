import {
  LayoutDashboard, Package, BarChart3, ArrowLeftRight,
  FileText, Warehouse, Truck, Users,
  Settings, Brain, FolderOpen, ClipboardList, Bell, Shield,
  UploadCloud, History, ClipboardCheck, Barcode, PackageCheck,
  Briefcase, Contact, FolderTree, Scale, IdCard, SlidersHorizontal, Plug, type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  /** Permiso requerido para ver el ítem. Sin permiso = siempre visible. */
  permiso?: string
}

export interface NavModule {
  /** Identificador estable del módulo */
  id: string
  /** Título visible del módulo */
  title: string
  /** Icono representativo del módulo (usado en la barra inferior móvil) */
  icon: LucideIcon
  /** Submódulos del módulo */
  items: NavItem[]
}

/**
 * Estructura única de navegación.
 * La usan tanto el Sidebar (desktop) como el MobileNav (barra inferior móvil).
 */
export const navigation: NavModule[] = [
  {
    id: 'principal',
    title: 'Principal',
    icon: LayoutDashboard,
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    ],
  },
  {
    id: 'carnet',
    title: 'Carnet',
    icon: IdCard,
    // Sin permiso: todo colaborador puede ver su propio carnet.
    items: [
      { label: 'Mi Carnet Digital', href: '/carnet', icon: IdCard },
    ],
  },
  {
    id: 'inventario',
    title: 'Inventario',
    icon: Package,
    items: [
      { label: 'Productos',          href: '/productos', icon: Package, permiso: 'ver_productos' },
      { label: 'Stock',              href: '/stock',     icon: BarChart3, permiso: 'ver_stock' },
      { label: 'Movimientos',        href: '/movimientos', icon: ArrowLeftRight, permiso: 'ver_movimientos' },
      { label: 'Arqueo',             href: '/arqueo',    icon: ClipboardCheck, permiso: 'ver_arqueo' },
      { label: 'Bodegas',            href: '/bodegas',   icon: Warehouse, permiso: 'ver_bodegas' },
      { label: 'Generador Códigos',  href: '/codigos',   icon: Barcode, permiso: 'generar_codigos' },
    ],
  },
  {
    id: 'gestion',
    title: 'Gestión',
    icon: Warehouse,
    items: [
      { label: 'Aprovisionamiento', href: '/aprovisionamiento', icon: Warehouse, permiso: 'ver_aprovisionamiento' },
      { label: 'Contratos/Sedes',   href: '/contratos',         icon: FileText, permiso: 'ver_contratos' },
      { label: 'Parametrización',   href: '/parametrizacion',   icon: SlidersHorizontal, permiso: 'ver_parametrizacion' },
      { label: 'Órdenes de Insumo', href: '/ordenes-insumo',    icon: ClipboardCheck, permiso: 'ver_ordenes_insumo' },
      { label: 'Alistamiento',      href: '/alistamiento',      icon: PackageCheck,   permiso: 'ver_alistamiento' },
      { label: 'Proveedores',       href: '/proveedores',       icon: Truck, permiso: 'ver_proveedores' },
      { label: 'Comparar Precios',  href: '/comparador-precios', icon: Scale, permiso: 'ver_proveedores' },
      { label: 'Órdenes de Compra', href: '/ordenes-compra',    icon: FileText, permiso: 'ver_ordenes_compra' },
      { label: 'Reportes',          href: '/reportes',          icon: BarChart3, permiso: 'ver_reportes' },
    ],
  },
  {
    id: 'gestion_humana',
    title: 'Gestión Humana',
    icon: Briefcase,
    items: [
      { label: 'Personas',      href: '/gestion-humana/personas',      icon: Contact, permiso: 'ver_personas' },
      { label: 'Postulaciones', href: '/gestion-humana/postulaciones', icon: ClipboardList, permiso: 'ver_postulaciones' },
      { label: 'Documentos',    href: '/gestion-humana/documentos',    icon: FolderTree, permiso: 'ver_documentos_rrhh' },
    ],
  },
  {
    id: 'ia',
    title: 'Inteligencia Artificial',
    icon: Brain,
    items: [
      { label: 'Asistente IA', href: '/ia/asistente', icon: Brain, permiso: 'usar_ia_asistente' },
    ],
  },
  {
    id: 'administracion',
    title: 'Administración',
    icon: Settings,
    items: [
      { label: 'Cargas masivas',     href: '/importar',         icon: UploadCloud,   permiso: 'importar_datos' },
      { label: 'Historial de Cambios', href: '/historial',      icon: History,       permiso: 'ver_historial' },
      { label: 'Documentos/Galería', href: '/documentos',      icon: FolderOpen,     permiso: 'ver_documentos' },
      { label: 'Notificaciones',     href: '/notificaciones',   icon: Bell,          permiso: 'ver_notificaciones' },
      { label: 'Usuarios',           href: '/usuarios',         icon: Users,         permiso: 'ver_usuarios' },
      { label: 'Roles y Permisos',   href: '/roles',            icon: Shield,        permiso: 'gestionar_roles' },
      { label: 'Integraciones',      href: '/integraciones',    icon: Plug,          permiso: 'gestionar_integraciones' },
      { label: 'Log de Actividad',   href: '/actividad-log',    icon: ClipboardList, permiso: 'ver_actividad_log' },
      { label: 'Configuración',      href: '/configuracion',    icon: Settings,      permiso: 'ver_configuracion' },
    ],
  },
]

/** Filtra la navegación según una función de permiso, quitando módulos vacíos. */
export function navegacionVisible(puede: (permiso?: string) => boolean): NavModule[] {
  return navigation
    .map((mod) => ({ ...mod, items: mod.items.filter((it) => puede(it.permiso)) }))
    .filter((mod) => mod.items.length > 0)
}

/** Etiqueta corta para mostrar bajo el icono en la barra inferior móvil. */
export const moduleShortLabel: Record<string, string> = {
  principal: 'Inicio',
  carnet: 'Carnet',
  inventario: 'Inventario',
  gestion: 'Gestión',
  gestion_humana: 'RRHH',
  ia: 'IA',
  administracion: 'Admin',
}

/** Devuelve el módulo cuyo submódulo coincide con la ruta actual. */
export function findActiveModule(pathname: string): NavModule | undefined {
  return navigation.find((mod) =>
    mod.items.some((item) => pathname === item.href || pathname.startsWith(item.href + '/'))
  )
}

/** Indica si un submódulo está activo según la ruta actual. */
export function isItemActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}
