import type { Metadata } from 'next'
import { Cog } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso, getPermisosUsuario } from '@/lib/permisos-server'
import type {
  CategoriaActivo, Criticidad, EstadoActivo, TipoMedidor,
} from '@/lib/activos'
import {
  ActivosClient, type ActivoFila, type OpcionSede, type OpcionZona,
  type OpcionPunto, type TipoActivoFila,
} from './ActivosClient'

export const metadata: Metadata = { title: 'Activos del cliente' }
export const dynamic = 'force-dynamic'

interface SedeRaw {
  id: string; nombre: string; ciudad: string | null; grupo_id: string
  grupo: { codigo: string; nombre: string; estado: string | null } | null
}
interface TipoRaw {
  id: string; grupo_id: string | null; codigo: string; nombre: string
  descripcion: string | null; categoria: CategoriaActivo; icono: string | null
  criticidad_sugerida: Criticidad; vida_util_meses: number | null
  exige_medidor: boolean; medidor_tipo: TipoMedidor | null; medidor_unidad: string | null
  obligatorio_normativo: boolean; normativa: string | null
  orden: number; activo: boolean
  contrato: { codigo: string } | null
}
interface ActivoRaw {
  id: string; grupo_id: string; sede_id: string; zona_id: string | null
  punto_id: string | null; activo_tipo_id: string | null; padre_id: string | null
  codigo: string; nombre: string; descripcion: string | null
  marca: string | null; modelo: string | null; serial: string | null
  ubicacion_texto: string | null; piso: string | null
  fecha_instalacion: string | null; garantia_hasta: string | null
  proveedor_id: string | null; criticidad: Criticidad; estado: EstadoActivo
  activo: boolean; sede_nombre: string | null
  tipo: { codigo: string; nombre: string } | null
  zona: { nombre: string } | null
  punto: { codigo: string; nombre: string } | null
  // Conteos en SQL, no trayendo filas: Supabase corta a los 8 segundos.
  activo_medidores: { count: number }[] | null
  activo_documentos: { count: number }[] | null
  ronda_qr: { id: string; estado: string; version: number; codigo_manual: string }[] | null
}
interface ProveedorRaw { id: string; nombre: string }

export default async function ActivosPage() {
  await requirePermiso('ver_activos_ronda')
  const permisos = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // La RLS decide el alcance: cada quien ve los activos de los contratos a los
  // que alcanza (auth_grupos()); un ADMIN ve todos. Aquí no se filtra por
  // contrato a mano — hacerlo duplicaría la regla y la dejaría desincronizada.
  const [sedesRaw, tiposRaw, activosRaw, zonasRaw, puntosRaw, proveedoresRaw] = await Promise.all([
    traerTodo<SedeRaw>((desde, hasta) => sb.from('sedes')
      .select('id, nombre, ciudad, grupo_id, grupo:grupos_contrato ( codigo, nombre, estado )')
      .eq('activo', true)
      .order('nombre').order('id').range(desde, hasta), { etiqueta: 'sedes' }),
    traerTodo<TipoRaw>((desde, hasta) => sb.from('activo_tipos')
      .select(`id, grupo_id, codigo, nombre, descripcion, categoria, icono,
               criticidad_sugerida, vida_util_meses, exige_medidor, medidor_tipo,
               medidor_unidad, obligatorio_normativo, normativa, orden, activo,
               contrato:grupos_contrato ( codigo )`)
      .order('orden').order('nombre').order('id').range(desde, hasta),
      { etiqueta: 'tipos de activo' }),
    traerTodo<ActivoRaw>((desde, hasta) => sb.from('activos')
      .select(`id, grupo_id, sede_id, zona_id, punto_id, activo_tipo_id, padre_id,
               codigo, nombre, descripcion, marca, modelo, serial, ubicacion_texto,
               piso, fecha_instalacion, garantia_hasta, proveedor_id, criticidad,
               estado, activo, sede_nombre,
               tipo:activo_tipos ( codigo, nombre ),
               zona:ronda_zonas ( nombre ),
               punto:ronda_puntos ( codigo, nombre ),
               activo_medidores ( count ),
               activo_documentos ( count ),
               ronda_qr ( id, estado, version, codigo_manual )`)
      // Orden estable por sede + código + id: `traerTodo` pagina con OFFSET, y
      // sin un orden único las páginas repiten o pierden filas.
      .order('sede_nombre').order('codigo').order('id')
      .range(desde, hasta), { etiqueta: 'activos' }),
    traerTodo<{ id: string; sede_id: string; nombre: string; piso: string | null }>(
      (desde, hasta) => sb.from('ronda_zonas')
        .select('id, sede_id, nombre, piso')
        .eq('activo', true)
        .order('orden').order('nombre').order('id').range(desde, hasta), { etiqueta: 'zonas' }),
    traerTodo<{ id: string; sede_id: string; codigo: string; nombre: string }>(
      (desde, hasta) => sb.from('ronda_puntos')
        .select('id, sede_id, codigo, nombre')
        .neq('estado', 'RETIRADO')
        .order('codigo').order('id').range(desde, hasta), { etiqueta: 'puntos' }),
    traerTodo<ProveedorRaw>((desde, hasta) => sb.from('proveedores')
      .select('id, nombre').eq('activo', true)
      .order('nombre').order('id').range(desde, hasta), { etiqueta: 'proveedores' }),
  ])

  const sedes: OpcionSede[] = sedesRaw.map((s) => ({
    id: s.id,
    nombre: s.nombre,
    ciudad: s.ciudad,
    contrato: s.grupo?.codigo ?? '—',
    contratoNombre: s.grupo?.nombre ?? '',
    contratoEstado: s.grupo?.estado ?? null,
    grupoId: s.grupo_id,
  }))

  const tipos: TipoActivoFila[] = tiposRaw.map((t) => ({
    id: t.id,
    grupoId: t.grupo_id,
    contrato: t.contrato?.codigo ?? null,
    codigo: t.codigo,
    nombre: t.nombre,
    descripcion: t.descripcion,
    categoria: t.categoria,
    icono: t.icono,
    criticidadSugerida: t.criticidad_sugerida,
    vidaUtilMeses: t.vida_util_meses,
    exigeMedidor: t.exige_medidor,
    medidorTipo: t.medidor_tipo,
    medidorUnidad: t.medidor_unidad,
    obligatorioNormativo: t.obligatorio_normativo,
    normativa: t.normativa,
    orden: t.orden,
    activo: t.activo,
    activos: activosRaw.filter((a) => a.activo_tipo_id === t.id).length,
  }))

  const activos: ActivoFila[] = activosRaw.map((a) => {
    const qrActivo = (a.ronda_qr ?? []).find((q) => q.estado === 'ACTIVO') ?? null
    return {
      id: a.id,
      grupoId: a.grupo_id,
      sedeId: a.sede_id,
      sedeNombre: a.sede_nombre ?? sedes.find((s) => s.id === a.sede_id)?.nombre ?? '',
      zonaId: a.zona_id,
      zonaNombre: a.zona?.nombre ?? null,
      puntoId: a.punto_id,
      puntoCodigo: a.punto?.codigo ?? null,
      tipoId: a.activo_tipo_id,
      tipoNombre: a.tipo?.nombre ?? null,
      padreId: a.padre_id,
      codigo: a.codigo,
      nombre: a.nombre,
      descripcion: a.descripcion,
      marca: a.marca,
      modelo: a.modelo,
      serial: a.serial,
      ubicacionTexto: a.ubicacion_texto,
      piso: a.piso,
      fechaInstalacion: a.fecha_instalacion,
      garantiaHasta: a.garantia_hasta,
      proveedorId: a.proveedor_id,
      criticidad: a.criticidad,
      estado: a.estado,
      activo: a.activo,
      medidores: a.activo_medidores?.[0]?.count ?? 0,
      documentos: a.activo_documentos?.[0]?.count ?? 0,
      qrVersiones: (a.ronda_qr ?? []).length,
      qrActivo: qrActivo
        ? { id: qrActivo.id, version: Number(qrActivo.version), codigoManual: qrActivo.codigo_manual }
        : null,
    }
  })

  const conQr = activos.filter((a) => a.qrActivo).length

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="font-heading flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Cog className="h-6 w-6 text-brand-green" /> Activos del cliente
        </h1>
        <p className="font-body mt-0.5 text-sm text-gray-500">
          {activos.length} activos en {new Set(activos.map((a) => a.sedeId)).size} sedes ·{' '}
          {conQr} con código QR activo · lo que se mantiene en la sede del cliente mientras dure
          el contrato: extintores, ascensores, bombas, luminarias. El equipo propio de la empresa
          va en Maquinaria, que es otro módulo.
        </p>
      </div>

      <ActivosClient
        sedes={sedes}
        tipos={tipos}
        activos={activos}
        zonas={zonasRaw.map<OpcionZona>((z) => ({
          id: z.id, sedeId: z.sede_id, nombre: z.nombre, piso: z.piso,
        }))}
        puntos={puntosRaw.map<OpcionPunto>((p) => ({
          id: p.id, sedeId: p.sede_id, codigo: p.codigo, nombre: p.nombre,
        }))}
        proveedores={proveedoresRaw.map((p) => ({ id: p.id, nombre: p.nombre }))}
        contratos={sedes
          .filter((s, i, xs) => xs.findIndex((o) => o.grupoId === s.grupoId) === i)
          .map((s) => ({ id: s.grupoId, codigo: s.contrato, nombre: s.contratoNombre }))}
        puedeGestionar={permisos.puede('gestionar_activos_ronda')}
      />
    </div>
  )
}
