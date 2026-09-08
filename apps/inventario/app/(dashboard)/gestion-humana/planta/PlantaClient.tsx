'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Search, UsersRound, UserCheck, UserMinus, KeyRound, Building2, ChevronRight,
  ChevronLeft, AlertTriangle, X, Briefcase, MapPin, CalendarDays, Phone, IdCard,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export interface Filtros {
  q: string
  estado: string
  ciudad: string
  centro: string
  vista: string
  pagina: number
}

export interface PlantaRow {
  id: string
  documento: string
  nombre_completo: string | null
  nombres: string | null
  apellidos: string | null
  cargo: string | null
  estado: string
  ciudad: string | null
  departamento: string | null
  centro_costo: string | null
  es_disponibilidad: boolean | null
  telefono: string | null
  salario: number | null
  fecha_ingreso: string | null
  fecha_retiro: string | null
  tiene_cuenta: boolean
  usuario_email: string | null
  usuario_rol: string | null
  veces_vinculado: number
  tiene_vinculacion_activa: boolean
  candidato_id: string | null
  nombre_confianza: string | null
}

interface Vinculacion {
  id: string
  cargo: string | null
  tipo_contrato: string | null
  fecha_ingreso: string | null
  fecha_retiro: string | null
  fecha_fin_contrato: string | null
  salario: number | null
  estado: string
  centros_costo: { codigo: string } | null
}

interface Props {
  filas: PlantaRow[]
  total: number
  tamanoPagina: number
  filtros: Filtros
  resumen: Record<string, number> | null
  centros: { codigo: string; ciudad: string | null; es_disponibilidad: boolean }[]
  ciudades: string[]
  incidencias: Record<string, number>
}

const ESTADO_BADGE: Record<string, string> = {
  ACTIVO: 'bg-green-100 text-green-700',
  RETIRADO: 'bg-gray-100 text-gray-600',
  SUSPENDIDO: 'bg-amber-100 text-amber-700',
}

const MOTIVO_LABEL: Record<string, string> = {
  NOMBRE_DUDOSO: 'Corte de nombre por revisar',
  ACTIVO_CON_RETIRO_RECIENTE: 'Activo con retiro reciente',
  SIN_CIUDAD: 'Ficha sin ciudad',
  DOCUMENTO_SOSPECHOSO: 'Documento que parece celular',
}

const pesos = (n: number | null) =>
  n === null ? '—' : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

const dia = (s: string | null) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('es-CO') : '—')

export function PlantaClient({
  filas, total, tamanoPagina, filtros, resumen, centros, ciudades, incidencias,
}: Props) {
  const router = useRouter()
  const params = useSearchParams()
  const [pendiente, iniciar] = useTransition()
  const [q, setQ] = useState(filtros.q)
  const [abierta, setAbierta] = useState<PlantaRow | null>(null)

  // Los filtros viven en la URL: así la pantalla se puede compartir y el botón
  // de atrás del navegador funciona como uno espera.
  function navegar(cambios: Record<string, string>) {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(cambios)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    if (!('pagina' in cambios)) p.delete('pagina')
    iniciar(() => router.push(`?${p.toString()}`))
  }

  const paginas = Math.max(1, Math.ceil(total / tamanoPagina))
  const inicio = total === 0 ? 0 : (filtros.pagina - 1) * tamanoPagina + 1
  const fin = Math.min(filtros.pagina * tamanoPagina, total)

  const tarjetas = [
    { label: 'En planta', valor: resumen?.activos ?? 0, icon: UsersRound, color: 'text-brand-green', vista: '', estado: 'ACTIVO' },
    { label: 'Disponibles', valor: resumen?.disponibles ?? 0, icon: UserCheck, color: 'text-blue-600', vista: 'disponibles', estado: 'ACTIVO' },
    { label: 'Retirados', valor: resumen?.retirados ?? 0, icon: UserMinus, color: 'text-gray-500', vista: '', estado: 'RETIRADO' },
    { label: 'Con acceso', valor: resumen?.con_cuenta ?? 0, icon: KeyRound, color: 'text-amber-600', vista: '', estado: 'ACTIVO' },
    { label: 'Centros de costo', valor: resumen?.centros ?? 0, icon: Building2, color: 'text-purple-600', vista: '', estado: '' },
  ]

  const totalIncidencias = Object.values(incidencias).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-5">
      {/* ── Resumen ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tarjetas.map((t) => (
          <button
            key={t.label}
            onClick={() => navegar({ vista: t.vista, estado: t.estado })}
            className="text-left rounded-xl border border-gray-100 bg-white p-3 shadow-sm hover:border-brand-green/40 transition-colors"
          >
            <t.icon className={`w-4 h-4 ${t.color} mb-1.5`} />
            <p className="font-heading font-bold text-xl text-gray-900">{t.valor.toLocaleString('es-CO')}</p>
            <p className="font-body text-xs text-gray-500">{t.label}</p>
          </button>
        ))}
      </div>

      {/* ── Qué revisar antes de dar la planta por buena ─────────────────── */}
      {totalIncidencias > 0 && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="font-body font-semibold text-sm text-amber-900">
              {totalIncidencias.toLocaleString('es-CO')} fichas por revisar
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(incidencias).map(([motivo, n]) => (
              <span key={motivo} className="font-body text-xs bg-white text-amber-800 border border-amber-200 rounded-full px-2 py-0.5">
                {MOTIVO_LABEL[motivo] ?? motivo}: {n.toLocaleString('es-CO')}
              </span>
            ))}
          </div>
          <button
            onClick={() => navegar({ vista: 'revisar', estado: '' })}
            className="mt-2 font-body text-xs font-semibold text-amber-900 underline underline-offset-2"
          >
            Ver las del corte de nombre dudoso
          </button>
        </div>
      )}

      {/* ── Filtros ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); navegar({ q }) }}
          className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 flex-1 min-w-[220px]"
        >
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por cédula, nombre o cargo…"
            className="flex-1 bg-transparent font-body text-sm outline-none placeholder:text-gray-400"
          />
        </form>

        <select
          value={filtros.estado}
          onChange={(e) => navegar({ estado: e.target.value })}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-body text-sm text-gray-700"
        >
          <option value="">Todos los estados</option>
          <option value="ACTIVO">En planta</option>
          <option value="RETIRADO">Retirados</option>
          <option value="SUSPENDIDO">Suspendidos</option>
        </select>

        <select
          value={filtros.ciudad}
          onChange={(e) => navegar({ ciudad: e.target.value })}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-body text-sm text-gray-700 max-w-[190px]"
        >
          <option value="">Toda ciudad</option>
          {ciudades.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <select
          value={filtros.centro}
          onChange={(e) => navegar({ centro: e.target.value })}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-body text-sm text-gray-700 max-w-[240px]"
        >
          <option value="">Todo centro de costos</option>
          {centros.map((c) => (
            <option key={c.codigo} value={c.codigo}>{c.es_disponibilidad ? '★ ' : ''}{c.codigo}</option>
          ))}
        </select>

        <select
          value={filtros.vista}
          onChange={(e) => navegar({ vista: e.target.value })}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-body text-sm text-gray-700"
        >
          <option value="">Sin filtro extra</option>
          <option value="disponibles">Solo disponibles</option>
          <option value="sin_cuenta">Sin cuenta de acceso</option>
          <option value="revisar">Por revisar</option>
        </select>
      </div>

      <p className="font-body text-xs text-gray-400">
        {total === 0 ? 'Sin resultados' : `${inicio.toLocaleString('es-CO')}–${fin.toLocaleString('es-CO')} de ${total.toLocaleString('es-CO')}`}
        {pendiente && ' · cargando…'}
      </p>

      {/* ── Lista ────────────────────────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {filas.map((p) => (
          <button
            key={p.id}
            onClick={() => setAbierta(p)}
            className="text-left flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm hover:border-brand-green/40 hover:shadow-md transition-all"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="font-body font-semibold text-sm text-gray-900 truncate">
                  {p.nombre_completo ?? `${p.apellidos ?? ''} ${p.nombres ?? ''}`.trim()}
                </p>
                <span className={`shrink-0 font-body text-[10px] font-medium px-1.5 py-0.5 rounded-full ${ESTADO_BADGE[p.estado] ?? 'bg-gray-100 text-gray-600'}`}>
                  {p.estado.charAt(0) + p.estado.slice(1).toLowerCase()}
                </span>
                {p.es_disponibilidad && (
                  <span className="shrink-0 font-body text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    Disponible
                  </span>
                )}
                {p.veces_vinculado > 1 && (
                  <span className="shrink-0 font-body text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                    {p.veces_vinculado} vinculaciones
                  </span>
                )}
              </div>
              <p className="font-body text-xs text-gray-500 flex items-center gap-1 min-w-0">
                <IdCard className="w-3 h-3 text-gray-400 shrink-0" /> {p.documento}
                {p.cargo && <span className="text-gray-300">·</span>}
                {p.cargo && <span className="truncate">{p.cargo}</span>}
              </p>
              <p className="font-body text-xs text-gray-400 truncate">
                {p.centro_costo ?? 'Sin centro de costos'}{p.ciudad ? ` · ${p.ciudad}` : ''}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
          </button>
        ))}
      </div>

      {filas.length === 0 && (
        <div className="py-16 text-center">
          <UsersRound className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="font-heading font-bold text-gray-400">Sin resultados</p>
          <p className="font-body text-sm text-gray-400 mt-1">Prueba con otro filtro o con la cédula completa.</p>
        </div>
      )}

      {/* ── Paginación ───────────────────────────────────────────────────── */}
      {paginas > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            disabled={filtros.pagina <= 1}
            onClick={() => navegar({ pagina: String(filtros.pagina - 1) })}
            className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 font-body text-sm text-gray-600 disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" /> Anterior
          </button>
          <span className="font-body text-sm text-gray-500">
            {filtros.pagina} / {paginas}
          </span>
          <button
            disabled={filtros.pagina >= paginas}
            onClick={() => navegar({ pagina: String(filtros.pagina + 1) })}
            className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-3 py-2 font-body text-sm text-gray-600 disabled:opacity-40"
          >
            Siguiente <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      <FichaDrawer persona={abierta} onClose={() => setAbierta(null)} />
    </div>
  )
}

// ─── Detalle + historial laboral ──────────────────────────────────────────────
function FichaDrawer({ persona, onClose }: { persona: PlantaRow | null; onClose: () => void }) {
  const [vinculaciones, setVinculaciones] = useState<Vinculacion[] | null>(null)

  useEffect(() => {
    if (!persona) { setVinculaciones(null); return }
    let vivo = true
    const sb = createClient()
    sb.from('persona_vinculaciones')
      .select('id, cargo, tipo_contrato, fecha_ingreso, fecha_retiro, fecha_fin_contrato, salario, estado, centros_costo ( codigo )')
      .eq('persona_id', persona.id)
      .order('fecha_ingreso', { ascending: false, nullsFirst: true })
      .then(({ data }) => { if (vivo) setVinculaciones((data ?? []) as unknown as Vinculacion[]) })
    return () => { vivo = false }
  }, [persona])

  const abierto = persona !== null

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-black/20 transition-opacity duration-300 ${abierto ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div className={`fixed top-0 right-0 z-40 h-full w-full max-w-md bg-white shadow-2xl transition-transform duration-300 ease-out flex flex-col ${abierto ? 'translate-x-0' : 'translate-x-full'}`}>
        {persona && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-4">
              <div className="min-w-0">
                <h2 className="font-heading font-bold text-lg text-gray-900 leading-tight">
                  {persona.nombre_completo ?? `${persona.apellidos ?? ''} ${persona.nombres ?? ''}`.trim()}
                </h2>
                <p className="font-body text-sm text-gray-500">{persona.documento}</p>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {persona.nombre_confianza && persona.nombre_confianza !== 'ALTA' && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                  <p className="font-body text-xs text-amber-900">
                    El corte entre apellidos y nombres se dedujo automáticamente y quedó con confianza{' '}
                    <strong>{persona.nombre_confianza.toLowerCase()}</strong>. Nómina lo entrega en un solo campo.
                    El nombre completo de arriba es el dato original.
                  </p>
                </div>
              )}

              <dl className="grid grid-cols-2 gap-3">
                <Dato icono={Briefcase} etiqueta="Cargo" valor={persona.cargo ?? '—'} />
                <Dato icono={Building2} etiqueta="Centro de costos" valor={persona.centro_costo ?? '—'} />
                <Dato icono={MapPin} etiqueta="Ciudad" valor={[persona.ciudad, persona.departamento].filter(Boolean).join(' · ') || '—'} />
                <Dato icono={Phone} etiqueta="Teléfono" valor={persona.telefono ?? '—'} />
                <Dato icono={CalendarDays} etiqueta="Ingreso" valor={dia(persona.fecha_ingreso)} />
                <Dato icono={CalendarDays} etiqueta="Retiro" valor={dia(persona.fecha_retiro)} />
                <Dato icono={IdCard} etiqueta="Salario" valor={pesos(persona.salario)} />
                <Dato
                  icono={KeyRound}
                  etiqueta="Acceso"
                  valor={persona.tiene_cuenta ? `${persona.usuario_rol ?? 'Con cuenta'} · ${persona.usuario_email ?? ''}` : 'Sin cuenta'}
                />
              </dl>

              {persona.candidato_id && (
                <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-3">
                  <p className="font-body text-xs text-gray-700">
                    Esta persona también tiene una hoja en el Registro de Vacantes.
                  </p>
                  <a
                    href="/gestion-humana/postulaciones"
                    className="font-body text-xs font-semibold text-brand-green underline underline-offset-2"
                  >
                    Ver en Postulaciones
                  </a>
                </div>
              )}

              <div>
                <h3 className="font-heading font-bold text-sm text-gray-900 mb-2">Historial laboral</h3>
                {vinculaciones === null && <p className="font-body text-sm text-gray-400">Cargando…</p>}
                {vinculaciones?.length === 0 && (
                  <p className="font-body text-sm text-gray-400">Sin vinculaciones registradas.</p>
                )}
                <ol className="space-y-2">
                  {(vinculaciones ?? []).map((v) => (
                    <li key={v.id} className="rounded-xl border border-gray-100 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-body font-semibold text-sm text-gray-900">
                          {v.cargo ?? 'Cargo no registrado'}
                        </p>
                        <span className={`shrink-0 font-body text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          v.estado === 'ACTIVA' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {v.estado === 'ACTIVA' ? 'Vigente' : 'Terminada'}
                        </span>
                      </div>
                      <p className="font-body text-xs text-gray-500">
                        {v.centros_costo?.codigo ?? 'Sin centro de costos'}
                        {v.tipo_contrato ? ` · ${v.tipo_contrato}` : ''}
                      </p>
                      <p className="font-body text-xs text-gray-400">
                        {dia(v.fecha_ingreso)} → {v.fecha_retiro ? dia(v.fecha_retiro) : 'hoy'}
                        {v.salario ? ` · ${pesos(v.salario)}` : ''}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

function Dato({ icono: Icono, etiqueta, valor }: { icono: typeof Briefcase; etiqueta: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-body text-[11px] uppercase tracking-wide text-gray-400 flex items-center gap-1">
        <Icono className="w-3 h-3" /> {etiqueta}
      </dt>
      <dd className="font-body text-sm text-gray-900 break-words">{valor}</dd>
    </div>
  )
}
