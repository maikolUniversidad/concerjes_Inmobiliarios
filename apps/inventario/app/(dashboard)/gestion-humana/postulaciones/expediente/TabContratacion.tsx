'use client'

import { useMemo, useState } from 'react'
import {
  FileSignature, Loader2, Save, Eye, Ban, Upload, FileCheck2, Wand2, ChevronDown, AlertTriangle, UserCheck, FileSpreadsheet, Plus, Trash2, Printer,
} from 'lucide-react'
import { toast } from 'sonner'
import { VisorDocumento } from '@/components/documentos/VisorDocumento'
import { MiniaturaArchivo } from '@/components/documentos/MiniaturaArchivo'
import { VisorArchivo } from '@/components/documentos/VisorArchivo'
import { useUrlsFirmadas } from '@/components/documentos/useUrlsFirmadas'
import { htmlParaMostrar, imprimirHtml } from '@/lib/documentos/html'
import { PaqueteDocumentos } from './PaqueteDocumentos'
import { contratoVacio, MODALIDADES_CONTRATO, CLASES_SALARIO, CLAUSULAS_ADICIONALES_POR_DEFECTO, type ContratoForm } from '@/lib/ats/contrato'
import { ordenFase } from '@/lib/ats/fases'
import { DOCGEN_ESTADO } from '../estados'
import { descargarDesdeApi } from '../acciones'
import { Seccion, Boton, Badge, Campo, Modal, inputCls, fechaHora } from '../ui'
import type { PropsTab } from './tipos'

/* eslint-disable @typescript-eslint/no-explicit-any */

const hoyISO = () => {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return s
}

const EXTRAS: { clave: string; label: string; tipo?: string }[] = [
  { clave: 'responsable_nombre', label: 'Quien socializa / recibe (RRHH)' },
  { clave: 'responsable_cargo', label: 'Cargo de quien socializa' },
  { clave: 'evaluador_nombre', label: 'Psicólogo(a) evaluador(a)' },
  { clave: 'puesto_direccion', label: 'Dirección del puesto de trabajo' },
  { clave: 'puesto_telefono', label: 'Teléfono del puesto' },
  { clave: 'puesto_interventor', label: 'Interventor / supervisor del cliente' },
  { clave: 'plazo_dias', label: 'Días de plazo para completar documentos', tipo: 'number' },
  { clave: 'pagare_valor', label: 'Valor del pagaré (vacío = en blanco)' },
  { clave: 'descuento_valor', label: 'Cuantía del descuento autorizado (vacío = en blanco)' },
]

const MOMENTOS: Record<string, string> = { SELECCION: 'Selección', CONTRATACION: 'Contratación e ingreso' }

export function TabContratacion({ d, sb, catalogos, puedeGestionar, recargar, onCambio }: PropsTab) {
  const c = d.c
  const vigente = d.contratos.find((k) => k.estado !== 'ANULADO') ?? null
  const arlDefecto = catalogos.arl.find((a) => /colpatria/i.test(a.nombre))?.id ?? ''
  const [k, setK] = useState<ContratoForm>(() => vigente ? {
    id: vigente.id, codigo: vigente.codigo, estado: vigente.estado,
    tipo_contrato: vigente.tipo_contrato ?? 'OBRA_LABOR', cargo_id: vigente.cargo_id ?? '', centro_costo_id: vigente.centro_costo_id ?? '',
    fecha_inicio_labores: vigente.fecha_inicio_labores ?? hoyISO(), salario: Number(vigente.salario ?? 0),
    salario_texto: vigente.salario_texto ?? '', clase_salario: vigente.clase_salario ?? 'Normal',
    incluye_auxilio_transporte: !!vigente.incluye_auxilio_transporte, periodo_pago: vigente.periodo_pago ?? '',
    lugar_labores: vigente.lugar_labores ?? '', ciudad_contratacion: vigente.ciudad_contratacion ?? '',
    contrato_servicio: vigente.contrato_servicio ?? '', periodo_prueba_dias: vigente.periodo_prueba_dias ?? 60,
    fecha_fin_contrato: vigente.fecha_fin_contrato ?? '', modalidad_jornada: vigente.modalidad_jornada ?? '',
    arl_id: vigente.arl_id ?? arlDefecto, tarifa_arl: Number(vigente.tarifa_arl ?? 1.044),
    ciudad_firma: vigente.ciudad_firma ?? '', fecha_firma: vigente.fecha_firma ?? hoyISO(),
    testigo1_nombre: vigente.testigo1_nombre ?? '', testigo1_documento: vigente.testigo1_documento ?? '',
    testigo2_nombre: vigente.testigo2_nombre ?? '', testigo2_documento: vigente.testigo2_documento ?? '',
    clausulas_adicionales: vigente.clausulas_adicionales ?? [], observaciones: vigente.observaciones ?? '',
  } : {
    ...contratoVacio({ cargoId: c.cargo_postulacion_id, centroId: c.centro_costo_id, smlv: catalogos.smlv, hoy: hoyISO(), arlId: arlDefecto }),
    lugar_labores: d.nombres.munTrabajo || 'BOGOTÁ', ciudad_contratacion: 'BOGOTÁ',
  })
  const [abiertoContrato, setAbiertoContrato] = useState(!vigente)
  const [guardando, setGuardando] = useState<string | null>(null)
  const entrevista = d.evaluaciones.find((e) => e.tipo === 'ENTREVISTA')
  const [extras, setExtras] = useState<Record<string, string>>({
    responsable_nombre: d.yo.nombre ?? '', responsable_cargo: 'Analista de selección y contratación',
    evaluador_nombre: entrevista?.evaluador_nombre ?? '', plazo_dias: '8',
  })
  const [verExtras, setVerExtras] = useState(false)
  const [selPl, setSelPl] = useState<Set<string>>(() => new Set(catalogos.plantillas.filter((p) => p.obligatoria).map((p) => p.codigo)))
  const [previa, setPrevia] = useState<any[] | null>(null)
  const [visor, setVisor] = useState<{ titulo: string; cuerpo: string } | null>(null)

  const up = (patch: Partial<ContratoForm>) => setK((x) => ({ ...x, ...patch }))
  const generadosActivos = d.generados.filter((g) => g.estado !== 'ANULADO')
  const porFirmar = generadosActivos.filter((g) => g.estado === 'PENDIENTE_FIRMA')
  // Escaneados de lo firmado en papel: miniatura y visor a pantalla completa.
  const urlsEscaneados = useUrlsFirmadas(sb, generadosActivos.map((g) => g.archivo_firmado_path))
  const [escaneado, setEscaneado] = useState<any | null>(null)
  const grupos = useMemo(() => {
    const m = new Map<string, typeof catalogos.plantillas>()
    for (const p of catalogos.plantillas) m.set(p.momento, [...(m.get(p.momento) ?? []), p])
    return [...m.entries()]
  }, [catalogos.plantillas])

  async function guardarContrato() {
    if (!k.cargo_id) { toast.error('Elija el cargo del contrato.'); return }
    if (!k.fecha_inicio_labores) { toast.error('Falta la fecha de iniciación de labores.'); return }
    if (k.tipo_contrato === 'OBRA_LABOR' && k.contrato_servicio.trim().length < 20) {
      toast.error('Describa la obra o labor contratada (contrato de servicio y cliente). La Ley 2466 de 2025 exige precisarla.')
      return
    }
    setGuardando('contrato')
    const fila: Record<string, unknown> = {
      candidato_id: c.id, cargo_id: k.cargo_id, centro_costo_id: k.centro_costo_id || null, requisicion_id: c.requisicion_id ?? null,
      tipo_contrato: k.tipo_contrato, fecha_inicio_labores: k.fecha_inicio_labores, salario: Number(k.salario) || 0,
      salario_texto: k.salario_texto, clase_salario: k.clase_salario, incluye_auxilio_transporte: k.incluye_auxilio_transporte,
      periodo_pago: k.periodo_pago, lugar_labores: k.lugar_labores, ciudad_contratacion: k.ciudad_contratacion,
      contrato_servicio: k.contrato_servicio, periodo_prueba_dias: Number(k.periodo_prueba_dias) || 0,
      fecha_fin_contrato: k.fecha_fin_contrato || null, fecha_fin_periodo_prueba: null, modalidad_jornada: k.modalidad_jornada,
      arl_id: k.arl_id || null, tarifa_arl: Number(k.tarifa_arl) || 1.044, ciudad_firma: k.ciudad_firma, fecha_firma: k.fecha_firma || null,
      testigo1_nombre: k.testigo1_nombre || null, testigo1_documento: k.testigo1_documento || null,
      testigo2_nombre: k.testigo2_nombre || null, testigo2_documento: k.testigo2_documento || null,
      clausulas_adicionales: k.clausulas_adicionales.filter((x) => x.trim()), observaciones: k.observaciones || null,
      eps_id: c.eps_id, afp_id: c.afp_id, cesantias_id: c.cesantias_id, ccf_id: c.ccf_id ?? d.nomina?.ccf_id ?? null,
      modalidad_salarial: k.clase_salario === 'Salario Integral' ? 'INTEGRAL' : 'SMLV_AUXILIO',
      template_version: `CONTRATO_OBRA_LABOR v${catalogos.plantillas.find((p) => p.codigo === 'CONTRATO_OBRA_LABOR')?.version_vigente ?? 1}`,
    }
    const r = k.id
      ? await sb.from('contratos').update(fila).eq('id', k.id).select('id, codigo, estado').single()
      : await sb.from('contratos').insert({ ...fila, estado: 'BORRADOR', generado_por: d.yo.id }).select('id, codigo, estado').single()
    setGuardando(null)
    if (r.error) { toast.error(r.error.message); return }
    up({ id: r.data.id, codigo: r.data.codigo, estado: r.data.estado })
    await sb.from('candidato_eventos').insert({ candidato_id: c.id, tipo: 'CONTRATO', motivo: `Contrato ${r.data.codigo} ${k.id ? 'actualizado' : 'creado'}`, actor: d.yo.id, actor_nombre: d.yo.nombre })
    toast.success(`Contrato ${r.data.codigo} guardado.`)
    setAbiertoContrato(false)
    await recargar(); onCambio()
  }

  async function generar(vistaPrevia: boolean) {
    if (selPl.size === 0) { toast.error('Seleccione al menos un documento.'); return }
    setGuardando(vistaPrevia ? 'previa' : 'generar')
    const res = await fetch('/api/gestion-humana/documentos/generar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidato_id: c.id, codigos: [...selPl], contrato_id: k.id ?? null, extras, vista_previa: vistaPrevia }),
    })
    const j = await res.json().catch(() => ({}))
    setGuardando(null)
    if (!res.ok) { toast.error(j.error ?? 'No se pudieron generar.'); return }
    setPrevia(j.documentos ?? [])
    if (!vistaPrevia) {
      toast.success(`${j.generados ?? 0} documento(s) generado(s)${j.por_firmar ? `; ${j.por_firmar} quedan para firma del candidato` : ''}.`)
      await recargar(); onCambio()
    }
  }

  async function ver(g: any, imprimir = false) {
    const { data, error } = await sb.from('documentos_generados').select('html_render, html_firmado, firma_evidencia, sha256, nombre').eq('id', g.id).single()
    if (error || !data) { toast.error('No se pudo abrir el documento.'); return }
    const cuerpo = htmlParaMostrar(data, { fotoUrl: d.fotoUrl })
    if (imprimir) imprimirHtml(cuerpo, data.nombre)
    else setVisor({ titulo: data.nombre, cuerpo })
  }

  async function anular(g: any) {
    const motivo = window.prompt(`Motivo para anular «${g.nombre}»:`)
    if (!motivo) return
    const { error } = await sb.from('documentos_generados').update({ estado: 'ANULADO', anulado_at: new Date().toISOString(), anulado_motivo: motivo }).eq('id', g.id)
    if (error) { toast.error(error.message); return }
    await sb.from('candidato_eventos').insert({ candidato_id: c.id, tipo: 'DOCUMENTO', motivo: `Anulado: ${g.nombre}`, detalle: { motivo }, actor: d.yo.id, actor_nombre: d.yo.nombre })
    await recargar(); onCambio()
  }

  async function firmadoEnPapel(g: any, file: File) {
    setGuardando(g.id)
    const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().slice(0, 5)
    const path = `${c.id}/FIRMADOS/${g.id}.${ext}`
    const upl = await sb.storage.from('registro-vacantes').upload(path, file, { contentType: file.type || undefined, upsert: true })
    if (upl.error) { setGuardando(null); toast.error(upl.error.message); return }
    const { error } = await sb.from('documentos_generados').update({
      estado: 'FIRMADO', metodo_firma: 'MANUSCRITA', archivo_firmado_path: path, archivo_firmado_at: new Date().toISOString(),
      firmado_at: new Date().toISOString(), firmado_por_staff: d.yo.id,
    }).eq('id', g.id)
    if (!error) await sb.from('candidato_eventos').insert({ candidato_id: c.id, tipo: 'FIRMA', motivo: `${g.nombre} (firmado en papel)`, detalle: { documento_id: g.id, metodo: 'MANUSCRITA' }, actor: d.yo.id, actor_nombre: d.yo.nombre })
    setGuardando(null)
    if (error) { toast.error(error.message); return }
    toast.success('Documento firmado en papel registrado.')
    await recargar(); onCambio()
  }

  async function entregarNomina() {
    if (!k.id) { toast.error('Guarde primero el contrato.'); return }
    if (porFirmar.length && !window.confirm(`Hay ${porFirmar.length} documento(s) sin firmar. ¿Entregar a nómina de todos modos?`)) return
    setGuardando('nomina')
    const { error } = await sb.rpc('vac_contratar_candidato', { p_candidato: c.id, p_contrato: k.id })
    if (!error) await sb.from('postulaciones').update({ estado: 'CONTRATADO' }).eq('candidato_id', c.id)
    setGuardando(null)
    if (error) { toast.error(error.message); return }
    toast.success('Contratado: la persona ya está en la planta de personal.')
    await recargar(); onCambio()
  }

  async function descargarWO() {
    setGuardando('wo')
    const err = await descargarDesdeApi('/api/gestion-humana/postulaciones/wo', { ids: [c.id] }, `WO_${c.numero_documento}.xlsx`)
    setGuardando(null)
    if (err) toast.error(err)
  }

  const contratado = ['CONTRATADO', 'ACTIVO'].includes(c.estado)
  const antesDeTiempo = ordenFase(c.estado) >= 0 && ordenFase(c.estado) < ordenFase('APTO')

  return (
    <div className="space-y-4">
      {antesDeTiempo && (
        <p className="flex items-start gap-1.5 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          El candidato aún no tiene concepto médico de aptitud. Puede preparar el contrato, pero la contratación normalmente va después de los exámenes.
        </p>
      )}

      {/* ── Contrato ─────────────────────────────────────────────────────── */}
      <Seccion titulo={k.codigo ? `Contrato ${k.codigo}` : 'Contrato de trabajo'} icono={<FileSignature className="h-4 w-4 text-brand-green" />}
        acciones={
          <button onClick={() => setAbiertoContrato((v) => !v)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-green">
            {abiertoContrato ? 'Ocultar' : 'Editar'} <ChevronDown className={'h-3.5 w-3.5 transition-transform ' + (abiertoContrato ? 'rotate-180' : '')} />
          </button>
        }>
        {!abiertoContrato && k.id ? (
          <p className="text-sm text-gray-700">
            {MODALIDADES_CONTRATO.find((m) => m.value === k.tipo_contrato)?.label} · {catalogos.cargos.find((x) => x.id === k.cargo_id)?.nombre} ·
            inicia {k.fecha_inicio_labores} · {catalogos.centros.find((x) => x.id === k.centro_costo_id)?.codigo ?? 'sin centro de costos'} · {k.salario_texto}
          </p>
        ) : (
          <fieldset disabled={!puedeGestionar} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo label="Modalidad">
                <select value={k.tipo_contrato} onChange={(e) => up({ tipo_contrato: e.target.value })} className={inputCls}>
                  {MODALIDADES_CONTRATO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Campo>
              <Campo label="Cargo">
                <select value={k.cargo_id} onChange={(e) => up({ cargo_id: e.target.value })} className={inputCls}>
                  <option value="">— Seleccione —</option>
                  {catalogos.cargos.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
              </Campo>
              <Campo label="Centro de costos">
                <select value={k.centro_costo_id} onChange={(e) => up({ centro_costo_id: e.target.value })} className={inputCls}>
                  <option value="">— Seleccione —</option>
                  {catalogos.centros.map((x) => <option key={x.id} value={x.id}>{x.codigo}</option>)}
                </select>
              </Campo>
              <Campo label="Fecha de iniciación de labores"><input type="date" value={k.fecha_inicio_labores} onChange={(e) => up({ fecha_inicio_labores: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Salario (número)" hint={catalogos.smlv ? `SMLV del año: $ ${catalogos.smlv.toLocaleString('es-CO')}` : undefined}>
                <input type="number" min={0} value={k.salario} onChange={(e) => up({ salario: Number(e.target.value) })} className={inputCls} />
              </Campo>
              <Campo label="Clase de salario (nómina)">
                <select value={k.clase_salario} onChange={(e) => up({ clase_salario: e.target.value })} className={inputCls}>
                  {CLASES_SALARIO.map((x) => <option key={x}>{x}</option>)}
                </select>
              </Campo>
            </div>
            <Campo label="Salario como se imprime en el contrato"><input value={k.salario_texto} onChange={(e) => up({ salario_texto: e.target.value })} className={inputCls} /></Campo>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo label="Periodos de pago"><input value={k.periodo_pago} onChange={(e) => up({ periodo_pago: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Lugar donde desempeñará las labores"><input value={k.lugar_labores} onChange={(e) => up({ lugar_labores: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Ciudad donde es contratado"><input value={k.ciudad_contratacion} onChange={(e) => up({ ciudad_contratacion: e.target.value })} className={inputCls} /></Campo>
            </div>
            <Campo label="Obra o labor contratada (contrato de servicio y cliente)" hint="Ej.: CONTRATO DE SERVICIO DE ASEO, CAFETERÍA Y MANTENIMIENTO: TMSA-LP-04-2026 EMPRESA DE TRANSPORTES TRANSMILENIO S.A.">
              <textarea rows={2} value={k.contrato_servicio} onChange={(e) => up({ contrato_servicio: e.target.value })} className={inputCls} />
            </Campo>
            <div className="grid gap-3 sm:grid-cols-4">
              <Campo label="Periodo de prueba (días)"><input type="number" min={0} max={60} value={k.periodo_prueba_dias} onChange={(e) => up({ periodo_prueba_dias: Number(e.target.value) })} className={inputCls} /></Campo>
              <Campo label="Fin del contrato (si aplica)"><input type="date" value={k.fecha_fin_contrato} onChange={(e) => up({ fecha_fin_contrato: e.target.value })} className={inputCls} /></Campo>
              <Campo label="ARL">
                <select value={k.arl_id} onChange={(e) => up({ arl_id: e.target.value })} className={inputCls}>
                  <option value="">— Seleccione —</option>
                  {catalogos.arl.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
              </Campo>
              <Campo label="Tarifa ARL (%)"><input type="number" step="0.001" value={k.tarifa_arl} onChange={(e) => up({ tarifa_arl: Number(e.target.value) })} className={inputCls} /></Campo>
              <Campo label="Jornada"><input value={k.modalidad_jornada} onChange={(e) => up({ modalidad_jornada: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Ciudad de firma"><input value={k.ciudad_firma} onChange={(e) => up({ ciudad_firma: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Fecha de firma"><input type="date" value={k.fecha_firma} onChange={(e) => up({ fecha_firma: e.target.value })} className={inputCls} /></Campo>
              <label className="flex items-center gap-2 pt-5 text-sm text-gray-700">
                <input type="checkbox" checked={k.incluye_auxilio_transporte} onChange={(e) => up({ incluye_auxilio_transporte: e.target.checked })} className="h-4 w-4 accent-[#2E7D32]" /> Auxilio de transporte
              </label>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Campo label="Testigo 1"><input value={k.testigo1_nombre} onChange={(e) => up({ testigo1_nombre: e.target.value })} className={inputCls} /></Campo>
              <Campo label="C.C. testigo 1"><input value={k.testigo1_documento} onChange={(e) => up({ testigo1_documento: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Testigo 2"><input value={k.testigo2_nombre} onChange={(e) => up({ testigo2_nombre: e.target.value })} className={inputCls} /></Campo>
              <Campo label="C.C. testigo 2"><input value={k.testigo2_documento} onChange={(e) => up({ testigo2_documento: e.target.value })} className={inputCls} /></Campo>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-600">Cláusulas adicionales</span>
                <button type="button" onClick={() => up({ clausulas_adicionales: [...CLAUSULAS_ADICIONALES_POR_DEFECTO] })} className="text-[11px] font-semibold text-brand-green">Restaurar las de la minuta</button>
              </div>
              <div className="space-y-1.5">
                {k.clausulas_adicionales.map((x, i) => (
                  <div key={i} className="flex gap-1.5">
                    <span className="pt-2 text-xs font-bold text-gray-400">{i + 1}.</span>
                    <textarea rows={2} value={x} onChange={(e) => up({ clausulas_adicionales: k.clausulas_adicionales.map((y, j) => (j === i ? e.target.value : y)) })} className={inputCls} />
                    <button type="button" onClick={() => up({ clausulas_adicionales: k.clausulas_adicionales.filter((_, j) => j !== i) })} className="text-red-400 hover:text-red-600" aria-label="Quitar"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => up({ clausulas_adicionales: [...k.clausulas_adicionales, ''] })} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-green"><Plus className="h-3.5 w-3.5" /> Agregar cláusula</button>
              </div>
            </div>
            <Campo label="Observaciones"><textarea rows={2} value={k.observaciones} onChange={(e) => up({ observaciones: e.target.value })} className={inputCls} /></Campo>
            {puedeGestionar && (
              <Boton onClick={guardarContrato} disabled={guardando === 'contrato'}>{guardando === 'contrato' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar contrato</Boton>
            )}
          </fieldset>
        )}
      </Seccion>

      {/* ── Documentos para firmar ───────────────────────────────────────── */}
      <Seccion titulo="Documentos de selección y contratación" icono={<Wand2 className="h-4 w-4 text-brand-green" />}>
        <p className="mb-3 text-xs text-gray-500">
          Se llenan solos con lo que el candidato registró y lo que usted definió arriba. El candidato los firma desde su celular en «Mi proceso»;
          los que se firman en papel se imprimen aquí y luego se sube el escaneado.
        </p>
        {puedeGestionar && (
          <>
            <div className="grid gap-3 lg:grid-cols-2">
              {grupos.map(([momento, lista]) => (
                <div key={momento} className="rounded-lg border border-gray-100 p-2.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{MOMENTOS[momento] ?? momento}</p>
                    <button type="button" className="text-[11px] font-semibold text-brand-green"
                      onClick={() => setSelPl((s) => { const n = new Set(s); const todos = lista.every((p) => n.has(p.codigo)); lista.forEach((p) => (todos ? n.delete(p.codigo) : n.add(p.codigo))); return n })}>
                      Todos / ninguno
                    </button>
                  </div>
                  <ul className="space-y-1">
                    {lista.map((p) => {
                      const ya = generadosActivos.find((g) => g.codigo_plantilla === p.codigo)
                      return (
                        <li key={p.codigo}>
                          <label className="flex cursor-pointer items-start gap-2 text-sm">
                            <input type="checkbox" checked={selPl.has(p.codigo)} onChange={() => setSelPl((s) => { const n = new Set(s); if (n.has(p.codigo)) n.delete(p.codigo); else n.add(p.codigo); return n })}
                              className="mt-0.5 h-4 w-4 accent-[#2E7D32]" />
                            <span className="min-w-0">
                              <span className="text-gray-800">{p.nombre}</span>
                              <span className="ml-1 text-[11px] text-gray-400">v{p.version_vigente}</span>
                              {p.requiere_contrato && !k.id && <span className="ml-1 text-[11px] text-amber-700">· necesita contrato</span>}
                              {!p.permite_firma_electronica && <span className="ml-1 text-[11px] text-gray-500">· firma en papel</span>}
                              {!p.visible_candidato && <span className="ml-1 text-[11px] text-gray-500">· uso interno</span>}
                              {ya && <span className="ml-1 text-[11px] text-brand-green">· ya generado ({DOCGEN_ESTADO[ya.estado]?.label.toLowerCase()})</span>}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>

            <button type="button" onClick={() => setVerExtras((v) => !v)} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-green">
              Datos adicionales que piden algunos formatos <ChevronDown className={'h-3.5 w-3.5 transition-transform ' + (verExtras ? 'rotate-180' : '')} />
            </button>
            {verExtras && (
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {EXTRAS.map((x) => (
                  <Campo key={x.clave} label={x.label}>
                    <input type={x.tipo ?? 'text'} value={extras[x.clave] ?? ''} onChange={(e) => setExtras({ ...extras, [x.clave]: e.target.value })} className={inputCls} />
                  </Campo>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Boton variante="secundario" onClick={() => generar(true)} disabled={!!guardando}>
                {guardando === 'previa' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Revisar antes de generar
              </Boton>
              <Boton onClick={() => generar(false)} disabled={!!guardando}>
                {guardando === 'generar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Generar {selPl.size} documento(s)
              </Boton>
            </div>
          </>
        )}

        {previa && (
          <ul className="mt-3 space-y-1 rounded-lg bg-gray-50 p-2.5 text-xs">
            {previa.map((r) => (
              <li key={r.codigo} className="flex flex-wrap items-start justify-between gap-2">
                <span className="font-medium text-gray-800">{r.nombre}</span>
                <span className={r.estado === 'OMITIDO' || r.estado === 'ERROR' ? 'text-amber-700' : 'text-green-700'}>
                  {r.estado === 'LISTO' ? 'Listo' : DOCGEN_ESTADO[r.estado]?.label ?? r.estado}{r.motivo ? ` · ${r.motivo}` : ''}
                  {r.vacias?.length ? <span className="text-amber-700"> · vacíos: {r.vacias.join(', ')}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}

        {/* Generados */}
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">Generados ({generadosActivos.length}) · por firmar {porFirmar.length}</p>
          {generadosActivos.length === 0 ? <p className="text-sm text-gray-400">Todavía no se ha generado ningún documento.</p> : (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
              {generadosActivos.map((g) => {
                const e = DOCGEN_ESTADO[g.estado] ?? DOCGEN_ESTADO.GENERADO
                return (
                  <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    {g.archivo_firmado_path && (
                      <MiniaturaArchivo url={urlsEscaneados[g.archivo_firmado_path] ?? null} nombre={g.archivo_firmado_path.split('/').pop() ?? g.nombre}
                        tamano="sm" onAbrir={() => setEscaneado(g)} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-800">{g.nombre}</p>
                      <p className="text-[11px] text-gray-400">
                        Generado {fechaHora(g.generado_at)}{g.generado_por_nombre ? ` por ${g.generado_por_nombre}` : ''}
                        {g.firmado_at && ` · firmado ${fechaHora(g.firmado_at)} (${g.metodo_firma === 'MANUSCRITA' ? 'en papel' : 'en la plataforma'})`}
                        {!g.visible_candidato && ' · uso interno'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className={e.color}>{e.label}</Badge>
                      <button onClick={() => ver(g)} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"><Eye className="h-3.5 w-3.5" /> Ver</button>
                      <button onClick={() => ver(g, true)} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"><Printer className="h-3.5 w-3.5" /> Imprimir</button>
                      {g.archivo_firmado_path && <button onClick={() => setEscaneado(g)} className="inline-flex items-center gap-1 rounded bg-green-50 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100"><FileCheck2 className="h-3.5 w-3.5" /> Escaneado</button>}
                      {puedeGestionar && g.estado === 'PENDIENTE_FIRMA' && (
                        <label className="inline-flex cursor-pointer items-center gap-1 rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">
                          {guardando === g.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Firmado en papel
                          <input type="file" hidden accept="application/pdf,image/*" onChange={(ev) => { const f = ev.target.files?.[0]; ev.target.value = ''; if (f) void firmadoEnPapel(g, f) }} />
                        </label>
                      )}
                      {puedeGestionar && <button onClick={() => anular(g)} className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"><Ban className="h-3.5 w-3.5" /> Anular</button>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Seccion>

      {/* ── Paquete en un solo PDF ───────────────────────────────────────── */}
      <PaqueteDocumentos d={d} sb={sb} catalogos={catalogos} puedeGestionar={puedeGestionar} recargar={recargar} onCambio={onCambio} />

      {/* ── Entrega a nómina ─────────────────────────────────────────────── */}
      <Seccion titulo="Entrega a nómina" icono={<UserCheck className="h-4 w-4 text-brand-green" />}>
        <p className="mb-2 text-xs text-gray-500">
          Contratar crea (o reactiva) la ficha en la planta de personal con su vinculación activa, amarrada a este contrato, y deja la fila lista para el cargue en WO.
        </p>
        <div className="flex flex-wrap gap-2">
          {puedeGestionar && !contratado && (
            <Boton onClick={entregarNomina} disabled={!k.id || guardando === 'nomina'}>
              {guardando === 'nomina' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />} Contratar y entregar a nómina
            </Boton>
          )}
          {contratado && <Badge className="bg-green-100 text-green-700">Contratado · en planta de personal</Badge>}
          <Boton variante="secundario" onClick={descargarWO} disabled={guardando === 'wo'}>
            {guardando === 'wo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Fila para WO (Excel)
          </Boton>
        </div>
      </Seccion>

      {visor && (
        <Modal titulo={visor.titulo} onClose={() => setVisor(null)} ancho="max-w-4xl">
          <VisorDocumento cuerpo={visor.cuerpo} titulo={visor.titulo} />
        </Modal>
      )}
      {escaneado && (
        <VisorArchivo onCerrar={() => setEscaneado(null)} archivos={[{
          url: urlsEscaneados[escaneado.archivo_firmado_path] ?? null, grupo: 'Firmado en papel (escaneado)',
          nombre: escaneado.archivo_firmado_path.split('/').pop() ?? escaneado.nombre,
        }]} />
      )}
    </div>
  )
}
