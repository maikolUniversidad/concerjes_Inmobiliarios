import 'server-only'

// Acceso a datos de /q/<token> contra Supabase (F2). La decisión de qué se abre
// y qué se rechaza está en ./decidir.ts; esto solo trae filas.
//
// Por qué va con la llave de SERVICIO y no con la sesión del usuario: la página
// es PÚBLICA. Quien escanea puede no tener sesión todavía (el enlace + PIN del
// ADR-A es de F4), así que no hay JWT con el que la RLS pueda filtrar. La
// autoridad de esta página es la FIRMA del token, no una cookie: sin firma
// válida no se devuelve nada, y lo que se devuelve con firma válida es lo que ya
// está impreso en la placa más el nombre del punto y el de la sede.

import { getAdmin } from '@/lib/supabase/admin'
import type {
  EventoAuditoria, FilaPunto, FilaQr, PuertaDatos,
} from './decidir'

export function puertaSupabase(): PuertaDatos {
  const sb = getAdmin()
  return {
    async buscarQr(porToken, codigo) {
      const { data, error } = await sb
        .from('ronda_qr')
        .select('id, punto_id, grupo_id, sede_id, version, estado, firma_llave_id, codigo_manual')
        .eq(porToken ? 'token' : 'codigo_manual', codigo)
        .maybeSingle()
      if (error) throw new Error(`No se pudo resolver el código: ${error.message}`)
      return (data as FilaQr | null) ?? null
    },

    async qrVigente(qrId) {
      const { data, error } = await sb.rpc('ronda_qr_vigente', { p_qr: qrId })
      if (error) throw new Error(`No se pudo verificar la vigencia: ${error.message}`)
      return data === true
    },

    async buscarPunto(puntoId) {
      const { data, error } = await sb
        .from('ronda_puntos')
        .select(`id, codigo, nombre, descripcion, piso, estado, exige_geocerca, geocerca_metros,
                 sede_nombre, zona:ronda_zonas ( nombre ), sede:sedes ( nombre, ciudad, direccion )`)
        .eq('id', puntoId)
        .maybeSingle()
      if (error) throw new Error(`No se pudo leer el punto: ${error.message}`)
      if (!data) return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = data as any
      const fila: FilaPunto = {
        id: p.id,
        codigo: p.codigo,
        nombre: p.nombre,
        descripcion: p.descripcion,
        piso: p.piso,
        estado: p.estado,
        exige_geocerca: p.exige_geocerca,
        geocerca_metros: Number(p.geocerca_metros),
        zona_nombre: p.zona?.nombre ?? null,
        sede_nombre: p.sede?.nombre ?? p.sede_nombre ?? '',
        sede_ciudad: p.sede?.ciudad ?? null,
        sede_direccion: p.sede?.direccion ?? null,
      }
      return fila
    },

    async registrarEvento(e: EventoAuditoria) {
      const { error } = await sb.from('ronda_eventos').insert(e)
      if (error) throw new Error(error.message)
    },
  }
}
