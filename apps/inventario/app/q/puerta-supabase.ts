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
  EventoAuditoria, FilaActivo, FilaPunto, FilaQr, PuertaDatos,
} from './decidir'

export function puertaSupabase(): PuertaDatos {
  const sb = getAdmin()
  return {
    async buscarQr(porToken, codigo) {
      const { data, error } = await sb
        .from('ronda_qr')
        // `tipo_objeto` y `activo_id` entran en F6: son los que dicen si la
        // placa es de un punto o de un activo del cliente.
        .select('id, punto_id, activo_id, tipo_objeto, grupo_id, sede_id, version, estado, firma_llave_id, codigo_manual')
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

    // ── F6: el activo del cliente ────────────────────────────────────────────
    async buscarActivo(activoId) {
      const { data, error } = await sb
        .from('activos')
        .select(`id, codigo, nombre, descripcion, estado, ubicacion_texto, piso,
                 marca, modelo, sede_nombre,
                 tipo:activo_tipos ( nombre ),
                 zona:ronda_zonas ( nombre ),
                 sede:sedes ( nombre, ciudad, direccion )`)
        .eq('id', activoId)
        .maybeSingle()
      if (error) throw new Error(`No se pudo leer el activo: ${error.message}`)
      if (!data) return null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = data as any
      const fila: FilaActivo = {
        id: a.id,
        codigo: a.codigo,
        nombre: a.nombre,
        descripcion: a.descripcion,
        estado: a.estado,
        ubicacion_texto: a.ubicacion_texto,
        piso: a.piso,
        marca: a.marca,
        modelo: a.modelo,
        tipo_nombre: a.tipo?.nombre ?? null,
        zona_nombre: a.zona?.nombre ?? null,
        sede_nombre: a.sede?.nombre ?? a.sede_nombre ?? '',
        sede_ciudad: a.sede?.ciudad ?? null,
        sede_direccion: a.sede?.direccion ?? null,
      }
      return fila
    },

    async activosDePunto(puntoId) {
      // Solo los que están en uso y no retirados: la placa del punto no tiene
      // por qué listar un equipo que ya salió de la operación. El tope de 20 es
      // lo que cabe en una pantalla de celular.
      const { data, error } = await sb
        .from('activos')
        .select('id, codigo, nombre, tipo:activo_tipos ( nombre )')
        .eq('punto_id', puntoId)
        .eq('activo', true)
        .neq('estado', 'RETIRADO')
        .order('codigo')
        .limit(20)
      if (error) throw new Error(`No se pudieron leer los activos del punto: ${error.message}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((a) => ({
        id: a.id, codigo: a.codigo, nombre: a.nombre, tipo_nombre: a.tipo?.nombre ?? null,
      }))
    },

    async registrarEvento(e: EventoAuditoria) {
      const { error } = await sb.from('ronda_eventos').insert(e)
      if (error) throw new Error(error.message)
    },
  }
}
