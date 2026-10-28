'use client'

import { useMemo, useState } from 'react'
import {
  MessagesSquare, AlertTriangle, CheckCircle2, Clock, ShieldAlert, Ban,
  FileText, Inbox, Send, Search, Smartphone,
} from 'lucide-react'

export interface ResumenCola {
  cuenta_id: string
  pendientes: number
  en_proceso: number
  salieron: number
  fallidos: number
  sin_credencial: number
  omitidos_ventana: number
  omitidos_jornada: number
  omitidos_consentimiento: number
  omitidos_plantilla: number
  omitidos_bloqueado: number
  espera_desde: string | null
}

export interface CuentaFila {
  id: string
  alias: string
  display_phone_number: string | null
  nombre_visible: string | null
  transporte: 'META' | 'BSP' | 'SIMULADOR'
  estado: string
  throughput_mps: number
  coexistencia: boolean
  predeterminada: boolean
  suspension_motivo: string | null
  conectado_at: string | null
  cola: ResumenCola | null
}

export interface ConversacionFila {
  id: string
  wa_id: string
  perfil_nombre: string | null
  estado: string
  estado_desde: string
  intentos: number
  bloqueada: boolean
  ultimo_entrante_at: string | null
  ventana_vence_at: string | null
  espera_vence_at: string | null
  mensajes_entrantes: number
  mensajes_salientes: number
  updated_at: string
  persona: { nombres: string } | null
  punto: { codigo: string; nombre: string } | null
  contrato: { codigo: string; nombre: string } | null
}

export interface MensajeFila {
  id: string
  conversacion_id: string
  direccion: 'ENTRANTE' | 'SALIENTE'
  tipo: string
  texto: string | null
  estado: string
  omitido_motivo: string | null
  error: string | null
  error_codigo: string | null
  intentos: number
  es_plantilla: boolean
  plantilla_nombre: string | null
  prioridad: number
  created_at: string
  enviado_at: string | null
}

export interface PlantillaFila {
  id: string
  nombre: string
  categoria: string
  idioma: string
  estado: string
  encabezado: string | null
  cuerpo: string
  pie: string | null
  botones: { tipo?: string; texto?: string }[] | null
  variables: { pos?: number; ejemplo?: string }[] | null
  proposito: string | null
  rechazo_motivo: string | null
  revisado_at: string | null
}

const tarjeta = 'rounded-xl border border-gray-200 bg-white p-4'
const chip = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-[11px] font-semibold'

/** Un número de WhatsApp nunca se muestra completo: es dato personal, y quien
 *  mira el tablero no necesita el número para hacer su trabajo. */
function numeroCorto(waId: string): string {
  if (waId.length <= 6) return '••••'
  return `${waId.slice(0, 2)}•••••${waId.slice(-3)}`
}

function hora(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'America/Bogota',
  })
}

const COLOR_ESTADO: Record<string, string> = {
  ENVIADO: 'bg-blue-50 text-blue-700',
  ENTREGADO: 'bg-blue-50 text-blue-700',
  LEIDO: 'bg-emerald-50 text-emerald-700',
  SIMULADO: 'bg-violet-50 text-violet-700',
  PENDIENTE: 'bg-amber-50 text-amber-700',
  EN_PROCESO: 'bg-amber-50 text-amber-700',
  RECIBIDO: 'bg-gray-100 text-gray-700',
  FALLIDO: 'bg-red-50 text-red-700',
  EN_ESPERA_CREDENCIAL: 'bg-red-50 text-red-700',
}

function colorEstado(estado: string): string {
  if (estado.startsWith('OMITIDO')) return 'bg-orange-50 text-orange-700'
  return COLOR_ESTADO[estado] ?? 'bg-gray-100 text-gray-700'
}

export function WhatsappClient({
  cuentas, porEstado, conversaciones, mensajes, plantillas, rechazos,
  simulador, faltaEnElEntorno, puedeGestionar, puedeConectar,
}: {
  cuentas: CuentaFila[]
  porEstado: { estado: string; conversaciones: number; sin_identificar: number; bloqueadas: number; con_ventana: number; vencidas: number }[]
  conversaciones: ConversacionFila[]
  mensajes: MensajeFila[]
  plantillas: PlantillaFila[]
  rechazos: { id: number; motivo: string; ip: string | null; bytes: number | null; recibido_at: string }[]
  simulador: boolean
  faltaEnElEntorno: string[]
  puedeGestionar: boolean
  puedeConectar: boolean
}) {
  const [pestana, setPestana] = useState<'cola' | 'conversaciones' | 'plantillas' | 'seguridad'>('cola')
  const [busca, setBusca] = useState('')

  const total = useMemo(() => {
    const t = { conversaciones: 0, sinIdentificar: 0, bloqueadas: 0, conVentana: 0, vencidas: 0 }
    for (const f of porEstado) {
      t.conversaciones += Number(f.conversaciones)
      t.sinIdentificar += Number(f.sin_identificar)
      t.bloqueadas += Number(f.bloqueadas)
      t.conVentana += Number(f.con_ventana)
      t.vencidas += Number(f.vencidas)
    }
    return t
  }, [porEstado])

  const omitidos = useMemo(() => mensajes.filter((m) => m.estado.startsWith('OMITIDO')), [mensajes])
  // El total REAL de omitidos sale de la vista agrupada (contada en SQL sobre
  // toda la tabla). `omitidos` son solo los que están entre los últimos 100
  // mensajes que trae la pantalla: si se usara ese número en el título, la
  // pestaña y la tarjeta de la cuenta mostrarían dos cifras distintas del mismo
  // dato, a cinco centímetros de distancia.
  const omitidosTotal = useMemo(
    () => cuentas.reduce((n, c) => n + (c.cola
      ? Number(c.cola.omitidos_ventana) + Number(c.cola.omitidos_jornada) +
        Number(c.cola.omitidos_consentimiento) + Number(c.cola.omitidos_plantilla) +
        Number(c.cola.omitidos_bloqueado)
      : 0), 0),
    [cuentas],
  )
  const aprobadas = plantillas.filter((p) => p.estado === 'APPROVED').length

  const convFiltradas = useMemo(() => {
    const q = busca.trim().toUpperCase()
    if (!q) return conversaciones
    return conversaciones.filter((c) =>
      [c.wa_id, c.estado, c.punto?.codigo, c.contrato?.codigo, c.persona?.nombres]
        .filter(Boolean).join(' ').toUpperCase().includes(q))
  }, [conversaciones, busca])

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessagesSquare className="h-6 w-6 text-brand-green" />
          <div>
            <h1 className="font-heading text-xl font-bold text-gray-900">Bot de WhatsApp</h1>
            <p className="font-body text-sm text-gray-500">
              Conversaciones de rondas, cola de salida y plantillas ante Meta.
            </p>
          </div>
        </div>
        {simulador && (
          <span className={`${chip} bg-violet-50 text-violet-700`}>
            <Smartphone className="h-3 w-3" /> Simulador activo · nada sale hacia un teléfono
          </span>
        )}
      </header>

      {/* Lo primero que hay que ver: qué le falta al entorno para poder mandar
          algo de verdad. Es más útil acá que como un error al enviar. */}
      {faltaEnElEntorno.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 font-body text-sm font-semibold text-amber-900">
            <AlertTriangle className="h-4 w-4" /> Falta configuración de Meta
          </p>
          <p className="mt-1 font-body text-sm text-amber-800">
            El bot funciona entero —recibe, conversa, guarda evidencia y deja ver cada mensaje tal
            como saldría— pero <strong>no puede enviar nada a un teléfono</strong> hasta que estén
            estas variables de entorno:{' '}
            {/* Una por una, no con `join`: en JSX el separador de `join` es TEXTO,
                así que `'</code>, <code>'` se escaparía y se leería tal cual. */}
            {faltaEnElEntorno.map((v, i) => (
              <span key={v}>
                {i > 0 && ', '}
                <code>{v}</code>
              </span>
            ))}
            .
          </p>
        </div>
      )}

      {/* La cuenta. Sin ninguna, hay que DECIRLO: un bloque que simplemente no
          aparece se lee como «está bien» y no como «no hay número conectado». */}
      {cuentas.length === 0 && (
        <section className={`${tarjeta} border-dashed text-center`}>
          <p className="font-body text-sm text-gray-500">
            No hay ningún número de WhatsApp registrado. Mientras no haya uno, el bot no puede
            recibir ni responder nada.
            {puedeConectar
              ? ' Conectá el número de la empresa desde la consola de Meta con Embedded Signup.'
              : ' Pedíselo a quien tenga el permiso de conectar WhatsApp.'}
          </p>
        </section>
      )}
      {cuentas.map((c) => (
        <section key={c.id} className={tarjeta}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-heading text-base font-bold text-gray-900">
                {c.nombre_visible ?? c.alias}{' '}
                <span className="font-body text-sm font-normal text-gray-500">
                  {c.display_phone_number ?? 'sin número'}
                </span>
              </p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <span className={`${chip} ${c.transporte === 'SIMULADOR' ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {c.transporte === 'SIMULADOR' ? 'Simulador' : c.transporte === 'BSP' ? 'Por proveedor (BSP)' : 'Directo con Meta'}
                </span>
                <span className={`${chip} ${c.estado === 'SUSPENDIDA' ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                  {c.estado}
                </span>
                {c.coexistencia && (
                  <span className={`${chip} bg-gray-100 text-gray-700`} title="El número sigue funcionando en la app WhatsApp Business del teléfono: sin grupos, sin ubicación en vivo, sin llamadas.">
                    Coexistencia
                  </span>
                )}
                <span className={`${chip} bg-gray-100 text-gray-700`} title="Tope fijo del número. No se puede subir para un número en coexistencia.">
                  {c.throughput_mps} msj/s
                </span>
              </div>
              {c.suspension_motivo && (
                <p className="mt-2 font-body text-sm text-red-700">{c.suspension_motivo}</p>
              )}
            </div>
            {c.cola && (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                <Dato n={c.cola.pendientes} l="en cola" />
                <Dato n={c.cola.salieron} l="salieron" />
                <Dato n={c.cola.fallidos} l="fallidos" tono={c.cola.fallidos ? 'rojo' : undefined} />
                <Dato
                  n={c.cola.omitidos_ventana + c.cola.omitidos_jornada + c.cola.omitidos_consentimiento +
                     c.cola.omitidos_plantilla + c.cola.omitidos_bloqueado}
                  l="omitidos"
                  tono="naranja"
                />
                <Dato n={c.cola.sin_credencial} l="sin token" tono={c.cola.sin_credencial ? 'rojo' : undefined} />
              </div>
            )}
          </div>
          {puedeConectar && c.transporte === 'SIMULADOR' && (
            <p className="mt-3 border-t border-gray-100 pt-3 font-body text-sm text-gray-500">
              Para conectar el número de la empresa hace falta terminar Embedded Signup en modo
              Coexistencia desde la consola de Meta. Avisá antes a quien use WhatsApp Web: al
              conectar, <strong>los dispositivos acompañantes se desvinculan</strong> y hay que
              volver a vincularlos.
            </p>
          )}
        </section>
      ))}

      {/* Totales de conversaciones */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tarjeta icono={<MessagesSquare className="h-4 w-4" />} n={total.conversaciones} l="conversaciones" />
        <Tarjeta icono={<Clock className="h-4 w-4" />} n={total.conVentana} l="con ventana abierta" />
        <Tarjeta icono={<ShieldAlert className="h-4 w-4" />} n={total.sinIdentificar} l="sin identificar" />
        <Tarjeta icono={<Ban className="h-4 w-4" />} n={total.bloqueadas} l="bloqueadas" />
        <Tarjeta icono={<FileText className="h-4 w-4" />} n={`${aprobadas}/${plantillas.length}`} l="plantillas aprobadas" />
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-gray-200">
        {([
          ['cola', `Cola y omitidos${omitidosTotal ? ` (${omitidosTotal})` : ''}`],
          ['conversaciones', 'Conversaciones'],
          ['plantillas', 'Plantillas'],
          ['seguridad', `Webhook${rechazos.length ? ` (${rechazos.length})` : ''}`],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setPestana(id)}
            className={`-mb-px border-b-2 px-3 py-2 font-body text-sm font-semibold ${
              pestana === id ? 'border-brand-green text-brand-green' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {label}
          </button>
        ))}
      </nav>

      {pestana === 'cola' && (
        <section className="space-y-4">
          {omitidos.length > 0 && (
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
              <p className="font-body text-sm font-semibold text-orange-900">
                Mensajes que no salieron, y por qué
              </p>
              <p className="mt-1 font-body text-sm text-orange-800">
                Un mensaje omitido no se perdió: quedó con su motivo. Fuera de la ventana de 24 horas
                solo sale una plantilla aprobada, y fuera de la jornada de la persona el bot no
                inicia conversación (Ley 2191 de 2022). Lo que haya que decirle a alguien de otra
                forma se recoge desde acá.
                {omitidosTotal > omitidos.length && (
                  <> Acá se ven los más recientes; en total hay <strong>{omitidosTotal}</strong>.</>
                )}
              </p>
              <ul className="mt-3 space-y-1.5">
                {omitidos.slice(0, 15).map((m) => (
                  <li key={m.id} className="font-body text-sm text-orange-900">
                    {/* `ring` y fondo blanco: dentro de este panel naranja un
                        chip `bg-orange-50` tiene el MISMO fondo que el panel y
                        deja de verse como pastilla. */}
                    <span className={`${chip} bg-white text-orange-700 ring-1 ring-orange-200`}>
                      {m.estado.replace('OMITIDO_', '')}
                    </span>{' '}
                    <span className="text-gray-500">{hora(m.created_at)}</span>{' '}
                    {m.omitido_motivo}
                  </li>
                ))}
              </ul>
              {/* Cortar en 15 sin decirlo iría contra el propósito del bloque,
                  que es justamente «esto es lo que hay que recoger». */}
              {omitidos.length > 15 && (
                <p className="mt-2 font-body text-sm text-orange-800">
                  Y {omitidos.length - 15} más en la tabla de abajo.
                </p>
              )}
            </div>
          )}
          <Tabla
            columnas={['Hora', 'Dir.', 'Tipo', 'Estado', 'Pri.', 'Texto', 'Detalle']}
            filas={mensajes.map((m) => [
              hora(m.created_at),
              m.direccion === 'ENTRANTE' ? <Inbox key="i" className="h-3.5 w-3.5 text-gray-400" /> : <Send key="s" className="h-3.5 w-3.5 text-gray-400" />,
              m.es_plantilla ? `plantilla · ${m.plantilla_nombre}` : m.tipo.toLowerCase(),
              <span key="e" className={`${chip} ${colorEstado(m.estado)}`}>{m.estado}</span>,
              m.direccion === 'SALIENTE' ? String(m.prioridad) : '—',
              (m.texto ?? '').slice(0, 90),
              m.omitido_motivo ?? m.error ?? (m.intentos > 1 ? `${m.intentos} intentos` : ''),
            ])}
            vacio="Todavía no hay mensajes."
          />
        </section>
      )}

      {pestana === 'conversaciones' && (
        <section className="space-y-3">
          <label className="flex max-w-sm items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
            <Search className="h-4 w-4 text-gray-400" />
            {/* El número completo SÍ filtra, a propósito: un supervisor que lo
                tiene en la mano necesita encontrar la conversación. El
                recordatorio va en el texto para que sea una decisión visible y
                no una sorpresa. */}
            <input value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por estado, punto, contrato, nombre o número"
              className="w-full font-body text-sm outline-none" />
          </label>
          <Tabla
            columnas={['Número', 'Persona', 'Estado', 'Desde', 'Punto', 'Contrato', 'Ventana', 'Vence', 'In/Out']}
            filas={convFiltradas.map((c) => [
              <span key="n" className="font-mono text-xs" title="El número no se muestra completo: es dato personal.">
                {numeroCorto(c.wa_id)}
              </span>,
              c.persona?.nombres?.split(/\s+/)[0] ?? (c.bloqueada ? 'bloqueada' : 'sin identificar'),
              // `includes` y no `startsWith`: EN_ESPERA_FUERA_DE_JORNADA empieza
              // por `EN_`, y es justo el estado de la Ley 2191 el que no puede
              // quedar pintado como uno normal.
              <span key="e" className={`${chip} ${
                c.estado.startsWith('ERROR') || c.estado === 'EXPIRADA'
                  ? 'bg-red-50 text-red-700'
                  : c.estado.includes('ESPERA')
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-gray-100 text-gray-700'}`}>
                {c.estado}
              </span>,
              hora(c.estado_desde),
              // El nombre del punto y del contrato se traen de la base: se
              // muestran en el `title`, que es donde caben sin volver la tabla
              // ilegible. Un código críptico y sin nombre no sirve de nada.
              c.punto
                ? <span key="p" title={c.punto.nombre}>{c.punto.codigo}</span>
                : '—',
              c.contrato
                ? <span key="c" title={c.contrato.nombre}>{c.contrato.codigo}</span>
                : '—',
              c.ventana_vence_at && Date.parse(c.ventana_vence_at) > Date.now()
                ? <span key="v" className={`${chip} bg-emerald-50 text-emerald-700`}><CheckCircle2 className="h-3 w-3" /> abierta</span>
                : <span key="v" className={`${chip} bg-gray-100 text-gray-600`}>cerrada</span>,
              hora(c.espera_vence_at),
              `${c.mensajes_entrantes}/${c.mensajes_salientes}`,
            ])}
            // Si hay conversaciones y el filtro no encontró ninguna, decirlo
            // como «no hay conversaciones» sería mentir sobre el estado del
            // sistema.
            vacio={busca.trim()
              ? `Ninguna conversación coincide con «${busca.trim()}».`
              : 'Todavía no hay conversaciones.'}
          />
        </section>
      )}

      {pestana === 'plantillas' && (
        <section className="space-y-3">
          <p className="font-body text-sm text-gray-500">
            Fuera de la ventana de 24 horas solo sale una plantilla en estado <code>APPROVED</code>.
            Una <code>PAUSED</code> por calidad se salta y no se reintenta. Ninguna es de categoría
            marketing, y la base no lo permite. Las plantillas se crean en el Business Manager de
            Meta y la revisión puede tardar hasta 24 horas.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {plantillas.map((p) => (
              <article key={p.id} className={tarjeta}>
                <div className="flex items-start justify-between gap-2">
                  <code className="font-mono text-sm font-semibold text-gray-900">{p.nombre}</code>
                  <span className={`${chip} ${p.estado === 'APPROVED' ? 'bg-emerald-50 text-emerald-700' : p.estado === 'REJECTED' || p.estado === 'PAUSED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                    {p.estado}
                  </span>
                </div>
                <p className="mt-0.5 font-body text-[11px] uppercase tracking-wide text-gray-400">
                  {p.categoria} · {p.idioma}
                </p>
                {p.proposito && <p className="mt-2 font-body text-sm text-gray-600">{p.proposito}</p>}
                <div className="mt-2 rounded-lg bg-gray-50 p-2.5 font-body text-sm text-gray-800">
                  {p.encabezado && <p className="font-semibold">{p.encabezado}</p>}
                  <p className="whitespace-pre-wrap">{p.cuerpo}</p>
                  {p.pie && <p className="mt-1 text-xs text-gray-500">{p.pie}</p>}
                  {(p.botones ?? []).length > 0 && (
                    <p className="mt-2 flex flex-wrap gap-1">
                      {(p.botones ?? []).map((b, i) => (
                        <span key={i} className={`${chip} bg-white text-gray-700 ring-1 ring-gray-200`}>{b.texto}</span>
                      ))}
                    </p>
                  )}
                </div>
                {p.rechazo_motivo && (
                  <p className="mt-2 font-body text-sm text-red-700">{p.rechazo_motivo}</p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {pestana === 'seguridad' && (
        <section className="space-y-3">
          <div className={tarjeta}>
            <p className="font-body text-sm font-semibold text-gray-900">El webhook</p>
            <p className="mt-1 font-body text-sm text-gray-600">
              <code>/api/whatsapp/webhook</code> es el único extremo público del módulo, y su
              autenticación es la <strong>firma de Meta</strong>: no hay cookie ni token de sesión,
              porque Meta no se puede autenticar de otra forma. Hay que excluirlo del Firewall, de
              BotID y de la protección de despliegue de Vercel. Un golpe sin firma válida se rechaza
              con 403 y se registra abajo <strong>sin el cuerpo</strong>: guardar el payload de algo
              que no se pudo autenticar es guardar lo que un desconocido quiso meter en la base.
            </p>
          </div>
          <Tabla
            columnas={['Hora', 'Motivo', 'IP', 'Bytes']}
            filas={rechazos.map((r) => [
              hora(r.recibido_at),
              <span key="m" className={`${chip} bg-red-50 text-red-700`}>{r.motivo}</span>,
              r.ip ?? '—',
              r.bytes ?? '—',
            ])}
            vacio="Ningún golpe rechazado. Es lo esperado."
          />
        </section>
      )}

      {!puedeGestionar && (
        <p className="font-body text-sm text-gray-400">
          Tenés acceso de lectura. Para responder a mano, reencolar lo omitido o gestionar plantillas
          hace falta el permiso <code>gestionar_whatsapp</code>.
        </p>
      )}
    </div>
  )
}

function Dato({ n, l, tono }: { n: number | string; l: string; tono?: 'rojo' | 'naranja' }) {
  const color = tono === 'rojo' ? 'text-red-600' : tono === 'naranja' ? 'text-orange-600' : 'text-gray-900'
  return (
    <div className="text-center">
      <p className={`font-heading text-lg font-bold ${color}`}>{n}</p>
      <p className="font-body text-[11px] uppercase tracking-wide text-gray-400">{l}</p>
    </div>
  )
}

function Tarjeta({ icono, n, l }: { icono: React.ReactNode; n: number | string; l: string }) {
  return (
    <div className={tarjeta}>
      <p className="flex items-center gap-1.5 font-body text-[11px] uppercase tracking-wide text-gray-400">
        {icono} {l}
      </p>
      <p className="mt-1 font-heading text-2xl font-bold text-gray-900">{n}</p>
    </div>
  )
}

function Tabla({
  columnas, filas, vacio,
}: { columnas: string[]; filas: React.ReactNode[][]; vacio: string }) {
  if (filas.length === 0) {
    return <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center font-body text-sm text-gray-400">{vacio}</p>
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full min-w-[720px] border-collapse">
        <thead>
          <tr className="bg-gray-50">
            {columnas.map((c) => (
              <th key={c} className="px-3 py-2 text-left font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t border-gray-100">
              {f.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top font-body text-sm text-gray-700">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
