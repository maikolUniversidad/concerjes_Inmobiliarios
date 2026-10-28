import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso, getPermisosUsuario } from '@/lib/permisos-server'
import { llaveActual, secretoDeLlave } from '@/lib/puntos-qr-firma'
import type {
  Criticidad, EstadoActivo, OrigenLectura, TipoDocumentoActivo, TipoMedidor,
} from '@/lib/activos'
import {
  FichaActivo, type DocumentoFila, type LecturaFila, type MedidorFila, type QrFila,
} from './FichaActivo'

export const metadata: Metadata = { title: 'Ficha del activo' }
export const dynamic = 'force-dynamic'

const SELECT_ACTIVO = `
  id, grupo_id, sede_id, zona_id, punto_id, activo_tipo_id, padre_id, codigo,
  clave_publica, nombre, descripcion, marca, modelo, serial, ubicacion_texto,
  piso, fecha_instalacion, garantia_hasta, criticidad, estado, activo,
  observaciones, sede_nombre, created_at,
  tipo:activo_tipos ( codigo, nombre, exige_medidor, medidor_tipo, medidor_unidad,
                      obligatorio_normativo, normativa ),
  zona:ronda_zonas ( nombre, piso ),
  punto:ronda_puntos ( id, codigo, nombre ),
  proveedor:proveedores ( nombre ),
  padre:padre_id ( id, codigo, nombre ),
  contrato:grupos_contrato ( codigo, nombre, estado, arte_color ),
  sede:sedes ( nombre, ciudad, direccion )`

export default async function ActivoFichaPage({
  params,
}: { params: Promise<{ id: string }> }) {
  await requirePermiso('ver_activos_ronda')
  const permisos = await getPermisosUsuario()
  const { id } = await params
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // Si la RLS no deja ver este activo, la consulta devuelve cero filas y la
  // página es un 404: no se distingue "no existe" de "no es de tu contrato",
  // que es justo lo que no hay que revelar.
  const { data: activoRaw } = await sb.from('activos')
    .select(SELECT_ACTIVO).eq('id', id).maybeSingle()
  if (!activoRaw) notFound()

  const [
    { data: hijos }, { data: documentos }, { data: medidores },
    { data: lecturas }, { data: qrs }, { data: ordenes },
  ] = await Promise.all([
    sb.from('activos').select('id, codigo, nombre, estado')
      .eq('padre_id', id).order('codigo'),
    sb.from('activo_documentos')
      .select('id, tipo, nombre, nombre_archivo, archivo_path, mime, tamano, vence_at, notas, created_at')
      .eq('activo_id', id).order('created_at', { ascending: false }).limit(200),
    sb.from('activo_medidores')
      .select('id, codigo, nombre, tipo, unidad, valor_actual, leido_at, acumulativo, decimales, valor_alerta, activo')
      .eq('activo_id', id).order('codigo'),
    // Las últimas 100 y punto: el histórico completo de un medidor de horas de
    // diez años son miles de filas, y Supabase corta a los 8 segundos.
    sb.from('activo_lecturas')
      .select('id, medidor_id, valor, valor_anterior, delta, leido_at, origen, nota, created_at')
      .eq('activo_id', id).order('leido_at', { ascending: false }).limit(100),
    sb.from('ronda_qr')
      .select('id, version, token, codigo_manual, estado, motivo_cambio, instalado_at, impresiones, created_at')
      .eq('activo_id', id).order('version', { ascending: false }),
    // Las órdenes de trabajo del activo (F7). Las últimas 50: el histórico
    // entero de un ascensor a diez años no cabe en los 8 s de Supabase, y la
    // ficha no es el sitio donde se consulta ese histórico.
    sb.from('mantenimiento_tickets')
      .select('id, numero, estado, tipo, titulo, created_at')
      .eq('activo_id', id).order('created_at', { ascending: false }).limit(50),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = activoRaw as any
  const llave = llaveActual()

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <Link href="/rondas/activos"
        className="font-body inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> Activos del cliente
      </Link>

      <FichaActivo
        activo={{
          id: a.id,
          codigo: a.codigo,
          clavePublica: a.clave_publica,
          nombre: a.nombre,
          descripcion: a.descripcion,
          marca: a.marca,
          modelo: a.modelo,
          serial: a.serial,
          ubicacionTexto: a.ubicacion_texto,
          piso: a.piso,
          fechaInstalacion: a.fecha_instalacion,
          garantiaHasta: a.garantia_hasta,
          criticidad: a.criticidad as Criticidad,
          estado: a.estado as EstadoActivo,
          enUso: a.activo,
          observaciones: a.observaciones,
          sedeNombre: a.sede?.nombre ?? a.sede_nombre ?? '',
          sedeCiudad: a.sede?.ciudad ?? null,
          sedeDireccion: a.sede?.direccion ?? null,
          zonaNombre: a.zona?.nombre ?? null,
          puntoId: a.punto?.id ?? null,
          puntoCodigo: a.punto?.codigo ?? null,
          puntoNombre: a.punto?.nombre ?? null,
          tipoNombre: a.tipo?.nombre ?? null,
          tipoExigeMedidor: a.tipo?.exige_medidor ?? false,
          tipoMedidor: (a.tipo?.medidor_tipo ?? null) as TipoMedidor | null,
          tipoMedidorUnidad: a.tipo?.medidor_unidad ?? null,
          tipoNormativa: a.tipo?.obligatorio_normativo ? (a.tipo?.normativa ?? 'Obligatorio por norma') : null,
          proveedorNombre: a.proveedor?.nombre ?? null,
          padre: a.padre ? { id: a.padre.id, codigo: a.padre.codigo, nombre: a.padre.nombre } : null,
          contratoCodigo: a.contrato?.codigo ?? '—',
          contratoNombre: a.contrato?.nombre ?? '',
          contratoEstado: a.contrato?.estado ?? null,
          arteColor: a.contrato?.arte_color ?? null,
        }}
        hijos={(hijos ?? []) as { id: string; codigo: string; nombre: string; estado: EstadoActivo }[]}
        documentos={((documentos ?? []) as Record<string, unknown>[]).map<DocumentoFila>((d) => ({
          id: String(d.id),
          tipo: d.tipo as TipoDocumentoActivo,
          nombre: String(d.nombre),
          nombreArchivo: (d.nombre_archivo as string | null) ?? null,
          archivoPath: String(d.archivo_path),
          mime: (d.mime as string | null) ?? null,
          tamano: d.tamano === null ? null : Number(d.tamano),
          venceAt: (d.vence_at as string | null) ?? null,
          notas: (d.notas as string | null) ?? null,
          createdAt: String(d.created_at),
        }))}
        medidores={((medidores ?? []) as Record<string, unknown>[]).map<MedidorFila>((m) => ({
          id: String(m.id),
          codigo: String(m.codigo),
          nombre: String(m.nombre),
          tipo: m.tipo as TipoMedidor,
          unidad: String(m.unidad),
          // `numeric` de PostgreSQL llega como texto: se convierte aquí para que
          // la pantalla no haga aritmética con cadenas.
          valorActual: Number(m.valor_actual),
          leidoAt: (m.leido_at as string | null) ?? null,
          acumulativo: Boolean(m.acumulativo),
          decimales: Number(m.decimales),
          valorAlerta: m.valor_alerta === null ? null : Number(m.valor_alerta),
          activo: Boolean(m.activo),
        }))}
        lecturas={((lecturas ?? []) as Record<string, unknown>[]).map<LecturaFila>((l) => ({
          id: String(l.id),
          medidorId: String(l.medidor_id),
          valor: Number(l.valor),
          valorAnterior: l.valor_anterior === null ? null : Number(l.valor_anterior),
          delta: l.delta === null ? null : Number(l.delta),
          leidoAt: String(l.leido_at),
          origen: l.origen as OrigenLectura,
          nota: (l.nota as string | null) ?? null,
        }))}
        qrs={((qrs ?? []) as Record<string, unknown>[]).map<QrFila>((q) => ({
          id: String(q.id),
          version: Number(q.version),
          token: String(q.token),
          codigoManual: String(q.codigo_manual),
          estado: String(q.estado) as QrFila['estado'],
          motivoCambio: (q.motivo_cambio as string | null) ?? null,
          impresiones: Number(q.impresiones ?? 0),
          createdAt: String(q.created_at),
        }))}
        baseUrl={process.env.APP_BASE_URL ?? ''}
        // Si no hay llave HMAC configurada en el servidor, la pantalla lo dice
        // en vez de ofrecer un botón que generaría una placa inverificable.
        llaveLista={!!llave && !!secretoDeLlave(llave)}
        llaveId={llave}
        puedeGestionar={permisos.puede('gestionar_activos_ronda')}
        puedeLeer={permisos.puede('registrar_lecturas_activos') || permisos.puede('gestionar_activos_ronda')}
        puedeQr={permisos.puede('gestionar_qr_ronda')}
        // F7: desde aquí entra el mantenimiento del activo. Las claves son las
        // del módulo de mantenimiento, no las de activos: quien ve la ficha no
        // tiene por qué poder reportar, y al revés tampoco.
        puedeReportarFalla={permisos.puede('reportar_falla_maquinaria')
          || permisos.puede('atender_mantenimiento')
          || permisos.puede('gestionar_mantenimiento')
          || permisos.puede('ejecutar_rondas')}
        puedeVerMantenimiento={permisos.puede('ver_mantenimiento')
          || permisos.puede('atender_mantenimiento')
          || permisos.puede('gestionar_mantenimiento')}
        ordenes={(ordenes ?? []).map((o: Record<string, unknown>) => ({
          id: String(o.id),
          numero: String(o.numero),
          estado: String(o.estado),
          tipo: String(o.tipo),
          titulo: String(o.titulo),
          createdAt: String(o.created_at),
        }))}
      />
    </div>
  )
}
