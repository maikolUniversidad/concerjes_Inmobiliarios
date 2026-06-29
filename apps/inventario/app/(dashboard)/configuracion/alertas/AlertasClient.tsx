'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import { BellRing, ShieldCheck, Megaphone, ChevronDown, Lock } from 'lucide-react'
import {
  ROL_LABELS, SEVERIDAD_LABELS, TIPO_NOTIFICACION_LABELS,
  type ReglaAlerta, type NotificacionPreferencias, type RolUsuario, type SeveridadNotificacion,
} from '@/lib/types/database'
import { guardarRegla, guardarPreferencias, enviarAnuncio, type ActionResult } from '../../notificaciones/actions'

const ROLES: RolUsuario[] = [
  'SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'COORDINADOR_COMPRAS', 'BODEGUERO', 'AUDITOR', 'OPERADOR_SEDE',
]
const SEVERIDADES: SeveridadNotificacion[] = ['INFO', 'EXITO', 'ADVERTENCIA', 'CRITICA']

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-[#2E7D32] hover:bg-[#1B5E20] text-white font-body font-semibold text-xs px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
    >
      {pending ? 'Guardando…' : label}
    </button>
  )
}

// ── Tarjeta de regla parametrizable ─────────────────────────────────────────────
function ReglaCard({ regla, esAdmin }: { regla: ReglaAlerta; esAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const [state, action] = useActionState<ActionResult, FormData>(guardarRegla, {})
  const sev = SEVERIDAD_LABELS[regla.severidad]
  const meta = TIPO_NOTIFICACION_LABELS[regla.codigo]
  const diasAviso = typeof regla.umbral?.dias_aviso === 'number' ? regla.umbral.dias_aviso : undefined

  useEffect(() => {
    if (state.ok) toast.success('Alerta actualizada')
    else if (state.error) toast.error(state.error)
  }, [state])

  return (
    <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
      {/* Cabecera */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50/60 transition-colors"
      >
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${regla.activa ? sev.dot : 'bg-gray-300'}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-heading font-semibold text-sm text-gray-900">{regla.nombre}</span>
            <span className={`font-body text-[10px] px-1.5 py-0.5 rounded-full ${sev.color} ${sev.bg}`}>{sev.label}</span>
            {!regla.activa && (
              <span className="font-body text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Desactivada</span>
            )}
          </div>
          <p className="font-body text-xs text-gray-500 mt-0.5 line-clamp-1">{regla.descripcion}</p>
        </div>
        <span className="font-body text-[11px] text-gray-400 hidden sm:block">
          {regla.roles_destino.length} rol{regla.roles_destino.length !== 1 ? 'es' : ''}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Detalle / edición */}
      {open && (
        <div className="border-t border-gray-50 p-4">
          {!esAdmin ? (
            <div className="flex items-center gap-2 text-gray-400">
              <Lock className="w-3.5 h-3.5" />
              <span className="font-body text-xs">Solo un administrador puede modificar esta alerta.</span>
            </div>
          ) : (
            <form action={action} className="space-y-4">
              <input type="hidden" name="id" value={regla.id} />
              <input type="hidden" name="codigo" value={regla.codigo} />

              {/* Estado y canales */}
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 font-body text-xs text-gray-700">
                  <input type="checkbox" name="activa" defaultChecked={regla.activa} className="rounded border-gray-300 text-[#2E7D32] focus:ring-[#2E7D32]" />
                  Alerta activa
                </label>
                <label className="flex items-center gap-2 font-body text-xs text-gray-700">
                  <input type="checkbox" name="canal_app" defaultChecked={regla.canal_app} className="rounded border-gray-300 text-[#2E7D32] focus:ring-[#2E7D32]" />
                  Notificar en la app
                </label>
                <label className="flex items-center gap-2 font-body text-xs text-gray-400" title="Disponible próximamente">
                  <input type="checkbox" name="canal_email" defaultChecked={regla.canal_email} className="rounded border-gray-300 text-[#2E7D32] focus:ring-[#2E7D32]" />
                  Enviar email
                </label>
              </div>

              {/* Severidad */}
              <div>
                <label className="block font-body text-xs font-semibold text-gray-500 mb-1.5">Severidad</label>
                <select
                  name="severidad"
                  defaultValue={regla.severidad}
                  className="border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-xs outline-none focus:border-[#2E7D32] bg-white text-gray-700"
                >
                  {SEVERIDADES.map((s) => (
                    <option key={s} value={s}>{SEVERIDAD_LABELS[s].label}</option>
                  ))}
                </select>
              </div>

              {/* Roles destino */}
              <div>
                <label className="block font-body text-xs font-semibold text-gray-500 mb-1.5">Roles que reciben esta alerta</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {ROLES.map((r) => (
                    <label key={r} className="flex items-center gap-2 font-body text-xs text-gray-700">
                      <input
                        type="checkbox"
                        name="roles_destino"
                        value={r}
                        defaultChecked={regla.roles_destino.includes(r)}
                        className="rounded border-gray-300 text-[#2E7D32] focus:ring-[#2E7D32]"
                      />
                      {ROL_LABELS[r].label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Umbral (solo OC por vencer) */}
              {regla.codigo === 'OC_POR_VENCER' && (
                <div>
                  <label className="block font-body text-xs font-semibold text-gray-500 mb-1.5">Días de aviso antes de la entrega</label>
                  <input
                    type="number"
                    name="dias_aviso"
                    min={0}
                    defaultValue={diasAviso ?? 3}
                    className="border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-xs outline-none focus:border-[#2E7D32] bg-white text-gray-700 w-24"
                  />
                </div>
              )}

              <div className="flex items-center gap-3">
                <SubmitBtn label="Guardar cambios" />
                <span className="font-body text-[11px] text-gray-300">Código: {meta.label}</span>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}

// ── Preferencias del usuario ─────────────────────────────────────────────────────
function PreferenciasForm({ reglas, prefs }: { reglas: ReglaAlerta[]; prefs: NotificacionPreferencias | null }) {
  const [state, action] = useActionState<ActionResult, FormData>(guardarPreferencias, {})
  const silenciados = prefs?.tipos_silenciados ?? []

  useEffect(() => {
    if (state.ok) toast.success('Preferencias guardadas')
    else if (state.error) toast.error(state.error)
  }, [state])

  return (
    <form action={action} className="rounded-2xl border border-gray-100 shadow-sm bg-white p-6 space-y-4">
      <div className="flex items-center gap-2">
        <BellRing className="w-4 h-4 text-brand-green" />
        <h2 className="font-heading font-semibold text-lg text-gray-900">Mis preferencias</h2>
      </div>
      <p className="font-body text-xs text-gray-500">
        Silencia los tipos de notificación que no quieres recibir. Solo afecta a tu cuenta.
      </p>

      <div className="grid sm:grid-cols-2 gap-2.5">
        {reglas.map((r) => (
          <label key={r.id} className="flex items-center gap-2 font-body text-xs text-gray-700 border border-gray-100 rounded-lg px-3 py-2">
            <input
              type="checkbox"
              name="silenciados"
              value={r.codigo}
              defaultChecked={silenciados.includes(r.codigo)}
              className="rounded border-gray-300 text-[#2E7D32] focus:ring-[#2E7D32]"
            />
            Silenciar “{TIPO_NOTIFICACION_LABELS[r.codigo].label}”
          </label>
        ))}
      </div>

      <label className="flex items-center gap-2 font-body text-xs text-gray-400 pt-1" title="Disponible próximamente">
        <input
          type="checkbox"
          name="email_activo"
          defaultChecked={prefs?.email_activo ?? false}
          className="rounded border-gray-300 text-[#2E7D32] focus:ring-[#2E7D32]"
        />
        Recibir también por correo electrónico (próximamente)
      </label>

      <SubmitBtn label="Guardar preferencias" />
    </form>
  )
}

// ── Anuncio manual (admin) ────────────────────────────────────────────────────────
function AnuncioForm() {
  const [state, action] = useActionState<ActionResult, FormData>(enviarAnuncio, {})

  useEffect(() => {
    if (state.ok) toast.success('Anuncio enviado')
    else if (state.error) toast.error(state.error)
  }, [state])

  return (
    <form action={action} className="rounded-2xl border border-gray-100 shadow-sm bg-white p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Megaphone className="w-4 h-4 text-brand-green" />
        <h2 className="font-heading font-semibold text-lg text-gray-900">Enviar anuncio</h2>
      </div>
      <p className="font-body text-xs text-gray-500">
        Envía un mensaje del sistema a los roles configurados en la alerta “Mensaje del sistema”.
      </p>
      <input
        name="titulo"
        required
        placeholder="Título del anuncio"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-[#2E7D32]"
      />
      <textarea
        name="mensaje"
        rows={3}
        placeholder="Mensaje (opcional)"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-[#2E7D32] resize-none"
      />
      <SubmitBtn label="Enviar anuncio" />
    </form>
  )
}

export function AlertasClient({
  reglas, prefs, esAdmin,
}: {
  reglas: ReglaAlerta[]
  prefs: NotificacionPreferencias | null
  esAdmin: boolean
}) {
  const activas = reglas.filter((r) => r.activa).length

  return (
    <div className="space-y-6">
      {/* Catálogo de alertas */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-brand-green" />
          <h2 className="font-heading font-semibold text-lg text-gray-900">Catálogo de alertas</h2>
          <span className="font-body text-xs text-gray-400">({activas} de {reglas.length} activas)</span>
        </div>
        <p className="font-body text-xs text-gray-500 mb-2">
          {esAdmin
            ? 'Activa, ajusta la severidad y elige qué roles reciben cada alerta.'
            : 'Estas son las alertas configuradas en el sistema. La edición es solo para administradores.'}
        </p>
        {reglas.map((r) => (
          <ReglaCard key={r.id} regla={r} esAdmin={esAdmin} />
        ))}
      </div>

      {/* Preferencias personales */}
      <PreferenciasForm reglas={reglas} prefs={prefs} />

      {/* Anuncio manual (admin) */}
      {esAdmin && <AnuncioForm />}
    </div>
  )
}
