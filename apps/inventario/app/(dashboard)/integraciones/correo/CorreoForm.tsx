'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  Mail, Send, Inbox, Save, Loader2, CheckCircle2, AlertCircle, RefreshCw, Plug, ShieldCheck, BellRing, KeyRound,
} from 'lucide-react'
import { guardarCorreo, probarConexion, enviarPrueba, leerBandeja, procesarPendientes, desconectarOauth, type ActionResult, type MensajeBandeja } from '../actions'

export interface CorreoDefaults {
  nombre: string; from_nombre: string; from_email: string
  auth_tipo: 'PASSWORD' | 'OAUTH2'
  oauth_proveedor: string; oauth_client_id: string; oauth_tenant: string; oauth_cuenta: string
  tieneClientSecret: boolean; autorizado: boolean
  smtp_host: string; smtp_port: number; smtp_secure: boolean; smtp_user: string; envio_activo: boolean
  imap_host: string; imap_port: number; imap_secure: boolean; imap_user: string; recepcion_activa: boolean
  tieneSmtpPass: boolean; tieneImapPass: boolean
  estado: string; ultimo_test: string | null; ultimo_error: string | null; configurado: boolean
  /** URL que debe registrarse como redirección autorizada en Google/Azure. */
  redirectUri: string
}

/** Servidores y ayuda de cada proveedor OAuth (espejo de `lib/email/oauth`). */
const OAUTH_PROVEEDORES: Record<string, { label: string; consola: string; ayuda: string }> = {
  GOOGLE: {
    label: 'Google (Gmail / Workspace)',
    consola: 'https://console.cloud.google.com/apis/credentials',
    ayuda: 'Crea un “ID de cliente de OAuth” de tipo Aplicación web y habilita la API de Gmail.',
  },
  MICROSOFT: {
    label: 'Microsoft 365 / Outlook',
    consola: 'https://portal.azure.com',
    ayuda: 'Registra una aplicación en Entra ID con permisos SMTP.Send e IMAP.AccessAsUser.All.',
  },
}

const MENSAJES_OAUTH: Record<string, { tipo: 'ok' | 'error'; texto: string }> = {
  ok:           { tipo: 'ok',    texto: 'Cuenta autorizada correctamente. Ya puedes probar la conexión.' },
  falta_client: { tipo: 'error', texto: 'Guarda primero el Client ID y el Client Secret del proveedor.' },
  sin_refresh:  { tipo: 'error', texto: 'El proveedor no entregó un token de refresco. Revoca el acceso anterior y vuelve a autorizar.' },
  error:        { tipo: 'error', texto: 'No se pudo completar la autorización.' },
}

const PRESETS: Record<string, { smtp_host: string; smtp_port: number; smtp_secure: boolean; imap_host: string; imap_port: number }> = {
  Gmail:   { smtp_host: 'smtp.gmail.com', smtp_port: 587, smtp_secure: false, imap_host: 'imap.gmail.com', imap_port: 993 },
  Outlook: { smtp_host: 'smtp.office365.com', smtp_port: 587, smtp_secure: false, imap_host: 'outlook.office365.com', imap_port: 993 },
  Yahoo:   { smtp_host: 'smtp.mail.yahoo.com', smtp_port: 465, smtp_secure: true, imap_host: 'imap.mail.yahoo.com', imap_port: 993 },
  Zoho:    { smtp_host: 'smtp.zoho.com', smtp_port: 465, smtp_secure: true, imap_host: 'imap.zoho.com', imap_port: 993 },
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'
const labelCls = 'font-body text-xs font-semibold text-gray-500'

function SaveBtn() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar configuración
    </button>
  )
}

export function CorreoForm({ defaults: d, pendientes }: { defaults: CorreoDefaults; pendientes: number }) {
  const [state, action] = useActionState<ActionResult, FormData>(guardarCorreo, {})
  const [smtp, setSmtp] = useState({ host: d.smtp_host, port: d.smtp_port, secure: d.smtp_secure })
  const [imap, setImap] = useState({ host: d.imap_host, port: d.imap_port, secure: d.imap_secure })
  const [authTipo, setAuthTipo] = useState<'PASSWORD' | 'OAUTH2'>(d.auth_tipo)
  const [proveedor, setProveedor] = useState(d.oauth_proveedor || 'GOOGLE')
  const [probando, startProbar] = useTransition()
  const [bandeja, setBandeja] = useState<MensajeBandeja[] | null>(null)
  const [cargandoBandeja, startBandeja] = useTransition()
  const [procesando, startProcesar] = useTransition()
  const [desconectando, startDesconectar] = useTransition()

  // Resultado del vínculo OAuth: el callback vuelve con ?oauth=… en la URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const clave = params.get('oauth')
    if (!clave) return
    const msg = MENSAJES_OAUTH[clave] ?? MENSAJES_OAUTH.error
    const detalle = params.get('detalle')
    if (msg.tipo === 'ok') toast.success(msg.texto)
    else toast.error(detalle ? `${msg.texto} ${detalle}` : msg.texto)
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  function desconectar() {
    if (!confirm('¿Desconectar la cuenta? Habrá que volver a autorizarla para enviar correos.')) return
    startDesconectar(async () => {
      const r = await desconectarOauth()
      if (r.error) toast.error(r.error)
      else toast.success('Cuenta desconectada')
    })
  }

  function enviarPendientes() {
    startProcesar(async () => {
      const r = await procesarPendientes()
      if (r.error) toast.error(r.error)
      else toast.success(`Enviados: ${r.enviados ?? 0}${r.errores ? ` · con ${r.errores} error(es)` : ''}`)
    })
  }

  useEffect(() => {
    if (state.ok) toast.success('Configuración guardada')
    else if (state.error) toast.error(state.error)
  }, [state])

  function aplicarPreset(nombre: string) {
    const p = PRESETS[nombre]
    if (!p) return
    setSmtp({ host: p.smtp_host, port: p.smtp_port, secure: p.smtp_secure })
    setImap({ host: p.imap_host, port: p.imap_port, secure: true })
    toast.info(`Servidores de ${nombre} aplicados. Recuerda usar una contraseña de aplicación.`)
  }

  function probar() {
    startProbar(async () => {
      const r = await probarConexion()
      if (r.error) toast.error(r.error)
      else toast.success('Conexión SMTP correcta ✅')
    })
  }

  function verBandeja() {
    startBandeja(async () => {
      const r = await leerBandeja()
      if (r.error) { toast.error(r.error); return }
      setBandeja(r.mensajes ?? [])
    })
  }

  return (
    <div className="space-y-5">
      {/* Estado */}
      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {d.estado === 'OK'
            ? <CheckCircle2 className="w-5 h-5 text-green-600" />
            : d.estado === 'ERROR' ? <AlertCircle className="w-5 h-5 text-red-500" /> : <Plug className="w-5 h-5 text-amber-500" />}
          <div>
            <p className="font-heading font-semibold text-sm text-gray-900">
              {d.estado === 'OK' ? 'Conexión verificada' : d.estado === 'ERROR' ? 'Error de conexión' : d.configurado ? 'Sin probar' : 'Sin configurar'}
            </p>
            {d.ultimo_test && <p className="font-body text-xs text-gray-400">Última prueba: {new Date(d.ultimo_test).toLocaleString('es-CO')}</p>}
            {d.estado === 'ERROR' && d.ultimo_error && <p className="font-body text-xs text-red-500 mt-0.5">{d.ultimo_error}</p>}
          </div>
        </div>
        <button onClick={probar} disabled={probando || !d.configurado}
          className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 font-body text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          {probando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} Probar conexión (SMTP)
        </button>
      </div>

      <form action={action} className="space-y-5">
        {/* Cuenta */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2"><Mail className="w-4 h-4 text-brand-green" /><h2 className="font-heading font-semibold text-base text-gray-900">Cuenta</h2></div>
            <div className="flex items-center gap-1.5">
              <span className="font-body text-xs text-gray-400">Proveedor:</span>
              {Object.keys(PRESETS).map(p => (
                <button key={p} type="button" onClick={() => aplicarPreset(p)}
                  className="font-body text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:border-brand-green hover:text-brand-green">{p}</button>
              ))}
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <label><span className={labelCls}>Nombre del remitente</span>
              <input name="from_nombre" defaultValue={d.from_nombre} placeholder="Conserjes Inmobiliarios" className={inputCls + ' mt-1'} /></label>
            <label><span className={labelCls}>Correo de la cuenta *</span>
              <input name="from_email" type="email" required defaultValue={d.from_email} placeholder="notificaciones@tudominio.com" className={inputCls + ' mt-1'} /></label>
          </div>
          <input type="hidden" name="nombre" value={d.nombre} />
        </div>

        {/* Método de autenticación */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-brand-green" />
            <h2 className="font-heading font-semibold text-base text-gray-900">Cómo se autentica</h2>
          </div>
          <input type="hidden" name="auth_tipo" value={authTipo} />

          <div className="grid sm:grid-cols-2 gap-3">
            <button type="button" onClick={() => setAuthTipo('PASSWORD')}
              className={`text-left rounded-xl border p-3 transition-colors ${authTipo === 'PASSWORD' ? 'border-brand-green bg-green-50/40' : 'border-gray-200 hover:border-gray-300'}`}>
              <p className="font-heading font-semibold text-sm text-gray-900">Contraseña de aplicación</p>
              <p className="font-body text-xs text-gray-500 mt-0.5">
                Usuario y contraseña SMTP/IMAP. Sirve con cualquier proveedor y con dominio propio.
              </p>
            </button>
            <button type="button" onClick={() => setAuthTipo('OAUTH2')}
              className={`text-left rounded-xl border p-3 transition-colors ${authTipo === 'OAUTH2' ? 'border-brand-green bg-green-50/40' : 'border-gray-200 hover:border-gray-300'}`}>
              <p className="font-heading font-semibold text-sm text-gray-900">Autorización con Google u Outlook</p>
              <p className="font-body text-xs text-gray-500 mt-0.5">
                OAuth 2.0: se autoriza la cuenta una vez y la plataforma renueva el acceso sola. Sin contraseñas guardadas.
              </p>
            </button>
          </div>

          {authTipo === 'OAUTH2' && (
            <div className="space-y-4 border-t border-gray-50 pt-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <label><span className={labelCls}>Proveedor *</span>
                  <select name="oauth_proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)}
                    className={inputCls + ' mt-1 bg-white'}>
                    {Object.entries(OAUTH_PROVEEDORES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </label>
                {proveedor === 'MICROSOFT' && (
                  <label><span className={labelCls}>Tenant (o «common»)</span>
                    <input name="oauth_tenant" defaultValue={d.oauth_tenant} placeholder="common" className={inputCls + ' mt-1'} /></label>
                )}
                <label><span className={labelCls}>Client ID *</span>
                  <input name="oauth_client_id" defaultValue={d.oauth_client_id} placeholder="1234-abc.apps.googleusercontent.com" className={inputCls + ' mt-1'} /></label>
                <label><span className={labelCls}>Client Secret {d.tieneClientSecret && <span className="text-green-600">(guardado)</span>}</span>
                  <input name="oauth_client_secret" type="password" placeholder={d.tieneClientSecret ? '•••••••• (deja vacío para conservar)' : 'Secreto de la aplicación'} className={inputCls + ' mt-1'} /></label>
              </div>

              <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                <p className="font-body text-xs text-gray-600">
                  {OAUTH_PROVEEDORES[proveedor]?.ayuda} Consola:{' '}
                  <a href={OAUTH_PROVEEDORES[proveedor]?.consola} target="_blank" rel="noreferrer" className="text-brand-green font-semibold hover:underline">
                    {OAUTH_PROVEEDORES[proveedor]?.consola}
                  </a>
                </p>
                <p className="font-body text-xs text-gray-600">
                  URL de redirección autorizada: <code className="bg-white border border-gray-200 rounded px-1.5 py-0.5">{d.redirectUri}</code>
                </p>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                {d.autorizado ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 font-body text-xs px-2.5 py-1.5 rounded-lg bg-green-50 text-green-700">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Autorizada{d.oauth_cuenta ? `: ${d.oauth_cuenta}` : ''}
                    </span>
                    <a href={`/api/integraciones/correo/oauth/iniciar?proveedor=${proveedor}`}
                      className="font-body text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
                      Volver a autorizar
                    </a>
                    <button type="button" onClick={desconectar} disabled={desconectando}
                      className="font-body text-xs text-red-500 border border-red-100 rounded-lg px-3 py-1.5 hover:bg-red-50 disabled:opacity-50">
                      {desconectando ? 'Desconectando…' : 'Desconectar'}
                    </button>
                  </>
                ) : (
                  <a href={`/api/integraciones/correo/oauth/iniciar?proveedor=${proveedor}`}
                    className="inline-flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark">
                    <ShieldCheck className="w-4 h-4" /> Conectar con {proveedor === 'GOOGLE' ? 'Google' : 'Microsoft'}
                  </a>
                )}
                <span className="font-body text-xs text-gray-400">Guarda los datos antes de conectar.</span>
              </div>
            </div>
          )}
        </div>

        {/* SMTP */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><Send className="w-4 h-4 text-brand-green" /><h2 className="font-heading font-semibold text-base text-gray-900">Envío (SMTP)</h2></div>
            <label className="flex items-center gap-2 font-body text-xs text-gray-600">
              <input type="checkbox" name="envio_activo" defaultChecked={d.envio_activo} className="accent-brand-green w-4 h-4" /> Activado
            </label>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <label><span className={labelCls}>Servidor SMTP</span>
              <input name="smtp_host" value={smtp.host} onChange={e => setSmtp(s => ({ ...s, host: e.target.value }))} placeholder="smtp.gmail.com" className={inputCls + ' mt-1'} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label><span className={labelCls}>Puerto</span>
                <input name="smtp_port" type="number" value={smtp.port} onChange={e => setSmtp(s => ({ ...s, port: Number(e.target.value) }))} className={inputCls + ' mt-1'} /></label>
              <label className="flex items-end pb-2 gap-2 font-body text-xs text-gray-600">
                <input type="checkbox" name="smtp_secure" checked={smtp.secure} onChange={e => setSmtp(s => ({ ...s, secure: e.target.checked }))} className="accent-brand-green w-4 h-4" /> SSL (465)
              </label>
            </div>
            <label><span className={labelCls}>Usuario</span>
              <input name="smtp_user" defaultValue={d.smtp_user} placeholder="usuario@dominio.com" className={inputCls + ' mt-1'} /></label>
            {authTipo === 'PASSWORD' && (
              <label><span className={labelCls}>Contraseña {d.tieneSmtpPass && <span className="text-green-600">(guardada)</span>}</span>
                <input name="smtp_pass" type="password" placeholder={d.tieneSmtpPass ? '•••••••• (deja vacío para conservar)' : 'Contraseña de aplicación'} className={inputCls + ' mt-1'} /></label>
            )}
          </div>
          <p className="font-body text-xs text-gray-400">
            {authTipo === 'OAUTH2'
              ? 'Con OAuth no se guarda ninguna contraseña: el acceso se renueva con el token de la cuenta autorizada.'
              : 'Con Gmail/Outlook usa una contraseña de aplicación (no la de tu cuenta) y verificación en dos pasos activada.'}
          </p>
        </div>

        {/* IMAP */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><Inbox className="w-4 h-4 text-brand-green" /><h2 className="font-heading font-semibold text-base text-gray-900">Recepción (IMAP)</h2></div>
            <label className="flex items-center gap-2 font-body text-xs text-gray-600">
              <input type="checkbox" name="recepcion_activa" defaultChecked={d.recepcion_activa} className="accent-brand-green w-4 h-4" /> Activado
            </label>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <label><span className={labelCls}>Servidor IMAP</span>
              <input name="imap_host" value={imap.host} onChange={e => setImap(s => ({ ...s, host: e.target.value }))} placeholder="imap.gmail.com" className={inputCls + ' mt-1'} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label><span className={labelCls}>Puerto</span>
                <input name="imap_port" type="number" value={imap.port} onChange={e => setImap(s => ({ ...s, port: Number(e.target.value) }))} className={inputCls + ' mt-1'} /></label>
              <label className="flex items-end pb-2 gap-2 font-body text-xs text-gray-600">
                <input type="checkbox" name="imap_secure" checked={imap.secure} onChange={e => setImap(s => ({ ...s, secure: e.target.checked }))} className="accent-brand-green w-4 h-4" /> SSL (993)
              </label>
            </div>
            <label><span className={labelCls}>Usuario</span>
              <input name="imap_user" defaultValue={d.imap_user} placeholder="usuario@dominio.com" className={inputCls + ' mt-1'} /></label>
            {authTipo === 'PASSWORD' && (
              <label><span className={labelCls}>Contraseña {d.tieneImapPass && <span className="text-green-600">(guardada)</span>}</span>
                <input name="imap_pass" type="password" placeholder={d.tieneImapPass ? '•••••••• (deja vacío para conservar)' : 'Contraseña de aplicación'} className={inputCls + ' mt-1'} /></label>
            )}
          </div>
          {/* imap_secure debe llegar como 'off' cuando se desmarca */}
          {!imap.secure && <input type="hidden" name="imap_secure" value="off" />}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <SaveBtn />
          <span className="font-body text-xs text-gray-400">Las credenciales quedan protegidas con acceso solo para administradores.</span>
        </div>
      </form>

      {/* Alertas por correo */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <BellRing className="w-4 h-4 text-brand-green" />
            <h2 className="font-heading font-semibold text-base text-gray-900">Alertas por correo</h2>
          </div>
          <button onClick={enviarPendientes} disabled={procesando || !d.configurado}
            className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 font-body text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            {procesando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Enviar pendientes {pendientes > 0 ? `(${pendientes})` : ''}
          </button>
        </div>
        <p className="font-body text-sm text-gray-500 mt-2">
          Las alertas del sistema con <strong>“Enviar email”</strong> activado se encolan aquí y se envían automáticamente (cada pocos minutos) con esta cuenta.
          Actívalo por alerta en <Link href="/configuracion/alertas" className="text-brand-green font-semibold hover:underline">Configuración de alertas</Link>.
        </p>
        {pendientes > 0 && (
          <p className="font-body text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2 inline-block">
            {pendientes} correo(s) pendiente(s) de envío.
          </p>
        )}
      </div>

      {/* Enviar prueba */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <h2 className="font-heading font-semibold text-base text-gray-900 mb-1">Enviar correo de prueba</h2>
        <p className="font-body text-xs text-gray-400 mb-3">Guarda primero. Se enviará un mensaje de prueba con la cuenta configurada.</p>
        <PruebaForm configurado={d.configurado} />
      </div>

      {/* Bandeja */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2"><Inbox className="w-4 h-4 text-brand-green" /><h2 className="font-heading font-semibold text-base text-gray-900">Bandeja de entrada</h2></div>
          <button onClick={verBandeja} disabled={cargandoBandeja || !d.recepcion_activa}
            className="flex items-center gap-1.5 border border-gray-200 rounded-xl px-3 py-2 font-body text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            {cargandoBandeja ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Cargar correos
          </button>
        </div>
        {!d.recepcion_activa ? (
          <p className="font-body text-sm text-gray-400">Activa la recepción (IMAP) y guarda para leer los correos entrantes.</p>
        ) : bandeja === null ? (
          <p className="font-body text-sm text-gray-400">Pulsa “Cargar correos” para ver los últimos mensajes.</p>
        ) : bandeja.length === 0 ? (
          <p className="font-body text-sm text-gray-400">No hay mensajes en la bandeja.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {bandeja.map(m => (
              <div key={m.uid} className="flex items-start gap-3 py-2.5">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${m.leido ? 'bg-gray-200' : 'bg-brand-green'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`font-body text-sm truncate ${m.leido ? 'text-gray-600' : 'font-semibold text-gray-900'}`}>{m.asunto}</p>
                  <p className="font-body text-xs text-gray-400 truncate">{m.de}</p>
                </div>
                {m.fecha && <span className="font-body text-xs text-gray-400 shrink-0">{new Date(m.fecha).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PruebaForm({ configurado }: { configurado: boolean }) {
  const [state, action] = useActionState<ActionResult, FormData>(enviarPrueba, {})
  useEffect(() => {
    if (state.ok) toast.success('Correo de prueba enviado ✅')
    else if (state.error) toast.error(state.error)
  }, [state])
  return (
    <form action={action} className="flex items-center gap-2 flex-wrap">
      <input name="para" type="email" placeholder="destinatario@correo.com (opcional)" className={inputCls + ' flex-1 min-w-[220px]'} />
      <SendBtn disabled={!configurado} />
    </form>
  )
}

function SendBtn({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={disabled || pending}
      className="flex items-center gap-2 border border-brand-green/40 text-brand-green font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-green-50 disabled:opacity-50">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar prueba
    </button>
  )
}
