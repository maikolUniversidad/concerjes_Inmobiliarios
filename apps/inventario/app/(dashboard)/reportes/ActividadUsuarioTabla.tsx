'use client'

import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

export interface ActividadFila {
  clave: string
  nombre: string
  email: string
  total: number
  modulos: string[]
  ultima: string
}

export function ActividadUsuarioTabla({ usuarios }: { usuarios: ActividadFila[] }) {
  const columnas: ColumnaTabla<ActividadFila>[] = [
    {
      id: 'usuario', header: 'Usuario', valor: (u) => u.nombre, ancho: 'min-w-[200px]', tarjeta: 'titulo',
      celda: (u) => (
        <>
          <p className="font-body font-medium text-sm text-gray-900">{u.nombre}</p>
          {u.email && <p className="font-body text-xs text-gray-400">{u.email}</p>}
        </>
      ),
    },
    { id: 'email', header: 'Correo', valor: (u) => u.email, prioridad: 3, className: 'text-xs text-gray-400', tarjeta: 'subtitulo' },
    {
      id: 'total', header: 'Acciones', valor: (u) => u.total, align: 'right', tarjeta: 'badge',
      className: 'font-heading font-bold text-base text-gray-900',
    },
    {
      id: 'modulos', header: 'Módulos', prioridad: 2, tarjeta: 'meta',
      valor: (u) => u.modulos.join(', '),
      celda: (u) => (
        <div className="flex flex-wrap gap-1">
          {u.modulos.slice(0, 6).map((m) => (
            <span key={m} className="font-body text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{m}</span>
          ))}
          {u.modulos.length > 6 && <span className="font-body text-xs text-gray-400">+{u.modulos.length - 6}</span>}
        </div>
      ),
    },
    {
      id: 'ultima', header: 'Última actividad', align: 'right', prioridad: 2, tarjeta: 'meta',
      className: 'text-xs text-gray-400 whitespace-nowrap',
      valor: (u) => new Date(u.ultima).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }),
    },
  ]

  return (
    <TablaEstandar
      id="reportes-actividad"
      titulo="Actividad por usuario"
      modulo="Sistema"
      entidad="actividad_log"
      datos={usuarios}
      columnas={columnas}
      filaId={(u) => u.clave}
      busqueda="Buscar usuario o módulo…"
      vacio={
        <p className="font-body text-sm text-gray-400">
          Aún no hay actividad registrada. Las acciones de los usuarios aparecerán aquí.
        </p>
      }
    />
  )
}
