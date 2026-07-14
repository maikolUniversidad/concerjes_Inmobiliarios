'use client'

import { useMemo, useState } from 'react'
import { Loader2, Plus, Trash2, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import type { WizardCtx } from '../RegistroWizard'
import { Field, Input, Select, Textarea, SiNo, Chips, Grid, SeccionTitulo } from '../ui'
import { guardarDireccion, guardarBeneficiarios, guardarCandidato } from '@/lib/registro/datos'
import {
  GENEROS, ESTADOS_CIVILES, RH, ESCOLARIDAD, LIBRETA, TIPO_CUENTA, JORNADAS, FUENTES,
  TALLA_CAMISA, TALLA_CALZADO, PARENTESCOS, VIVIENDA, type Beneficiario,
} from '@/lib/registro/tipos'

export function Paso2Formulario({ ctx }: { ctx: WizardCtx }) {
  const { form, update, catalogos, candidatoId, direccion, setDireccion, beneficiarios, setBeneficiarios, next, prev } = ctx
  const [guardando, setGuardando] = useState(false)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [cuentaConfirm, setCuentaConfirm] = useState(form.numero_cuenta ?? '')

  const munisDe = (dep?: string | null) =>
    catalogos.municipios.filter((m) => m.departamento_codigo === dep)

  const esMasculino = form.genero === 'Masculino'
  const edad = useMemo(() => {
    if (!form.fecha_nacimiento) return null
    const d = new Date(form.fecha_nacimiento)
    return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000))
  }, [form.fecha_nacimiento])
  const requiereLibreta = esMasculino && edad !== null && edad < 50

  function validar(): boolean {
    const e: Record<string, string> = {}
    if (!form.nombres?.trim()) e.nombres = 'Escribe tus nombres.'
    if (!form.apellidos?.trim()) e.apellidos = 'Escribe tus apellidos.'
    if (!form.fecha_nacimiento) e.fecha_nacimiento = 'Falta tu fecha de nacimiento.'
    else if (edad !== null && edad < 18) e.fecha_nacimiento = 'Debes ser mayor de edad (18 años).'
    if (!form.email?.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) e.email = 'Correo no válido.'
    if (!form.celular?.trim() || !/^3\d{9}$/.test(form.celular)) e.celular = 'Celular de 10 dígitos que empiece en 3.'
    if (!direccion.direccion?.trim()) e.direccion = 'Escribe tu dirección.'
    if (!direccion.departamento_codigo) e.dep_res = 'Selecciona departamento.'
    if (!direccion.municipio_codigo) e.mun_res = 'Selecciona ciudad.'
    if (!form.eps_id) e.eps_id = 'Selecciona tu EPS.'
    if (!form.afp_id) e.afp_id = 'Selecciona tu fondo de pensión.'
    if (!form.cesantias_id) e.cesantias_id = 'Selecciona tu fondo de cesantías.'
    if (!form.ccf_id) e.ccf_id = 'Selecciona tu caja de compensación.'
    if (!form.banco_id) e.banco_id = 'Selecciona tu banco.'
    if (!form.numero_cuenta?.trim()) e.numero_cuenta = 'Escribe tu número de cuenta.'
    else if (form.numero_cuenta !== cuentaConfirm) e.cuentaConfirm = 'Los números de cuenta no coinciden.'
    if (!form.cargo_postulacion_id) e.cargo = 'Selecciona el cargo al que te postulas.'
    if (!form.talla_camisa || !form.talla_pantalon || !form.talla_calzado) e.tallas = 'Completa tus tallas.'
    if (requiereLibreta && !form.libreta_militar_tipo) e.libreta = 'Indica tu situación militar.'
    setErrores(e)
    if (Object.keys(e).length) {
      toast.error('Revisa los campos marcados en rojo.')
      const first = document.querySelector('[data-error="true"]')
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
      await guardarCandidato(candidatoId, { ...campos, nombres: form.nombres?.toUpperCase(), apellidos: form.apellidos?.toUpperCase() })
      await guardarDireccion(candidatoId, direccion)
      await guardarBeneficiarios(candidatoId, form.tiene_personas_a_cargo ? beneficiarios : [])
      next()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  const errProps = (k: string) => ({ error: errores[k], 'data-error': !!errores[k] } as const)

  const addBenef = () =>
    setBeneficiarios([...beneficiarios, { nombres: '', apellidos: '', parentesco: 'Hijo(a)' }])
  const setBenef = (i: number, patch: Partial<Beneficiario>) =>
    setBeneficiarios(beneficiarios.map((b, j) => (j === i ? { ...b, ...patch } : b)))
  const delBenef = (i: number) => setBeneficiarios(beneficiarios.filter((_, j) => j !== i))

  return (
    <div className="space-y-8">
      {/* ── Sección 1 · Identificación ───────────────────────────────────── */}
      <section className="space-y-4">
        <SeccionTitulo n={1} titulo="Tus datos" />
        <Grid>
          <Field label="Nombres" req {...errProps('nombres')}>
            <div data-error={!!errores.nombres}>
              <Input value={form.nombres ?? ''} onChange={(e) => update({ nombres: e.target.value })} placeholder="María Fernanda" />
            </div>
          </Field>
          <Field label="Apellidos" req {...errProps('apellidos')}>
            <div data-error={!!errores.apellidos}>
              <Input value={form.apellidos ?? ''} onChange={(e) => update({ apellidos: e.target.value })} placeholder="Gómez Ruiz" />
            </div>
          </Field>
        </Grid>
        <Grid>
          <Field label="Fecha de nacimiento" req {...errProps('fecha_nacimiento')}>
            <div data-error={!!errores.fecha_nacimiento}>
              <Input type="date" value={form.fecha_nacimiento ?? ''} onChange={(e) => update({ fecha_nacimiento: e.target.value })} />
            </div>
          </Field>
          <Field label="Fecha de expedición del documento">
            <Input type="date" value={form.fecha_expedicion_doc ?? ''} onChange={(e) => update({ fecha_expedicion_doc: e.target.value })} />
          </Field>
        </Grid>
        <Grid>
          <Field label="Nacionalidad" req>
            <Input value={form.nacionalidad ?? 'COLOMBIANA'} onChange={(e) => update({ nacionalidad: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Lugar de expedición del documento">
            <Select
              value={catalogos.municipios.find((m) => m.nombre === form.lugar_expedicion_doc)?.codigo_dane ?? ''}
              onChange={(e) => update({ lugar_expedicion_doc: catalogos.municipios.find((m) => m.codigo_dane === e.target.value)?.nombre ?? null })}
            >
              <option value="">— Selecciona —</option>
              {catalogos.municipios.map((m) => <option key={m.codigo_dane} value={m.codigo_dane}>{m.nombre}</option>)}
            </Select>
          </Field>
        </Grid>
        <Grid>
          <Field label="Departamento de nacimiento">
            <Select value={form.departamento_nacimiento ?? ''} onChange={(e) => update({ departamento_nacimiento: e.target.value || null, municipio_nacimiento: null })}>
              <option value="">— Selecciona —</option>
              {catalogos.departamentos.map((d) => <option key={d.codigo_dane} value={d.codigo_dane}>{d.nombre}</option>)}
            </Select>
          </Field>
          <Field label="Ciudad de nacimiento">
            <Select value={form.municipio_nacimiento ?? ''} onChange={(e) => update({ municipio_nacimiento: e.target.value || null })} disabled={!form.departamento_nacimiento}>
              <option value="">— Selecciona —</option>
              {munisDe(form.departamento_nacimiento).map((m) => <option key={m.codigo_dane} value={m.codigo_dane}>{m.nombre}</option>)}
            </Select>
          </Field>
        </Grid>
        <Grid>
          <Field label="Género" req><Select value={form.genero ?? ''} onChange={(e) => update({ genero: e.target.value })}>
            <option value="">— Selecciona —</option>{GENEROS.map((g) => <option key={g}>{g}</option>)}
          </Select></Field>
          <Field label="Estado civil" req><Select value={form.estado_civil ?? ''} onChange={(e) => update({ estado_civil: e.target.value })}>
            <option value="">— Selecciona —</option>{ESTADOS_CIVILES.map((g) => <option key={g}>{g}</option>)}
          </Select></Field>
        </Grid>
        <Grid>
          <Field label="Grupo sanguíneo y RH" req><Select value={form.grupo_sanguineo ?? ''} onChange={(e) => update({ grupo_sanguineo: e.target.value })}>
            <option value="">— Selecciona —</option>{RH.map((g) => <option key={g}>{g}</option>)}
          </Select></Field>
          <Field label="Nivel de escolaridad" req><Select value={form.nivel_escolaridad ?? ''} onChange={(e) => update({ nivel_escolaridad: e.target.value })}>
            <option value="">— Selecciona —</option>{ESCOLARIDAD.map((g) => <option key={g}>{g}</option>)}
          </Select></Field>
        </Grid>
        {requiereLibreta && (
          <Grid>
            <Field label="Tipo de libreta militar" req {...errProps('libreta')}>
              <div data-error={!!errores.libreta}>
                <Select value={form.libreta_militar_tipo ?? ''} onChange={(e) => update({ libreta_militar_tipo: e.target.value })}>
                  <option value="">— Selecciona —</option>{LIBRETA.map((g) => <option key={g}>{g}</option>)}
                </Select>
              </div>
            </Field>
            {form.libreta_militar_tipo && form.libreta_militar_tipo !== 'No aplica' && (
              <Field label="Número de libreta militar">
                <Input value={form.libreta_militar_numero ?? ''} onChange={(e) => update({ libreta_militar_numero: e.target.value })} />
              </Field>
            )}
          </Grid>
        )}
      </section>

      {/* ── Sección 2 · Contacto y ubicación ─────────────────────────────── */}
      <section className="space-y-4">
        <SeccionTitulo n={2} titulo="Contacto y dónde vives" />
        <Grid>
          <Field label="Correo electrónico" req {...errProps('email')}>
            <div data-error={!!errores.email}>
              <Input type="email" value={form.email ?? ''} onChange={(e) => update({ email: e.target.value.trim() })} placeholder="correo@ejemplo.com" />
            </div>
          </Field>
          <Field label="Celular" req hint="10 dígitos, empieza en 3" {...errProps('celular')}>
            <div data-error={!!errores.celular}>
              <Input inputMode="numeric" maxLength={10} value={form.celular ?? ''} onChange={(e) => update({ celular: e.target.value.replace(/\D/g, '') })} placeholder="3001234567" />
            </div>
          </Field>
        </Grid>
        <Field label="Teléfono alterno / de recado">
          <Input inputMode="numeric" value={form.telefono_alterno ?? ''} onChange={(e) => update({ telefono_alterno: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="Dirección de residencia" req {...errProps('direccion')}>
          <div data-error={!!errores.direccion}>
            <Input value={direccion.direccion} onChange={(e) => setDireccion({ ...direccion, direccion: e.target.value })} placeholder="Calle 100 # 20-30 apto 501" />
          </div>
        </Field>
        <Grid>
          <Field label="Barrio">
            <Input value={direccion.barrio ?? ''} onChange={(e) => setDireccion({ ...direccion, barrio: e.target.value })} />
          </Field>
          <Field label="Departamento de residencia" req {...errProps('dep_res')}>
            <div data-error={!!errores.dep_res}>
              <Select value={direccion.departamento_codigo ?? ''} onChange={(e) => setDireccion({ ...direccion, departamento_codigo: e.target.value || null, municipio_codigo: null })}>
                <option value="">— Selecciona —</option>
                {catalogos.departamentos.map((d) => <option key={d.codigo_dane} value={d.codigo_dane}>{d.nombre}</option>)}
              </Select>
            </div>
          </Field>
        </Grid>
        <Grid>
          <Field label="Ciudad de residencia" req {...errProps('mun_res')}>
            <div data-error={!!errores.mun_res}>
              <Select value={direccion.municipio_codigo ?? ''} onChange={(e) => setDireccion({ ...direccion, municipio_codigo: e.target.value || null })} disabled={!direccion.departamento_codigo}>
                <option value="">— Selecciona —</option>
                {munisDe(direccion.departamento_codigo).map((m) => <option key={m.codigo_dane} value={m.codigo_dane}>{m.nombre}</option>)}
              </Select>
            </div>
          </Field>
          <Field label="Localidad / comuna (opcional)">
            <Input value={direccion.localidad ?? ''} onChange={(e) => setDireccion({ ...direccion, localidad: e.target.value })} />
          </Field>
        </Grid>
        <Grid>
          <Field label="Departamento donde deseas trabajar">
            <Select value={form.departamento_trabajo ?? ''} onChange={(e) => update({ departamento_trabajo: e.target.value || null, municipio_trabajo: null })}>
              <option value="">— Selecciona —</option>
              {catalogos.departamentos.map((d) => <option key={d.codigo_dane} value={d.codigo_dane}>{d.nombre}</option>)}
            </Select>
          </Field>
          <Field label="Ciudad donde deseas trabajar">
            <Select value={form.municipio_trabajo ?? ''} onChange={(e) => update({ municipio_trabajo: e.target.value || null })} disabled={!form.departamento_trabajo}>
              <option value="">— Selecciona —</option>
              {munisDe(form.departamento_trabajo).map((m) => <option key={m.codigo_dane} value={m.codigo_dane}>{m.nombre}</option>)}
            </Select>
          </Field>
        </Grid>
        <div className="rounded-xl bg-gray-50 p-4">
          <p className="mb-3 text-sm font-semibold text-gray-700">Contacto de emergencia</p>
          <div className="space-y-4">
            <Grid>
              <Field label="Nombre"><Input value={form.contacto_emergencia_nombre ?? ''} onChange={(e) => update({ contacto_emergencia_nombre: e.target.value })} /></Field>
              <Field label="Parentesco">
                <Select value={form.contacto_emergencia_parentesco ?? ''} onChange={(e) => update({ contacto_emergencia_parentesco: e.target.value })}>
                  <option value="">— Selecciona —</option>{PARENTESCOS.map((p) => <option key={p}>{p}</option>)}
                </Select>
              </Field>
            </Grid>
            <Field label="Teléfono"><Input inputMode="numeric" value={form.contacto_emergencia_telefono ?? ''} onChange={(e) => update({ contacto_emergencia_telefono: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
        </div>
      </section>

      {/* ── Sección 3 · Seguridad social y pago ──────────────────────────── */}
      <section className="space-y-4">
        <SeccionTitulo n={3} titulo="Seguridad social y pago" />
        <Grid>
          <Field label="EPS" req {...errProps('eps_id')}>
            <div data-error={!!errores.eps_id}>
              <Select value={form.eps_id ?? ''} onChange={(e) => update({ eps_id: e.target.value || null })}>
                <option value="">— Selecciona —</option>{catalogos.eps.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </Select>
            </div>
          </Field>
          <Field label="Fondo de pensión" req {...errProps('afp_id')}>
            <div data-error={!!errores.afp_id}>
              <Select value={form.afp_id ?? ''} onChange={(e) => update({ afp_id: e.target.value || null })}>
                <option value="">— Selecciona —</option>{catalogos.afp.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </Select>
            </div>
          </Field>
        </Grid>
        <Grid>
          <Field label="Fondo de cesantías" req {...errProps('cesantias_id')}>
            <div data-error={!!errores.cesantias_id}>
              <Select value={form.cesantias_id ?? ''} onChange={(e) => update({ cesantias_id: e.target.value || null })}>
                <option value="">— Selecciona —</option>{catalogos.cesantias.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </Select>
            </div>
          </Field>
          <Field label="Caja de compensación" req {...errProps('ccf_id')}>
            <div data-error={!!errores.ccf_id}>
              <Select value={form.ccf_id ?? ''} onChange={(e) => update({ ccf_id: e.target.value || null })}>
                <option value="">— Selecciona —</option>{catalogos.cajas.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </Select>
            </div>
          </Field>
        </Grid>
        <Field label="¿Eres pensionado(a)?">
          <SiNo value={form.es_pensionado} onChange={(v) => update({ es_pensionado: v })} />
        </Field>
        <Grid>
          <Field label="Banco" req {...errProps('banco_id')}>
            <div data-error={!!errores.banco_id}>
              <Select value={form.banco_id ?? ''} onChange={(e) => update({ banco_id: e.target.value || null })}>
                <option value="">— Selecciona —</option>{catalogos.bancos.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
              </Select>
            </div>
          </Field>
          <Field label="Tipo de cuenta" req>
            <Select value={form.tipo_cuenta ?? ''} onChange={(e) => update({ tipo_cuenta: e.target.value })}>
              <option value="">— Selecciona —</option>{TIPO_CUENTA.map((t) => <option key={t}>{t}</option>)}
            </Select>
          </Field>
        </Grid>
        <Grid>
          <Field label="Número de cuenta" req {...errProps('numero_cuenta')}>
            <div data-error={!!errores.numero_cuenta}>
              <Input inputMode="numeric" value={form.numero_cuenta ?? ''} onChange={(e) => update({ numero_cuenta: e.target.value.replace(/\D/g, '') })} />
            </div>
          </Field>
          <Field label="Confirma el número de cuenta" req {...errProps('cuentaConfirm')}>
            <div data-error={!!errores.cuentaConfirm}>
              <Input inputMode="numeric" value={cuentaConfirm} onChange={(e) => setCuentaConfirm(e.target.value.replace(/\D/g, ''))} onPaste={(e) => e.preventDefault()} />
            </div>
          </Field>
        </Grid>
        <Field label="¿La cuenta está a tu nombre?">
          <SiNo value={form.cuenta_propia} onChange={(v) => update({ cuenta_propia: v })} />
        </Field>
        {form.cuenta_propia === false && (
          <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
            Si la cuenta no está a tu nombre, deberás gestionarlo con Recursos Humanos.
          </p>
        )}
      </section>

      {/* ── Sección 4 · Experiencia y postulación ────────────────────────── */}
      <section className="space-y-4">
        <SeccionTitulo n={4} titulo="Experiencia y postulación" />
        <Grid>
          <Field label="Años de experiencia"><Input type="number" min={0} max={50} value={form.experiencia_anios ?? ''} onChange={(e) => update({ experiencia_anios: e.target.value ? +e.target.value : null })} /></Field>
          <Field label="Meses adicionales"><Input type="number" min={0} max={11} value={form.experiencia_meses ?? ''} onChange={(e) => update({ experiencia_meses: e.target.value ? +e.target.value : null })} /></Field>
        </Grid>
        <Field label="Cargo al que te postulas" req {...errProps('cargo')}>
          <div data-error={!!errores.cargo}>
            <Select value={form.cargo_postulacion_id ?? ''} onChange={(e) => update({ cargo_postulacion_id: e.target.value || null })}>
              <option value="">— Selecciona —</option>{catalogos.cargos.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </Select>
          </div>
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

      {/* ── Sección 5 · Dotación ─────────────────────────────────────────── */}
      <section className="space-y-4">
        <SeccionTitulo n={5} titulo="Tus tallas (dotación)" desc="Para entregarte tu uniforme sin demoras." />
        <div data-error={!!errores.tallas}>
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

      {/* ── Sección 6 · Grupo familiar ───────────────────────────────────── */}
      <section className="space-y-4">
        <SeccionTitulo n={6} titulo="Grupo familiar" />
        <Field label="¿Tienes personas a cargo?">
          <SiNo value={form.tiene_personas_a_cargo} onChange={(v) => update({ tiene_personas_a_cargo: v })} />
        </Field>
        {form.tiene_personas_a_cargo && (
          <div className="space-y-3">
            {beneficiarios.map((b, i) => (
              <div key={i} className="rounded-xl border border-gray-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-600">Beneficiario {i + 1}</span>
                  <button type="button" onClick={() => delBenef(i)} className="text-red-500"><Trash2 className="h-4 w-4" /></button>
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

      {/* ── Sección 7 · Encuesta sociodemográfica (opcional, NO datos de salud) ── */}
      <section className="space-y-4">
        <SeccionTitulo n={7} titulo="Cuéntanos un poco más" desc="Opcional. No preguntamos por tu salud." />
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
