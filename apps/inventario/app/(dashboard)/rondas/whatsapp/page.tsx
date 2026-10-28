import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso, getPermisosUsuario } from '@/lib/permisos-server'
import { faltantes, simuladorActivo } from '@/lib/whatsapp/config'
import { WhatsappClient, type ConversacionFila, type MensajeFila, type PlantillaFila, type CuentaFila, type ResumenCola } from './WhatsappClient'

export const metadata: Metadata = { title: 'Bot de WhatsApp' }
export const dynamic = 'force-dynamic'

/**
 * El tablero del bot: la cuenta, las conversaciones, la cola de salida y el
 * estado de las plantillas ante Meta.
 *
 * TODO SE CUENTA EN SQL. Supabase corta las consultas a los 8 segundos, y las
 * conversaciones de 6.000 personas no se traen para contarlas en JavaScript:
 * los totales salen de `whatsapp_resumen_cola` y
 * `whatsapp_resumen_conversaciones`, que son vistas agrupadas, y las filas se
 * traen paginadas y acotadas a lo último.
 *
 * Lo que la pantalla tiene que dejar claro de un golpe: QUÉ NO SALIÓ Y POR QUÉ.
 * Un mensaje omitido no es un error silencioso, es trabajo que alguien tiene
 * que recoger desde acá.
 */
export default async function WhatsappPage() {
  await requirePermiso('ver_whatsapp')
  const permisos = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [cuentas, cola, porEstado, conversaciones, ultimos, plantillas, rechazos] = await Promise.all([
    sb.from('whatsapp_cuentas')
      .select('id, alias, display_phone_number, nombre_visible, transporte, estado, throughput_mps, coexistencia, predeterminada, suspension_motivo, conectado_at')
      .order('predeterminada', { ascending: false }).order('alias'),
    sb.from('whatsapp_resumen_cola').select('*'),
    sb.from('whatsapp_resumen_conversaciones').select('estado, conversaciones, sin_identificar, bloqueadas, con_ventana, vencidas'),
    // Las 50 conversaciones con movimiento más reciente: es lo que un
    // supervisor mira. El resto se busca, no se lista.
    sb.from('crm_conversaciones')
      .select(`id, wa_id, perfil_nombre, estado, estado_desde, intentos, bloqueada,
               ultimo_entrante_at, ventana_vence_at, espera_vence_at,
               mensajes_entrantes, mensajes_salientes, updated_at,
               persona:personas ( nombres ), punto:ronda_puntos ( codigo, nombre ),
               contrato:grupos_contrato ( codigo, nombre )`)
      .order('updated_at', { ascending: false }).order('id')
      .limit(50),
    // Los últimos 100 mensajes, con lo omitido primero en la cabeza del usuario.
    sb.from('crm_mensajes')
      .select('id, conversacion_id, direccion, tipo, texto, estado, omitido_motivo, error, error_codigo, intentos, es_plantilla, plantilla_nombre, prioridad, created_at, enviado_at')
      .order('created_at', { ascending: false }).order('id')
      .limit(100),
    sb.from('whatsapp_plantillas')
      .select('id, nombre, categoria, idioma, estado, encabezado, cuerpo, pie, botones, variables, proposito, rechazo_motivo, revisado_at')
      .order('categoria').order('nombre'),
    sb.from('whatsapp_eventos_rechazados')
      .select('id, motivo, ip, bytes, recibido_at')
      .order('recibido_at', { ascending: false }).order('id')
      .limit(20),
  ])

  const colaPorCuenta = new Map<string, ResumenCola>(
    ((cola.data ?? []) as ResumenCola[]).map((c) => [c.cuenta_id, c]),
  )

  return (
    <WhatsappClient
      cuentas={((cuentas.data ?? []) as CuentaFila[]).map((c) => ({
        ...c,
        cola: colaPorCuenta.get(c.id) ?? null,
      }))}
      porEstado={(porEstado.data ?? []) as {
        estado: string; conversaciones: number; sin_identificar: number
        bloqueadas: number; con_ventana: number; vencidas: number
      }[]}
      conversaciones={(conversaciones.data ?? []) as ConversacionFila[]}
      mensajes={(ultimos.data ?? []) as MensajeFila[]}
      plantillas={(plantillas.data ?? []) as PlantillaFila[]}
      rechazos={(rechazos.data ?? []) as { id: number; motivo: string; ip: string | null; bytes: number | null; recibido_at: string }[]}
      simulador={simuladorActivo()}
      // Qué le falta al entorno para poder mandar algo de verdad. Se muestra
      // porque es más útil que descubrirlo con un error al enviar.
      faltaEnElEntorno={faltantes()}
      puedeGestionar={permisos.puede('gestionar_whatsapp')}
      puedeConectar={permisos.puede('conectar_whatsapp')}
    />
  )
}
