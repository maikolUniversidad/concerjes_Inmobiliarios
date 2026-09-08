'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  UsersRound, UserCheck, UserMinus, KeyRound, Building2, AlertTriangle, X,
  Briefcase, MapPin, CalendarDays, Phone, IdCard, History,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

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
  es_administrativo: boolean | null
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
  resumen: Record<string, number> | null
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
  n === null ? '' : new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)

const dia = (s: string | null) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('es-CO') : '—')

const capitaliza = (e: string) => e.charAt(0) + e.slice(1).toLowerCase()

const nombreDe = (p: PlantaRow) =>
  p.nombre_completo ?? `${p.apellidos ?? ''} ${p.nombres ?? ''}`.trim() ?? p.documento

/** Filtros rápidos de la cabecera: recortan lo que ve la tabla. */
type Foco = 'todos' | 'activos' | 'disponibles' | 'retirados' | 'con_cuenta' | 'revisar'

export function PlantaClient({ filas, resumen, incidencias }: Props) {
  const [foco, setFoco] = useState<Foco>('activos')
  const [abierta, setAbierta] = useState<PlantaRow | null>(null)

  const datos = useMemo(() => {
    switch (foco) {
      case 'activos': return filas.filter((f) => f.estado === 'ACTIVO')
      case 'disponibles': return filas.filter((f) => f.estado === 'ACTIVO' && f.tiene_vinculacion_activa && f.es_disponibilidad)
      case 'retirados': return filas.filter((f) => f.estado === 'RETIRADO')
      case 'con_cuenta': return filas.filter((f) => f.tiene_cuenta)
      case 'revisar': return filas.filter((f) => f.nombre_confianza === 'BAJA' || f.nombre_confianza === 'MEDIA')
      default: return filas
    }
  }, [filas, foco])

  const tarjetas: { foco: Foco; label: string; valor: number; icon: typeof UsersRound; color: string }[] = [
    { foco: 'activos', label: 'En planta', valor: resumen?.activos ?? 0, icon: UsersRound, color: 'text-brand-green' },
    { foco: 'disponibles', label: 'Disponibles', valor: resumen?.disponibles ?? 0, icon: UserCheck, color: 'text-blue-600' },
    { foco: 'retirados', label: 'Retirados', valor: resumen?.retirados ?? 0, icon: UserMinus, color: 'text-gray-500' },
    { foco: 'con_cuenta', label: 'Con acceso', valor: resumen?.con_cuenta ?? 0, icon: KeyRound, color: 'text-amber-600' },
    { foco: 'todos', label: 'Centros de costo', valor: resumen?.centros ?? 0, icon: Building2, color: 'text-purple-600' },
  ]

  const totalIncidencias = Object.values(incidencias).reduce((a, b) => a + b, 0)

  const columnas: ColumnaTabla<PlantaRow>[] = [
    {
      id: 'nombre', header: 'Colaborador', valor: nombreDe, ancho: 'min-w-[230px]', tarjeta: 'titulo',
      celda: (p) => (
        <div className="min-w-0">
          <p className="font-body text-sm font-semibold text-gray-900">{nombreDe(p)}</p>
          {p.veces_vinculado > 1 && (
            <span className="font-body text-[10px] text-purple-700">{p.veces_vinculado} vinculaciones</span>
          )}
        </div>
      ),
    },
    {
      id: 'documento', header: 'Documento', valor: (p) => p.documento, ancho: 'w-32', tarjeta: 'subtitulo',
    },
    { id: 'cargo', header: 'Cargo', valor: (p) => p.cargo ?? '', tarjeta: 'meta' },
    {
      id: 'centro', header: 'Centro de costos', valor: (p) => p.centro_costo ?? '',
      ancho: 'min-w-[200px]', tarjeta: 'meta',
      celda: (p) => (
        <span className="font-body text-sm text-gray-600">
          {p.centro_costo ?? '—'}
          {p.es_disponibilidad && (
            <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 font-body text-[10px] font-medium text-blue-700">
              Disponible
            </span>
          )}
        </span>
      ),
    },
    { id: 'ciudad', header: 'Ciudad', valor: (p) => p.ciudad ?? '', prioridad: 2, tarjeta: 'meta' },
    { id: 'departamento', header: 'Depto.', valor: (p) => p.departamento ?? '', prioridad: 3, tarjeta: 'oculto' },
    {
      id: 'estado', header: 'Estado', valor: (p) => capitaliza(p.estado), ancho: 'w-28', tarjeta: 'badge',
      celda: (p) => (
        <span className={`whitespace-nowrap rounded-full px-1.5 py-0.5 font-body text-[10px] font-medium ${ESTADO_BADGE[p.estado] ?? 'bg-gray-100 text-gray-600'}`}>
          {capitaliza(p.estado)}
        </span>
      ),
    },
    {
      id: 'acceso', header: 'Acceso',
      valor: (p) => (p.tiene_cuenta ? p.usuario_rol ?? 'Con acceso' : 'Sin acceso'),
      ancho: 'w-32', tarjeta: 'badge',
    },
    { id: 'telefono', header: 'Teléfono', valor: (p) => p.telefono ?? '', prioridad: 3, tarjeta: 'oculto' },
    {
      id: 'salario', header: 'Salario', valor: (p) => p.salario ?? '', align: 'right',
      prioridad: 3, tarjeta: 'oculto',
      celda: (p) => <span className="font-body text-sm tabular-nums text-gray-600">{pesos(p.salario) || '—'}</span>,
      copiaTexto: (p) => (p.salario === null ? '' : String(p.salario)),
    },
    { id: 'retiro', header: 'Retiro', valor: (p) => p.fecha_retiro ?? '', prioridad: 3, tarjeta: 'oculto' },
    {
      id: 'revisar', header: 'Revisar', valor: (p) => (p.nombre_confianza && p.nombre_confianza !== 'ALTA' ? capitaliza(p.nombre_confianza) : ''),
      ancho: 'w-24', prioridad: 3, tarjeta: 'oculto',
    },
  ]

  return (
    <div className="space-y-5">
      {/* ── Resumen: cada tarjeta es un filtro rápido ─────────────────────── */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {tarjetas.map((t) => {
          const activa = foco === t.foco && t.foco !== 'todos'
          return (
            <button
              key={t.label}
              onClick={() => setFoco(t.foco)}
              aria-pressed={activa}
              className={`rounded-xl border bg-white p-3 text-left shadow-sm transition-colors ${
                activa ? 'border-brand-green ring-1 ring-brand-green/30' : 'border-gray-100 hover:border-brand-green/40'
              }`}
            >
              <t.icon className={`mb-1.5 h-4 w-4 ${t.color}`} />
              <p className="font-heading text-xl font-bold text-gray-900">{t.valor.toLocaleString('es-CO')}</p>
              <p className="font-body text-xs text-gray-500">{t.label}</p>
            </button>
          )
        })}
      </div>

      {/* ── Qué revisar antes de dar la planta por buena ─────────────────── */}
      {totalIncidencias > 0 && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="font-body text-sm font-semibold text-amber-900">
              {totalIncidencias.toLocaleString('es-CO')} fichas por revisar
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(incidencias).map(([motivo, n]) => (
              <span key={motivo} className="rounded-full border border-amber-200 bg-white px-2 py-0.5 font-body text-xs text-amber-800">
                {MOTIVO_LABEL[motivo] ?? motivo}: {n.toLocaleString('es-CO')}
              </span>
            ))}
          </div>
          <button onClick={() => setFoco('revisar')}
            className="mt-2 font-body text-xs font-semibold text-amber-900 underline underline-offset-2">
            Ver las del corte de nombre dudoso
          </button>
        </div>
      )}

      <TablaEstandar
        id="planta-personal"
        titulo="Planta de personal"
        modulo="Gestión Humana"
        entidad="personas"
        datos={datos}
        columnas={columnas}
        filaId={(p) => p.id}
        onFilaClick={setAbierta}
        textoDetalle="Ver"
        busqueda="Buscar por nombre, cédula, cargo o centro de costos…"
        gridTarjetas="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
        herramientas={foco !== 'todos' ? (
          <button onClick={() => setFoco('todos')}
            className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-body text-sm text-gray-600 hover:bg-gray-50">
            Ver toda la planta
          </button>
        ) : undefined}
        vacio={
          <div className="py-16 text-center">
            <UsersRound className="mx-auto mb-3 h-12 w-12 text-gray-200" />
            <p className="font-heading font-bold text-gray-400">Sin resultados</p>
            <p className="mt-1 font-body text-sm text-gray-400">Prueba con otro filtro o con la cédula completa.</p>
          </div>
        }
      />

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
      <div className={`fixed top-0 right-0 z-40 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ease-out ${abierto ? 'translate-x-0' : 'translate-x-full'}`}>
        {persona && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-4">
              <div className="min-w-0">
                <h2 className="font-heading text-lg font-bold leading-tight text-gray-900">{nombreDe(persona)}</h2>
                <p className="font-body text-sm text-gray-500">{persona.documento}</p>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              {persona.nombre_confianza && persona.nombre_confianza !== 'ALTA' && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                  <p className="font-body text-xs text-amber-900">
                    El corte entre apellidos y nombres se dedujo automáticamente y quedó con confianza{' '}
                    <strong>{persona.nombre_confianza.toLowerCase()}</strong>. Nómina lo entrega en un solo campo,
                    y el nombre de arriba es el dato original.
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
                <Dato icono={IdCard} etiqueta="Salario" valor={pesos(persona.salario) || '—'} />
                <Dato icono={KeyRound} etiqueta="Acceso"
                  valor={persona.tiene_cuenta ? `${persona.usuario_rol ?? 'Con cuenta'} · ${persona.usuario_email ?? ''}` : 'Sin cuenta'} />
              </dl>

              {persona.candidato_id && (
                <div className="rounded-xl border border-brand-green/30 bg-brand-green/5 p-3">
                  <p className="font-body text-xs text-gray-700">
                    Esta persona también tiene una hoja en el Registro de Vacantes.
                  </p>
                  <a href="/gestion-humana/postulaciones"
                    className="font-body text-xs font-semibold text-brand-green underline underline-offset-2">
                    Ver en Postulaciones
                  </a>
                </div>
              )}

              <div>
                <h3 className="mb-2 flex items-center gap-1.5 font-heading text-sm font-bold text-gray-900">
                  <History className="h-4 w-4 text-brand-green" /> Historial laboral
                </h3>
                {vinculaciones === null && <p className="font-body text-sm text-gray-400">Cargando…</p>}
                {vinculaciones?.length === 0 && (
                  <p className="font-body text-sm text-gray-400">Sin vinculaciones registradas.</p>
                )}
                <ol className="space-y-2">
                  {(vinculaciones ?? []).map((v) => (
                    <li key={v.id} className="rounded-xl border border-gray-100 bg-white p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-body text-sm font-semibold text-gray-900">{v.cargo ?? 'Cargo no registrado'}</p>
                        <span className={`shrink-0 rounded-full px-1.5 py-0.5 font-body text-[10px] font-medium ${
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
      <dt className="flex items-center gap-1 font-body text-[11px] uppercase tracking-wide text-gray-400">
        <Icono className="h-3 w-3" /> {etiqueta}
      </dt>
      <dd className="break-words font-body text-sm text-gray-900">{valor}</dd>
    </div>
  )
}
