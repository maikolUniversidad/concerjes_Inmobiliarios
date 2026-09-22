'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Printer, Loader2, Save, Users } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { usePermisos } from '@/components/permisos/PermisosProvider'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'
import { ComboBuscador } from '@/components/ui/ComboBuscador'
import { renderizarPlantilla } from '@/lib/documentos/plantilla'
import { imprimirHtml, limpiarHtml, resolverMarcadores } from '@/lib/documentos/html'
import { faseMeta } from '@/lib/ats/fases'
import { Modal, Boton, Badge, Campo, inputCls, fechaCorta } from '../postulaciones/ui'

/* eslint-disable @typescript-eslint/no-explicit-any */

const ESTADOS: Record<string, { label: string; color: string }> = {
  BORRADOR: { label: 'Borrador', color: 'bg-gray-100 text-gray-600' },
  ABIERTA: { label: 'Abierta', color: 'bg-blue-100 text-blue-700' },
  EN_PROCESO: { label: 'En proceso', color: 'bg-violet-100 text-violet-700' },
  CUBIERTA: { label: 'Cubierta', color: 'bg-green-100 text-green-700' },
  CERRADA: { label: 'Cerrada', color: 'bg-gray-200 text-gray-600' },
  ANULADA: { label: 'Anulada', color: 'bg-red-100 text-red-700' },
}

/** Suma días hábiles (lunes a viernes). Si se radica después de las 12 m., cuenta desde el día siguiente. */
function sumarDiasHabiles(desdeISO: string, n: number, despuesDeMediodia = false): string {
  const d = new Date(`${desdeISO}T12:00:00`)
  if (despuesDeMediodia) d.setDate(d.getDate() + 1)
  let quedan = n
  while (quedan > 0) {
    d.setDate(d.getDate() + 1)
    const dia = d.getDay()
    if (dia !== 0 && dia !== 6) quedan--
  }
  return d.toISOString().slice(0, 10)
}

const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

const VACIA = (): Record<string, any> => ({
  fecha_solicitud: hoyISO(), solicitante_nombre: '', proceso: 'OPERACIONES', centro_costo_id: '', cliente_id: '',
  cliente_nombre: '', sede: '', fecha_inicio: '', fecha_inicio_texto: 'LO MÁS PRONTO POSIBLE', cantidad: 1,
  motivo: 'REEMPLAZO', motivo_detalle: '', tipo_cargo: 'OPERATIVO', cargo_id: '', cargo_texto: '', perfil_cargo: '',
  competencias_tecnicas: '', requiere_curso_alturas: false, requiere_curso_alimentos: false, requiere_examen_conduccion: false,
  salario_basico: '', turnos: [] as string[], turno_otro: '', edad_requerida: '', sexo_requerido: '', nivel_academico: '',
  experiencia_anios: '', experiencia_meses: '', modalidad_contrato: 'OBRA_LABOR', funciones: '', estado: 'ABIERTA',
  aprobada_lider: false, aprobada_th: false, fecha_limite: '', observaciones: '',
})

export function RequisicionesClient({
  requisiciones, candidatos, cargos, centros, listas, clientes, plantillaHtml, empresa,
}: {
  requisiciones: any[]; candidatos: any[]; cargos: any[]; centros: any[]; listas: any[]; clientes: any[]
  plantillaHtml: string | null; empresa: any | null
}) {
  const router = useRouter()
  const { puede } = usePermisos()
  const puedeGestionar = puede('gestionar_requisiciones')
  const [sb] = useState<any>(() => createClient())
  const [lista, setLista] = useState(requisiciones)
  useEffect(() => { setLista(requisiciones) }, [requisiciones])
  const [edit, setEdit] = useState<Record<string, any> | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [yo, setYo] = useState<string>('')

  useEffect(() => {
    sb.auth.getUser().then(async ({ data }: any) => {
      if (!data.user) return
      const { data: u } = await sb.from('usuarios').select('nombre, email').eq('id', data.user.id).maybeSingle()
      setYo(u?.nombre ?? u?.email ?? '')
    })
  }, [sb])

  const de = (l: string) => listas.filter((x) => x.lista === l)
  const candidatosDe = (id: string) => candidatos.filter((c) => c.requisicion_id === id)
  const cargoNombre = (id: string | null) => cargos.find((c) => c.id === id)?.nombre ?? ''
  const centroCodigo = (id: string | null) => centros.find((c) => c.id === id)?.codigo ?? ''

  function nueva() {
    setEdit({ ...VACIA(), solicitante_nombre: yo, fecha_limite: sumarDiasHabiles(hoyISO(), 5, new Date().getHours() >= 12) })
  }

  function up(patch: Record<string, any>) {
    setEdit((e) => {
      if (!e) return e
      const n = { ...e, ...patch }
      // Al escoger el cargo se proponen los cursos y el tipo según el catálogo.
      if (patch.cargo_id !== undefined) {
        const cg = cargos.find((c) => c.id === patch.cargo_id)
        if (cg) {
          n.cargo_texto = cg.nombre
          n.tipo_cargo = cg.tipo ?? n.tipo_cargo
          n.requiere_curso_alturas = !!cg.requiere_trabajo_alturas
          n.requiere_curso_alimentos = !!cg.requiere_manipulacion_alimentos
          n.requiere_examen_conduccion = !!cg.requiere_examen_conduccion
          if (!n.funciones && cg.funciones_generales?.length) n.funciones = cg.funciones_generales.join(' ')
        }
      }
      if (patch.centro_costo_id !== undefined) {
        const cc = centros.find((c) => c.id === patch.centro_costo_id)
        if (cc) {
          n.cliente_nombre = n.cliente_nombre || cc.nombre
          n.sede = n.sede || cc.ciudad || ''
          n.cliente_id = cc.cliente_id ?? n.cliente_id
        }
      }
      if (patch.tipo_cargo !== undefined || patch.fecha_solicitud !== undefined) {
        if (n.tipo_cargo === 'OPERATIVO' && n.fecha_solicitud) n.fecha_limite = sumarDiasHabiles(n.fecha_solicitud, 5)
      }
      return n
    })
  }

  async function guardar() {
    if (!edit) return
    if (!edit.solicitante_nombre?.trim()) { toast.error('Falta el nombre del solicitante.'); return }
    if (!edit.cargo_id && !edit.cargo_texto?.trim()) { toast.error('Indique el cargo solicitado.'); return }
    if (!(Number(edit.cantidad) > 0)) { toast.error('La cantidad debe ser mayor que cero.'); return }
    setGuardando(true)
    const { data: { user } } = await sb.auth.getUser()
    const num = (v: any) => (v === '' || v === null || v === undefined ? null : Number(v))
    const fila: Record<string, any> = {
      fecha_solicitud: edit.fecha_solicitud, solicitante_nombre: edit.solicitante_nombre.trim(), proceso: edit.proceso || null,
      centro_costo_id: edit.centro_costo_id || null, cliente_id: edit.cliente_id || null, cliente_nombre: edit.cliente_nombre || null,
      sede: edit.sede || null, fecha_inicio: edit.fecha_inicio || null, fecha_inicio_texto: edit.fecha_inicio_texto || null,
      cantidad: Number(edit.cantidad), motivo: edit.motivo || null, motivo_detalle: edit.motivo_detalle || null,
      tipo_cargo: edit.tipo_cargo, cargo_id: edit.cargo_id || null, cargo_texto: edit.cargo_texto || cargoNombre(edit.cargo_id) || null,
      perfil_cargo: edit.perfil_cargo || null, competencias_tecnicas: edit.competencias_tecnicas || null,
      requiere_curso_alturas: !!edit.requiere_curso_alturas, requiere_curso_alimentos: !!edit.requiere_curso_alimentos,
      requiere_examen_conduccion: !!edit.requiere_examen_conduccion, salario_basico: num(edit.salario_basico),
      turnos: edit.turnos ?? [], turno_otro: edit.turno_otro || null, edad_requerida: edit.edad_requerida || null,
      sexo_requerido: edit.sexo_requerido || null, nivel_academico: edit.nivel_academico || null,
      experiencia_anios: num(edit.experiencia_anios), experiencia_meses: num(edit.experiencia_meses),
      modalidad_contrato: edit.modalidad_contrato || null, funciones: edit.funciones || null, estado: edit.estado,
      aprobada_lider: !!edit.aprobada_lider, aprobada_th: !!edit.aprobada_th, fecha_limite: edit.fecha_limite || null,
      observaciones: edit.observaciones || null,
    }
    const r = edit.id
      ? await sb.from('requisiciones').update(fila).eq('id', edit.id).select('*').single()
      : await sb.from('requisiciones').insert({ ...fila, solicitante_id: user?.id ?? null, created_by: user?.id ?? null }).select('*').single()
    setGuardando(false)
    if (r.error) { toast.error(r.error.message); return }
    toast.success(`Requisición ${r.data.numero} guardada.`)
    setEdit(null)
    router.refresh()
  }

  function imprimir(req: any) {
    if (!plantillaHtml) { toast.error('No hay una versión publicada de la plantilla de requisición.'); return }
    const hoy = new Date()
    const ctx = {
      empresa: empresa ?? {},
      hoy: { fecha: hoy.toLocaleDateString('es-CO'), anio: String(hoy.getFullYear()) },
      requisicion: {
        ...req,
        cargo: req.cargo_texto ?? cargoNombre(req.cargo_id),
        centro_costo: centroCodigo(req.centro_costo_id),
        modalidad_nombre: de('MODALIDAD_CONTRATO').find((m) => m.valor === req.modalidad_contrato)?.etiqueta ?? req.modalidad_contrato ?? '',
      },
    }
    const html = resolverMarcadores(limpiarHtml(renderizarPlantilla(plantillaHtml, ctx)))
    imprimirHtml(html, `Requisición ${req.numero}`)
  }

  const columnas: ColumnaTabla<any>[] = useMemo(() => [
    { id: 'numero', header: 'Número', valor: (r) => r.numero, tarjeta: 'titulo' },
    { id: 'fecha', header: 'Solicitud', valor: (r) => r.fecha_solicitud },
    { id: 'cliente', header: 'Cliente / contrato', valor: (r) => r.cliente_nombre ?? centroCodigo(r.centro_costo_id), tarjeta: 'subtitulo' },
    { id: 'cargo', header: 'Cargo', valor: (r) => r.cargo_texto ?? cargoNombre(r.cargo_id) },
    {
      id: 'cupos', header: 'Cubiertos', align: 'center', valor: (r) => `${r.cupos_cubiertos}/${r.cantidad}`,
      celda: (r) => <span className={r.cupos_cubiertos >= r.cantidad ? 'font-semibold text-green-700' : ''}>{r.cupos_cubiertos}/{r.cantidad}</span>,
    },
    { id: 'candidatos', header: 'Candidatos', align: 'center', valor: (r) => candidatosDe(r.id).length, prioridad: 2 },
    {
      id: 'estado', header: 'Estado', valor: (r) => ESTADOS[r.estado]?.label ?? r.estado, tarjeta: 'badge',
      celda: (r) => <Badge className={ESTADOS[r.estado]?.color ?? 'bg-gray-100 text-gray-600'}>{ESTADOS[r.estado]?.label ?? r.estado}</Badge>,
    },
    {
      id: 'limite', header: 'Fecha límite', valor: (r) => r.fecha_limite ?? '', prioridad: 2,
      celda: (r) => {
        if (!r.fecha_limite) return <span className="text-gray-300">—</span>
        const vencida = !['CUBIERTA', 'CERRADA', 'ANULADA'].includes(r.estado) && r.fecha_limite < hoyISO()
        return <span className={vencida ? 'font-semibold text-red-600' : ''}>{fechaCorta(r.fecha_limite)}</span>
      },
    },
    { id: 'solicitante', header: 'Solicitante', valor: (r) => r.solicitante_nombre, prioridad: 3 },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [candidatos, cargos, centros])

  return (
    <div className="space-y-4">
      <TablaEstandar<any>
        id="requisiciones"
        titulo="Requisiciones de personal"
        modulo="Gestión Humana"
        entidad="requisiciones"
        datos={lista}
        columnas={columnas}
        filaId={(r) => r.id}
        busqueda="Buscar por número, cliente o cargo…"
        onFilaClick={(r) => setEdit({ ...VACIA(), ...r, salario_basico: r.salario_basico ?? '', experiencia_anios: r.experiencia_anios ?? '', experiencia_meses: r.experiencia_meses ?? '' })}
        textoDetalle="Abrir"
        acciones={(r) => (
          <button onClick={(e) => { e.stopPropagation(); imprimir(r) }} title="Imprimir formato" className="rounded p-1 text-gray-500 hover:bg-gray-100">
            <Printer className="h-4 w-4" />
          </button>
        )}
        herramientas={puedeGestionar ? <Boton onClick={nueva}><Plus className="h-4 w-4" /> Nueva requisición</Boton> : undefined}
        vacio={<p className="py-10 text-center text-sm text-gray-400">No hay requisiciones. Cree la primera con «Nueva requisición».</p>}
      />

      {edit && (
        <Modal
          titulo={edit.id ? `Requisición ${edit.numero}` : 'Nueva requisición de personal'}
          subtitulo="Formato C_1.1 · versión 3"
          onClose={() => setEdit(null)}
          ancho="max-w-4xl"
          pie={
            <div className="flex flex-wrap justify-end gap-2">
              {edit.id && <Boton variante="secundario" onClick={() => imprimir(edit)}><Printer className="h-4 w-4" /> Imprimir</Boton>}
              <Boton variante="secundario" onClick={() => setEdit(null)}>Cerrar</Boton>
              {puedeGestionar && <Boton onClick={guardar} disabled={guardando}>{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar</Boton>}
            </div>
          }
        >
          <fieldset disabled={!puedeGestionar} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Campo label="Nombre solicitante"><input value={edit.solicitante_nombre} onChange={(e) => up({ solicitante_nombre: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Proceso"><input value={edit.proceso ?? ''} onChange={(e) => up({ proceso: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Fecha de solicitud"><input type="date" value={edit.fecha_solicitud ?? ''} onChange={(e) => up({ fecha_solicitud: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Estado">
                <select value={edit.estado} onChange={(e) => up({ estado: e.target.value })} className={inputCls}>
                  {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Campo>
            </div>

            <div className="rounded-xl border border-gray-100 p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Datos del contrato</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block sm:col-span-1">
                  <span className="mb-1 block text-xs font-semibold text-gray-600">Centro de costos</span>
                  <ComboBuscador items={centros} value={edit.centro_costo_id ?? ''} onPick={(x: any) => up({ centro_costo_id: x.id })}
                    getId={(x: any) => x.id} textoBusqueda={(x: any) => `${x.codigo} ${x.nombre}`} fila={(x: any) => <span className="text-sm">{x.codigo}</span>}
                    etiqueta={(x: any) => x.codigo} placeholder="Buscar centro de costos…" disabled={!puedeGestionar} />
                </label>
                <Campo label="Nombre del contrato (cliente)">
                  <input list="clientes-req" value={edit.cliente_nombre ?? ''} onChange={(e) => up({ cliente_nombre: e.target.value })} className={inputCls} />
                  <datalist id="clientes-req">{clientes.map((c) => <option key={c.id} value={c.nombre} />)}</datalist>
                </Campo>
                <Campo label="Sede"><input value={edit.sede ?? ''} onChange={(e) => up({ sede: e.target.value })} className={inputCls} /></Campo>
                <Campo label="Fecha de inicio"><input type="date" value={edit.fecha_inicio ?? ''} onChange={(e) => up({ fecha_inicio: e.target.value })} className={inputCls} /></Campo>
                <Campo label="…o en texto"><input value={edit.fecha_inicio_texto ?? ''} onChange={(e) => up({ fecha_inicio_texto: e.target.value })} className={inputCls} /></Campo>
                <Campo label="Número de trabajadores"><input type="number" min={1} value={edit.cantidad} onChange={(e) => up({ cantidad: e.target.value })} className={inputCls} /></Campo>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <Campo label="Motivo de la solicitud">
                <select value={edit.motivo ?? ''} onChange={(e) => up({ motivo: e.target.value })} className={inputCls}>
                  {de('MOTIVO_REQUISICION').map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                </select>
              </Campo>
              <Campo label="Detalle del motivo (a quién reemplaza, etc.)"><input value={edit.motivo_detalle ?? ''} onChange={(e) => up({ motivo_detalle: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Tipo de cargo">
                <select value={edit.tipo_cargo} onChange={(e) => up({ tipo_cargo: e.target.value })} className={inputCls}>
                  <option value="OPERATIVO">Operativo</option><option value="ADMINISTRATIVO">Administrativo</option>
                </select>
              </Campo>
              <Campo label="Cargo solicitado">
                <select value={edit.cargo_id ?? ''} onChange={(e) => up({ cargo_id: e.target.value })} className={inputCls}>
                  <option value="">— Seleccione —</option>
                  {cargos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </Campo>
              <Campo label="Perfil del cargo"><input value={edit.perfil_cargo ?? ''} onChange={(e) => up({ perfil_cargo: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Competencias técnicas"><input value={edit.competencias_tecnicas ?? ''} onChange={(e) => up({ competencias_tecnicas: e.target.value })} className={inputCls} /></Campo>
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-gray-700">
              {[['requiere_curso_alturas', 'Examen / curso de alturas'], ['requiere_curso_alimentos', 'Manipulación de alimentos'], ['requiere_examen_conduccion', 'Examen de conducción (psicosensométrico)']].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!edit[k]} onChange={(e) => up({ [k]: e.target.checked })} className="h-4 w-4 accent-[#2E7D32]" /> {l}</label>
              ))}
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold text-gray-600">Turnos</p>
              <div className="flex flex-wrap gap-1.5">
                {de('TURNO').map((t) => {
                  const on = (edit.turnos ?? []).includes(t.valor)
                  return (
                    <button key={t.valor} type="button" onClick={() => up({ turnos: on ? edit.turnos.filter((x: string) => x !== t.valor) : [...(edit.turnos ?? []), t.valor] })}
                      className={'rounded-full border px-3 py-1 text-xs font-medium ' + (on ? 'border-brand-green bg-brand-green text-white' : 'border-gray-200 bg-white text-gray-700')}>
                      {t.etiqueta}
                    </button>
                  )
                })}
              </div>
              {(edit.turnos ?? []).includes('OTRO') && <input value={edit.turno_otro ?? ''} onChange={(e) => up({ turno_otro: e.target.value })} placeholder="¿Cuál?" className={inputCls + ' mt-2 max-w-sm'} />}
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <Campo label="Salario básico"><input type="number" min={0} value={edit.salario_basico ?? ''} onChange={(e) => up({ salario_basico: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Edad"><input value={edit.edad_requerida ?? ''} onChange={(e) => up({ edad_requerida: e.target.value })} placeholder="No especificó" className={inputCls} /></Campo>
              <Campo label="Sexo">
                <select value={edit.sexo_requerido ?? ''} onChange={(e) => up({ sexo_requerido: e.target.value })} className={inputCls}>
                  <option value="">Indiferente</option><option>Femenino</option><option>Masculino</option>
                </select>
              </Campo>
              <Campo label="Nivel académico">
                <select value={edit.nivel_academico ?? ''} onChange={(e) => up({ nivel_academico: e.target.value })} className={inputCls}>
                  <option value="">— —</option>
                  {de('NIVEL_ACADEMICO').map((n) => <option key={n.valor} value={n.etiqueta}>{n.etiqueta}</option>)}
                </select>
              </Campo>
              <Campo label="Experiencia (años)"><input type="number" min={0} value={edit.experiencia_anios ?? ''} onChange={(e) => up({ experiencia_anios: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Experiencia (meses)"><input type="number" min={0} max={11} value={edit.experiencia_meses ?? ''} onChange={(e) => up({ experiencia_meses: e.target.value })} className={inputCls} /></Campo>
              <Campo label="Modalidad del contrato">
                <select value={edit.modalidad_contrato ?? ''} onChange={(e) => up({ modalidad_contrato: e.target.value })} className={inputCls}>
                  {de('MODALIDAD_CONTRATO').map((m) => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
                </select>
              </Campo>
              <Campo label="Fecha límite de cubrimiento" hint="Operativos: 5 días hábiles"><input type="date" value={edit.fecha_limite ?? ''} onChange={(e) => up({ fecha_limite: e.target.value })} className={inputCls} /></Campo>
            </div>
            <Campo label="Funciones y responsabilidades"><textarea rows={3} value={edit.funciones ?? ''} onChange={(e) => up({ funciones: e.target.value })} className={inputCls} /></Campo>
            <div className="flex flex-wrap gap-4 text-sm text-gray-700">
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!edit.aprobada_lider} onChange={(e) => up({ aprobada_lider: e.target.checked })} className="h-4 w-4 accent-[#2E7D32]" /> Aprobada por el líder del proceso</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!edit.aprobada_th} onChange={(e) => up({ aprobada_th: e.target.checked })} className="h-4 w-4 accent-[#2E7D32]" /> Aprobada por Talento Humano</label>
            </div>
            <Campo label="Observaciones"><textarea rows={2} value={edit.observaciones ?? ''} onChange={(e) => up({ observaciones: e.target.value })} className={inputCls} /></Campo>

            {edit.id && (
              <div className="rounded-xl border border-gray-100 p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500"><Users className="h-4 w-4" /> Candidatos asignados ({candidatosDe(edit.id).length})</p>
                {candidatosDe(edit.id).length === 0 ? <p className="text-sm text-gray-400">Asigne candidatos desde su expediente (pestaña Personal → Vinculación).</p> : (
                  <ul className="space-y-1">
                    {candidatosDe(edit.id).map((c) => (
                      <li key={c.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-1.5 text-sm">
                        <span>{c.nombres} {c.apellidos} · {c.numero_documento}</span>
                        <Badge className={faseMeta(c.estado).color}>{faseMeta(c.estado).label}</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </fieldset>
        </Modal>
      )}
    </div>
  )
}
