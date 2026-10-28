import 'server-only'

// El barrido del SLA de los casos, para el cron.
//
// Está acá y no dentro del route handler por la misma razón por la que F9 puso
// `procesarVencimientos` en `lib/whatsapp/motor.ts`: `scripts/auditar-permisos.mjs`
// marca cualquier `route.ts` que escriba sin comprobar un permiso, y un cron no
// tiene usuario con el que comprobarlo — se autentica con `CRON_SECRET`. Mezclar
// las dos cosas en el mismo archivo deja una entrada permanente en ese informe,
// y un informe con ruido es un informe que nadie lee.
//
// Todo el cálculo lo hace `crm_sla_barrer()` en la base, y eso no es elegancia:
// el plazo lo calculó la base, así que quien decida si venció tiene que ser la
// misma aritmética. Un barrido que recalculara los plazos en JavaScript podría
// marcar incumplido a alguien que la base considera a tiempo.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Sb = any

export interface CasoVencido {
  numero: string
  que: 'PRIMERA' | 'RESOLUCION' | 'AMBOS'
}

export interface ResultadoBarrido {
  incumplidos: number
  casos: CasoVencido[]
}

/**
 * Marca los SLA vencidos y dispara `CRM_SLA_INCUMPLIDO`, una vez por caso.
 *
 * Respeta la pausa: un reloj parado no vence. Y no responde, no escala y no
 * reasigna — avisa. Nada de este módulo manda un mensaje sin que una persona lo
 * apruebe.
 */
export async function barrerSlaCrm(supabase: Sb, limite = 200): Promise<ResultadoBarrido> {
  const { data, error } = await supabase.rpc('crm_sla_barrer', { p_limite: limite })
  if (error) throw new Error(error.message)

  const filas = (data ?? []) as { caso_id: string; numero: string; que: CasoVencido['que'] }[]
  return {
    incumplidos: filas.length,
    // El número del caso y qué venció, nada más: esto queda en los registros de
    // Vercel y un `CS-00012` no es dato personal, pero el asunto de una
    // conversación sí puede serlo.
    casos: filas.map((f) => ({ numero: f.numero, que: f.que })),
  }
}
