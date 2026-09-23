'use client'

import { useState } from 'react'
import { ExternalLink, Briefcase, KeyRound, AlertTriangle, Landmark, MapPin, HeartPulse, GraduationCap, Users, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ComboBuscador } from '@/components/ui/ComboBuscador'
import { Seccion, Dato, Boton, inputCls, fechaCorta } from '../ui'
import type { PropsTab } from './tipos'

/* eslint-disable @typescript-eslint/no-explicit-any */

const siNo = (v: boolean | null | undefined) => (v === true ? 'Sí' : v === false ? 'No' : '')

/** Datos del registro del candidato (etapa 1 · Postulación, junto a los documentos). */
export function TabPersonal({ d, sb, catalogos, puedeGestionar, recargar, onCambio, columnas = 2 }: PropsTab & { columnas?: 1 | 2 }) {
  const c = d.c
  const n = d.nombres
  const [centro, setCentro] = useState<string>(c.centro_costo_id ?? '')
  const [req, setReq] = useState<string>(c.requisicion_id ?? '')
  const [rolId, setRolId] = useState<string>(d.rolId)
  const [guardando, setGuardando] = useState<string | null>(null)

  async function guardarVinculacion() {
    setGuardando('vinc')
    const { error } = await sb.from('candidatos').update({ centro_costo_id: centro || null, requisicion_id: req || null }).eq('id', c.id)
    if (!error) {
      await sb.from('postulaciones').update({ requisicion_id: req || null }).eq('candidato_id', c.id)
      await sb.from('candidato_eventos').insert({
        candidato_id: c.id, tipo: 'CENTRO_COSTO', motivo: 'Vinculación actualizada',
        detalle: { centro_costo: catalogos.centros.find((x) => x.id === centro)?.codigo ?? null, requisicion: catalogos.requisiciones.find((x) => x.id === req)?.numero ?? null },
        actor: d.yo.id, actor_nombre: d.yo.nombre,
      })
    }
    setGuardando(null)
    if (error) { toast.error(error.message); return }
    toast.success('Vinculación guardada.')
    await recargar(); onCambio()
  }

  async function guardarRol() {
    setGuardando('rol')
    const res = await fetch('/api/gestion-humana/postulaciones/rol', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidato_id: c.id, rol_id: rolId || null }),
    })
    const j = await res.json().catch(() => ({}))
    setGuardando(null)
    if (!res.ok) { toast.error(j.error ?? 'No se pudo cambiar el rol.'); return }
    toast.success('Rol actualizado.')
  }

  const rolSel = catalogos.roles.find((r) => r.id === rolId)
  const rolOperativo = !!rolSel?.rol_base && rolSel.rol_base !== 'AUDITOR'
  const hijos = d.bens.filter((b) => /^hij/i.test(b.parentesco ?? '')).length

  return (
    <div className="space-y-4">
      <div className={'grid gap-4 ' + (columnas === 2 ? 'lg:grid-cols-2' : '')}>
        <Seccion titulo="Identificación" icono={<Users className="h-4 w-4 text-brand-green" />}>
          <div className="grid grid-cols-2 gap-3">
            <Dato label="Tipo y número" valor={`${c.tipo_documento} ${c.numero_documento}`} />
            <Dato label="Expedición" valor={[c.lugar_expedicion_doc, fechaCorta(c.fecha_expedicion_doc)].filter((x) => x && x !== '—').join(' · ')} />
            <Dato label="Primer nombre" valor={c.primer_nombre} />
            <Dato label="Segundo nombre" valor={c.segundo_nombre} />
            <Dato label="Primer apellido" valor={c.primer_apellido} />
            <Dato label="Segundo apellido" valor={c.segundo_apellido} />
            <Dato label="Nacimiento" valor={c.fecha_nacimiento ? `${fechaCorta(c.fecha_nacimiento)}${c.fecha_nacimiento ? ` · ${Math.floor((Date.now() - new Date(c.fecha_nacimiento).getTime()) / 31557600000)} años` : ''}` : ''} />
            <Dato label="Lugar de nacimiento" valor={[n.munNacimiento, n.depNacimiento].filter(Boolean).join(', ')} />
            <Dato label="Género" valor={c.genero} />
            <Dato label="Estado civil" valor={c.estado_civil} />
            <Dato label="Grupo sanguíneo" valor={c.grupo_sanguineo} />
            <Dato label="Estatura" valor={c.estatura_cm ? `${c.estatura_cm} cm` : ''} />
            <Dato label="Escolaridad" valor={c.nivel_escolaridad} />
            <Dato label="Libreta militar" valor={[c.libreta_militar_tipo, c.libreta_militar_numero].filter(Boolean).join(' · ')} />
          </div>
        </Seccion>

        <Seccion titulo="Contacto y ubicación" icono={<MapPin className="h-4 w-4 text-brand-green" />}>
          <div className="grid grid-cols-2 gap-3">
            <Dato label="Correo" valor={c.email} />
            <Dato label="Celular" valor={[c.celular, c.telefono_alterno].filter(Boolean).join(' · ')} />
            <Dato label="Dirección" valor={d.dir?.direccion} ancho />
            <Dato label="Barrio / localidad" valor={[d.dir?.barrio, d.dir?.localidad].filter(Boolean).join(' · ')} />
            <Dato label="Ciudad de residencia" valor={[n.munResidencia, n.depResidencia].filter(Boolean).join(', ')} />
            <Dato label="Ciudad de trabajo deseada" valor={[n.munTrabajo, n.depTrabajo].filter(Boolean).join(', ')} />
            <Dato label="Contacto de emergencia" valor={[c.contacto_emergencia_nombre, c.contacto_emergencia_parentesco, c.contacto_emergencia_telefono].filter(Boolean).join(' · ')} />
          </div>
        </Seccion>

        <Seccion titulo="Seguridad social y pago" icono={<HeartPulse className="h-4 w-4 text-brand-green" />}
          acciones={
            <a href="https://www.adres.gov.co/consulte-su-eps" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100">
              Consultar EPS en ADRES <ExternalLink className="h-3 w-3" />
            </a>
          }>
          <div className="grid grid-cols-2 gap-3">
            <Dato label="EPS" valor={n.eps?.nombre} />
            <Dato label="Código EPS (nómina)" valor={n.eps?.codigo_nomina} />
            <Dato label="Fondo de pensión" valor={n.afp?.nombre} />
            <Dato label="Código AFP (nómina)" valor={n.afp?.codigo_nomina} />
            <Dato label="Cesantías" valor={n.cesantias?.nombre} />
            <Dato label="Caja elegida" valor={n.caja?.nombre} />
            <Dato label="Banco" valor={n.banco?.nombre} />
            <Dato label="Cuenta" valor={[c.tipo_cuenta, c.numero_cuenta].filter(Boolean).join(' · ') + (c.cuenta_propia === false ? ' (no es propia)' : '')} />
            <Dato label="¿Pensionado?" valor={siNo(c.es_pensionado)} />
          </div>
        </Seccion>

        <Seccion titulo="Resumen de códigos para nómina" icono={<Landmark className="h-4 w-4 text-brand-green" />}>
          {d.nomina ? (
            <div className="grid grid-cols-2 gap-3">
              <Dato label="Depto WO" valor={d.nomina.depto_wo} />
              <Dato label="Ciudad WO" valor={d.nomina.ciudad_wo} />
              <Dato label="Caja (por ciudad de trabajo)" valor={d.cajaNomina?.codigo_nomina ?? d.cajaNomina?.nombre} />
              <Dato label="Depto ARL" valor={d.nomina.depto_arl} />
              <Dato label="Ciudad ARL" valor={d.nomina.ciudad_arl} />
              <Dato label="Centro de trabajo (WO)" valor={`Ciudad: ${d.nomina.ciudad_wo} Depto: ${d.nomina.depto_wo}`} ancho />
            </div>
          ) : (
            <p className="text-xs text-gray-400">El candidato no indicó ciudad de trabajo: no se pueden derivar los códigos.</p>
          )}
        </Seccion>

        <Seccion titulo="Vinculación" icono={<Briefcase className="h-4 w-4 text-brand-green" />}>
          <div className="space-y-3">
            <Dato label="Cargo postulado" valor={catalogos.cargos.find((x) => x.id === c.cargo_postulacion_id)?.nombre} />
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-600">Centro de costos (contrato / cliente)</span>
              <ComboBuscador
                items={catalogos.centros}
                value={centro}
                onPick={(x) => setCentro(x.id)}
                getId={(x) => x.id}
                textoBusqueda={(x) => `${x.codigo} ${x.nombre} ${x.ciudad ?? ''}`}
                fila={(x) => <span className="text-sm">{x.codigo}</span>}
                etiqueta={(x) => x.codigo}
                placeholder="Buscar contrato / centro de costos…"
                disabled={!puedeGestionar}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-600">Requisición de personal</span>
              <select value={req} onChange={(e) => setReq(e.target.value)} disabled={!puedeGestionar} className={inputCls}>
                <option value="">— Sin requisición —</option>
                {catalogos.requisiciones.map((r) => (
                  <option key={r.id} value={r.id}>{r.numero} · {r.cargo_texto ?? ''} · {r.cliente_nombre ?? ''} ({r.cupos_cubiertos}/{r.cantidad})</option>
                ))}
              </select>
            </label>
            {puedeGestionar && (
              <Boton onClick={guardarVinculacion} disabled={guardando === 'vinc' || (centro === (c.centro_costo_id ?? '') && req === (c.requisicion_id ?? ''))}>
                {guardando === 'vinc' ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Guardar vinculación
              </Boton>
            )}
          </div>
        </Seccion>

        <Seccion titulo="Proceso, experiencia y cursos" icono={<GraduationCap className="h-4 w-4 text-brand-green" />}>
          <div className="grid grid-cols-2 gap-3">
            <Dato label="Experiencia" valor={`${c.experiencia_anios ?? 0} años, ${c.experiencia_meses ?? 0} meses`} />
            <Dato label="Postulado el" valor={fechaCorta(c.created_at)} />
            <Dato label="¿Hizo el proceso antes?" valor={siNo(c.ha_hecho_proceso_antes)} />
            <Dato label="¿Trabajó con nosotros?" valor={siNo(c.ha_trabajado_antes)} />
            <Dato label="Curso de alturas" valor={c.curso_alturas ? `Sí${c.curso_alturas_vigencia ? ` · vence ${fechaCorta(c.curso_alturas_vigencia)}` : ''}` : siNo(c.curso_alturas)} />
            <Dato label="Manipulación de alimentos" valor={siNo(c.curso_alimentos)} />
            <Dato label="Manejo de grecas" valor={siNo(c.curso_grecas)} />
            <Dato label="Tallas" valor={[c.talla_camisa, c.talla_pantalon, c.talla_calzado].filter(Boolean).join(' / ')} />
            <Dato label="Estudios registrados" valor={d.estudios.length ? d.estudios.map((e) => e.titulo || e.nivel).join(' · ') : ''} ancho />
            <Dato label="Empleos anteriores" valor={d.experiencias.length ? d.experiencias.map((e) => `${e.empresa}${e.cargo ? ` (${e.cargo})` : ''}`).join(' · ') : ''} ancho />
            <Dato label="Grupo familiar" valor={d.bens.length ? `${d.bens.length} persona(s) · ${hijos} hijo(s)` : ''} />
            <Dato label="Disponibilidad" valor={(c.disponibilidad_jornada ?? []).join(', ')} />
          </div>
        </Seccion>
      </div>

      {d.historial.length > 0 && (
        <Seccion titulo="Ya trabajó con nosotros" icono={<Briefcase className="h-4 w-4 text-amber-600" />}>
          <ol className="space-y-1.5">
            {d.historial.map((h: any) => (
              <li key={h.vinculacion_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <span><strong>{h.cargo ?? 'Cargo no registrado'}</strong> · {h.centro_costo ?? 'Sin centro de costos'}</span>
                <span className="text-xs text-gray-500">{fechaCorta(h.fecha_ingreso)} → {h.fecha_retiro ? fechaCorta(h.fecha_retiro) : 'hoy'} · {h.estado === 'ACTIVA' ? 'Vigente' : 'Terminada'}</span>
              </li>
            ))}
          </ol>
          {d.historial.some((h: any) => h.estado === 'ACTIVA') && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Figura vinculado(a) hoy. Confirme con nómina antes de continuar.</p>
          )}
        </Seccion>
      )}

      {puedeGestionar && c.auth_uid && (
        <Seccion titulo="Cuenta en la plataforma" icono={<KeyRound className="h-4 w-4 text-brand-green" />}>
          <div className="flex flex-wrap gap-2">
            <select value={rolId} onChange={(e) => setRolId(e.target.value)} className={inputCls + ' max-w-xs'}>
              <option value="">— Sin rol —</option>
              {catalogos.roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </select>
            <Boton variante="secundario" onClick={guardarRol} disabled={guardando === 'rol'}>Guardar rol</Boton>
          </div>
          {rolOperativo ? (
            <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-700">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> «{rolSel?.nombre}» da acceso operativo real ({rolSel?.rol_base}). Asígnelo solo si la persona ya está contratada.
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-gray-400">«Aspirante» solo ve y actualiza su propia hoja de vida y firma sus documentos.</p>
          )}
        </Seccion>
      )}
    </div>
  )
}
