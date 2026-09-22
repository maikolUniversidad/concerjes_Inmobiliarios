'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  X, Loader2, IdCard, CheckCircle2, ArrowRightLeft, Ban, RotateCcw, User, FolderOpen, ClipboardCheck, Stethoscope,
  FileSignature, History, Camera,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { esCorte, faseMeta, semaforoDias, siguienteFase } from '@/lib/ats/fases'
import { BotonesFoto } from '@/components/foto/BotonesFoto'
import { ModalMover } from '../ModalMover'
import { ModalDescartar } from '../ModalDescartar'
import { subirDocumentoStaff } from '../acciones'
import { Badge, Boton, Modal } from '../ui'
import type { Catalogos, FilaBandeja } from '../tipos'
import type { DatosExp } from './tipos'
import { TabPersonal } from './TabPersonal'
import { TabDocumentos } from './TabDocumentos'
import { TabEvaluaciones } from './TabEvaluaciones'
import { TabExamenes } from './TabExamenes'
import { TabContratacion } from './TabContratacion'
import { TabHistorial } from './TabHistorial'

/* eslint-disable @typescript-eslint/no-explicit-any */

type TabKey = 'personal' | 'documentos' | 'evaluaciones' | 'examenes' | 'contratacion' | 'historial'

const TABS: { key: TabKey; label: string; icono: React.ReactNode }[] = [
  { key: 'personal', label: 'Personal', icono: <User className="h-4 w-4" /> },
  { key: 'documentos', label: 'Documentos', icono: <FolderOpen className="h-4 w-4" /> },
  { key: 'evaluaciones', label: 'Pruebas y evaluaciones', icono: <ClipboardCheck className="h-4 w-4" /> },
  { key: 'examenes', label: 'Exámenes médicos', icono: <Stethoscope className="h-4 w-4" /> },
  { key: 'contratacion', label: 'Contratación', icono: <FileSignature className="h-4 w-4" /> },
  { key: 'historial', label: 'Historial', icono: <History className="h-4 w-4" /> },
]

export function Expediente({
  candidatoId, fila, catalogos, puedeGestionar, onClose, onCambio,
}: {
  candidatoId: string
  fila: FilaBandeja | null
  catalogos: Catalogos
  puedeGestionar: boolean
  onClose: () => void
  onCambio: () => void
}) {
  const [sb] = useState<any>(() => createClient())
  const [d, setD] = useState<DatosExp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('personal')
  const [modal, setModal] = useState<null | { tipo: 'mover' | 'descartar'; destino?: string; motivo?: string }>(null)
  const [fotoAbierta, setFotoAbierta] = useState(false)

  const cargar = useCallback(async () => {
    const id = candidatoId
    const [cR, dirR, bensR, estR, expR, refR, docsR, consR, evsR, obsR, evalR, intR, kR, genR, yoR] = await Promise.all([
      sb.from('candidatos').select('*').eq('id', id).maybeSingle(),
      sb.from('candidato_direcciones').select('*').eq('candidato_id', id).is('vigente_hasta', null).order('vigente_desde', { ascending: false }).limit(1).maybeSingle(),
      sb.from('beneficiarios').select('*').eq('candidato_id', id),
      sb.from('candidato_estudios').select('*').eq('candidato_id', id).order('orden'),
      sb.from('candidato_experiencias').select('*').eq('candidato_id', id).order('orden'),
      sb.from('candidato_referencias').select('*').eq('candidato_id', id).order('tipo').order('orden'),
      sb.from('candidato_documentos').select('*').eq('candidato_id', id).order('created_at'),
      sb.from('consentimientos').select('*').eq('candidato_id', id).order('created_at'),
      sb.from('candidato_eventos').select('*').eq('candidato_id', id).order('created_at', { ascending: false }).limit(300),
      sb.from('candidato_observaciones').select('*').eq('candidato_id', id).order('created_at', { ascending: false }),
      sb.from('candidato_evaluaciones').select('*').eq('candidato_id', id).order('created_at', { ascending: false }),
      sb.from('prueba_intentos').select('*, prueba:pruebas(id, codigo, nombre, tipo, tiempo_limite_min, requiere_firma)').eq('candidato_id', id),
      sb.from('contratos').select('*').eq('candidato_id', id).order('generado_at', { ascending: false }),
      sb.from('documentos_generados')
        .select('id, plantilla_id, codigo_plantilla, nombre, estado, metodo_firma, firmado_at, generado_at, generado_por_nombre, archivo_firmado_path, visible_candidato, permite_firma_electronica, anulado_motivo, version_id, contrato_id')
        .eq('candidato_id', id).order('generado_at', { ascending: false }),
      sb.auth.getUser(),
    ])
    if (cR.error || !cR.data) { setError(cR.error?.message ?? 'No se encontró el candidato.'); return }
    const c = cR.data
    const dir = dirR.data ?? null
    const muns = [c.municipio_nacimiento, c.municipio_trabajo, dir?.municipio_codigo].filter(Boolean)
    const deps = [c.departamento_nacimiento, c.departamento_trabajo, dir?.departamento_codigo].filter(Boolean)
    const uno = (tabla: string, idv: string | null) =>
      idv ? sb.from(tabla).select('*').eq('id', idv).maybeSingle() : Promise.resolve({ data: null })
    const [munR, depR, epsR, afpR, cesR, cajaR, bancoR, nomR, histR, usrR, fotoR, yoRow] = await Promise.all([
      muns.length ? sb.from('municipios').select('codigo_dane, nombre').in('codigo_dane', muns) : Promise.resolve({ data: [] }),
      deps.length ? sb.from('departamentos').select('codigo_dane, nombre').in('codigo_dane', deps) : Promise.resolve({ data: [] }),
      uno('eps', c.eps_id), uno('afp', c.afp_id), uno('cesantias', c.cesantias_id), uno('cajas_compensacion', c.ccf_id), uno('bancos', c.banco_id),
      c.municipio_trabajo ? sb.from('municipios_nomina').select('*').eq('municipio_codigo', c.municipio_trabajo).maybeSingle() : Promise.resolve({ data: null }),
      c.numero_documento ? sb.rpc('historial_laboral', { p_documento: c.numero_documento }) : Promise.resolve({ data: [] }),
      c.auth_uid ? sb.from('usuarios').select('rol_id').eq('id', c.auth_uid).maybeSingle() : Promise.resolve({ data: null }),
      c.foto_perfil_path ? sb.storage.from('registro-vacantes').createSignedUrl(c.foto_perfil_path, 1800) : Promise.resolve({ data: null }),
      yoR.data?.user ? sb.from('usuarios').select('id, nombre, email').eq('id', yoR.data.user.id).maybeSingle() : Promise.resolve({ data: null }),
    ])
    const mun = new Map<string, string>((munR.data ?? []).map((m: any) => [m.codigo_dane, m.nombre]))
    const dep = new Map<string, string>((depR.data ?? []).map((x: any) => [x.codigo_dane, x.nombre]))
    const nomina = nomR.data ?? null
    const cajaNomina = nomina?.ccf_id ? (await sb.from('cajas_compensacion').select('*').eq('id', nomina.ccf_id).maybeSingle()).data : null

    setD({
      c, dir, bens: bensR.data ?? [], estudios: estR.data ?? [], experiencias: expR.data ?? [], referencias: refR.data ?? [],
      docs: docsR.data ?? [], consentimientos: consR.data ?? [], eventos: evsR.data ?? [], observaciones: obsR.data ?? [],
      evaluaciones: evalR.data ?? [], intentos: intR.data ?? [], contratos: kR.data ?? [], generados: genR.data ?? [],
      historial: histR.data ?? [],
      nombres: {
        munNacimiento: mun.get(c.municipio_nacimiento) ?? '', depNacimiento: dep.get(c.departamento_nacimiento) ?? '',
        munTrabajo: mun.get(c.municipio_trabajo) ?? '', depTrabajo: dep.get(c.departamento_trabajo) ?? '',
        munResidencia: dir?.municipio_codigo ? (mun.get(dir.municipio_codigo) ?? '') : '',
        depResidencia: dir?.departamento_codigo ? (dep.get(dir.departamento_codigo) ?? '') : '',
        eps: epsR.data, afp: afpR.data, cesantias: cesR.data, caja: cajaR.data, banco: bancoR.data,
      },
      nomina, cajaNomina,
      rolId: usrR.data?.rol_id ?? '',
      fotoUrl: fotoR.data?.signedUrl ?? null,
      yo: { id: yoRow.data?.id ?? null, nombre: yoRow.data?.nombre ?? yoRow.data?.email ?? null },
    })
  }, [sb, candidatoId])

  useEffect(() => { void cargar() }, [cargar])

  // La fila de la bandeja es la que usan los modales; si el expediente cambió de
  // fase, se toma el estado fresco.
  const filaActual: FilaBandeja | null = useMemo(() => {
    if (!d) return fila
    const base = fila ?? ({} as FilaBandeja)
    return {
      ...base, id: d.c.id, estado: d.c.estado, nombres: d.c.nombres, apellidos: d.c.apellidos,
      tipo_documento: d.c.tipo_documento, numero_documento: d.c.numero_documento, cargo_postulacion_id: d.c.cargo_postulacion_id,
      cargo: catalogos.cargos.find((x) => x.id === d.c.cargo_postulacion_id)?.nombre ?? base.cargo ?? null,
    }
  }, [d, fila, catalogos.cargos])

  const recargar = useCallback(async () => { await cargar() }, [cargar])
  const cambio = useCallback(() => { void cargar(); onCambio() }, [cargar, onCambio])

  // Foto tomada o subida por RRHH (p. ej. con la cámara de la oficina): queda
  // validada y pasa a ser la foto de perfil que sale en los formatos.
  async function guardarFoto(file: File) {
    const tipo = catalogos.tipos.find((t) => t.codigo === 'FOTO_CARNET')
    if (!tipo) { toast.error('No está configurado el tipo de documento de la foto (FOTO_CARNET).'); return }
    const r = await subirDocumentoStaff(sb, candidatoId, tipo, file, 'Foto de perfil tomada por RRHH', { validado: true })
    if (r.error || !r.path) { toast.error(r.error ?? 'No se pudo guardar la foto.'); return }
    const { error } = await sb.from('candidatos').update({ foto_perfil_path: r.path, foto_perfil_at: new Date().toISOString() }).eq('id', candidatoId)
    if (error) { toast.error(error.message); return }
    toast.success('Foto de perfil guardada.')
    setFotoAbierta(false)
    await cargar()
  }

  const estado = d?.c.estado ?? fila?.estado ?? ''
  const meta = faseMeta(estado)
  const siguiente = siguienteFase(estado)
  const corte = esCorte(estado)
  const dias = d ? Math.floor((Date.now() - new Date(d.c.fase_desde).getTime()) / 86400000) : (fila?.dias_en_fase ?? 0)
  const sem = semaforoDias(dias)
  const cargo = catalogos.cargos.find((x) => x.id === d?.c.cargo_postulacion_id)?.nombre ?? fila?.cargo ?? 'Sin cargo'

  const props = d ? { d, sb, catalogos, puedeGestionar, recargar, onCambio: cambio } : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-6xl flex-col overflow-hidden bg-gray-50 shadow-2xl sm:h-[95vh] sm:rounded-2xl">
        {/* Encabezado */}
        <div className="shrink-0 border-b border-gray-100 bg-white px-4 py-3 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button type="button" onClick={() => d && setFotoAbierta(true)} className="relative shrink-0"
                title={puedeGestionar ? 'Foto de perfil: tomar o cambiar' : 'Foto de perfil'} aria-label="Foto de perfil">
                {d?.fotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.fotoUrl} alt="Foto" className="h-16 w-12 rounded-lg border border-gray-200 object-cover" />
                ) : (
                  <div className="flex h-16 w-12 items-center justify-center rounded-lg bg-gray-100"><IdCard className="h-6 w-6 text-gray-400" /></div>
                )}
                {puedeGestionar && d && (
                  <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-brand-green text-white ring-2 ring-white">
                    <Camera className="h-3 w-3" />
                  </span>
                )}
              </button>
              <div className="min-w-0">
                <h2 className="truncate font-heading text-lg font-bold text-gray-900">{d?.c.nombres ?? fila?.nombres} {d?.c.apellidos ?? fila?.apellidos}</h2>
                <p className="truncate text-xs text-gray-500">
                  {d?.c.tipo_documento ?? fila?.tipo_documento} {d?.c.numero_documento ?? fila?.numero_documento} · Candidato para <strong>{cargo}</strong>
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge className={meta.color}>{meta.label}</Badge>
                  {!corte && <Badge className={sem.color}>{sem.label} en la fase</Badge>}
                  {d?.c.motivo_descarte && <Badge className="bg-red-50 text-red-700">Motivo: {catalogos.motivos.find((m) => m.valor === d.c.motivo_descarte)?.etiqueta ?? d.c.motivo_descarte}</Badge>}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100" aria-label="Cerrar"><X className="h-5 w-5" /></button>
          </div>

          {puedeGestionar && d && (
            <div className="mt-3 flex flex-wrap gap-2">
              {!corte && siguiente && (
                <Boton onClick={() => setModal({ tipo: 'mover', destino: siguiente })}>
                  <CheckCircle2 className="h-4 w-4" /> Aprobar → {faseMeta(siguiente).label}
                </Boton>
              )}
              {!corte && <Boton variante="secundario" onClick={() => setModal({ tipo: 'mover' })}><ArrowRightLeft className="h-4 w-4" /> Mover a otra fase</Boton>}
              {!corte && <Boton variante="secundario" onClick={() => setModal({ tipo: 'descartar' })}><Ban className="h-4 w-4 text-red-600" /> Descartar</Boton>}
              {corte && <Boton variante="suave" onClick={() => setModal({ tipo: 'mover', destino: 'EN_VERIFICACION' })}><RotateCcw className="h-4 w-4" /> Reactivar</Boton>}
            </div>
          )}

          <div className="-mb-3 mt-3 flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ' +
                  (tab === t.key ? 'border-brand-green text-brand-green' : 'border-transparent text-gray-500 hover:text-gray-800')}>
                {t.icono}{t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Contenido */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-5">
          {error ? (
            <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>
          ) : !props ? (
            <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-brand-green" /></div>
          ) : (
            <>
              {tab === 'personal' && <TabPersonal {...props} />}
              {tab === 'documentos' && <TabDocumentos {...props} />}
              {tab === 'evaluaciones' && <TabEvaluaciones {...props} />}
              {tab === 'examenes' && <TabExamenes {...props} onNoApto={() => setModal({ tipo: 'descartar', motivo: 'EXAMENES_MEDICOS' })} />}
              {tab === 'contratacion' && <TabContratacion {...props} />}
              {tab === 'historial' && <TabHistorial {...props} />}
            </>
          )}
        </div>
      </div>

      {modal?.tipo === 'mover' && filaActual && (
        <ModalMover filas={[filaActual]} destinoInicial={modal.destino} catalogos={catalogos} onClose={() => setModal(null)}
          onHecho={() => { setModal(null); cambio() }} />
      )}
      {modal?.tipo === 'descartar' && filaActual && (
        <ModalDescartar filas={[filaActual]} motivos={catalogos.motivos} motivoInicial={modal.motivo} onClose={() => setModal(null)}
          onHecho={() => { setModal(null); cambio() }} />
      )}
      {fotoAbierta && d && (
        <Modal titulo="Foto de perfil" subtitulo={`${d.c.nombres ?? ''} ${d.c.apellidos ?? ''}`} onClose={() => setFotoAbierta(false)} ancho="max-w-md">
          <div className="flex flex-col items-center gap-4">
            {d.fotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.fotoUrl} alt="Foto de perfil" className="h-64 w-48 rounded-xl border border-gray-200 object-cover" />
            ) : (
              <div className="flex h-64 w-48 items-center justify-center rounded-xl bg-gray-100 text-sm text-gray-400">Sin foto</div>
            )}
            <p className="text-center text-xs text-gray-500">
              Sale en la hoja de vida, la actualización de datos y los resultados de las pruebas. Los formatos que se generen
              después la llevan incluida.
            </p>
            {puedeGestionar && (
              <div className="w-full">
                <BotonesFoto onFoto={guardarFoto} textoTomar={d.fotoUrl ? 'Tomar otra con la cámara' : 'Tomar con la cámara'}
                  textoSubir={d.fotoUrl ? 'Cambiar por un archivo' : 'Subir foto'} />
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
