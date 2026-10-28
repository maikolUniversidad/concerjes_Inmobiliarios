import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso, getPermisosUsuario } from '@/lib/permisos-server'
import { caudalConfigurado } from '@/lib/whatsapp/caudal'
import { simuladorActivo } from '@/lib/whatsapp/config'
import {
  EnviosClient,
  type EnvioResumen,
  type OpcionMenu,
  type ContratoFila,
  type SedeFila,
  type PlantillaFila,
  type CargoFila,
} from './EnviosClient'

export const metadata: Metadata = { title: 'Envíos masivos de WhatsApp' }
export const dynamic = 'force-dynamic'

/**
 * Envíos masivos de WhatsApp y menú del bot (Puntos QR F10).
 *
 * TODO SE CUENTA EN SQL. Un envío a una sede entera son miles de filas, y
 * Supabase corta a los 8 segundos: los totales por estado salen de la vista
 * `crm_envios_resumen`, que agrupa en la base, y los destinos se miran de a
 * páginas con una acción, nunca todos.
 *
 * Lo que la pantalla tiene que dejar claro antes de confirmar: A CUÁNTAS
 * PERSONAS le va a llegar, a cuántas NO y por qué, cuánto va a costar, y cuánto
 * va a tardar al caudal del número. Un botón que dice «enviar» sin eso es un
 * botón que un día le escribe a 6.000 personas por error.
 */
export default async function EnviosPage() {
  await requirePermiso('ver_envios_whatsapp')
  const permisos = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [envios, menu, contratos, sedes, plantillas, cargos] = await Promise.all([
    // Los 50 envíos más recientes, con sus destinos contados en SQL.
    sb.from('crm_envios_resumen').select('*').order('created_at', { ascending: false }).limit(50),
    sb.from('crm_menu_opciones')
      .select('id, grupo_id, cargo, orden, etiqueta, descripcion, accion, texto, requiere_permiso, activo')
      .order('grupo_id', { ascending: true, nullsFirst: true })
      .order('cargo', { ascending: true, nullsFirst: true })
      .order('orden'),
    // Solo los contratos que habilitaron WhatsApp: ofrecer los otros sería
    // ofrecer un envío que la base va a rechazar.
    sb.from('grupos_contrato')
      .select('id, codigo, nombre, estado, reglas:grupo_reglas ( permite_whatsapp, mensajeria_desde, mensajeria_hasta )')
      .eq('activo', true)
      .order('nombre'),
    sb.from('sedes').select('id, nombre, grupo_id').eq('activo', true).order('nombre'),
    sb.from('whatsapp_plantillas')
      .select('id, nombre, categoria, estado, cuerpo, variables')
      .order('estado')
      .order('nombre'),
    // Los cargos que de verdad existen en la nómina, contados en SQL: son el
    // «rol» por el que se filtra una audiencia.
    sb.from('crm_cargos_audiencia')
      .select('cargo, grupo_id, personas, alcanzables')
      .order('cargo'),
  ])

  return (
    <EnviosClient
      envios={(envios.data ?? []) as EnvioResumen[]}
      menu={(menu.data ?? []) as OpcionMenu[]}
      contratos={(contratos.data ?? []) as ContratoFila[]}
      sedes={(sedes.data ?? []) as SedeFila[]}
      plantillas={(plantillas.data ?? []) as PlantillaFila[]}
      cargos={(cargos.data ?? []) as CargoFila[]}
      simulador={simuladorActivo()}
      caudalMps={caudalConfigurado()}
      puedeGestionar={permisos.puede('gestionar_envios_whatsapp')}
      puedeMenu={permisos.puede('gestionar_menu_whatsapp')}
      puedeEmergencia={permisos.puede('gestionar_whatsapp')}
    />
  )
}
