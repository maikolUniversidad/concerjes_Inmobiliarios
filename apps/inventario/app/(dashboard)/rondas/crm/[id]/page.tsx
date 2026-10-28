import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso, getPermisosUsuario } from '@/lib/permisos-server'
import { faltaParaIa, iaActiva, modeloCrm } from '@/lib/crm/ia'
import { CasoClient, type CasoDetalle, type MensajeFila, type EtiquetaFila,
         type AsignacionFila, type AgenteFila, type EventoFila } from './CasoClient'

export const metadata: Metadata = { title: 'Caso del CRM' }
export const dynamic = 'force-dynamic'

/**
 * Un caso: la conversación, el reloj, lo que sugirió la IA y el botón que —
 * y solo él — hace que una respuesta salga.
 *
 * El festivos del calendario COMPARTIDO (`pqrs_dias_no_habiles`) se cargan acá
 * y se le pasan al cliente, para que el reloj que se dibuja en la pantalla sea
 * el mismo que calculó la base. Son pocas filas (los festivos de un país) y se
 * traen de una vez en vez de preguntar por cada caso.
 */
export default async function CasoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await requirePermiso('ver_crm')
  const permisos = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const { data: caso } = await sb
    .from('crm_bandeja')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!caso) notFound()

  const [extra, mensajes, etiquetas, asignaciones, agentes, eventos, festivos] = await Promise.all([
    sb.from('crm_casos')
      .select(`descripcion, respuesta_ia, respuesta_aprobada_texto, respuesta_aprobada_at,
               respuesta_editada, ia_modelo, ia_prompt_version, ia_mensajes_vistos,
               clasificacion_ia, motivo_apertura, abierto_por_tipo, cierre_motivo,
               aprobador:usuarios!crm_casos_respuesta_aprobada_por_fkey ( nombre ),
               confirmador:usuarios!crm_casos_ia_confirmado_por_fkey ( nombre )`)
      .eq('id', id)
      .single(),
    caso.conversacion_id
      ? sb.from('crm_mensajes')
          .select(`id, direccion, tipo, texto, estado, iniciado_por, es_plantilla,
                   plantilla_nombre, omitido_motivo, error, created_at, enviado_at`)
          .eq('conversacion_id', caso.conversacion_id)
          .order('created_at', { ascending: false })
          .order('id')
          .limit(100)
      : Promise.resolve({ data: [] }),
    sb.from('crm_etiquetas')
      .select('id, codigo, nombre, color, grupo_id, activo')
      .eq('activo', true)
      .order('codigo'),
    sb.from('crm_asignaciones')
      .select('id, usuario_nombre, motivo, desde, hasta')
      .eq('caso_id', id)
      .order('desde', { ascending: false })
      .order('id'),
    sb.from('usuarios').select('id, nombre, rol').eq('activo', true).order('nombre').limit(300),
    sb.from('ronda_eventos')
      .select('id, accion, actor_tipo, actor_nombre, detalle, created_at')
      .eq('entidad', 'crm_casos')
      .eq('entidad_id', id)
      .order('id', { ascending: false })
      .limit(40),
    sb.from('pqrs_dias_no_habiles').select('fecha').order('fecha'),
  ])

  const { id: modelo } = modeloCrm()

  return (
    <CasoClient
      caso={{ ...(caso as CasoDetalle), ...(extra.data ?? {}) }}
      // Ascendentes para leerla como una conversación: la consulta los pide
      // descendentes porque es el orden del índice.
      mensajes={(((mensajes.data ?? []) as MensajeFila[]).slice().reverse())}
      etiquetas={((etiquetas.data ?? []) as EtiquetaFila[])
        .filter((e) => e.grupo_id === null || e.grupo_id === caso.grupo_id)}
      asignaciones={(asignaciones.data ?? []) as AsignacionFila[]}
      agentes={(agentes.data ?? []) as AgenteFila[]}
      eventos={(eventos.data ?? []) as EventoFila[]}
      festivos={((festivos.data ?? []) as { fecha: string }[]).map((f) => f.fecha)}
      puedeGestionar={permisos.puede('gestionar_crm')}
      iaEncendida={iaActiva()}
      iaModelo={modelo}
      faltaParaIa={faltaParaIa()}
    />
  )
}
