import {
  LayoutDashboard, Package, BarChart3, ArrowLeftRight,
  QrCode, FileText, Warehouse, Truck, Users,
  Settings, Brain, Sparkles, FolderOpen, type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
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
    id: 'inventario',
    title: 'Inventario',
    icon: Package,
    items: [
      { label: 'Productos',   href: '/productos',   icon: Package },
      { label: 'Stock',       href: '/stock',       icon: BarChart3 },
      { label: 'Movimientos', href: '/movimientos', icon: ArrowLeftRight },
      { label: 'Escáner',     href: '/scanner',     icon: QrCode },
    ],
  },
  {
    id: 'gestion',
    title: 'Gestión',
    icon: Warehouse,
    items: [
      { label: 'Aprovisionamiento', href: '/aprovisionamiento', icon: Warehouse },
      { label: 'Contratos/Sedes',   href: '/contratos',         icon: FileText },
      { label: 'Proveedores',       href: '/proveedores',       icon: Truck },
      { label: 'Órdenes de Compra', href: '/ordenes-compra',    icon: FileText },
      { label: 'Reportes',          href: '/reportes',          icon: BarChart3 },
    ],
  },
  {
    id: 'ia',
    title: 'Inteligencia Artificial',
    icon: Brain,
    items: [
      { label: 'Visión IA',    href: '/ia/vision',    icon: Sparkles },
      { label: 'Asistente IA', href: '/ia/asistente', icon: Brain },
      { label: 'Análisis IA',  href: '/ia/analisis',  icon: BarChart3 },
    ],
  },
  {
    id: 'administracion',
    title: 'Administración',
    icon: Settings,
    items: [
      { label: 'Documentos/Galería', href: '/documentos',    icon: FolderOpen },
      { label: 'Usuarios',           href: '/usuarios',       icon: Users },
      { label: 'Configuración',      href: '/configuracion',  icon: Settings },
    ],
  },
]

/** Etiqueta corta para mostrar bajo el icono en la barra inferior móvil. */
export const moduleShortLabel: Record<string, string> = {
  principal: 'Inicio',
  inventario: 'Inventario',
  gestion: 'Gestión',
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
