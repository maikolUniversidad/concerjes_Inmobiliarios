'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Stethoscope, Mail, Loader2, CheckCircle2, XCircle, Building2, Upload, Eye, BookUser } from 'lucide-react'
import { toast } from 'sonner'
import { emitirEvento } from '@/lib/notificaciones/eventos'
import { ordenFase } from '@/lib/ats/fases'
import { fechaCorta, parsearFecha } from '@/lib/documentos/plantilla'

/** dd/mm/aaaa para el correo a la IPS ('' si no hay fecha). */
const fechaDoc = (v: unknown) => { const f = parsearFecha(v); return f ? fechaCorta(f) : '' }
import { subirDocumentoStaff } from '../acciones'
import { Seccion, Boton, Badge, Campo, inputCls, fechaHora } from '../ui'
import type { PropsTab } from './tipos'

/* eslint-disable @typescript-eslint/no-explicit-any */

export function TabExamenes({ d, sb, catalogos, puedeGestionar, recargar, onCambio, onNoApto }: PropsTab & { onNoApto: () => void }) {
  const c = d.c
  const [ipsSel, setIpsSel] = useState<string>(c.ips_id ?? '')
  const [otra, setOtra] = useState({ nombre: '', correo: '', guardar: true })
  const [observaciones, setObservaciones] = useState('')
  const [guardando, setGuardando] = useState<string | null>(null)
  const cargoCat = catalogos.cargos.find((x) => x.id === c.cargo_postulacion_id)
  const cargo = cargoCat?.nombre ?? ''
  const tipoConcepto = catalogos.tipos.find((t) => t.codigo === 'CONCEPTO_APTITUD')
  const conceptos = d.docs.filter((x) => x.tipo_documental_id === tipoConcepto?.id)

  const ipsElegida: { id: string | null; nombre: string; correo: string | null; correos_copia?: string[] | null } | null =
    ipsSel === 'OTRA'
      ? { id: null, nombre: otra.nombre.trim().toUpperCase(), correo: otra.correo.trim().toLowerCase() }
      : catalogos.ips.find((i) => i.id === ipsSel) ?? null

  const asunto = `Remisión examen ocupacional de ingreso · ${c.nombres ?? ''} ${c.apellidos ?? ''} · ${c.tipo_documento} ${c.numero_documento}`
  const cuerpo = [
    'Buen día,', '',
    'Remitimos al siguiente aspirante para examen médico ocupacional de ingreso:', '',
    `Nombre: ${c.nombres ?? ''} ${c.apellidos ?? ''}`,
    `Documento: ${c.tipo_documento} ${c.numero_documento}`,
    `Fecha de nacimiento: ${c.fecha_nacimiento ?? ''}`,
    `Cargo: ${cargo}`,
    `EPS: ${d.nombres.eps?.nombre ?? ''} · AFP: ${d.nombres.afp?.nombre ?? ''}`,
    `Celular: ${c.celular ?? ''}`,
    `Trabajo en alturas: ${cargoCat?.requiere_trabajo_alturas ? 'Sí' : 'No'} · Manipulación de alimentos: ${cargoCat?.requiere_manipulacion_alimentos ? 'Sí' : 'No'}`,
    ...(observaciones.trim() ? [`Observaciones: ${observaciones.trim()}`] : []), '',
    'Empresa: CONSERJES INMOBILIARIOS LTDA · NIT 800.093.388-2', '',
    'Gracias.',
  ].join('\n')

  async function remitir() {
    if (!ipsElegida?.nombre) { toast.error('Elija la IPS.'); return }
    if (ipsSel === 'OTRA' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(otra.correo)) { toast.error('Escriba un correo válido para la IPS.'); return }
    setGuardando('remitir')
    // "Otra IPS": se guarda en el directorio para no volver a escribirla (si ya existe con ese nombre, se usa esa).
    let ipsId = ipsElegida.id
    if (ipsSel === 'OTRA' && otra.guardar) {
      const nueva = await sb.from('ips').insert({ nombre: ipsElegida.nombre, correo: ipsElegida.correo, orden: 100 }).select('id').single()
      if (!nueva.error) ipsId = nueva.data.id
      else {
        const existente = await sb.from('ips').select('id').eq('nombre', ipsElegida.nombre).maybeSingle()
        ipsId = existente.data?.id ?? null
      }
    }
    const patch: Record<string, unknown> = {
      ips_id: ipsId, ips_nombre: ipsElegida.nombre, ips_correo: ipsElegida.correo || null,
      ips_fecha_remision: new Date().toISOString(), ips_remitido_por: d.yo.id,
    }
    if (ordenFase(c.estado) >= 0 && ordenFase(c.estado) < ordenFase('EXAMEN_MEDICO')) patch.estado = 'EXAMEN_MEDICO'
    const { error } = await sb.from('candidatos').update(patch).eq('id', c.id)
    if (error) { setGuardando(null); toast.error(error.message); return }
    if (patch.estado) await sb.from('postulaciones').update({ estado: 'EXAMEN_MEDICO' }).eq('candidato_id', c.id)
    await sb.from('candidato_eventos').insert({
      candidato_id: c.id, tipo: 'REMISION_IPS', motivo: `Remitido a ${ipsElegida.nombre}`,
      detalle: { ips: ipsElegida.nombre, correo: ipsElegida.correo }, actor: d.yo.id, actor_nombre: d.yo.nombre,
    })
    // Todo lo que usa la plantilla «Remisión a examen médico de ingreso» del flujo de correo.
    const { data: empresa } = await sb.from('vac_empresa').select('razon_social, nit, correo_seleccion').eq('id', 1).maybeSingle()
    await emitirEvento(sb, {
      codigo: 'ATS_REMISION_IPS',
      payload: {
        candidato_id: c.id, candidato_email: c.email, candidato_nombre: `${c.nombres ?? ''} ${c.apellidos ?? ''}`.trim(),
        tipo_documento: c.tipo_documento, documento: c.numero_documento, fecha_nacimiento: fechaDoc(c.fecha_nacimiento),
        celular: c.celular ?? '', cargo, eps: d.nombres.eps?.nombre ?? '', afp: d.nombres.afp?.nombre ?? '',
        trabajo_alturas: cargoCat?.requiere_trabajo_alturas ? 'Sí' : 'No',
        manipulacion_alimentos: cargoCat?.requiere_manipulacion_alimentos ? 'Sí' : 'No',
        observaciones: observaciones.trim() || 'Ninguna',
        ips_id: ipsId, ips: ipsElegida.nombre, ips_correo: ipsElegida.correo,
        fecha_remision: fechaDoc(new Date()), remitido_por: d.yo.nombre ?? 'Gestión Humana',
        empresa: empresa?.razon_social ?? '', empresa_nit: empresa?.nit ?? '', correo_respuesta: empresa?.correo_seleccion ?? '',
      },
      entidad: 'candidatos', entidadId: c.id,
    })
    setGuardando(null)
    toast.success(`Remitido a ${ipsElegida.nombre}.`)
    await recargar(); onCambio()
  }

  async function marcarApto() {
    setGuardando('apto')
    const { error } = await sb.from('candidatos').update({ estado: 'APTO' }).eq('id', c.id)
    if (!error) await sb.from('postulaciones').update({ estado: 'APTO' }).eq('candidato_id', c.id)
    setGuardando(null)
    if (error) { toast.error(error.message); return }
    toast.success('Marcado como apto.')
    await recargar(); onCambio()
  }

  async function verConcepto(doc: any) {
    const { data } = await sb.storage.from('registro-vacantes').createSignedUrl(doc.storage_path, 300)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
  }

  return (
    <div className="space-y-4">
      <Seccion titulo="Remisión a IPS" icono={<Stethoscope className="h-4 w-4 text-brand-green" />}
        acciones={c.ips_nombre ? <Badge className="bg-cyan-100 text-cyan-800">Remitido a {c.ips_nombre} · {fechaHora(c.ips_fecha_remision)}</Badge> : null}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {catalogos.ips.map((i) => (
            <button key={i.id} type="button" disabled={!puedeGestionar} onClick={() => setIpsSel(i.id)}
              className={'rounded-xl border-2 p-3 text-left transition-colors disabled:cursor-default ' +
                (ipsSel === i.id ? 'border-brand-green bg-brand-green/5' : 'border-gray-100 bg-white hover:border-brand-green/40')}>
              <Building2 className="mb-1 h-4 w-4 text-brand-green" />
              <p className="text-sm font-bold text-gray-800">{i.nombre}</p>
              <p className={'truncate text-[11px] ' + (i.correo ? 'text-gray-400' : 'text-amber-700')}>
                {i.correo ?? 'sin correo: no recibe la remisión automática'}
              </p>
              {(i.correos_copia?.length ?? 0) > 0 && <p className="text-[10px] text-gray-400">+{i.correos_copia!.length} en copia</p>}
            </button>
          ))}
          <button type="button" disabled={!puedeGestionar} onClick={() => setIpsSel('OTRA')}
            className={'rounded-xl border-2 border-dashed p-3 text-left ' + (ipsSel === 'OTRA' ? 'border-brand-green bg-brand-green/5' : 'border-gray-200 bg-white hover:border-brand-green/40')}>
            <Mail className="mb-1 h-4 w-4 text-gray-400" />
            <p className="text-sm font-bold text-gray-800">Otra IPS</p>
            <p className="text-[11px] text-gray-400">Escribir correo personalizado</p>
          </button>
        </div>
        {ipsSel === 'OTRA' && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Campo label="Nombre de la IPS"><input value={otra.nombre} onChange={(e) => setOtra({ ...otra, nombre: e.target.value })} className={inputCls} /></Campo>
            <Campo label="Correo de la IPS"><input type="email" value={otra.correo} onChange={(e) => setOtra({ ...otra, correo: e.target.value })} className={inputCls} /></Campo>
            <label className="flex items-center gap-2 text-xs text-gray-600 sm:col-span-2">
              <input type="checkbox" checked={otra.guardar} onChange={(e) => setOtra({ ...otra, guardar: e.target.checked })} className="h-4 w-4 accent-[#2E7D32]" />
              Guardarla en el directorio de centros médicos para las próximas remisiones
            </label>
          </div>
        )}
        {puedeGestionar && ipsElegida?.nombre && (
          <div className="mt-3">
            <Campo label="Observaciones para la IPS (opcional)">
              <textarea rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} className={inputCls}
                placeholder="Exámenes adicionales, horario, indicaciones…" />
            </Campo>
          </div>
        )}
        {puedeGestionar && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Boton onClick={remitir} disabled={!ipsElegida?.nombre || guardando === 'remitir'}>
              {guardando === 'remitir' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />} Registrar remisión
            </Boton>
            {ipsElegida?.correo && (
              <a href={`mailto:${encodeURIComponent(ipsElegida.correo)}?${(ipsElegida.correos_copia?.length ?? 0) > 0 ? `cc=${encodeURIComponent(ipsElegida.correos_copia!.join(','))}&` : ''}subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                <Mail className="h-4 w-4" /> Abrir correo a la IPS
              </a>
            )}
          </div>
        )}
        <p className="mt-2 text-[11px] text-gray-400">
          Al registrar la remisión, el flujo «Remisión a exámenes médicos → centro médico» le envía el correo a la IPS (con sus
          copias) si hay una cuenta de correo conectada. Si no, use «Abrir correo a la IPS».{' '}
          <Link href="/notificaciones/directorio" className="inline-flex items-center gap-0.5 font-semibold text-brand-green hover:underline">
            <BookUser className="h-3 w-3" /> Correos de los centros médicos
          </Link>
        </p>
      </Seccion>

      <Seccion titulo="Concepto de aptitud médica" icono={<CheckCircle2 className="h-4 w-4 text-brand-green" />}>
        <p className="mb-2 text-xs text-gray-500">Solo el concepto de aptitud (apto, apto con restricciones o no apto). La historia clínica no se sube: es reserva de la IPS.</p>
        {conceptos.length === 0 ? <p className="mb-2 text-sm text-gray-400">Aún no se ha cargado el concepto.</p> : (
          <ul className="mb-2 space-y-1">
            {conceptos.map((x) => (
              <li key={x.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-1.5 text-sm">
                <span className="truncate">{x.nombre_original}</span>
                <button onClick={() => verConcepto(x)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-green"><Eye className="h-3.5 w-3.5" /> Ver</button>
              </li>
            ))}
          </ul>
        )}
        {puedeGestionar && tipoConcepto && (
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              {guardando === 'subir' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Cargar concepto
              <input type="file" hidden accept="image/*,application/pdf" onChange={async (e) => {
                const f = e.target.files?.[0]; e.target.value = ''
                if (!f) return
                setGuardando('subir')
                const r = await subirDocumentoStaff(sb, c.id, tipoConcepto, f)
                setGuardando(null)
                if (r.error) { toast.error(r.error); return }
                toast.success('Concepto cargado.'); await recargar(); onCambio()
              }} />
            </label>
            <Boton variante="suave" onClick={marcarApto} disabled={guardando === 'apto' || c.estado === 'APTO' || conceptos.length === 0}
              title={conceptos.length === 0 ? 'Cargue primero el concepto de aptitud' : undefined}>
              <CheckCircle2 className="h-4 w-4" /> Marcar apto
            </Boton>
            <Boton variante="secundario" onClick={onNoApto}><XCircle className="h-4 w-4 text-red-600" /> No apto</Boton>
          </div>
        )}
      </Seccion>
    </div>
  )
}
