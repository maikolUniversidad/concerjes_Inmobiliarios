'use client'
import { useMemo, useRef, useState } from 'react'
import {
  Download, Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle,
  Plus, RefreshCw, X, ArrowRight, Copy, Info, MinusCircle,
} from 'lucide-react'
import {
  validarLote, type EntityConfig, type EstadoFila, type FilaValidada,
} from '@/lib/import/config'
import {
  descargarPlantilla, parsearArchivo, descargarInformeCarga,
} from '@/lib/import/xlsx-client'
import { importarEntidad, type ImportResult, type FilaCommit } from '@/app/(dashboard)/importar/actions'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

const ESTADO_META: Record<EstadoFila, { label: string; cls: string }> = {
  nuevo: { label: 'Nuevo', cls: 'bg-green-100 text-green-700' },
  actualizar: { label: 'Actualizar', cls: 'bg-blue-100 text-blue-700' },
  error: { label: 'Error', cls: 'bg-red-100 text-red-700' },
  duplicado: { label: 'Repetida', cls: 'bg-amber-100 text-amber-700' },
  omitido: { label: 'Ejemplo', cls: 'bg-gray-100 text-gray-500' },
}

interface Columnas { reconocidas: string[]; desconocidas: string[]; faltantes: string[] }

/** Muestra el valor ya interpretado (SI/NO en vez de true/false, o un guion si no vino). */
function formatoCelda(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'SI' : 'NO'
  if (typeof v === 'number') return v.toLocaleString('es-CO')
  return String(v)
}

export function BulkImport({ config, existentes }: { config: EntityConfig; existentes: string[] }) {
  const existSet = useMemo(() => new Set(existentes), [existentes])
  const [filas, setFilas] = useState<FilaValidada[] | null>(null)
  const [columnas, setColumnas] = useState<Columnas | null>(null)
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [committing, setCommitting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const resumen = useMemo(() => {
    const base = { nuevo: 0, actualizar: 0, error: 0, duplicado: 0, omitido: 0 }
    for (const f of filas ?? []) base[f.estado]++
    return base
  }, [filas])

  const aCargar = resumen.nuevo + resumen.actualizar

  async function onFile(file: File) {
    setParsing(true); setParseError(''); setResult(null); setFilas(null); setColumnas(null); setFileName(file.name)
    try {
      const archivo = await parsearArchivo(file, config)
      setColumnas({
        reconocidas: archivo.reconocidas,
        desconocidas: archivo.desconocidas,
        faltantes: archivo.faltantes,
      })
      if (archivo.reconocidas.length === 0) {
        setParseError('No se reconoció ninguna columna. Revisa que la primera fila tenga los encabezados de la plantilla.')
        return
      }
      if (archivo.filas.length === 0) { setParseError('El archivo no tiene filas de datos.'); return }
      setFilas(validarLote(config, archivo.filas, existSet).filas)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'No se pudo leer el archivo.')
    } finally {
      setParsing(false)
    }
  }

  async function confirmar() {
    if (!filas) return
    const validas = filas.filter(f => f.estado === 'nuevo' || f.estado === 'actualizar')
    if (validas.length === 0) return
    setCommitting(true)
    const commit: FilaCommit[] = validas.map(f => ({ fila: f.fila, clave: f.claveMostrada, datos: f.datos }))
    const res = await importarEntidad(config.id, commit, fileName)
    setResult(res)
    setCommitting(false)
  }

  function reset() {
    setFilas(null); setResult(null); setFileName(''); setParseError(''); setColumnas(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const keyCols = config.columns.slice(0, 4)

  // Columnas de la vista previa: fila, estado, las 4 claves del archivo y la nota.
  const columnasPreview = useMemo<ColumnaTabla<FilaValidada>[]>(() => {
    const notaDe = (f: FilaValidada) =>
      f.errores.length
        ? f.errores.join(' · ')
        : f.avisos.length
          ? f.avisos.join(' · ')
          : f.estado === 'actualizar'
            ? 'Se actualizará solo con las columnas del archivo'
            : ''
    return [
      { id: 'fila', header: 'Fila', valor: (f) => f.fila, ancho: 'w-16', className: 'font-mono text-xs text-gray-400', tarjeta: 'meta' },
      {
        id: 'estado', header: 'Estado', valor: (f) => ESTADO_META[f.estado].label, tarjeta: 'badge',
        celda: (f) => {
          const meta = ESTADO_META[f.estado]
          return <span className={`font-body text-xs font-medium px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
        },
      },
      ...keyCols.map((c, i): ColumnaTabla<FilaValidada> => ({
        id: c.key,
        header: c.label,
        valor: (f) => formatoCelda(f.datos[c.key]),
        ancho: 'max-w-[200px]',
        className: 'truncate text-gray-700',
        prioridad: i === 0 ? 1 : i < 2 ? 2 : 3,
        tarjeta: i === 0 ? 'titulo' : i === 1 ? 'subtitulo' : 'meta',
      })),
      {
        id: 'nota', header: 'Observaciones', valor: notaDe, tarjeta: 'cuerpo',
        celda: (f) => <span className={f.errores.length ? 'text-red-600' : 'text-gray-400'}>{notaDe(f)}</span>,
        className: 'text-xs',
      },
    ]
  }, [keyCols])

  return (
    <div className="space-y-5">
      {/* Paso 1: plantilla */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <h3 className="font-heading font-semibold text-gray-900 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-brand-green text-white text-xs flex items-center justify-center font-bold">1</span>
              Descarga la plantilla
            </h3>
            <p className="font-body text-sm text-gray-500 mt-1 ml-8">
              Incluye los encabezados, una fila de ejemplo y una hoja de instrucciones. Clave para no duplicar: <strong>{config.matchLabel}</strong>.
            </p>
          </div>
          <button onClick={() => descargarPlantilla(config)}
            className="flex items-center gap-2 border border-brand-green text-brand-green font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-green-50 transition-colors">
            <Download className="w-4 h-4" /> Plantilla {config.label}
          </button>
        </div>
      </div>

      {/* Paso 2: subir */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <h3 className="font-heading font-semibold text-gray-900 flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-brand-green text-white text-xs flex items-center justify-center font-bold">2</span>
          Sube tu archivo (.xlsx o .csv)
        </h3>
        <div
          onClick={() => inputRef.current?.click()}
          className="ml-8 border-2 border-dashed border-gray-200 rounded-xl py-8 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-brand-green hover:bg-green-50/40 transition-colors"
        >
          {parsing ? <Loader2 className="w-8 h-8 text-brand-green animate-spin" /> : <Upload className="w-8 h-8 text-gray-300" />}
          <p className="font-body text-sm text-gray-600">{fileName || 'Haz clic o arrastra el archivo aquí'}</p>
          <p className="font-body text-xs text-gray-400">Formatos: Excel (.xlsx) o CSV</p>
        </div>
        <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
        {parseError && (
          <div className="ml-8 mt-3 flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="font-body text-sm text-red-700">{parseError}</p>
          </div>
        )}

        {columnas && (columnas.faltantes.length > 0 || columnas.desconocidas.length > 0) && (
          <div className="ml-8 mt-3 space-y-2">
            {columnas.faltantes.length > 0 && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="font-body text-sm text-red-700">
                  Faltan columnas obligatorias: <strong>{columnas.faltantes.join(', ')}</strong>.
                  Descarga la plantilla y copia sus encabezados.
                </p>
              </div>
            )}
            {columnas.desconocidas.length > 0 && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="font-body text-sm text-amber-800">
                  Estas columnas del archivo no se usan y se ignoran:{' '}
                  <strong>{columnas.desconocidas.join(', ')}</strong>.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Paso 3: preview */}
      {filas && !result && (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <h3 className="font-heading font-semibold text-gray-900 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-brand-green text-white text-xs flex items-center justify-center font-bold">3</span>
              Vista previa ({filas.length} filas)
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 font-body text-xs font-semibold px-2.5 py-1 rounded-full"><Plus className="w-3 h-3" /> {resumen.nuevo} nuevos</span>
              <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 font-body text-xs font-semibold px-2.5 py-1 rounded-full"><RefreshCw className="w-3 h-3" /> {resumen.actualizar} a actualizar</span>
              {resumen.duplicado > 0 && <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 font-body text-xs font-semibold px-2.5 py-1 rounded-full"><Copy className="w-3 h-3" /> {resumen.duplicado} repetidas</span>}
              {resumen.omitido > 0 && <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-500 font-body text-xs font-semibold px-2.5 py-1 rounded-full"><MinusCircle className="w-3 h-3" /> {resumen.omitido} omitidas</span>}
              {resumen.error > 0 && <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 font-body text-xs font-semibold px-2.5 py-1 rounded-full"><X className="w-3 h-3" /> {resumen.error} con error</span>}
            </div>
          </div>

          <div className="p-4">
            <TablaEstandar
              id={`import-preview-${config.id}`}
              titulo={`Vista previa · ${config.label}`}
              modulo="Sistema"
              entidad={config.id}
              datos={filas}
              columnas={columnasPreview}
              filaId={(f) => String(f.fila)}
              busqueda="Buscar en la vista previa…"
              filasPorPagina={100}
              filaClassName={(f) => (
                f.estado === 'error' ? 'bg-red-50/30'
                  : f.estado === 'duplicado' ? 'bg-amber-50/40'
                  : f.estado === 'omitido' ? 'opacity-50' : ''
              )}
              vacio={<p className="font-body text-sm text-gray-400">El archivo no trae filas.</p>}
            />
          </div>

          <div className="p-5 border-t border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <button onClick={reset} className="font-body text-sm text-gray-500 hover:text-gray-700">Cambiar archivo</button>
            <button onClick={confirmar} disabled={committing || aCargar === 0}
              className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark transition-colors disabled:opacity-50">
              {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {committing ? 'Procesando...' : `Confirmar carga de ${aCargar} filas`}
            </button>
          </div>
          {(resumen.error > 0 || resumen.duplicado > 0) && (
            <p className="px-5 pb-4 -mt-2 font-body text-xs text-gray-400">
              {resumen.error > 0 && 'Las filas con error se omiten; corrígelas y vuelve a subir el archivo. '}
              {resumen.duplicado > 0 && 'De cada clave repetida se carga solo la primera aparición.'}
            </p>
          )}
        </div>
      )}

      {/* Resultado */}
      {result && (
        <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm space-y-4">
          {result.ok ? (
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="w-6 h-6" />
              <h3 className="font-heading font-bold text-lg">Carga completada</h3>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-red-700">
              <AlertCircle className="w-6 h-6" />
              <h3 className="font-heading font-bold text-lg">{result.error ?? 'La carga falló'}</h3>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-green-100 bg-green-50 p-4 text-center">
              <p className="font-heading font-bold text-2xl text-green-700">{result.creados}</p>
              <p className="font-body text-xs text-green-600">Creados</p>
            </div>
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-center">
              <p className="font-heading font-bold text-2xl text-blue-700">{result.actualizados}</p>
              <p className="font-body text-xs text-blue-600">Actualizados</p>
            </div>
            <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-center">
              <p className="font-heading font-bold text-2xl text-red-700">{result.errores}</p>
              <p className="font-body text-xs text-red-600">Errores</p>
            </div>
          </div>

          {result.detalle.filter(d => d.accion === 'error').length > 0 && (
            <div className="border border-red-100 rounded-xl overflow-hidden">
              <p className="bg-red-50 px-3 py-2 font-body text-xs font-semibold text-red-700">Filas con error</p>
              <div className="max-h-48 overflow-y-auto divide-y divide-gray-50">
                {result.detalle.filter(d => d.accion === 'error').map((d, i) => (
                  <div key={i} className="px-3 py-2 flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-gray-400">Fila {d.fila} · {d.clave}</span>
                    <span className="font-body text-xs text-red-600">{d.error}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={reset} className="flex items-center gap-2 border border-gray-200 text-gray-600 font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-gray-50">
              <FileSpreadsheet className="w-4 h-4" /> Cargar otro archivo
            </button>
            {result.detalle.length > 0 && (
              <button onClick={() => descargarInformeCarga(config, fileName, result.detalle)}
                className="flex items-center gap-2 border border-brand-green text-brand-green font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-green-50">
                <Download className="w-4 h-4" /> Descargar informe
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
