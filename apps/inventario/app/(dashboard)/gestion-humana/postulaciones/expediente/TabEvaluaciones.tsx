'use client'

import { useState } from 'react'
import { ClipboardCheck, ShieldCheck, MessageSquare, Phone, Loader2, Plus, Trash2, Brain, Search, ChevronDown, Eye, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { htmlResultadoPrueba } from '@/lib/ats/resultado-prueba'
import { imprimirHtml, limpiarHtml, resolverMarcadores } from '@/lib/documentos/html'
import { VisorDocumento } from '@/components/documentos/VisorDocumento'
import { Seccion, Boton, Badge, Campo, Modal, inputCls, fechaCorta, fechaHora } from '../ui'
import type { PropsTab } from './tipos'

/* eslint-disable @typescript-eslint/no-explicit-any */

const RIESGO: Record<string, string> = { BAJO: 'bg-green-100 text-green-700', MEDIO: 'bg-amber-100 text-amber-800', ALTO: 'bg-red-100 text-red-700' }
const ANTEC: Record<string, { label: string; color: string }> = {
  PENDIENTE: { label: 'Pendiente', color: 'bg-gray-100 text-gray-600' },
  SIN_NOVEDAD: { label: 'Sin novedad', color: 'bg-green-100 text-green-700' },
  CON_NOVEDAD: { label: 'Con novedad', color: 'bg-red-100 text-red-700' },
}

interface Conviviente { nombre: string; parentesco: string; edad: string; nivel_academico: string; ocupacion: string }
interface Trayecto { empresa: string; tiempo: string; fecha_retiro: string; razon_retiro: string; funciones: string }

const CAMPOS_TEXTO: [string, string][] = [
  ['personas_a_cargo', '¿Cuántas personas tiene a su cargo y quiénes son?'],
  ['aspectos_mejorar', 'Aspectos por mejorar'],
  ['aspectos_buenos', 'Aspectos buenos'],
  ['tiempo_libre', '¿Qué actividades realiza en su tiempo libre?'],
  ['grupo_social', '¿Pertenece a algún grupo social o deportivo?'],
  ['metas', '¿Qué metas tiene planeadas a su futuro?'],
  ['logros', '¿Qué logros ha obtenido por su desempeño laboral?'],
  ['situacion_dificil', '¿Cuál fue la situación más difícil que ha enfrentado en su trabajo?'],
  ['solucion', '¿Cómo la solucionó?'],
  ['aprendizaje', '¿Qué aprendió de esta situación?'],
  ['personal_a_cargo', '¿Ha tenido personal a su cargo y cuántos?'],
  ['personal_dificil', 'Si ha tenido personal a su cargo, ¿qué fue lo más difícil?'],
]

export function TabEvaluaciones({ d, sb, catalogos, puedeGestionar, recargar, onCambio }: PropsTab) {
  return (
    <div className="space-y-4">
      <Pruebas d={d} sb={sb} catalogos={catalogos} />
      <Entrevista d={d} sb={sb} puedeGestionar={puedeGestionar} recargar={recargar} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SeguridadAAA d={d} sb={sb} puedeGestionar={puedeGestionar} recargar={recargar} />
        <Antecedentes d={d} sb={sb} puedeGestionar={puedeGestionar} recargar={recargar} onCambio={onCambio} />
      </div>
      <Referencias d={d} sb={sb} puedeGestionar={puedeGestionar} recargar={recargar} />
      <Observaciones d={d} sb={sb} puedeGestionar={puedeGestionar} recargar={recargar} />
    </div>
  )
}

// ── Pruebas de selección ──────────────────────────────────────────────────────
function Pruebas({ d, sb, catalogos }: { d: PropsTab['d']; sb: any; catalogos: PropsTab['catalogos'] }) {
  const [detalle, setDetalle] = useState<Record<string, any[] | null>>({})
  const [visor, setVisor] = useState<{ titulo: string; cuerpo: string } | null>(null)
  const [preparando, setPreparando] = useState<string | null>(null)
  async function verRespuestas(intento: any) {
    if (detalle[intento.id]) { setDetalle((x) => ({ ...x, [intento.id]: null })); return }
    const { data } = await sb.from('prueba_preguntas').select('id, orden, enunciado, opciones, respuesta_correcta, dimension')
      .eq('prueba_id', intento.prueba_id).order('orden')
    setDetalle((x) => ({ ...x, [intento.id]: data ?? [] }))
  }

  // Resultado imprimible (PDF) con la foto de perfil del candidato.
  async function resultado(intento: any, imprimir: boolean) {
    setPreparando(intento.id)
    const [preguntasR, empresaR, fotoR] = await Promise.all([
      sb.from('prueba_preguntas').select('id, orden, enunciado, opciones, respuesta_correcta, dimension').eq('prueba_id', intento.prueba_id).order('orden'),
      sb.from('vac_empresa').select('razon_social, nit').eq('id', 1).maybeSingle(),
      d.c.foto_perfil_path ? sb.storage.from('registro-vacantes').createSignedUrl(d.c.foto_perfil_path, 900) : Promise.resolve({ data: null }),
    ])
    setPreparando(null)
    if (preguntasR.error) { toast.error(preguntasR.error.message); return }
    const nombre = `${d.c.nombres ?? ''} ${d.c.apellidos ?? ''}`.trim()
    const html = htmlResultadoPrueba({
      empresa: empresaR.data,
      candidato: {
        nombre, tipo_documento: d.c.tipo_documento, numero_documento: d.c.numero_documento,
        cargo: catalogos.cargos.find((x) => x.id === d.c.cargo_postulacion_id)?.nombre ?? null,
        ciudad: d.nombres.munTrabajo || d.nombres.munResidencia || null,
      },
      prueba: intento.prueba ?? { nombre: 'Prueba', tipo: '' },
      preguntas: preguntasR.data ?? [],
      intento,
    })
    const cuerpo = resolverMarcadores(limpiarHtml(html), { fotoUrl: fotoR.data?.signedUrl ?? d.fotoUrl })
    const titulo = `${intento.prueba?.nombre ?? 'Prueba'} - ${nombre}`
    if (imprimir) imprimirHtml(cuerpo, titulo)
    else setVisor({ titulo, cuerpo })
  }

  return (
    <Seccion titulo="Pruebas de selección" icono={<Brain className="h-4 w-4 text-brand-green" />}>
      {d.intentos.length === 0 ? (
        <p className="text-sm text-gray-400">El candidato aún no ha presentado las pruebas (aptitud y conocimientos).</p>
      ) : (
        <div className="space-y-2">
          {d.intentos.map((i) => (
            <div key={i.id} className="rounded-lg border border-gray-100 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{i.prueba?.nombre}</p>
                  <p className="text-xs text-gray-500">
                    {i.estado === 'EN_CURSO' ? 'En curso' : i.estado === 'EXPIRADA' ? 'Enviada fuera de tiempo' : 'Completada'} · {fechaHora(i.finalizado_at ?? i.iniciado_at)}
                    {i.firma_nombre && <> · Firmó «{i.firma_nombre}»</>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {i.puntaje_max ? (
                    <Badge className={i.puntaje / i.puntaje_max >= 0.67 ? 'bg-green-100 text-green-700' : i.puntaje / i.puntaje_max >= 0.5 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}>
                      Puntaje: {i.puntaje} / {i.puntaje_max}
                    </Badge>
                  ) : <Badge className="bg-violet-100 text-violet-700">Perfil</Badge>}
                  <button onClick={() => verRespuestas(i)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-green">
                    Respuestas <ChevronDown className={'h-3.5 w-3.5 transition-transform ' + (detalle[i.id] ? 'rotate-180' : '')} />
                  </button>
                  {i.estado !== 'EN_CURSO' && (
                    <>
                      <button onClick={() => resultado(i, false)} disabled={preparando === i.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        {preparando === i.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Ver
                      </button>
                      <button onClick={() => resultado(i, true)} disabled={preparando === i.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        title="Imprimir o guardar como PDF">
                        <Printer className="h-3.5 w-3.5" /> PDF
                      </button>
                    </>
                  )}
                </div>
              </div>
              {i.perfil && (
                <table className="mt-2 w-full text-xs">
                  <thead><tr className="text-left text-gray-400"><th className="py-1">Dimensión</th><th className="text-center">A</th><th className="text-center">B</th></tr></thead>
                  <tbody>
                    {Object.entries(i.perfil as Record<string, Record<string, number>>).map(([dim, v]) => (
                      <tr key={dim} className="border-t border-gray-100"><td className="py-1 text-gray-700">{dim}</td><td className="text-center">{v.A ?? 0}</td><td className="text-center">{v.B ?? 0}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {detalle[i.id] && (
                <ol className="mt-2 space-y-1.5 text-xs">
                  {detalle[i.id]!.map((q) => {
                    const r = (i.respuestas ?? {})[q.id]
                    const op = (q.opciones ?? []).find((o: any) => o.clave === r)
                    const ok = q.respuesta_correcta ? r === q.respuesta_correcta : null
                    return (
                      <li key={q.id} className="rounded bg-gray-50 p-2">
                        <p className="font-medium text-gray-800">{q.orden}. {q.enunciado}</p>
                        <p className={ok === null ? 'text-gray-600' : ok ? 'text-green-700' : 'text-red-700'}>
                          Respondió: {r ? `${r}) ${op?.texto ?? ''}` : '— sin respuesta —'}
                          {ok === false && <> · correcta: {q.respuesta_correcta}</>}
                        </p>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          ))}
        </div>
      )}
      {visor && (
        <Modal titulo={visor.titulo} subtitulo="Resultado de la prueba de selección" onClose={() => setVisor(null)} ancho="max-w-4xl">
          <VisorDocumento cuerpo={visor.cuerpo} titulo={visor.titulo} alturaMax="none" />
        </Modal>
      )}
    </Seccion>
  )
}

// ── Formato de entrevista (psicológica) ─────────────────────────────────────
function Entrevista({ d, sb, puedeGestionar, recargar }: { d: PropsTab['d']; sb: any; puedeGestionar: boolean; recargar: () => Promise<void> }) {
  const previa = d.evaluaciones.find((e) => e.tipo === 'ENTREVISTA') ?? null
  const datos0 = (previa?.datos ?? {}) as Record<string, any>
  const [abierta, setAbierta] = useState(!!previa)
  const [fecha, setFecha] = useState<string>(previa?.fecha ?? new Date().toISOString().slice(0, 10))
  const [evaluador, setEvaluador] = useState<string>(previa?.evaluador_nombre ?? d.yo.nombre ?? '')
  const [resultado, setResultado] = useState<string>(previa?.resultado ?? 'PENDIENTE')
  const [concepto, setConcepto] = useState<string>(previa?.concepto ?? '')
  const [txt, setTxt] = useState<Record<string, string>>(() => Object.fromEntries(CAMPOS_TEXTO.map(([k]) => [k, datos0[k] ?? ''])))
  const [conv, setConv] = useState<Conviviente[]>(datos0.convivientes ?? d.bens.map((b) => ({
    nombre: `${b.nombres ?? ''} ${b.apellidos ?? ''}`.trim(), parentesco: b.parentesco ?? '', edad: '', nivel_academico: '', ocupacion: '',
  })))
  const [tray, setTray] = useState<Trayecto[]>(datos0.trayectoria ?? d.experiencias.slice(0, 3).map((x) => ({
    empresa: x.empresa ?? '', tiempo: '', fecha_retiro: x.fecha_retiro ?? '', razon_retiro: x.motivo_retiro ?? '', funciones: x.funciones ?? '',
  })))
  const [obs, setObs] = useState<string>(datos0.observaciones ?? '')
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    setGuardando(true)
    const fila = {
      candidato_id: d.c.id, tipo: 'ENTREVISTA', resultado, concepto: concepto || null, fecha,
      evaluador: d.yo.id, evaluador_nombre: evaluador || null,
      datos: { ...txt, convivientes: conv.filter((x) => x.nombre.trim()), trayectoria: tray.filter((x) => x.empresa.trim()), observaciones: obs },
    }
    const r = previa
      ? await sb.from('candidato_evaluaciones').update(fila).eq('id', previa.id)
      : await sb.from('candidato_evaluaciones').insert(fila)
    if (!r.error) {
      await sb.from('candidato_eventos').insert({
        candidato_id: d.c.id, tipo: 'EVALUACION', motivo: `Entrevista ${previa ? 'actualizada' : 'registrada'}: ${resultado}`,
        actor: d.yo.id, actor_nombre: d.yo.nombre,
      })
    }
    setGuardando(false)
    if (r.error) { toast.error(r.error.message); return }
    toast.success('Entrevista guardada. Ya puede generar el formato de entrevista en Contratación.')
    await recargar()
  }

  return (
    <Seccion titulo="Entrevista y evaluación psicológica" icono={<MessageSquare className="h-4 w-4 text-brand-green" />}
      acciones={previa ? <Badge className={resultado === 'APROBADO' ? 'bg-green-100 text-green-700' : resultado === 'NO_APROBADO' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}>{resultado.replace('_', ' ')}</Badge> : null}>
      {!abierta ? (
        puedeGestionar
          ? <Boton variante="suave" onClick={() => setAbierta(true)}><Plus className="h-4 w-4" /> Registrar entrevista (formato de entrevista v4)</Boton>
          : <p className="text-sm text-gray-400">Sin entrevista registrada.</p>
      ) : (
        <fieldset disabled={!puedeGestionar} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo label="Fecha"><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} /></Campo>
            <Campo label="Psicólogo(a) evaluador(a)"><input value={evaluador} onChange={(e) => setEvaluador(e.target.value)} className={inputCls} /></Campo>
            <Campo label="Resultado">
              <select value={resultado} onChange={(e) => setResultado(e.target.value)} className={inputCls}>
                <option value="PENDIENTE">Pendiente</option><option value="APROBADO">Aprobado</option><option value="NO_APROBADO">No aprobado</option>
              </select>
            </Campo>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold text-gray-600">¿Con quién vive?</p>
            <div className="space-y-1.5">
              {conv.map((x, i) => (
                <div key={i} className="grid grid-cols-2 gap-1.5 sm:grid-cols-[2fr_1fr_60px_1fr_1fr_32px]">
                  <input placeholder="Nombre" value={x.nombre} onChange={(e) => setConv(conv.map((y, j) => j === i ? { ...y, nombre: e.target.value } : y))} className={inputCls} />
                  <input placeholder="Parentesco" value={x.parentesco} onChange={(e) => setConv(conv.map((y, j) => j === i ? { ...y, parentesco: e.target.value } : y))} className={inputCls} />
                  <input placeholder="Edad" value={x.edad} onChange={(e) => setConv(conv.map((y, j) => j === i ? { ...y, edad: e.target.value } : y))} className={inputCls} />
                  <input placeholder="Nivel académico" value={x.nivel_academico} onChange={(e) => setConv(conv.map((y, j) => j === i ? { ...y, nivel_academico: e.target.value } : y))} className={inputCls} />
                  <input placeholder="Ocupación" value={x.ocupacion} onChange={(e) => setConv(conv.map((y, j) => j === i ? { ...y, ocupacion: e.target.value } : y))} className={inputCls} />
                  <button type="button" onClick={() => setConv(conv.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600" aria-label="Quitar"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              {conv.length < 6 && <button type="button" onClick={() => setConv([...conv, { nombre: '', parentesco: '', edad: '', nivel_academico: '', ocupacion: '' }])} className="text-xs font-semibold text-brand-green">+ Agregar persona</button>}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {CAMPOS_TEXTO.slice(0, 6).map(([k, label]) => (
              <Campo key={k} label={label}><textarea rows={2} value={txt[k]} onChange={(e) => setTxt({ ...txt, [k]: e.target.value })} className={inputCls} /></Campo>
            ))}
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold text-gray-600">Trayectoria laboral (iniciando con la última empresa)</p>
            <div className="space-y-1.5">
              {tray.map((x, i) => (
                <div key={i} className="grid grid-cols-2 gap-1.5 sm:grid-cols-[1.5fr_1fr_1fr_1.5fr_2fr_32px]">
                  <input placeholder="Empresa" value={x.empresa} onChange={(e) => setTray(tray.map((y, j) => j === i ? { ...y, empresa: e.target.value } : y))} className={inputCls} />
                  <input placeholder="Tiempo laborado" value={x.tiempo} onChange={(e) => setTray(tray.map((y, j) => j === i ? { ...y, tiempo: e.target.value } : y))} className={inputCls} />
                  <input type="date" value={x.fecha_retiro} onChange={(e) => setTray(tray.map((y, j) => j === i ? { ...y, fecha_retiro: e.target.value } : y))} className={inputCls} />
                  <input placeholder="Razón de retiro" value={x.razon_retiro} onChange={(e) => setTray(tray.map((y, j) => j === i ? { ...y, razon_retiro: e.target.value } : y))} className={inputCls} />
                  <input placeholder="Funciones" value={x.funciones} onChange={(e) => setTray(tray.map((y, j) => j === i ? { ...y, funciones: e.target.value } : y))} className={inputCls} />
                  <button type="button" onClick={() => setTray(tray.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600" aria-label="Quitar"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              {tray.length < 3 && <button type="button" onClick={() => setTray([...tray, { empresa: '', tiempo: '', fecha_retiro: '', razon_retiro: '', funciones: '' }])} className="text-xs font-semibold text-brand-green">+ Agregar empresa</button>}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {CAMPOS_TEXTO.slice(6).map(([k, label]) => (
              <Campo key={k} label={label}><textarea rows={2} value={txt[k]} onChange={(e) => setTxt({ ...txt, [k]: e.target.value })} className={inputCls} /></Campo>
            ))}
          </div>

          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
            <p className="mb-2 text-xs font-semibold text-gray-600">Espacio exclusivo de la empresa · confidencial (el candidato no lo ve)</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Concepto general"><textarea rows={3} value={concepto} onChange={(e) => setConcepto(e.target.value)} className={inputCls} /></Campo>
              <Campo label="Observaciones"><textarea rows={3} value={obs} onChange={(e) => setObs(e.target.value)} className={inputCls} /></Campo>
            </div>
          </div>
          {puedeGestionar && (
            <Boton onClick={guardar} disabled={guardando}>{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />} Guardar entrevista</Boton>
          )}
        </fieldset>
      )}
    </Seccion>
  )
}

// ── Seguridad AAA ────────────────────────────────────────────────────────────
function SeguridadAAA({ d, sb, puedeGestionar, recargar }: { d: PropsTab['d']; sb: any; puedeGestionar: boolean; recargar: () => Promise<void> }) {
  const lista = d.evaluaciones.filter((e) => e.tipo === 'SEGURIDAD')
  const [nivel, setNivel] = useState('BAJO')
  const [resena, setResena] = useState('')
  const [guardando, setGuardando] = useState(false)
  async function guardar() {
    if (!resena.trim()) { toast.error('Escriba la reseña del estudio.'); return }
    setGuardando(true)
    const { error } = await sb.from('candidato_evaluaciones').insert({
      candidato_id: d.c.id, tipo: 'SEGURIDAD', resultado: nivel, concepto: resena.trim(), evaluador: d.yo.id, evaluador_nombre: d.yo.nombre,
    })
    if (!error) await sb.from('candidato_eventos').insert({ candidato_id: d.c.id, tipo: 'EVALUACION', motivo: `Estudio de seguridad AAA: riesgo ${nivel}`, actor: d.yo.id, actor_nombre: d.yo.nombre })
    setGuardando(false)
    if (error) { toast.error(error.message); return }
    setResena(''); toast.success('Estudio de seguridad registrado.')
    await recargar()
  }
  return (
    <Seccion titulo="Estudio de seguridad AAA" icono={<ShieldCheck className="h-4 w-4 text-brand-green" />}>
      {lista.length === 0 ? <p className="mb-2 text-sm text-gray-400">No hay evaluaciones de seguridad registradas.</p> : (
        <ul className="mb-3 space-y-1.5">
          {lista.map((e) => (
            <li key={e.id} className="rounded-lg bg-gray-50 p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <Badge className={RIESGO[e.resultado] ?? 'bg-gray-100 text-gray-600'}>Riesgo {String(e.resultado ?? '').toLowerCase()}</Badge>
                <span className="text-xs text-gray-400">{fechaCorta(e.fecha)} · {e.evaluador_nombre ?? ''}</span>
              </div>
              <p className="mt-1 text-gray-700">{e.concepto}</p>
            </li>
          ))}
        </ul>
      )}
      {puedeGestionar && (
        <div className="space-y-2">
          <select value={nivel} onChange={(e) => setNivel(e.target.value)} className={inputCls}>
            <option value="BAJO">Riesgo bajo</option><option value="MEDIO">Riesgo medio</option><option value="ALTO">Riesgo alto</option>
          </select>
          <textarea rows={2} value={resena} onChange={(e) => setResena(e.target.value)} className={inputCls} placeholder="Reseña del estudio (visita domiciliaria, verificaciones…)" />
          <Boton variante="suave" onClick={guardar} disabled={guardando}>{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Registrar estudio</Boton>
        </div>
      )}
    </Seccion>
  )
}

// ── Verificación de antecedentes ────────────────────────────────────────────
function Antecedentes({ d, sb, puedeGestionar, recargar, onCambio }: { d: PropsTab['d']; sb: any; puedeGestionar: boolean; recargar: () => Promise<void>; onCambio: () => void }) {
  const [res, setRes] = useState<string>(d.c.antecedentes_resultado ?? 'PENDIENTE')
  const [msg, setMsg] = useState<string>(d.c.antecedentes_mensaje ?? '')
  const [guardando, setGuardando] = useState(false)
  const actual = ANTEC[d.c.antecedentes_resultado ?? 'PENDIENTE'] ?? ANTEC.PENDIENTE
  async function guardar() {
    setGuardando(true)
    const { error } = await sb.from('candidatos').update({
      antecedentes_resultado: res, antecedentes_mensaje: msg || null, antecedentes_fecha: new Date().toISOString(), antecedentes_por: d.yo.id,
    }).eq('id', d.c.id)
    if (!error) await sb.from('candidato_eventos').insert({ candidato_id: d.c.id, tipo: 'EVALUACION', motivo: `Antecedentes: ${ANTEC[res]?.label ?? res}`, detalle: { mensaje: msg }, actor: d.yo.id, actor_nombre: d.yo.nombre })
    setGuardando(false)
    if (error) { toast.error(error.message); return }
    toast.success('Verificación de antecedentes guardada.')
    await recargar(); onCambio()
  }
  return (
    <Seccion titulo="Verificación de antecedentes" icono={<Search className="h-4 w-4 text-brand-green" />}
      acciones={<Badge className={actual.color}>{actual.label}</Badge>}>
      <p className="mb-2 text-xs text-gray-500">
        Policía, Procuraduría, Contraloría y RNMC (y Personería en Bogotá). {d.c.antecedentes_fecha ? `Última verificación: ${fechaHora(d.c.antecedentes_fecha)}.` : ''}
      </p>
      {puedeGestionar ? (
        <div className="space-y-2">
          <select value={res} onChange={(e) => setRes(e.target.value)} className={inputCls}>
            <option value="PENDIENTE">Pendiente</option><option value="SIN_NOVEDAD">Sin novedad</option><option value="CON_NOVEDAD">Con novedad</option>
          </select>
          <textarea rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} className={inputCls} placeholder="Detalle de la verificación" />
          <Boton variante="suave" onClick={guardar} disabled={guardando}>{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar verificación</Boton>
        </div>
      ) : d.c.antecedentes_mensaje ? <p className="text-sm text-gray-700">{d.c.antecedentes_mensaje}</p> : null}
    </Seccion>
  )
}

// ── Referencias (verificación telefónica) ───────────────────────────────────
function Referencias({ d, sb, puedeGestionar, recargar }: { d: PropsTab['d']; sb: any; puedeGestionar: boolean; recargar: () => Promise<void> }) {
  async function verificar(r: any, ok: boolean) {
    const nota = ok ? (window.prompt('Nota de la verificación (opcional):', r.verificacion_nota ?? '') ?? '') : null
    const { error } = await sb.from('candidato_referencias').update({
      verificada: ok, verificada_por: ok ? d.yo.id : null, verificada_at: ok ? new Date().toISOString() : null, verificacion_nota: nota,
    }).eq('id', r.id)
    if (error) { toast.error(error.message); return }
    await recargar()
  }
  return (
    <Seccion titulo="Referencias" icono={<Phone className="h-4 w-4 text-brand-green" />}>
      {d.referencias.length === 0 ? <p className="text-sm text-gray-400">El candidato no registró referencias en el formulario.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-400"><th className="py-1">Tipo</th><th>Nombre</th><th>Parentesco / ocupación</th><th>Teléfono</th><th>Verificación</th></tr></thead>
            <tbody>
              {d.referencias.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="py-1.5 text-xs text-gray-500">{String(r.tipo).toLowerCase()}</td>
                  <td className="font-medium text-gray-800">{r.nombre}</td>
                  <td className="text-gray-600">{r.parentesco || r.ocupacion}</td>
                  <td><a href={`tel:${r.telefono}`} className="text-brand-green">{r.telefono}</a></td>
                  <td>
                    {r.verificada ? (
                      <span className="text-xs text-green-700">✓ {fechaCorta(r.verificada_at)}{r.verificacion_nota ? ` · ${r.verificacion_nota}` : ''}
                        {puedeGestionar && <button onClick={() => verificar(r, false)} className="ml-1 text-gray-400 underline">deshacer</button>}</span>
                    ) : puedeGestionar ? (
                      <button onClick={() => verificar(r, true)} className="rounded bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700 hover:bg-green-100">Marcar verificada</button>
                    ) : <span className="text-xs text-gray-400">Sin verificar</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Seccion>
  )
}

// ── Observaciones del equipo ────────────────────────────────────────────────
function Observaciones({ d, sb, puedeGestionar, recargar }: { d: PropsTab['d']; sb: any; puedeGestionar: boolean; recargar: () => Promise<void> }) {
  const [texto, setTexto] = useState('')
  const [guardando, setGuardando] = useState(false)
  async function agregar() {
    if (!texto.trim()) return
    setGuardando(true)
    const { error } = await sb.from('candidato_observaciones').insert({ candidato_id: d.c.id, texto: texto.trim(), autor: d.yo.id, autor_nombre: d.yo.nombre })
    if (!error) await sb.from('candidato_eventos').insert({ candidato_id: d.c.id, tipo: 'OBSERVACION', motivo: texto.trim().slice(0, 140), actor: d.yo.id, actor_nombre: d.yo.nombre })
    setGuardando(false)
    if (error) { toast.error(error.message); return }
    setTexto('')
    await recargar()
  }
  return (
    <Seccion titulo="Observaciones" icono={<MessageSquare className="h-4 w-4 text-brand-green" />}>
      {puedeGestionar && (
        <div className="mb-3 flex gap-2">
          <textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} className={inputCls} placeholder="Registrar una observación del proceso…" />
          <Boton onClick={agregar} disabled={guardando || !texto.trim()} className="self-end">{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</Boton>
        </div>
      )}
      {d.observaciones.length === 0 ? <p className="text-sm text-gray-400">No hay observaciones registradas.</p> : (
        <ul className="space-y-1.5">
          {d.observaciones.map((o) => (
            <li key={o.id} className="rounded-lg bg-gray-50 p-2 text-sm">
              <p className="whitespace-pre-wrap text-gray-800">{o.texto}</p>
              <p className="mt-0.5 text-[11px] text-gray-400">{o.autor_nombre ?? ''} · {fechaHora(o.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  )
}
