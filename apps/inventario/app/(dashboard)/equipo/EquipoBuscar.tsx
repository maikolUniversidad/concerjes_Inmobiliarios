'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { QrCode, Search, Wrench, AlertTriangle, CalendarClock, Loader2, ChevronRight } from 'lucide-react'
import { BarcodeScanner } from '@/components/ui/BarcodeScanner'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'
import { ESTADO_MAQ_META } from '../maquinaria/estados'
import { CONDICION_META, extraerReferenciaEquipo } from '@/lib/mantenimiento'

export interface EquipoRow {
  id: string; codigo: string; nombre: string; tipo: string | null; marca: string | null; modelo: string | null
  serial: string | null; estado: string; condicion: string; imagen_url: string | null; proximo_mant: string | null
  ubicacion_sede_id: string | null; ubicacion_texto: string | null; sedes: { nombre: string } | null
  mantenimiento_tickets: { id: string; estado: string }[]
}

const ABIERTOS = new Set(['ABIERTO', 'RECIBIDO', 'EN_PROCESO', 'EN_ESPERA'])
const abiertos = (e: EquipoRow) => (e.mantenimiento_tickets ?? []).filter((t) => ABIERTOS.has(t.estado)).length
const fechaCorta = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })

export function EquipoBuscar({ sede, equipos }: { sede: { id: string; nombre: string } | null; equipos: EquipoRow[] }) {
  const router = useRouter()
  const [escaneando, setEscaneando] = useState(false)
  const [codigo, setCodigo] = useState('')
  const [abriendo, setAbriendo] = useState(false)
  const [soloMiSede, setSoloMiSede] = useState(!!sede && equipos.some((e) => e.ubicacion_sede_id === sede.id))
  const [soloNovedades, setSoloNovedades] = useState(false)

  const hoy = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const vencido = (e: EquipoRow) => !!e.proximo_mant && new Date(e.proximo_mant + 'T00:00:00') <= hoy
  const conNovedad = (e: EquipoRow) =>
    abiertos(e) > 0 || e.estado === 'DANADA' || e.estado === 'MANTENIMIENTO' || e.condicion === 'MALA' || vencido(e)

  function abrir(ref: string) {
    const r = extraerReferenciaEquipo(ref)
    if (!r) return
    setAbriendo(true)
    router.push(`/equipo/${encodeURIComponent(r)}`)
  }

  const datos = useMemo(() => equipos
    .filter((e) => !soloMiSede || !sede || e.ubicacion_sede_id === sede.id)
    .filter((e) => !soloNovedades || conNovedad(e)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [equipos, soloMiSede, soloNovedades, sede])

  const columnas: ColumnaTabla<EquipoRow>[] = [
    {
      id: 'nombre', header: 'Equipo', valor: (e) => e.nombre, ancho: 'min-w-[220px]', tarjeta: 'titulo',
      celda: (e) => (
        <div className="flex items-center gap-2.5">
          <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-gray-100">
            {e.imagen_url
              ? <Image src={e.imagen_url} alt={e.nombre} fill sizes="36px" className="object-cover" />
              : <div className="flex h-full items-center justify-center text-gray-300"><Wrench className="w-4 h-4" /></div>}
          </div>
          <span className="font-medium text-gray-900">{e.nombre}</span>
        </div>
      ),
    },
    { id: 'codigo', header: 'Código', valor: (e) => e.codigo, tarjeta: 'subtitulo', className: 'font-mono text-xs text-gray-600' },
    { id: 'tipo', header: 'Tipo', valor: (e) => e.tipo ?? '', prioridad: 2, tarjeta: 'meta', className: 'text-gray-600' },
    { id: 'marca', header: 'Marca / modelo', valor: (e) => [e.marca, e.modelo].filter(Boolean).join(' · '), prioridad: 3, tarjeta: 'oculto', className: 'text-xs text-gray-500' },
    { id: 'serial', header: 'Serial', valor: (e) => e.serial ?? '', prioridad: 3, tarjeta: 'oculto', className: 'text-xs text-gray-500' },
    {
      id: 'sede', header: 'Sede', valor: (e) => [e.sedes?.nombre, e.ubicacion_texto].filter(Boolean).join(' · '),
      prioridad: 2, tarjeta: 'meta', className: 'text-xs text-gray-600 max-w-[260px] truncate',
    },
    {
      id: 'estado', header: 'Estado', valor: (e) => ESTADO_MAQ_META[e.estado]?.label ?? e.estado, tarjeta: 'badge',
      celda: (e) => {
        const m = ESTADO_MAQ_META[e.estado]
        return <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${m?.cls ?? 'bg-gray-100 text-gray-600'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${m?.dot ?? 'bg-gray-400'}`} />{m?.label ?? e.estado}
        </span>
      },
    },
    {
      id: 'condicion', header: 'Condición', valor: (e) => CONDICION_META[e.condicion]?.label ?? e.condicion, prioridad: 2, tarjeta: 'meta',
      celda: (e) => <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${CONDICION_META[e.condicion]?.cls ?? 'bg-gray-100 text-gray-600'}`}>{CONDICION_META[e.condicion]?.label ?? e.condicion}</span>,
    },
    {
      id: 'tickets', header: 'Tickets abiertos', align: 'center', valor: (e) => abiertos(e), prioridad: 2, tarjeta: 'meta',
      celda: (e) => abiertos(e) > 0
        ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600"><AlertTriangle className="w-3 h-3" />{abiertos(e)}</span>
        : <span className="text-gray-300">—</span>,
    },
    {
      id: 'preventivo', header: 'Próximo preventivo', valor: (e) => e.proximo_mant ?? '', prioridad: 3, tarjeta: 'meta',
      copiaTexto: (e) => e.proximo_mant ?? '',
      celda: (e) => e.proximo_mant
        ? <span className={`inline-flex items-center gap-1 text-xs ${vencido(e) ? 'font-semibold text-purple-700' : 'text-gray-600'}`}>
            <CalendarClock className="w-3.5 h-3.5" />{fechaCorta(e.proximo_mant)}{vencido(e) && ' · vencido'}
          </span>
        : <span className="text-gray-300">—</span>,
    },
  ]

  return (
    <div className="space-y-5">
      {/* Escanear / digitar */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col sm:flex-row gap-3">
          <button onClick={() => setEscaneando(true)}
            className="flex items-center justify-center gap-2.5 rounded-xl bg-brand-green px-6 py-3.5 text-white font-heading font-bold text-base hover:bg-brand-green-dark transition-colors sm:w-auto">
            <QrCode className="w-6 h-6" /> Escanear código QR
          </button>
          <form onSubmit={(e) => { e.preventDefault(); abrir(codigo) }} className="flex flex-1 gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-xl border border-gray-200 px-3 focus-within:border-brand-green focus-within:ring-2 focus-within:ring-brand-green/20">
              <Search className="w-4 h-4 text-gray-400 shrink-0" />
              <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Escribe el código exacto, ej: BR 482"
                aria-label="Código del equipo"
                className="flex-1 py-3 bg-transparent font-mono text-base uppercase placeholder:normal-case placeholder:font-body placeholder:text-sm outline-none"
                autoCapitalize="characters" autoComplete="off" />
            </div>
            <button type="submit" disabled={!codigo.trim() || abriendo}
              className="rounded-xl bg-gray-900 px-5 text-white font-semibold text-sm disabled:opacity-40">
              {abriendo ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Abrir'}
            </button>
          </form>
        </div>
      </div>

      {/* Inventario de maquinaria */}
      <TablaEstandar
        id="equipo-inventario"
        titulo="Inventario de maquinaria"
        modulo="Mantenimiento"
        entidad="maquinaria"
        datos={datos}
        columnas={columnas}
        filaId={(e) => e.id}
        busqueda="Buscar por código, nombre, tipo, marca, serial o sede…"
        vistaInicial="auto"
        onFilaClick={(e) => router.push(`/equipo/${e.id}`)}
        textoDetalle="Ver equipo"
        anchoAcciones="w-24"
        acciones={(e) => (
          <button onClick={() => router.push(`/equipo/${e.id}`)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-green hover:bg-green-50">
            Abrir <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
        herramientas={
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
            {sede && (
              <label className="flex items-center gap-1.5 select-none" title={sede.nombre}>
                <input type="checkbox" checked={soloMiSede} onChange={(e) => setSoloMiSede(e.target.checked)} className="accent-brand-green" />
                Solo mi sede
              </label>
            )}
            <label className="flex items-center gap-1.5 select-none">
              <input type="checkbox" checked={soloNovedades} onChange={(e) => setSoloNovedades(e.target.checked)} className="accent-brand-green" />
              Con novedades
            </label>
          </div>
        }
        vacio={
          <>
            <Wrench className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p className="font-body text-sm text-gray-400">
              {soloMiSede && sede ? `No hay equipos registrados en ${sede.nombre}.` : 'No hay equipos que coincidan.'}
            </p>
          </>
        }
      />

      {escaneando && (
        <BarcodeScanner
          onDetected={(v) => { setEscaneando(false); abrir(v) }}
          onClose={() => setEscaneando(false)}
        />
      )}
    </div>
  )
}
