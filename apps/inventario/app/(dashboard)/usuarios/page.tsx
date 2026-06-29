'use client'
import { useState } from 'react'
import { Users, Plus, Search, Shield, ChevronDown, Edit2, Trash2, Key } from 'lucide-react'
import { ROL_LABELS, GRUPO_LABELS, PERMISOS, type RolUsuario, type GrupoContrato } from '@/lib/types/database'

const ROLES: RolUsuario[] = ['SUPER_ADMIN','ADMIN','SUPERVISOR','COORDINADOR_COMPRAS','BODEGUERO','AUDITOR','OPERADOR_SEDE']

const mockUsuarios = [
  { id:'1', nombre:'Carlos Martínez', email:'c.martinez@conserjesinmobiliarios.com', rol:'SUPER_ADMIN' as RolUsuario, grupo_id:null, activo:true, ultimo_acceso:'2026-06-28T08:30:00' },
  { id:'2', nombre:'Andrea López', email:'a.lopez@conserjesinmobiliarios.com', rol:'ADMIN' as RolUsuario, grupo_id:null, activo:true, ultimo_acceso:'2026-06-28T07:15:00' },
  { id:'3', nombre:'Jhon Pérez', email:'j.perez@conserjesinmobiliarios.com', rol:'COORDINADOR_COMPRAS' as RolUsuario, grupo_id:null, activo:true, ultimo_acceso:'2026-06-27T16:45:00' },
  { id:'4', nombre:'María Torres', email:'m.torres@conserjesinmobiliarios.com', rol:'SUPERVISOR' as RolUsuario, grupo_id:'CA', activo:true, ultimo_acceso:'2026-06-28T09:00:00' },
  { id:'5', nombre:'Luis García', email:'l.garcia@conserjesinmobiliarios.com', rol:'BODEGUERO' as RolUsuario, grupo_id:null, activo:true, ultimo_acceso:'2026-06-28T06:00:00' },
  { id:'6', nombre:'Patricia Ruiz', email:'p.ruiz@conserjesinmobiliarios.com', rol:'AUDITOR' as RolUsuario, grupo_id:null, activo:false, ultimo_acceso:'2026-06-20T14:00:00' },
  { id:'7', nombre:'Roberto Silva', email:'r.silva@conserjesinmobiliarios.com', rol:'OPERADOR_SEDE' as RolUsuario, grupo_id:'MO', activo:true, ultimo_acceso:'2026-06-28T08:00:00' },
]

function formatFecha(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('es-CO', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
}

export default function UsuariosPage() {
  const [rolFilter, setRolFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [selectedUser, setSelectedUser] = useState<typeof mockUsuarios[0] | null>(null)
  const [showPermisos, setShowPermisos] = useState(false)

  const filtered = mockUsuarios.filter(u => {
    const matchRol = !rolFilter || u.rol === rolFilter
    const matchSearch = !search || u.nombre.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
    return matchRol && matchSearch
  })

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900">Usuarios y Roles</h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">{mockUsuarios.filter(u => u.activo).length} activos · {mockUsuarios.length} total</p>
        </div>
        <button className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm">
          <Plus className="w-4 h-4" />
          Invitar usuario
        </button>
      </div>

      {/* Role summary chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {ROLES.map(rol => {
          const info = ROL_LABELS[rol]
          const count = mockUsuarios.filter(u => u.rol === rol).length
          return (
            <button
              key={rol}
              onClick={() => setRolFilter(rolFilter === rol ? '' : rol)}
              className={`rounded-xl border p-3 text-left transition-all ${rolFilter === rol ? info.color + ' border-current' : 'bg-white border-gray-100 hover:border-gray-200'}`}
            >
              <p className="font-heading font-bold text-lg">{count}</p>
              <p className={`font-body text-xs mt-0.5 ${rolFilter === rol ? '' : 'text-gray-500'}`}>{info.label}</p>
            </button>
          )
        })}
      </div>

      <div className="flex gap-5 flex-col lg:flex-row">
        {/* Users list */}
        <div className="flex-1 space-y-3">
          {/* Search */}
          <div className="bg-white border border-gray-100 rounded-xl p-3 flex items-center gap-2 shadow-sm">
            <Search className="w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre o email..."
              className="font-body text-sm flex-1 outline-none placeholder:text-gray-400"
            />
          </div>

          {/* Table */}
          <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Usuario</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3 hidden sm:table-cell">Rol</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3 hidden md:table-cell">Último acceso</th>
                  <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Estado</th>
                  <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase tracking-wide px-4 py-3">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(u => {
                  const rol = ROL_LABELS[u.rol]
                  const grupo = u.grupo_id ? GRUPO_LABELS[u.grupo_id as GrupoContrato] : null
                  return (
                    <tr
                      key={u.id}
                      onClick={() => setSelectedUser(u)}
                      className={`cursor-pointer transition-colors ${selectedUser?.id === u.id ? 'bg-green-50' : 'hover:bg-gray-50/50'}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-green to-brand-green-dark flex items-center justify-center text-white font-heading font-bold text-xs shrink-0">
                            {u.nombre.split(' ').map(n => n[0]).join('').slice(0,2)}
                          </div>
                          <div>
                            <p className="font-body font-medium text-sm text-gray-900">{u.nombre}</p>
                            <p className="font-body text-xs text-gray-400">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="space-y-1">
                          <span className={`font-body text-xs font-medium px-2 py-0.5 rounded-full ${rol.color}`}>
                            {rol.label}
                          </span>
                          {grupo && (
                            <span className={`block font-body text-xs px-2 py-0.5 rounded-full ${grupo.color}`}>
                              {grupo.nombre}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <p className="font-body text-xs text-gray-500">{formatFecha(u.ultimo_acceso)}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`w-2 h-2 rounded-full inline-block ${u.activo ? 'bg-green-500' : 'bg-gray-300'}`} />
                        <span className={`font-body text-xs ml-1.5 ${u.activo ? 'text-green-700' : 'text-gray-400'}`}>
                          {u.activo ? 'Activo' : 'Inactivo'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                          <button className="p-1.5 rounded-lg text-gray-400 hover:text-brand-green hover:bg-green-50 transition-colors" title="Editar">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Resetear contraseña">
                            <Key className="w-3.5 h-3.5" />
                          </button>
                          <button className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors" title="Desactivar">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Permissions panel */}
        {selectedUser && (
          <div className="w-full lg:w-80 bg-white border border-gray-100 rounded-xl shadow-sm p-5 space-y-4 self-start">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-brand-green" />
                <h3 className="font-heading font-semibold text-sm text-gray-900">Permisos</h3>
              </div>
              <button onClick={() => setSelectedUser(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>

            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-green to-brand-green-dark flex items-center justify-center text-white font-heading font-bold text-xs">
                {selectedUser.nombre.split(' ').map(n => n[0]).join('').slice(0,2)}
              </div>
              <div>
                <p className="font-body font-medium text-sm text-gray-900">{selectedUser.nombre}</p>
                <span className={`font-body text-xs px-2 py-0.5 rounded-full ${ROL_LABELS[selectedUser.rol].color}`}>
                  {ROL_LABELS[selectedUser.rol].label}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-body font-semibold text-xs text-gray-500 uppercase tracking-wide">Permisos asignados</p>
              {PERMISOS[selectedUser.rol].includes('*') ? (
                <div className="bg-red-50 border border-red-100 rounded-lg p-3">
                  <p className="font-body text-xs font-bold text-red-700">Acceso total (*)</p>
                  <p className="font-body text-xs text-red-500 mt-0.5">Todos los módulos y acciones</p>
                </div>
              ) : (
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {PERMISOS[selectedUser.rol].map(p => (
                    <div key={p} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50">
                      <div className="w-1.5 h-1.5 rounded-full bg-brand-green shrink-0" />
                      <span className="font-body text-xs text-gray-700 font-mono">{p}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-gray-100 space-y-2">
              <button className="w-full flex items-center justify-center gap-2 border border-brand-green text-brand-green font-body font-semibold text-sm px-4 py-2.5 rounded-lg hover:bg-green-50 transition-colors">
                <Edit2 className="w-3.5 h-3.5" />
                Editar usuario
              </button>
              <button className="w-full flex items-center justify-center gap-2 border border-gray-200 text-gray-600 font-body text-sm px-4 py-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                <Key className="w-3.5 h-3.5" />
                Enviar reset contraseña
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
