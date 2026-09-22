'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowRightLeft, Ban, FileSpreadsheet, Loader2, UserCheck, X, ClipboardList, FileSignature } from 'lucide-react'
import { toast } from 'sonner'
import { usePermisos } from '@/components/permisos/PermisosProvider'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'
import { BANDEJAS, faseMeta, semaforoDias, type BandejaKey } from '@/lib/ats/fases'
import { Expediente } from './expediente/Expediente'
import { ModalMover } from './ModalMover'
import { ModalDescartar } from './ModalDescartar'
import { descargarDesdeApi } from './acciones'
import { Badge, Boton } from './ui'
import type { Catalogos, FilaBandeja } from './tipos'

interface Props { filas: FilaBandeja[]; catalogos: Catalogos }

export function PostulacionesClient({ filas, catalogos }: Props) {
  const router = useRouter()
  const { puede } = usePermisos()
  const puedeGestionar = puede('gestionar_postulaciones')

  const [lista, setLista] = useState<FilaBandeja[]>(filas)
  useEffect(() => { setLista(filas) }, [filas])
  const [bandeja, setBandeja] = useState<BandejaKey>('POSTULACION')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [abierto, setAbierto] = useState<string | null>(null)
  const [modal, setModal] = useState<null | { tipo: 'mover' | 'descartar'; filas: FilaBandeja[]; destino?: string; motivo?: string }>(null)
  const [descargando, setDescargando] = useState(false)

  const conteo = useMemo(() => {
    const m = new Map<BandejaKey, number>()
    for (const f of lista) {
      const b = faseMeta(f.estado).bandeja
      m.set(b, (m.get(b) ?? 0) + 1)
    }
    return m
  }, [lista])

  const visibles = useMemo(() => lista.filter((f) => faseMeta(f.estado).bandeja === bandeja), [lista, bandeja])
  const seleccionadas = useMemo(() => lista.filter((f) => sel.has(f.id)), [lista, sel])
  const estancados = useMemo(() => lista.filter((f) => !['CONTRATADOS', 'DESCARTADOS'].includes(faseMeta(f.estado).bandeja) && f.dias_en_fase > 7).length, [lista])

  function cambiarBandeja(b: BandejaKey) { setBandeja(b); setSel(new Set()) }
  function alternar(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function refrescar() { setSel(new Set()); router.refresh() }

  async function descargarWO(ids: string[]) {
    setDescargando(true)
    const err = await descargarDesdeApi('/api/gestion-humana/postulaciones/wo', { ids }, `WO_Contratados_${new Date().toISOString().slice(0, 10)}.xlsx`)
    setDescargando(false)
    if (err) toast.error(err)
  }

  const columnas: ColumnaTabla<FilaBandeja>[] = [
    {
      id: 'candidato', header: 'Candidato', tarjeta: 'titulo', ancho: 'min-w-[220px]',
      valor: (f) => `${f.nombres ?? ''} ${f.apellidos ?? ''}`.trim(),
      celda: (f) => (
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-900">{f.nombres ?? '—'} {f.apellidos ?? ''}</p>
          <p className="text-xs text-gray-500">
            {f.tipo_documento} {f.numero_documento}
            {(f.persona_id || f.ha_trabajado_antes) && <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800">Ya trabajó</span>}
          </p>
        </div>
      ),
    },
    { id: 'cargo', header: 'Cargo', valor: (f) => f.cargo ?? 'Sin cargo', tarjeta: 'subtitulo' },
    { id: 'ciudad', header: 'Ciudad', valor: (f) => f.ciudad_trabajo ?? '', prioridad: 2 },
    {
      id: 'fase', header: 'Fase', valor: (f) => faseMeta(f.estado).label, tarjeta: 'badge',
      celda: (f) => <Badge className={faseMeta(f.estado).color}>{faseMeta(f.estado).label}</Badge>,
    },
    {
      id: 'dias', header: 'Días en fase', align: 'center', valor: (f) => f.dias_en_fase,
      celda: (f) => { const s = semaforoDias(f.dias_en_fase); return <Badge className={s.color}>{s.label}</Badge> },
    },
    {
      id: 'docs', header: 'Documentos', align: 'center', valor: (f) => `${f.docs_validados}/${f.docs_total}`,
      celda: (f) => (
        <span className="text-xs">
          <strong>{f.docs_validados}</strong>/{f.docs_total}
          {f.docs_rechazados > 0 && <span className="ml-1 text-red-600">· {f.docs_rechazados} rech.</span>}
        </span>
      ),
    },
    {
      id: 'pruebas', header: 'Pruebas', align: 'center', prioridad: 2,
      valor: (f) => `${f.pruebas_presentadas}/2${f.puntaje_conocimientos ? ` · ${f.puntaje_conocimientos}` : ''}`,
    },
    {
      id: 'firmas', header: 'Firmas', align: 'center', prioridad: 2,
      valor: (f) => f.docs_por_firmar ? `${f.docs_por_firmar} pendientes` : f.docs_firmados ? `${f.docs_firmados} firmados` : '',
      celda: (f) => f.docs_por_firmar
        ? <Badge className="bg-amber-100 text-amber-800">{f.docs_por_firmar} por firmar</Badge>
        : f.docs_firmados ? <Badge className="bg-green-100 text-green-700">{f.docs_firmados} firmados</Badge> : <span className="text-gray-300">—</span>,
    },
    { id: 'centro', header: 'Centro de costos', valor: (f) => f.centro_costo ?? '', prioridad: 3 },
    { id: 'requisicion', header: 'Requisición', valor: (f) => f.requisicion ?? '', prioridad: 3 },
    ...(bandeja === 'DESCARTADOS' ? [{
      id: 'motivo', header: 'Motivo', valor: (f: FilaBandeja) => catalogos.motivos.find((m) => m.valor === f.motivo_descarte)?.etiqueta ?? f.motivo_descarte ?? '',
    }] : []),
    { id: 'postulado', header: 'Postulado', valor: (f) => f.created_at?.slice(0, 10) ?? '', prioridad: 3 },
  ]

  const kpis = [
    { label: 'En proceso', valor: lista.filter((f) => !['CONTRATADOS', 'DESCARTADOS'].includes(faseMeta(f.estado).bandeja)).length, color: 'text-gray-900' },
    { label: 'Postulación', valor: conteo.get('POSTULACION') ?? 0, color: 'text-blue-700' },
    { label: 'Evaluación', valor: (conteo.get('EVALUACION') ?? 0) + (conteo.get('SEGURIDAD') ?? 0), color: 'text-violet-700' },
    { label: 'Exámenes', valor: conteo.get('EXAMENES') ?? 0, color: 'text-cyan-700' },
    { label: 'Contratación', valor: conteo.get('CONTRATACION') ?? 0, color: 'text-lime-700' },
    { label: 'Estancados (+7 días)', valor: estancados, color: estancados ? 'text-red-600' : 'text-gray-400' },
  ]

  return (
    <div className="space-y-4">
      {/* Indicadores */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-gray-100 bg-white px-3 py-2.5 shadow-sm">
            <p className={`font-heading text-2xl font-bold ${k.color}`}>{k.valor}</p>
            <p className="text-xs text-gray-500">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Link href="/gestion-humana/requisiciones" className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-semibold text-gray-600 hover:border-brand-green hover:text-brand-green">
          <ClipboardList className="h-3.5 w-3.5" /> Requisiciones
        </Link>
        <Link href="/gestion-humana/plantillas" className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 font-semibold text-gray-600 hover:border-brand-green hover:text-brand-green">
          <FileSignature className="h-3.5 w-3.5" /> Plantillas de documentos
        </Link>
      </div>

      {/* Bandejas por fase */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-200">
        {BANDEJAS.map((b) => (
          <button key={b.key} onClick={() => cambiarBandeja(b.key)}
            className={'shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ' +
              (bandeja === b.key ? 'border-brand-green text-brand-green' : 'border-transparent text-gray-500 hover:text-gray-800')}>
            {b.label} <span className="ml-1 rounded-full bg-gray-100 px-1.5 text-[11px] text-gray-600">{conteo.get(b.key) ?? 0}</span>
          </button>
        ))}
      </div>

      <TablaEstandar<FilaBandeja>
        id={`ats-bandeja-${bandeja.toLowerCase()}`}
        titulo={`Candidatos · ${BANDEJAS.find((b) => b.key === bandeja)?.label}`}
        modulo="Postulaciones"
        entidad="candidatos"
        datos={visibles}
        columnas={columnas}
        filaId={(f) => f.id}
        busqueda="Buscar por nombre o documento…"
        onFilaClick={(f) => setAbierto(f.id)}
        textoDetalle="Expediente"
        filaClassName={(f) => (sel.has(f.id) ? 'bg-brand-green/5' : '')}
        acciones={puedeGestionar ? (f) => (
          <input type="checkbox" checked={sel.has(f.id)} onChange={() => alternar(f.id)} onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 accent-[#2E7D32]" aria-label="Seleccionar" />
        ) : undefined}
        anchoAcciones="w-10"
        herramientas={puedeGestionar ? (
          sel.size > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-gray-600">{sel.size} seleccionado(s)</span>
              <Boton variante="suave" onClick={() => setModal({ tipo: 'mover', filas: seleccionadas })}><ArrowRightLeft className="h-4 w-4" /> Mover de fase</Boton>
              <Boton variante="secundario" onClick={() => setModal({ tipo: 'descartar', filas: seleccionadas })}><Ban className="h-4 w-4" /> Descartar</Boton>
              <Boton variante="secundario" onClick={() => descargarWO([...sel])} disabled={descargando}>
                {descargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Excel nómina (WO)
              </Boton>
              <Boton variante="secundario" onClick={() => setSel(new Set())}><X className="h-4 w-4" /> Deseleccionar</Boton>
            </div>
          ) : visibles.length > 0 ? (
            <Boton variante="secundario" onClick={() => setSel(new Set(visibles.map((f) => f.id)))}><UserCheck className="h-4 w-4" /> Seleccionar todos en esta fase</Boton>
          ) : null
        ) : undefined}
        vacio={<p className="py-10 text-center text-sm text-gray-400">No hay candidatos en esta fase.</p>}
      />

      {abierto && (
        <Expediente
          candidatoId={abierto}
          fila={lista.find((f) => f.id === abierto) ?? null}
          catalogos={catalogos}
          puedeGestionar={puedeGestionar}
          onClose={() => setAbierto(null)}
          onCambio={refrescar}
        />
      )}

      {modal?.tipo === 'mover' && (
        <ModalMover filas={modal.filas} destinoInicial={modal.destino} catalogos={catalogos} onClose={() => setModal(null)}
          onHecho={(ok, destino) => {
            setLista((l) => l.map((f) => (ok.includes(f.id) ? { ...f, estado: destino, dias_en_fase: 0 } : f)))
            setModal(null)
            refrescar()
          }} />
      )}
      {modal?.tipo === 'descartar' && (
        <ModalDescartar filas={modal.filas} motivos={catalogos.motivos} motivoInicial={modal.motivo} onClose={() => setModal(null)}
          onHecho={() => { setModal(null); refrescar() }} />
      )}
    </div>
  )
}
