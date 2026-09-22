'use client'

import { useState, useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Hospital, ListChecks, Building2, Plus, Pencil, Trash2, Loader2, X, AlertTriangle, Workflow, ExternalLink, Save,
} from 'lucide-react'
import type { CentroMedico, DirectorioContacto, DirectorioLista } from '@/lib/types/database'
import {
  eliminarCentroMedico, eliminarContacto, eliminarLista, guardarCentroMedico, guardarContacto, guardarEmpresa, guardarLista,
  type DatosCentroMedico, type DatosContacto, type DatosEmpresa, type DatosLista, type ResultadoDirectorio,
} from './actions'

export interface UsoDestino { destino: string; flujo: string; activo: boolean; evento: string }
export interface OtraFuente { nombre: string; detalle: string; total: number | null; conCorreo: number | null; href: string | null }
interface Empresa {
  razon_social: string | null; nit: string | null; correo_seleccion: string | null; correo_datos: string | null
  telefono: string | null; telefono_nomina: string | null; contacto_nomina: string | null
}

type Pestana = 'centros' | 'listas' | 'empresa'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green disabled:bg-gray-50'
const labelCls = 'font-body text-xs font-semibold text-gray-500'

/** Ejecuta una acción del servidor y avisa el resultado. */
function useAccion() {
  const [pendiente, start] = useTransition()
  const ejecutar = (fn: () => Promise<ResultadoDirectorio>, exito: string, alTerminar?: () => void) =>
    start(async () => {
      const r = await fn()
      if (r.error) { toast.error(r.error); return }
      if (r.aviso) toast.warning(r.aviso)
      else toast.success(exito)
      alTerminar?.()
    })
  return { pendiente, ejecutar }
}

export function DirectorioClient({
  centros, listas, contactos, empresa, usos, cuentaConectada, otras, puedeGestionar, puedeEditarCentros, puedeVerIntegraciones,
}: {
  centros: CentroMedico[]
  listas: DirectorioLista[]
  contactos: DirectorioContacto[]
  empresa: Empresa | null
  usos: UsoDestino[]
  cuentaConectada: boolean
  otras: OtraFuente[]
  puedeGestionar: boolean
  puedeEditarCentros: boolean
  puedeVerIntegraciones: boolean
}) {
  const [pestana, setPestana] = useState<Pestana>('centros')
  const sinCorreoCentros = centros.filter((c) => c.activo && !c.correo).length
  const sinCorreoContactos = contactos.filter((c) => c.activo && !c.correo).length

  const PESTANAS: { key: Pestana; label: string; icono: ReactNode; alerta: number }[] = [
    { key: 'centros', label: `Centros médicos (${centros.length})`, icono: <Hospital className="w-4 h-4" />, alerta: sinCorreoCentros },
    { key: 'listas', label: `Listas de distribución (${listas.length})`, icono: <ListChecks className="w-4 h-4" />, alerta: sinCorreoContactos },
    { key: 'empresa', label: 'Empresa y otros correos', icono: <Building2 className="w-4 h-4" />, alerta: 0 },
  ]

  return (
    <div className="space-y-4">
      {!cuentaConectada && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="font-body text-sm text-amber-900">
            <p className="font-semibold">Todavía no hay una cuenta de correo conectada: por ahora no sale ningún correo.</p>
            <p className="mt-0.5 text-amber-800">
              Los flujos quedan listos con estos destinatarios, pero omiten el envío hasta que se conecte la cuenta desde la que
              escribe la plataforma (contraseña de aplicación, o Google / Microsoft).
            </p>
            {puedeVerIntegraciones && (
              <Link href="/integraciones/correo" className="inline-flex items-center gap-1 mt-2 font-semibold text-amber-900 underline">
                Conectar la cuenta de correo <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-gray-100">
        {PESTANAS.map((p) => (
          <button key={p.key} onClick={() => setPestana(p.key)}
            className={'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 font-body text-sm font-semibold ' +
              (pestana === p.key ? 'border-brand-green text-brand-green' : 'border-transparent text-gray-500 hover:text-gray-800')}>
            {p.icono}{p.label}
            {p.alerta > 0 && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-800">{p.alerta} sin correo</span>}
          </button>
        ))}
      </div>

      {pestana === 'centros' && <TabCentros centros={centros} usos={usos} puedeEditar={puedeEditarCentros} />}
      {pestana === 'listas' && <TabListas listas={listas} contactos={contactos} usos={usos} puedeEditar={puedeGestionar} />}
      {pestana === 'empresa' && <TabEmpresa empresa={empresa} otras={otras} puedeEditar={puedeEditarCentros} />}
    </div>
  )
}

// ── Piezas comunes ──────────────────────────────────────────────────────────
function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl my-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-heading font-bold text-lg text-gray-900">{titulo}</h2>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600" aria-label="Cerrar"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  )
}

function Campo({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="font-body text-[11px] text-gray-400">{hint}</span>}
    </label>
  )
}

function Usos({ destino, usos }: { destino: string; usos: UsoDestino[] }) {
  const lista = usos.filter((u) => u.destino === destino)
  if (lista.length === 0) {
    return <p className="font-body text-[11px] text-gray-400">Ningún flujo le escribe todavía.</p>
  }
  return (
    <p className="font-body text-[11px] text-gray-500 flex items-center gap-1 flex-wrap">
      <Workflow className="w-3.5 h-3.5 text-brand-green" /> Le escribe:
      {lista.map((u) => (
        <span key={u.flujo} className={`rounded px-1.5 py-0.5 ${u.activo ? 'bg-green-50 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
          {u.flujo}{!u.activo && ' (inactivo)'}
        </span>
      ))}
    </p>
  )
}

function Correos({ correo, copias }: { correo: string | null; copias: string[] }) {
  if (!correo) {
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-body text-[11px] font-semibold text-amber-800"><AlertTriangle className="w-3 h-3" /> Sin correo</span>
  }
  return (
    <div className="min-w-0">
      <p className="font-body text-sm text-gray-800 truncate">{correo}</p>
      {copias.length > 0 && <p className="font-body text-[11px] text-gray-400 truncate">Copia: {copias.join(', ')}</p>}
    </div>
  )
}

function Guardar({ pendiente, onClick, texto = 'Guardar' }: { pendiente: boolean; onClick: () => void; texto?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={pendiente}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
      {pendiente ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {texto}
    </button>
  )
}

// ── Centros médicos ─────────────────────────────────────────────────────────
function TabCentros({ centros, usos, puedeEditar }: { centros: CentroMedico[]; usos: UsoDestino[]; puedeEditar: boolean }) {
  const [editando, setEditando] = useState<CentroMedico | 'nuevo' | null>(null)
  const { pendiente, ejecutar } = useAccion()

  function borrar(c: CentroMedico) {
    if (!confirm(`¿Eliminar el centro médico ${c.nombre}? Si ya tiene remisiones, solo se desactiva.`)) return
    ejecutar(() => eliminarCentroMedico(c.id), 'Centro médico eliminado')
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <p className="font-body text-sm text-gray-600">
            Son los que aparecen al remitir a exámenes en el expediente del candidato. Al registrar la remisión, la IPS recibe el
            correo en su dirección principal, con las copias.
          </p>
          <Usos destino="entidad:ips" usos={usos} />
        </div>
        {puedeEditar && (
          <button onClick={() => setEditando('nuevo')}
            className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark">
            <Plus className="w-4 h-4" /> Nuevo centro médico
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-gray-100 text-left font-body text-[11px] uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2.5">Centro médico</th><th className="px-4 py-2.5">Correos</th>
              <th className="px-4 py-2.5">Teléfono</th><th className="px-4 py-2.5">Dirección</th><th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {centros.map((c) => (
              <tr key={c.id} className={`border-b border-gray-50 align-top ${c.activo ? '' : 'opacity-60'}`}>
                <td className="px-4 py-3">
                  <p className="font-heading font-semibold text-sm text-gray-900">{c.nombre}</p>
                  {c.contacto && <p className="font-body text-[11px] text-gray-500">Contacto: {c.contacto}</p>}
                  {!c.activo && <span className="font-body text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactivo</span>}
                </td>
                <td className="px-4 py-3 max-w-[280px]"><Correos correo={c.correo} copias={c.correos_copia ?? []} /></td>
                <td className="px-4 py-3 font-body text-sm text-gray-700">{c.telefono ?? '—'}</td>
                <td className="px-4 py-3 font-body text-sm text-gray-700">
                  {c.direccion ?? '—'}{c.ciudad ? <span className="block text-[11px] text-gray-400">{c.ciudad}</span> : null}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {puedeEditar && (
                    <>
                      <button onClick={() => setEditando(c)} className="p-1.5 text-gray-400 hover:text-brand-green" aria-label="Editar"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => borrar(c)} disabled={pendiente} className="p-1.5 text-gray-400 hover:text-red-600 disabled:opacity-40" aria-label="Eliminar"><Trash2 className="w-4 h-4" /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {centros.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center font-body text-sm text-gray-400">Aún no hay centros médicos.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editando && <EditorCentro centro={editando === 'nuevo' ? null : editando} onCerrar={() => setEditando(null)} />}
    </div>
  )
}

function EditorCentro({ centro, onCerrar }: { centro: CentroMedico | null; onCerrar: () => void }) {
  const [d, setD] = useState<DatosCentroMedico>({
    id: centro?.id ?? null, nombre: centro?.nombre ?? '', correo: centro?.correo ?? '',
    correos_copia: (centro?.correos_copia ?? []).join(', '), telefono: centro?.telefono ?? '', direccion: centro?.direccion ?? '',
    ciudad: centro?.ciudad ?? '', contacto: centro?.contacto ?? '', notas: centro?.notas ?? '', activo: centro?.activo ?? true,
  })
  const { pendiente, ejecutar } = useAccion()
  const set = (k: keyof DatosCentroMedico) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value })

  return (
    <Modal titulo={centro ? `Editar ${centro.nombre}` : 'Nuevo centro médico'} onCerrar={onCerrar}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Campo label="Nombre *"><input value={d.nombre} onChange={set('nombre')} className={inputCls} placeholder="IPS DE EJEMPLO" /></Campo>
        <Campo label="Persona de contacto"><input value={d.contacto} onChange={set('contacto')} className={inputCls} /></Campo>
      </div>
      <Campo label="Correo principal" hint="A este correo llega la remisión a exámenes.">
        <input type="email" value={d.correo} onChange={set('correo')} className={inputCls} placeholder="citas@ips.com" />
      </Campo>
      <Campo label="Correos en copia" hint="Separados por coma. Van en copia del mismo correo.">
        <input value={d.correos_copia} onChange={set('correos_copia')} className={inputCls} placeholder="coordinacion@ips.com, laboratorio@ips.com" />
      </Campo>
      <div className="grid sm:grid-cols-2 gap-4">
        <Campo label="Teléfono"><input value={d.telefono} onChange={set('telefono')} className={inputCls} /></Campo>
        <Campo label="Ciudad"><input value={d.ciudad} onChange={set('ciudad')} className={inputCls} /></Campo>
      </div>
      <Campo label="Dirección"><input value={d.direccion} onChange={set('direccion')} className={inputCls} /></Campo>
      <Campo label="Notas" hint="Horarios, exámenes que hace, indicaciones para el candidato…">
        <textarea rows={2} value={d.notas} onChange={set('notas')} className={inputCls} />
      </Campo>
      <label className="flex items-center gap-2 font-body text-xs text-gray-700">
        <input type="checkbox" checked={d.activo} onChange={(e) => setD({ ...d, activo: e.target.checked })} className="accent-brand-green w-4 h-4" />
        Activo (aparece al remitir en el expediente)
      </label>
      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
        <Guardar pendiente={pendiente} onClick={() => ejecutar(() => guardarCentroMedico(d), 'Centro médico guardado', onCerrar)} />
        <button type="button" onClick={onCerrar} className="font-body text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
      </div>
    </Modal>
  )
}

// ── Listas de distribución ──────────────────────────────────────────────────
function TabListas({
  listas, contactos, usos, puedeEditar,
}: { listas: DirectorioLista[]; contactos: DirectorioContacto[]; usos: UsoDestino[]; puedeEditar: boolean }) {
  const [editLista, setEditLista] = useState<DirectorioLista | 'nueva' | null>(null)
  const [editContacto, setEditContacto] = useState<{ lista: DirectorioLista; contacto: DirectorioContacto | null } | null>(null)
  const { pendiente, ejecutar } = useAccion()

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="font-body text-sm text-gray-600 max-w-3xl">
          Grupos de personas o buzones que reciben avisos. En un flujo se elige la lista y le llega a cada contacto activo con
          correo, con sus copias. Cambiar un contacto aquí cambia a quién le llega, sin tocar los flujos.
        </p>
        {puedeEditar && (
          <button onClick={() => setEditLista('nueva')}
            className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark">
            <Plus className="w-4 h-4" /> Nueva lista
          </button>
        )}
      </div>

      {listas.map((l) => {
        const suyos = contactos.filter((c) => c.lista_codigo === l.codigo)
        const conCorreo = suyos.filter((c) => c.activo && c.correo).length
        return (
          <div key={l.codigo} className={`bg-white border rounded-2xl p-4 shadow-sm ${l.activo ? 'border-gray-100' : 'border-dashed border-gray-200'}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-heading font-semibold text-sm text-gray-900">{l.nombre}</span>
                  <code className="font-body text-[10px] text-gray-400">{l.codigo}</code>
                  {!l.activo && <span className="font-body text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Inactiva</span>}
                  {conCorreo === 0 && l.activo && (
                    <span className="font-body text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800">Nadie recibe: falta un correo</span>
                  )}
                </div>
                {l.descripcion && <p className="font-body text-xs text-gray-500">{l.descripcion}</p>}
                {l.uso && <p className="font-body text-xs text-gray-500"><strong className="text-gray-600">Para qué:</strong> {l.uso}</p>}
                <Usos destino={`lista:${l.codigo}`} usos={usos} />
              </div>
              {puedeEditar && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setEditContacto({ lista: l, contacto: null })}
                    className="flex items-center gap-1 font-body text-xs text-brand-green font-semibold px-2.5 py-1.5 rounded-lg hover:bg-green-50">
                    <Plus className="w-3.5 h-3.5" /> Contacto
                  </button>
                  <button onClick={() => setEditLista(l)} className="p-1.5 text-gray-400 hover:text-brand-green" aria-label="Editar lista"><Pencil className="w-4 h-4" /></button>
                  {!l.es_sistema && (
                    <button onClick={() => { if (confirm(`¿Eliminar la lista ${l.nombre} y sus contactos?`)) ejecutar(() => eliminarLista(l.codigo), 'Lista eliminada') }}
                      disabled={pendiente} className="p-1.5 text-gray-400 hover:text-red-600 disabled:opacity-40" aria-label="Eliminar lista"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              )}
            </div>

            {suyos.length === 0 ? (
              <p className="mt-3 font-body text-xs text-gray-400">Sin contactos.</p>
            ) : (
              <div className="mt-3 divide-y divide-gray-50">
                {suyos.map((c) => (
                  <div key={c.id} className={`flex items-start gap-3 py-2 ${c.activo ? '' : 'opacity-60'}`}>
                    <div className="min-w-0 w-1/3">
                      <p className="font-body text-sm font-semibold text-gray-800 truncate">{c.nombre}</p>
                      <p className="font-body text-[11px] text-gray-400 truncate">{[c.cargo, c.telefono].filter(Boolean).join(' · ') || '—'}</p>
                    </div>
                    <div className="min-w-0 flex-1"><Correos correo={c.correo} copias={c.correos_copia ?? []} /></div>
                    {puedeEditar && (
                      <div className="shrink-0">
                        <button onClick={() => setEditContacto({ lista: l, contacto: c })} className="p-1.5 text-gray-400 hover:text-brand-green" aria-label="Editar contacto"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => { if (confirm(`¿Quitar a ${c.nombre} de la lista?`)) ejecutar(() => eliminarContacto(c.id), 'Contacto eliminado') }}
                          disabled={pendiente} className="p-1.5 text-gray-400 hover:text-red-600 disabled:opacity-40" aria-label="Eliminar contacto"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {editLista && <EditorLista lista={editLista === 'nueva' ? null : editLista} onCerrar={() => setEditLista(null)} />}
      {editContacto && <EditorContacto lista={editContacto.lista} contacto={editContacto.contacto} onCerrar={() => setEditContacto(null)} />}
    </div>
  )
}

function EditorLista({ lista, onCerrar }: { lista: DirectorioLista | null; onCerrar: () => void }) {
  const [d, setD] = useState<DatosLista>({
    codigo: lista?.codigo ?? null, nombre: lista?.nombre ?? '', descripcion: lista?.descripcion ?? '', uso: lista?.uso ?? '', activo: lista?.activo ?? true,
  })
  const { pendiente, ejecutar } = useAccion()
  return (
    <Modal titulo={lista ? `Editar lista ${lista.nombre}` : 'Nueva lista'} onCerrar={onCerrar}>
      <Campo label="Nombre *"><input value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} className={inputCls} placeholder="Gerencia" /></Campo>
      <Campo label="Descripción"><input value={d.descripcion} onChange={(e) => setD({ ...d, descripcion: e.target.value })} className={inputCls} placeholder="Quiénes están en la lista" /></Campo>
      <Campo label="Para qué se usa"><input value={d.uso} onChange={(e) => setD({ ...d, uso: e.target.value })} className={inputCls} placeholder="Qué avisos recibe" /></Campo>
      <label className="flex items-center gap-2 font-body text-xs text-gray-700">
        <input type="checkbox" checked={d.activo} onChange={(e) => setD({ ...d, activo: e.target.checked })} className="accent-brand-green w-4 h-4" />
        Activa (si está inactiva, los flujos no le envían)
      </label>
      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
        <Guardar pendiente={pendiente} onClick={() => ejecutar(() => guardarLista(d), 'Lista guardada', onCerrar)} />
        <button type="button" onClick={onCerrar} className="font-body text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
      </div>
    </Modal>
  )
}

function EditorContacto({ lista, contacto, onCerrar }: { lista: DirectorioLista; contacto: DirectorioContacto | null; onCerrar: () => void }) {
  const [d, setD] = useState<DatosContacto>({
    id: contacto?.id ?? null, lista_codigo: lista.codigo, nombre: contacto?.nombre ?? '', cargo: contacto?.cargo ?? '',
    correo: contacto?.correo ?? '', correos_copia: (contacto?.correos_copia ?? []).join(', '), telefono: contacto?.telefono ?? '',
    notas: contacto?.notas ?? '', activo: contacto?.activo ?? true,
  })
  const { pendiente, ejecutar } = useAccion()
  const set = (k: keyof DatosContacto) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value })
  return (
    <Modal titulo={`${contacto ? 'Editar contacto' : 'Nuevo contacto'} · ${lista.nombre}`} onCerrar={onCerrar}>
      <div className="grid sm:grid-cols-2 gap-4">
        <Campo label="Nombre o buzón *"><input value={d.nombre} onChange={set('nombre')} className={inputCls} placeholder="Buzón de nómina" /></Campo>
        <Campo label="Cargo o área"><input value={d.cargo} onChange={set('cargo')} className={inputCls} placeholder="Nómina" /></Campo>
      </div>
      <Campo label="Correo" hint="Sin correo el contacto queda guardado, pero no recibe avisos.">
        <input type="email" value={d.correo} onChange={set('correo')} className={inputCls} placeholder="nomina@empresa.com" />
      </Campo>
      <Campo label="Correos en copia" hint="Separados por coma. Van en copia del mismo correo.">
        <input value={d.correos_copia} onChange={set('correos_copia')} className={inputCls} />
      </Campo>
      <div className="grid sm:grid-cols-2 gap-4">
        <Campo label="Teléfono"><input value={d.telefono} onChange={set('telefono')} className={inputCls} /></Campo>
        <label className="flex items-center gap-2 font-body text-xs text-gray-700 sm:mt-6">
          <input type="checkbox" checked={d.activo} onChange={(e) => setD({ ...d, activo: e.target.checked })} className="accent-brand-green w-4 h-4" />
          Activo
        </label>
      </div>
      <Campo label="Notas"><textarea rows={2} value={d.notas} onChange={set('notas')} className={inputCls} /></Campo>
      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
        <Guardar pendiente={pendiente} onClick={() => ejecutar(() => guardarContacto(d), 'Contacto guardado', onCerrar)} />
        <button type="button" onClick={onCerrar} className="font-body text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
      </div>
    </Modal>
  )
}

// ── Empresa y otros correos de la plataforma ────────────────────────────────
function TabEmpresa({ empresa, otras, puedeEditar }: { empresa: Empresa | null; otras: OtraFuente[]; puedeEditar: boolean }) {
  const [d, setD] = useState<DatosEmpresa>({
    correo_seleccion: empresa?.correo_seleccion ?? '', correo_datos: empresa?.correo_datos ?? '', telefono: empresa?.telefono ?? '',
    telefono_nomina: empresa?.telefono_nomina ?? '', contacto_nomina: empresa?.contacto_nomina ?? '',
  })
  const { pendiente, ejecutar } = useAccion()
  const set = (k: keyof DatosEmpresa) => (e: React.ChangeEvent<HTMLInputElement>) => setD({ ...d, [k]: e.target.value })

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm space-y-4">
        <div>
          <h2 className="font-heading font-semibold text-base text-gray-900">{empresa?.razon_social ?? 'Empresa'}</h2>
          <p className="font-body text-xs text-gray-500">NIT {empresa?.nit ?? '—'} · correos que salen en los formatos y en los avisos.</p>
        </div>
        <fieldset disabled={!puedeEditar} className="space-y-4">
          <Campo label="Correo de selección" hint="Lo ven los candidatos y es a donde las IPS envían el concepto de aptitud.">
            <input type="email" value={d.correo_seleccion} onChange={set('correo_seleccion')} className={inputCls} />
          </Campo>
          <Campo label="Correo de datos personales" hint="Sale en las autorizaciones de tratamiento de datos (habeas data).">
            <input type="email" value={d.correo_datos} onChange={set('correo_datos')} className={inputCls} />
          </Campo>
          <div className="grid sm:grid-cols-2 gap-4">
            <Campo label="Teléfono"><input value={d.telefono} onChange={set('telefono')} className={inputCls} /></Campo>
            <Campo label="Teléfono de nómina"><input value={d.telefono_nomina} onChange={set('telefono_nomina')} className={inputCls} /></Campo>
          </div>
          <Campo label="Contacto de nómina"><input value={d.contacto_nomina} onChange={set('contacto_nomina')} className={inputCls} /></Campo>
        </fieldset>
        {puedeEditar && (
          <div className="pt-2 border-t border-gray-100">
            <Guardar pendiente={pendiente} onClick={() => ejecutar(() => guardarEmpresa(d), 'Datos de la empresa guardados')} />
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
        <h2 className="font-heading font-semibold text-base text-gray-900">Otros correos que tiene la plataforma</h2>
        <p className="font-body text-xs text-gray-500 mb-3">Se editan en su propio módulo; aquí solo se ve cuántos tienen correo.</p>
        <div className="divide-y divide-gray-50">
          {otras.map((o) => {
            const sinDato = o.total === null
            const faltan = !sinDato && o.conCorreo !== null ? o.total! - o.conCorreo : 0
            return (
              <div key={o.nombre} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-body text-sm font-semibold text-gray-800">{o.nombre}</p>
                  <p className="font-body text-[11px] text-gray-400 truncate">{o.detalle}</p>
                </div>
                <div className="text-right shrink-0">
                  {sinDato ? (
                    <p className="font-body text-xs text-gray-400">Sin permiso para ver</p>
                  ) : (
                    <p className="font-body text-xs text-gray-600">
                      {o.conCorreo} de {o.total} con correo
                      {faltan > 0 && <span className="block text-[11px] text-amber-700">{faltan} sin correo</span>}
                    </p>
                  )}
                  {o.href && <Link href={o.href} className="font-body text-[11px] font-semibold text-brand-green hover:underline">Ir al módulo</Link>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
