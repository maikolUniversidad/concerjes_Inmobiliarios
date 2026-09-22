'use client'

import { useMemo, useState } from 'react'
import { Loader2, Plus, Trash2, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import type { WizardCtx } from '../RegistroWizard'
import { Field, Input, Select, Textarea, SiNo, Chips, Grid, SeccionTitulo } from '../ui'
import {
  guardarDireccion, guardarBeneficiarios, guardarCandidato, guardarEstudios, guardarExperiencias, guardarReferencias,
} from '@/lib/registro/datos'
import {
  GENEROS, ESTADOS_CIVILES, RH, ESCOLARIDAD, LIBRETA, TIPO_CUENTA, JORNADAS, FUENTES,
  TALLA_CAMISA, TALLA_CALZADO, PARENTESCOS, PARENTESCOS_FAMILIAR, VIVIENDA, NIVELES_ESTUDIO,
  type Beneficiario, type Estudio, type Experiencia, type Referencia,
} from '@/lib/registro/tipos'

const soloLetras = (v: string) => v.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ' -]/g, '').replace(/\s{2,}/g, ' ').toUpperCase()

export function Paso2Formulario({ ctx }: { ctx: WizardCtx }) {
  const {
    form, update, catalogos, candidatoId, direccion, setDireccion, beneficiarios, setBeneficiarios,
    estudios, setEstudios, experiencias, setExperiencias, referencias, setReferencias, next, prev,
  } = ctx
  const [guardando, setGuardando] = useState(false)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [cuentaConfirm, setCuentaConfirm] = useState(form.numero_cuenta ?? '')

  const deptoNombre = useMemo(() => new Map(catalogos.departamentos.map((d) => [d.codigo_dane, d.nombre])), [catalogos.departamentos])
  const munisDe = (dep?: string | null) => catalogos.municipios.filter((m) => m.departamento_codigo === dep)

  const esMasculino = form.genero === 'Masculino'
  const edad = useMemo(() => {
    if (!form.fecha_nacimiento) return null
    const d = new Date(form.fecha_nacimiento)
    return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000))
  }, [form.fecha_nacimiento])
  const requiereLibreta = esMasculino && edad !== null && edad < 50

  function validar(): boolean {
    const e: Record<string, string> = {}
    if (!form.primer_nombre?.trim()) e.primer_nombre = 'Escribe tu primer nombre.'
    if (!form.primer_apellido?.trim()) e.primer_apellido = 'Escribe tu primer apellido.'
    if (!form.fecha_nacimiento) e.fecha_nacimiento = 'Falta tu fecha de nacimiento.'
    else if (edad !== null && edad < 18) e.fecha_nacimiento = 'Debes ser mayor de edad (18 años).'
    if (!form.fecha_expedicion_doc) e.fecha_expedicion_doc = 'Falta la fecha de expedición del documento.'
    else if (form.fecha_nacimiento && form.fecha_expedicion_doc < form.fecha_nacimiento) e.fecha_expedicion_doc = 'La expedición no puede ser anterior al nacimiento.'
    if (!form.lugar_expedicion_doc) e.lugar_expedicion_doc = 'Indica dónde se expidió el documento.'
    if (!form.departamento_nacimiento || !form.municipio_nacimiento) e.nacimiento = 'Indica tu lugar de nacimiento.'
    if (!form.genero) e.genero = 'Selecciona tu género.'
    if (!form.estado_civil) e.estado_civil = 'Selecciona tu estado civil.'
    if (!form.grupo_sanguineo) e.grupo_sanguineo = 'Selecciona tu grupo sanguíneo.'
    if (!form.nivel_escolaridad) e.nivel_escolaridad = 'Selecciona tu nivel de estudios.'
    if (!form.email?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) e.email = 'Correo no válido.'
    if (!form.celular?.trim() || !/^3\d{9}$/.test(form.celular)) e.celular = 'Celular de 10 dígitos que empiece en 3.'
    if (!direccion.direccion?.trim()) e.direccion = 'Escribe tu dirección.'
    if (!direccion.departamento_codigo) e.dep_res = 'Selecciona departamento.'
    if (!direccion.municipio_codigo) e.mun_res = 'Selecciona ciudad.'
    if (!form.departamento_trabajo || !form.municipio_trabajo) e.trabajo = 'Indica dónde deseas trabajar.'
    if (!form.eps_id) e.eps_id = 'Selecciona tu EPS.'
    if (!form.afp_id) e.afp_id = 'Selecciona tu fondo de pensión.'
    if (!form.cesantias_id) e.cesantias_id = 'Selecciona tu fondo de cesantías.'
    if (!form.ccf_id) e.ccf_id = 'Selecciona tu caja de compensación.'
    if (!form.banco_id) e.banco_id = 'Selecciona tu banco.'
    if (!form.numero_cuenta?.trim()) e.numero_cuenta = 'Escribe tu número de cuenta.'
    else if (form.numero_cuenta !== cuentaConfirm) e.cuentaConfirm = 'Los números de cuenta no coinciden.'
    if (!form.cargo_postulacion_id) e.cargo = 'Selecciona el cargo al que te postulas.'
    if (form.cargo_postulacion_id) {
      if (form.curso_alturas === null || form.curso_alturas === undefined
        || form.curso_alimentos === null || form.curso_alimentos === undefined
        || form.curso_grecas === null || form.curso_grecas === undefined) e.cursos = 'Responde las preguntas de cursos.'
      else if (form.curso_alturas && !form.curso_alturas_vigencia) e.cursos = 'Indica hasta cuándo está vigente tu curso de alturas.'
    }
    if (!form.talla_camisa || !form.talla_pantalon || !form.talla_calzado) e.tallas = 'Completa tus tallas.'
    if (requiereLibreta && !form.libreta_militar_tipo) e.libreta = 'Indica tu situación militar.'
    if (form.nivel_escolaridad !== 'Sin estudio' && !estudios.some((x) => x.institucion?.trim() || x.titulo?.trim())) e.estudios = 'Registra al menos tu último estudio.'
    const fam = referencias.filter((r) => r.tipo === 'FAMILIAR' && r.nombre.trim())
    const per = referencias.filter((r) => r.tipo === 'PERSONAL' && r.nombre.trim())
    if (fam.length < 1 || per.length < 1) e.referencias = 'Registra al menos una referencia familiar y una personal.'
    else if ([...fam, ...per].some((r) => !/^\d{7,10}$/.test(String(r.telefono ?? '')))) e.referencias = 'Cada referencia necesita un teléfono (7 a 10 dígitos).'
    if (experiencias.some((x) => x.empresa.trim() && !x.fecha_ingreso)) e.experiencias = 'Indica la fecha de ingreso de cada empleo.'
    setErrores(e)
    if (Object.keys(e).length) {
      toast.error('Revisa los campos marcados en rojo.')
      setTimeout(() => document.querySelector('[data-error="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
    }
    return Object.keys(e).length === 0
  }

  async function continuar() {
    if (!candidatoId) { toast.error('Sesión no iniciada.'); return }
    if (!validar()) return
    setGuardando(true)
    try {
      // Forzar guardado del candidato (por si el autosave está pendiente).
      const { id, estado, paso_actual, ...campos } = form
      void id; void estado; void paso_actual
      const err = await guardarCandidato(candidatoId, campos)
      if (err) throw new Error(err)
      await guardarDireccion(candidatoId, direccion)
      await guardarBeneficiarios(candidatoId, form.tiene_personas_a_cargo ? beneficiarios : [])
      const errs = await Promise.all([
        guardarEstudios(candidatoId, estudios),
        guardarExperiencias(candidatoId, experiencias),
        guardarReferencias(candidatoId, referencias),
      ])
      const e1 = errs.find(Boolean)
      if (e1) throw new Error(e1)
      next()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  const err = (k: string) => ({ error: errores[k] })
  const marca = (k: string) => ({ 'data-error': !!errores[k] })

  const setEst = (i: number, patch: Partial<Estudio>) => setEstudios(estudios.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const setExp = (i: number, patch: Partial<Experiencia>) => setExperiencias(experiencias.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const setRef = (i: number, patch: Partial<Referencia>) => setReferencias(referencias.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const addBenef = () => setBeneficiarios([...beneficiarios, { nombres: '', apellidos: '', parentesco: 'Hijo(a)' }])
  const setBenef = (i: number, patch: Partial<Beneficiario>) => setBeneficiarios(beneficiarios.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  const delBenef = (i: number) => setBeneficiarios(beneficiarios.filter((_, j) => j !== i))

  const lugarExpCodigo = catalogos.municipios.find((m) => m.nombre === form.lugar_expedicion_doc)?.codigo_dane ?? ''

  return (
    <div className="space-y-8">
      {/* ── Sección 1 · Identificación ───────────────────────────────────── */}
      <section className="space-y-4">
        <SeccionTitulo n={1} titulo="Tus datos" desc="Escríbelos tal como aparecen en tu documento." />
        <Grid>
          <div {...marca('primer_nombre')}>
            <Field label="Primer nombre" req {...err('primer_nombre')}>
              <Input value={form.primer_nombre ?? ''} onChange={(e) => update({ primer_nombre: soloLetras(e.target.value) })} placeholder="LAURA" />
            </Field>
          </div>
          <Field label="Segundo nombre">
            <Input value={form.segundo_nombre ?? ''} onChange={(e) => update({ segundo_nombre: soloLetras(e.target.value) })} placeholder="MARCELA" />
          </Field>
        </Grid>
        <Grid>
          <div {...marca('primer_apellido')}>
            <Field label="Primer apellido" req {...err('primer_apellido')}>
              <Input value={form.primer_apellido ?? ''} onChange={(e) => update({ primer_apellido: soloLetras(e.target.value) })} placeholder="RÍOS" />
            </Field>
          </div>
          <Field label="Segundo apellido">
            <Input value={form.segundo_apellido ?? ''} onChange={(e) => update({ segundo_apellido: soloLetras(e.target.value) })} placeholder="PEÑA" />
          </Field>
        </Grid>
        <Grid>
          <div {...marca('fecha_nacimiento')}>
            <Field label="Fecha de nacimiento" req {...err('fecha_nacimiento')}>
              <Input type="date" value={form.fecha_nacimiento ?? ''} onChange={(e) => update({ fecha_nacimiento: e.target.value })} />
            </Field>
          </div>
          <div {...marca('fecha_expedicion_doc')}>
            <Field label="Fecha de expedición del documento" req {...err('fecha_expedicion_doc')}>
              <Input type="date" value={form.fecha_expedicion_doc ?? ''} onChange={(e) => update({ fecha_expedicion_doc: e.target.value })} />
            </Field>
          </div>
        </Grid>
        <Grid>
          <div {...marca('lugar_expedicion_doc')}>
            <Field label="Lugar de expedición del documento" req {...err('lugar_expedicion_doc')}>
              <Select value={lugarExpCodigo} onChange={(e) => update({ lugar_expedicion_doc: catalogos.municipios.find((m) => m.codigo_dane === e.target.value)?.nombre ?? null })}>
                <option value="">— Selecciona —</option>
                {catalogos.municipios.map((m) => <option key={m.codigo_dane} value={m.codigo_dane}>{m.nombre} ({deptoNombre.get(m.departamento_codigo ?? '') ?? ''})</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Nacionalidad" req>
            <Input value={form.nacionalidad ?? 'COLOMBIANA'} onChange={(e) => update({ nacionalidad: e.target.value.toUpperCase() })} />
          </Field>
        </Grid>
        <div {...marca('nacimiento')}>
          <Grid>
            <Field label="Departamento de nacimiento" req {...err('nacimiento')}>
              <Select value={form.departamento_nacimiento ?? ''} onChange={(e) => update({ departamento_nacimiento: e.target.value || null, municipio_nacimiento: null })}>
                <option value="">— Selecciona —</option>
                {catalogos.departamentos.map((d) => <option key={d.codigo_dane} value={d.codigo_dane}>{d.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Ciudad de nacimiento" req>
              <Select value={form.municipio_nacimiento ?? ''} onChange={(e) => update({ municipio_nacimiento: e.target.value || null })} disabled={!form.departamento_nacimiento}>
                <option value="">{form.departamento_nacimiento ? '— Selecciona —' : 'Primero selecciona el departamento'}</option>
                {munisDe(form.departamento_nacimiento).map((m) => <option key={m.codigo_dane} value={m.codigo_dane}>{m.nombre}</option>)}
              </Select>
            </Field>
          </Grid>
        </div>
        <Grid>
          <div {...marca('genero')}>
            <Field label="Género" req {...err('genero')}><Select value={form.genero ?? ''} onChange={(e) => update({ genero: e.target.value })}>
              <option value="">— Selecciona —</option>{GENEROS.map((g) => <option key={g}>{g}</option>)}
            </Select></Field>
          </div>
          <div {...marca('estado_civil')}>
            <Field label="Estado civil" req {...err('estado_civil')}><Select value={form.estado_civil ?? ''} onChange={(e) => update({ estado_civil: e.target.value })}>
              <option value="">— Selecciona —</option>{ESTADOS_CIVILES.map((g) => <option key={g}>{g}</option>)}
            </Select></Field>
          </div>
        </Grid>
        <Grid>
          <div {...marca('grupo_sanguineo')}>
            <Field label="Grupo sanguíneo y RH" req {...err('grupo_sanguineo')}><Select value={form.grupo_sanguineo ?? ''} onChange={(e) => update({ grupo_sanguineo: e.target.value })}>
              <option value="">— Selecciona —</option>{RH.map((g) => <option key={g}>{g}</option>)}
            </Select></Field>
          </div>
          <div {...marca('nivel_escolaridad')}>
            <Field label="Nivel de escolaridad" req {...err('nivel_escolaridad')}><Select value={form.nivel_escolaridad ?? ''} onChange={(e) => update({ nivel_escolaridad: e.target.value })}>
              <option value="">— Selecciona —</option>{ESCOLARIDAD.map((g) => <option key={g}>{g}</option>)}
            </Select></Field>
          </div>
        </Grid>
        <Grid>
          <Field label="Estatura (cm)" hint="Ej.: 154">
            <Input inputMode="numeric" maxLength={3} value={form.estatura_cm ?? ''} onChange={(e) => update({ estatura_cm: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} />
          </Field>
          {requiereLibreta ? (
            <div {...marca('libreta')}>
              <Field label="Tipo de libreta militar" req {...err('libreta')}>
                <Select value={form.libreta_militar_tipo ?? ''} onChange={(e) => update({ libreta_militar_tipo: e.target.value })}>
                  <option value="">— Selecciona —</option>{LIBRETA.map((g) => <option key={g}>{g}</option>)}
                </Select>
              </Field>
            </div>
          ) : <div />}
        </Grid>
        {requiereLibreta && form.libreta_militar_tipo && form.libreta_militar_tipo !== 'No aplica' && (
          <Grid>
            <Field label="Número de libreta militar"><Input value={form.libreta_militar_numero ?? ''} onChange={(e) => update({ libreta_militar_numero: e.target.value })} /></Field>
            <Field label="Distrito militar"><Input value={form.distrito_militar ?? ''} onChange={(e) => update({ distrito_militar: e.target.value })} /></Field>
          </Grid>
        )}
      </section>

      {/* ── Sección 2 · Contacto y ubicación ─────────────────────────────── */}
      <section className="space-y-4">
        <SeccionTitulo n={2} titulo="Contacto y dónde vives" />
        <Grid>
          <div {...marca('email')}>
            <Field label="Correo electrónico" req hint="Aquí te llegan los comunicados de la empresa" {...err('email')}>
              <Input type="email" value={form.email ?? ''} onChange={(e) => update({ email: e.target.value.trim() })} placeholder="correo@ejemplo.com" />
            </Field>
          </div>
          <div {...marca('celular')}>
            <Field label="Celular" req hint="10 dígitos, empieza en 3" {...err('celular')}>
              <Input inputMode="numeric" maxLength={10} value={form.celular ?? ''} onChange={(e) => update({ celular: e.target.value.replace(/\D/g, '') })} placeholder="3001234567" />
            </Field>
          </div>
        </Grid>
        <Grid>
          <Field label="Otro celular / de recado">
            <Input inputMode="numeric" maxLength={10} value={form.telefono_alterno ?? ''} onChange={(e) => update({ telefono_alterno: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="Teléfono fijo">
            <Input inputMode="numeric" maxLength={10} value={form.telefono_fijo ?? ''} onChange={(e) => update({ telefono_fijo: e.target.value.replace(/\D/g, '') })} />
          </Field>
        </Grid>
        <div {...marca('direccion')}>
          <Field label="Dirección de residencia" req {...err('direccion')}>
            <Input value={direccion.direccion} onChange={(e) => setDireccion({ ...direccion, direccion: e.target.value })} placeholder="Calle 100 # 20-30 apto 501" />
          </Field>
        </div>
        <Grid>
          <Field label="Barrio">
            <Input value={direccion.barrio ?? ''} onChange={(e) => setDireccion({ ...direccion, barrio: e.target.value })} />
          </Field>
          <div {...marca('dep_res')}>
            <Field label="Departamento de residencia" req {...err('dep_res')}>
              <Select value={direccion.departamento_codigo ?? ''} onChange={(e) => setDireccion({ ...direccion, departamento_codigo: e.target.value || null, municipio_codigo: null })}>
                <option value="">— Selecciona —</option>
                {catalogos.departamentos.map((d) => <option key={d.codigo_dane} value={d.codigo_dane}>{d.nombre}</option>)}
              </Select>
            </Field>
          </div>
        </Grid>
        <Grid>
          <div {...marca('mun_res')}>
            <Field label="Ciudad de residencia" req {...err('mun_res')}>
              <Select value={direccion.municipio_codigo ?? ''} onChange={(e) => setDireccion({ ...direccion, municipio_codigo: e.target.value || null })} disabled={!direccion.departamento_codigo}>
                <option value="">{direccion.departamento_codigo ? '— Selecciona —' : 'Primero selecciona el departamento'}</option>
                {munisDe(direccion.departamento_codigo).map((m) => <option key={m.codigo_dane} value={m.codigo_dane}>{m.nombre}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Localidad / comuna (opcional)">
            <Input value={direccion.localidad ?? ''} onChange={(e) => setDireccion({ ...direccion, localidad: e.target.value })} />
          </Field>
        </Grid>
        <div {...marca('trabajo')}>
          <Grid>
            <Field label="Departamento donde deseas trabajar" req {...err('trabajo')}>
              <Select value={form.departamento_trabajo ?? ''} onChange={(e) => update({ departamento_trabajo: e.target.value || null, municipio_trabajo: null })}>
                <option value="">— Selecciona —</option>
                {catalogos.departamentos.map((d) => <option key={d.codigo_dane} value={d.codigo_dane}>{d.nombre}</option>)}
              </Select>
            </Field>
            <Field label="Ciudad donde deseas trabajar" req>
              <Select value={form.municipio_trabajo ?? ''} onChange={(e) => update({ municipio_trabajo: e.target.value || null })} disabled={!form.departamento_trabajo}>
                <option value="">{form.departamento_trabajo ? '— Selecciona —' : 'Primero selecciona el departamento'}</option>
                {munisDe(form.departamento_trabajo).map((m) => <option key={m.codigo_dane} value={m.codigo_dane}>{m.nombre}</option>)}
              </Select>
            </Field>
          </Grid>
        </div>
        <div className="rounded-xl bg-gray-50 p-4">
          <p className="mb-3 text-sm font-semibold text-gray-700">Contacto de emergencia (si no te podemos ubicar)</p>
          <div className="space-y-4">
            <Grid>
              <Field label="Nombre"><Input value={form.contacto_emergencia_nombre ?? ''} onChange={(e) => update({ contacto_emergencia_nombre: e.target.value })} /></Field>
              <Field label="Parentesco">
                <Select value={form.contacto_emergencia_parentesco ?? ''} onChange={(e) => update({ contacto_emergencia_parentesco: e.target.value })}>
                  <option value="">— Selecciona —</option>{[...PARENTESCOS_FAMILIAR, 'Amigo(a)'].map((p) => <option key={p}>{p}</option>)}
                </Select>
              </Field>
            </Grid>
            <Field label="Teléfono"><Input inputMode="numeric" maxLength={10} value={form.contacto_emergencia_telefono ?? ''} onChange={(e) => update({ contacto_emergencia_telefono: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
        </div>
      </section>

      {/* ── Sección 3 · Seguridad social y pago ──────────────────────────── */}
      <section className="space-y-4">
        <SeccionTitulo n={3} titulo="Seguridad social y pago" />
        <Grid>
          <div {...marca('eps_id')}>
            <Field label="EPS" req {...err('eps_id')}>
              <Select value={form.eps_id ?? ''} onChange={(e) => update({ eps_id: e.target.value || null })}>
                <option value="">— Selecciona —</option>{catalogos.eps.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </Select>
            </Field>
          </div>
          <div {...marca('afp_id')}>
            <Field label="Fondo de pensión" req {...err('afp_id')}>
              <Select value={form.afp_id ?? ''} onChange={(e) => update({ afp_id: e.target.value || null })}>
                <option value="">— Selecciona —</option>{catalogos.afp.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </Select>
            </Field>
          </div>
        </Grid>
        <Grid>
          <div {...marca('cesantias_id')}>
            <Field label="Fondo de cesantías" req {...err('cesantias_id')}>
              <Select value={form.cesantias_id ?? ''} onChange={(e) => update({ cesantias_id: e.target.value || null })}>
                <option value="">— Selecciona —</option>{catalogos.cesantias.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </Select>
            </Field>
          </div>
          <div {...marca('ccf_id')}>
            <Field label="Caja de compensación" req {...err('ccf_id')}>
              <Select value={form.ccf_id ?? ''} onChange={(e) => update({ ccf_id: e.target.value || null })}>
                <option value="">— Selecciona —</option>{catalogos.cajas.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </Select>
            </Field>
          </div>
        </Grid>
        <Field label="¿Eres pensionado(a)?">
          <SiNo value={form.es_pensionado} onChange={(v) => update({ es_pensionado: v })} />
        </Field>
        <Grid>
          <div {...marca('banco_id')}>
            <Field label="Banco" req {...err('banco_id')}>
              <Select value={form.banco_id ?? ''} onChange={(e) => update({ banco_id: e.target.value || null })}>
                <option value="">— Selecciona —</option>{catalogos.bancos.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Tipo de cuenta" req>
            <Select value={form.tipo_cuenta ?? ''} onChange={(e) => update({ tipo_cuenta: e.target.value })}>
              <option value="">— Selecciona —</option>{TIPO_CUENTA.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
        </Grid>
        <Grid>
          <div {...marca('numero_cuenta')}>
            <Field label="Número de cuenta" req {...err('numero_cuenta')}>
              <Input inputMode="numeric" value={form.numero_cuenta ?? ''} onChange={(e) => update({ numero_cuenta: e.target.value.replace(/\D/g, '') })} />
            </Field>
          </div>
          <div {...marca('cuentaConfirm')}>
            <Field label="Confirma el número de cuenta" req {...err('cuentaConfirm')}>
              <Input inputMode="numeric" value={cuentaConfirm} onChange={(e) => setCuentaConfirm(e.target.value.replace(/\D/g, ''))} onPaste={(e) => e.preventDefault()} />
            </Field>
          </div>
        </Grid>
        <Field label="¿La cuenta está a tu nombre?">
          <SiNo value={form.cuenta_propia} onChange={(v) => update({ cuenta_propia: v })} />
        </Field>
        {form.cuenta_propia === false && (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">Si la cuenta no está a tu nombre, deberás gestionarlo con Recursos Humanos.</p>
        )}
      </section>

      {/* ── Sección 4 · Experiencia, cargo y cursos ──────────────────────── */}
      <section className="space-y-4">
        <SeccionTitulo n={4} titulo="Cargo, experiencia y cursos" />
        <div {...marca('cargo')}>
          <Field label="Cargo al que te postulas" req {...err('cargo')}>
            <Select value={form.cargo_postulacion_id ?? ''} onChange={(e) => update({ cargo_postulacion_id: e.target.value || null })}>
              <option value="">— Selecciona —</option>{catalogos.cargos.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </Select>
          </Field>
        </div>
        {form.cargo_postulacion_id && (
          <div className="space-y-4 rounded-xl border border-brand-green/20 bg-brand-green/5 p-4" {...marca('cursos')}>
            <p className="text-sm font-semibold text-gray-800">Datos de cursos</p>
            <Field label="¿Tienes curso de trabajo en alturas vigente?" req {...err('cursos')}>
              <SiNo value={form.curso_alturas} onChange={(v) => update({ curso_alturas: v, ...(v ? {} : { curso_alturas_vigencia: null }) })} />
            </Field>
            {form.curso_alturas && (
              <Field label="¿En qué fecha vence el curso de alturas?" req>
                <Input type="date" value={form.curso_alturas_vigencia ?? ''} onChange={(e) => update({ curso_alturas_vigencia: e.target.value })} />
              </Field>
            )}
            <Field label="¿Tienes curso de manipulación de alimentos?" req>
              <SiNo value={form.curso_alimentos} onChange={(v) => update({ curso_alimentos: v })} />
            </Field>
            <Field label="¿Tienes curso de manejo de grecas?" req>
              <SiNo value={form.curso_grecas} onChange={(v) => update({ curso_grecas: v })} />
            </Field>
          </div>
        )}
        <Grid>
          <Field label="Años de experiencia laboral"><Input type="number" min={0} max={50} value={form.experiencia_anios ?? ''} onChange={(e) => update({ experiencia_anios: e.target.value ? +e.target.value : null })} /></Field>
          <Field label="Meses adicionales"><Input type="number" min={0} max={11} value={form.experiencia_meses ?? ''} onChange={(e) => update({ experiencia_meses: e.target.value ? +e.target.value : null })} /></Field>
        </Grid>
        <Field label="Cuéntanos brevemente de ti (perfil laboral)" hint="Opcional. Qué sabes hacer, cómo eres trabajando.">
          <Textarea value={form.perfil_laboral ?? ''} onChange={(e) => update({ perfil_laboral: e.target.value })} maxLength={800} />
        </Field>
        <Field label="Disponibilidad de jornada">
          <Chips opciones={JORNADAS} value={form.disponibilidad_jornada ?? []} onChange={(v) => update({ disponibilidad_jornada: v })} />
        </Field>
        <Grid>
          <Field label="¿Desde cuándo puedes iniciar?"><Input type="date" value={form.fecha_disponible ?? ''} onChange={(e) => update({ fecha_disponible: e.target.value })} /></Field>
          <Field label="Aspiración salarial (opcional)"><Input type="number" min={0} value={form.aspiracion_salarial ?? ''} onChange={(e) => update({ aspiracion_salarial: e.target.value ? +e.target.value : null })} /></Field>
        </Grid>
        <Field label="¿Puedes desplazarte a otras sedes?">
          <SiNo value={form.se_puede_desplazar} onChange={(v) => update({ se_puede_desplazar: v })} />
        </Field>
        <Grid>
          <Field label="¿Cómo te enteraste de la vacante?">
            <Select value={form.fuente_reclutamiento ?? ''} onChange={(e) => update({ fuente_reclutamiento: e.target.value })}>
              <option value="">— Selecciona —</option>{FUENTES.map((f) => <option key={f}>{f}</option>)}
            </Select>
          </Field>
          {form.fuente_reclutamiento === 'Referido' && (
            <Field label="Nombre de quien te refirió"><Input value={form.referido_por ?? ''} onChange={(e) => update({ referido_por: e.target.value })} /></Field>
          )}
        </Grid>
      </section>

      {/* ── Sección 5 · Estudios ─────────────────────────────────────────── */}
      <section className="space-y-3" {...marca('estudios')}>
        <SeccionTitulo n={5} titulo="Estudios" desc="Tu último estudio y los cursos que tengas (alturas, alimentos, etiqueta y protocolo…)." />
        {errores.estudios && <p className="text-xs font-medium text-red-600">{errores.estudios}</p>}
        {estudios.map((x, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-600">Estudio {i + 1}</span>
              <button type="button" onClick={() => setEstudios(estudios.filter((_, j) => j !== i))} className="text-red-500" aria-label="Quitar"><Trash2 className="h-4 w-4" /></button>
            </div>
            <Grid>
              <Select value={x.nivel} onChange={(e) => setEst(i, { nivel: e.target.value })}>
                {NIVELES_ESTUDIO.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
              </Select>
              <Input placeholder="Institución" value={x.institucion ?? ''} onChange={(e) => setEst(i, { institucion: e.target.value })} />
            </Grid>
            <Grid>
              <Input placeholder={x.nivel === 'CURSO' ? 'Nombre del curso' : 'Título obtenido'} value={x.titulo ?? ''} onChange={(e) => setEst(i, { titulo: e.target.value })} />
              <Input placeholder="Ciudad" value={x.ciudad ?? ''} onChange={(e) => setEst(i, { ciudad: e.target.value })} />
            </Grid>
            <Grid>
              <Input type="number" placeholder="Año de finalización" min={1950} max={2100} value={x.anio_finalizacion ?? ''} onChange={(e) => setEst(i, { anio_finalizacion: e.target.value ? Number(e.target.value) : null })} />
              {x.nivel === 'CURSO'
                ? <Input placeholder="Intensidad (ej.: 10 horas)" value={x.intensidad_horaria ?? ''} onChange={(e) => setEst(i, { intensidad_horaria: e.target.value })} />
                : <Input placeholder="Último curso aprobado (ej.: 11°, 5 semestre)" value={x.ultimo_curso_aprobado ?? ''} onChange={(e) => setEst(i, { ultimo_curso_aprobado: e.target.value })} />}
            </Grid>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={!!x.en_curso} onChange={(e) => setEst(i, { en_curso: e.target.checked })} className="h-4 w-4 accent-[#2E7D32]" /> Lo estoy cursando actualmente
            </label>
          </div>
        ))}
        <button type="button" onClick={() => setEstudios([...estudios, { nivel: estudios.length ? 'CURSO' : 'SECUNDARIA' }])}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-brand-green py-3 font-body text-sm font-semibold text-brand-green">
          <Plus className="h-4 w-4" /> Agregar estudio o curso
        </button>
      </section>

      {/* ── Sección 6 · Experiencia laboral ──────────────────────────────── */}
      <section className="space-y-3" {...marca('experiencias')}>
        <SeccionTitulo n={6} titulo="Empleos anteriores" desc="Empieza por el último. Si es tu primer empleo, déjalo vacío." />
        {errores.experiencias && <p className="text-xs font-medium text-red-600">{errores.experiencias}</p>}
        {experiencias.map((x, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-600">Empleo {i + 1}</span>
              <button type="button" onClick={() => setExperiencias(experiencias.filter((_, j) => j !== i))} className="text-red-500" aria-label="Quitar"><Trash2 className="h-4 w-4" /></button>
            </div>
            <Grid>
              <Input placeholder="Empresa" value={x.empresa} onChange={(e) => setExp(i, { empresa: e.target.value })} />
              <Input placeholder="Cargo que tenías" value={x.cargo ?? ''} onChange={(e) => setExp(i, { cargo: e.target.value })} />
            </Grid>
            <Grid>
              <Input placeholder="Teléfono de la empresa" inputMode="numeric" value={x.telefono ?? ''} onChange={(e) => setExp(i, { telefono: e.target.value.replace(/\D/g, '') })} />
              <Input placeholder="Dirección de la empresa" value={x.direccion ?? ''} onChange={(e) => setExp(i, { direccion: e.target.value })} />
            </Grid>
            <Grid>
              <Input placeholder="Jefe inmediato" value={x.jefe_inmediato ?? ''} onChange={(e) => setExp(i, { jefe_inmediato: e.target.value })} />
              <Input placeholder="Cargo del jefe" value={x.cargo_jefe ?? ''} onChange={(e) => setExp(i, { cargo_jefe: e.target.value })} />
            </Grid>
            <Grid>
              <Field label="Fecha de ingreso"><Input type="date" value={x.fecha_ingreso ?? ''} onChange={(e) => setExp(i, { fecha_ingreso: e.target.value })} /></Field>
              <Field label="Fecha de retiro">
                <Input type="date" value={x.fecha_retiro ?? ''} disabled={!!x.trabaja_actualmente} onChange={(e) => setExp(i, { fecha_retiro: e.target.value })} />
              </Field>
            </Grid>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" checked={!!x.trabaja_actualmente} onChange={(e) => setExp(i, { trabaja_actualmente: e.target.checked, fecha_retiro: e.target.checked ? null : x.fecha_retiro })} className="h-4 w-4 accent-[#2E7D32]" /> Trabajo ahí actualmente
            </label>
            <Input placeholder="Motivo del retiro" value={x.motivo_retiro ?? ''} onChange={(e) => setExp(i, { motivo_retiro: e.target.value })} />
            <Textarea placeholder="Funciones que realizabas" value={x.funciones ?? ''} onChange={(e) => setExp(i, { funciones: e.target.value })} />
          </div>
        ))}
        {experiencias.length < 5 && (
          <button type="button" onClick={() => setExperiencias([...experiencias, { empresa: '' }])}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-brand-green py-3 font-body text-sm font-semibold text-brand-green">
            <Plus className="h-4 w-4" /> Agregar empleo
          </button>
        )}
      </section>

      {/* ── Sección 7 · Referencias ──────────────────────────────────────── */}
      <section className="space-y-3" {...marca('referencias')}>
        <SeccionTitulo n={7} titulo="Referencias" desc="Dos familiares que no vivan contigo y dos personas que te conozcan (no familiares ni jefes)." />
        {errores.referencias && <p className="text-xs font-medium text-red-600">{errores.referencias}</p>}
        {referencias.map((r, i) => (
          <div key={i} className="space-y-3 rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-600">Referencia {r.tipo === 'FAMILIAR' ? 'familiar' : r.tipo === 'PERSONAL' ? 'personal' : 'laboral'}</span>
              {referencias.filter((x) => x.tipo === r.tipo).length > 2 && (
                <button type="button" onClick={() => setReferencias(referencias.filter((_, j) => j !== i))} className="text-red-500" aria-label="Quitar"><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
            <Grid>
              <Input placeholder="Nombre completo" value={r.nombre} onChange={(e) => setRef(i, { nombre: e.target.value })} />
              {r.tipo === 'FAMILIAR' ? (
                <Select value={r.parentesco ?? ''} onChange={(e) => setRef(i, { parentesco: e.target.value })}>
                  <option value="">Parentesco</option>{PARENTESCOS_FAMILIAR.map((p) => <option key={p}>{p}</option>)}
                </Select>
              ) : (
                <Input placeholder="¿De dónde lo conoces? (amigo, vecino…)" value={r.parentesco ?? ''} onChange={(e) => setRef(i, { parentesco: e.target.value })} />
              )}
            </Grid>
            <Grid>
              <Input placeholder="Teléfono" inputMode="numeric" maxLength={10} value={r.telefono ?? ''} onChange={(e) => setRef(i, { telefono: e.target.value.replace(/\D/g, '') })} />
              <Input placeholder="Ocupación" value={r.ocupacion ?? ''} onChange={(e) => setRef(i, { ocupacion: e.target.value })} />
            </Grid>
            <Input placeholder="Dirección o barrio" value={r.direccion ?? ''} onChange={(e) => setRef(i, { direccion: e.target.value })} />
          </div>
        ))}
      </section>

      {/* ── Sección 8 · Dotación ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <SeccionTitulo n={8} titulo="Tus tallas (dotación)" desc="Para entregarte tu uniforme sin demoras." />
        <div {...marca('tallas')}>
          <Grid>
            <Field label="Camisa / blusa" req>
              <Select value={form.talla_camisa ?? ''} onChange={(e) => update({ talla_camisa: e.target.value })}>
                <option value="">—</option>{TALLA_CAMISA.map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Pantalón" req>
              <Input value={form.talla_pantalon ?? ''} onChange={(e) => update({ talla_pantalon: e.target.value })} placeholder="Ej: 32 o M" />
            </Field>
          </Grid>
          <div className="mt-4">
            <Grid>
              <Field label="Calzado" req>
                <Select value={form.talla_calzado ?? ''} onChange={(e) => update({ talla_calzado: e.target.value })}>
                  <option value="">—</option>{TALLA_CALZADO.map((t) => <option key={t}>{t}</option>)}
                </Select>
              </Field>
              <Field label="Chaqueta / overol (opcional)">
                <Select value={form.talla_chaqueta ?? ''} onChange={(e) => update({ talla_chaqueta: e.target.value })}>
                  <option value="">—</option>{TALLA_CAMISA.map((t) => <option key={t}>{t}</option>)}
                </Select>
              </Field>
            </Grid>
          </div>
          {errores.tallas && <p className="mt-1 text-xs font-medium text-red-600">{errores.tallas}</p>}
        </div>
      </section>

      {/* ── Sección 9 · Grupo familiar ───────────────────────────────────── */}
      <section className="space-y-4">
        <SeccionTitulo n={9} titulo="Grupo familiar" desc="Las personas que dependen de ti (para afiliarlas a EPS y caja)." />
        <Field label="¿Tienes personas a cargo?">
          <SiNo value={form.tiene_personas_a_cargo} onChange={(v) => update({ tiene_personas_a_cargo: v })} />
        </Field>
        {form.tiene_personas_a_cargo && (
          <div className="space-y-3">
            {beneficiarios.map((b, i) => (
              <div key={i} className="rounded-xl border border-gray-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-600">Beneficiario {i + 1}</span>
                  <button type="button" onClick={() => delBenef(i)} className="text-red-500" aria-label="Quitar"><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="space-y-3">
                  <Grid>
                    <Input placeholder="Nombres" value={b.nombres} onChange={(e) => setBenef(i, { nombres: e.target.value })} />
                    <Input placeholder="Apellidos" value={b.apellidos} onChange={(e) => setBenef(i, { apellidos: e.target.value })} />
                  </Grid>
                  <Grid>
                    <Select value={b.parentesco} onChange={(e) => setBenef(i, { parentesco: e.target.value })}>
                      {PARENTESCOS.map((p) => <option key={p}>{p}</option>)}
                    </Select>
                    <Input type="date" value={b.fecha_nacimiento ?? ''} onChange={(e) => setBenef(i, { fecha_nacimiento: e.target.value })} />
                  </Grid>
                  <Grid>
                    <Select value={b.tipo_documento ?? ''} onChange={(e) => setBenef(i, { tipo_documento: e.target.value })}>
                      <option value="">Tipo doc.</option><option>RC</option><option>TI</option><option>CC</option>
                    </Select>
                    <Input placeholder="Número de documento" value={b.numero_documento ?? ''} onChange={(e) => setBenef(i, { numero_documento: e.target.value })} />
                  </Grid>
                </div>
              </div>
            ))}
            <button type="button" onClick={addBenef} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-brand-green py-3 font-body text-sm font-semibold text-brand-green">
              <Plus className="h-4 w-4" /> Agregar beneficiario
            </button>
            <Field label="¿Tu cónyuge trabaja?">
              <SiNo value={form.conyuge_trabaja === 'SI' ? true : form.conyuge_trabaja === 'NO' ? false : null}
                onChange={(v) => update({ conyuge_trabaja: v === true ? 'SI' : v === false ? 'NO' : 'NA' })} incluyeNA />
            </Field>
          </div>
        )}
      </section>

      {/* ── Sección 10 · Encuesta sociodemográfica (opcional) ─────────────── */}
      <section className="space-y-4">
        <SeccionTitulo n={10} titulo="Cuéntanos un poco más" desc="Opcional. No preguntamos por tu salud." />
        <Grid>
          <Field label="Tipo de vivienda">
            <Select value={form.vivienda_tipo ?? ''} onChange={(e) => update({ vivienda_tipo: e.target.value })}>
              <option value="">— Selecciona —</option>{VIVIENDA.map((v) => <option key={v}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Estrato">
            <Select value={form.estrato ?? ''} onChange={(e) => update({ estrato: e.target.value ? +e.target.value : null })}>
              <option value="">—</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
        </Grid>
        <Field label="¿Practicas algún deporte?">
          <SiNo value={form.practica_deporte} onChange={(v) => update({ practica_deporte: v })} />
        </Field>
      </section>

      {/* Navegación */}
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={prev} className="rounded-xl border border-gray-300 px-5 py-3 font-body font-semibold text-gray-600">
          Atrás
        </button>
        <button type="button" onClick={continuar} disabled={guardando}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-green py-3 font-body text-base font-semibold text-white transition-colors hover:bg-brand-green-dark disabled:opacity-50">
          {guardando ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Continuar a documentos <ArrowRight className="h-5 w-5" /></>}
        </button>
      </div>
    </div>
  )
}
