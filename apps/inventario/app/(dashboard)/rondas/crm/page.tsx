import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso, getPermisosUsuario } from '@/lib/permisos-server'
import { faltaParaIa, modeloCrm, iaActiva } from '@/lib/crm/ia'
import { BandejaClient, type CasoFila, type ResumenFila, type EtiquetaFila,
         type ReglaFila, type AgenteFila, type ConversacionSuelta } from './BandejaClient'

export const metadata: Metadata = { title: 'Bandeja del CRM' }
export const dynamic = 'force-dynamic'

/**
 * La bandeja de conversaciones del CRM (F11 de Puntos QR).
 *
 * TODO SE CUENTA EN SQL. Es la pantalla que alguien deja abierta todo el día con
 * los casos del mes, y Supabase corta las consultas a los 8 segundos: los
 * totales salen de `crm_resumen_bandeja` (una vista agrupada) y las filas de
 * `crm_bandeja`, que ya trae el caso, su conversación, su reloj y sus etiquetas
 * resueltas — sin una consulta por fila.
 *
 * Lo primero que tiene que quedar claro de un golpe: QUÉ HAY QUE CONTESTAR YA,
 * y QUÉ SUGERENCIA DE LA IA ESTÁ ESPERANDO QUE ALGUIEN LA APRUEBE. Una
 * sugerencia sin aprobar es trabajo pendiente, no un adorno.
 */
export default async function CrmPage() {
  await requirePermiso('ver_crm')
  const permisos = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [resumen, abiertos, recientes, etiquetas, reglas, agentes, sueltas, festivos] = await Promise.all([
    sb.from('crm_resumen_bandeja').select('*'),
    // Lo abierto primero y completo: es la cola de trabajo. Ordenado por lo que
    // vence antes, que es el orden en el que de verdad se atiende.
    sb.from('crm_bandeja')
      .select('*')
      .in('estado', ['NUEVO', 'EN_TRAMITE', 'EN_ESPERA'])
      .order('vence_primera_at', { ascending: true, nullsFirst: false })
      .order('abierto_at', { ascending: true })
      .order('id')
      .limit(200),
    // Lo cerrado, solo lo último: se consulta, no se vigila.
    sb.from('crm_bandeja')
      .select('*')
      .in('estado', ['RESUELTO', 'CERRADO'])
      .order('updated_at', { ascending: false })
      .order('id')
      .limit(50),
    sb.from('crm_etiquetas')
      .select('id, codigo, nombre, color, grupo_id, descripcion, activo')
      .order('codigo'),
    sb.from('crm_sla_reglas')
      .select(`id, grupo_id, tipo, prioridad, minutos_primera_respuesta, minutos_resolucion,
               horas_habiles, jornada_desde, jornada_hasta, activo, observacion,
               contrato:grupos_contrato ( codigo, nombre )`)
      .order('prioridad')
      .order('id'),
    sb.from('usuarios').select('id, nombre, rol').eq('activo', true).order('nombre').limit(300),
    // Conversaciones con movimiento reciente que NO tienen caso abierto: es de
    // donde sale un caso nuevo cuando el bot no lo derivó.
    sb.from('crm_conversaciones')
      .select(`id, wa_id, perfil_nombre, estado, ultimo_entrante_at, mensajes_entrantes,
               contrato:grupos_contrato ( codigo, nombre )`)
      .order('ultimo_entrante_at', { ascending: false, nullsFirst: false })
      .order('id')
      .limit(40),
    // El calendario de festivos COMPARTIDO (el de PQRS y No conformes). Son
    // pocas filas —los festivos de un país— y se traen de una vez para que el
    // reloj que se dibuja en la lista sea el mismo que calculó la base, en
    // minutos hábiles y no de reloj de pared.
    sb.from('pqrs_dias_no_habiles').select('fecha').order('fecha'),
  ])

  const filas = [...((abiertos.data ?? []) as CasoFila[]), ...((recientes.data ?? []) as CasoFila[])]
  const conCaso = new Set(filas.map((f) => f.conversacion_id).filter(Boolean) as string[])
  const abiertasConCaso = new Set(
    ((abiertos.data ?? []) as CasoFila[]).map((f) => f.conversacion_id).filter(Boolean) as string[],
  )

  const { id: modelo } = modeloCrm()

  return (
    <BandejaClient
      resumen={(resumen.data ?? []) as ResumenFila[]}
      casos={filas}
      etiquetas={(etiquetas.data ?? []) as EtiquetaFila[]}
      reglas={(reglas.data ?? []) as ReglaFila[]}
      agentes={(agentes.data ?? []) as AgenteFila[]}
      sueltas={((sueltas.data ?? []) as ConversacionSuelta[])
        .filter((c) => !abiertasConCaso.has(c.id))
        .map((c) => ({ ...c, tuvoCaso: conCaso.has(c.id) }))}
      puedeGestionar={permisos.puede('gestionar_crm')}
      puedeParametrizar={permisos.puede('parametrizar_crm')}
      iaEncendida={iaActiva()}
      iaModelo={modelo}
      faltaParaIa={faltaParaIa()}
      festivos={((festivos.data ?? []) as { fecha: string }[]).map((f) => f.fecha)}
    />
  )
}
