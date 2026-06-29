'use client'
import { useMemo, useRef, useState } from 'react'
import {
  Download, Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle,
  Plus, RefreshCw, X, ArrowRight,
} from 'lucide-react'
import {
  validarFila, normalizaClave, type EntityConfig, type FilaValidada,
} from '@/lib/import/config'
import { descargarPlantilla, parsearArchivo } from '@/lib/import/xlsx-client'
import { importarEntidad, type ImportResult, type FilaCommit } from '@/app/(dashboard)/importar/actions'

const ESTADO_META = {
  nuevo: { label: 'Nuevo', cls: 'bg-green-100 text-green-700' },
  actualizar: { label: 'Actualizar', cls: 'bg-blue-100 text-blue-700' },
  error: { label: 'Error', cls: 'bg-red-100 text-red-700' },
}

export function BulkImport({ config, existentes }: { config: EntityConfig; existentes: string[] }) {
  const existSet = useMemo(() => new Set(existentes), [existentes])
  const [filas, setFilas] = useState<FilaValidada[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [committing, setCommitting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const resumen = useMemo(() => {
    if (!filas) return { nuevos: 0, actualizar: 0, errores: 0 }
    return {
      nuevos: filas.filter(f => f.estado === 'nuevo').length,
      actualizar: filas.filter(f => f.estado === 'actualizar').length,
      errores: filas.filter(f => f.estado === 'error').length,
    }
  }, [filas])

  async function onFile(file: File) {
    setParsing(true); setParseError(''); setResult(null); setFilas(null); setFileName(file.name)
    try {
      const crudas = await parsearArchivo(file, config)
      if (crudas.length === 0) { setParseError('El archivo no tiene filas de datos.'); return }
      setFilas(crudas.map(c => validarFila(config, c, existSet)))
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'No se pudo leer el archivo.')
    } finally {
      setParsing(false)
    }
  }

  async function confirmar() {
    if (!filas) return
    const validas = filas.filter(f => f.estado !== 'error')
    if (validas.length === 0) return
    setCommitting(true)
    const commit: FilaCommit[] = validas.map(f => ({ fila: f.fila, clave: f.claveMostrada, datos: f.datos }))
    const res = await importarEntidad(config.id, commit, fileName)
    setResult(res)
    setCommitting(false)
  }

  function reset() { setFilas(null); setResult(null); setFileName(''); setParseError(''); if (inputRef.current) inputRef.current.value = '' }

  const keyCols = config.columns.slice(0, 4)

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
      </div>

      {/* Paso 3: preview */}
      {filas && !result && (
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <h3 className="font-heading font-semibold text-gray-900 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-brand-green text-white text-xs flex items-center justify-center font-bold">3</span>
              Vista previa ({filas.length} filas)
            </h3>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 font-body text-xs font-semibold px-2.5 py-1 rounded-full"><Plus className="w-3 h-3" /> {resumen.nuevos} nuevos</span>
              <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 font-body text-xs font-semibold px-2.5 py-1 rounded-full"><RefreshCw className="w-3 h-3" /> {resumen.actualizar} a actualizar</span>
              {resumen.errores > 0 && <span className="inline-flex items-center gap-1 bg-red-100 text-red-700 font-body text-xs font-semibold px-2.5 py-1 rounded-full"><X className="w-3 h-3" /> {resumen.errores} con error</span>}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[460px]">
            <table className="w-full">
              <thead className="sticky top-0 bg-gray-50">
                <tr className="border-b border-gray-100">
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2">Fila</th>
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2">Estado</th>
                  {keyCols.map(c => <th key={c.key} className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2">{c.label}</th>)}
                  <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-3 py-2">Observaciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filas.map((f, i) => {
                  const meta = ESTADO_META[f.estado]
                  return (
                    <tr key={i} className={f.estado === 'error' ? 'bg-red-50/30' : ''}>
                      <td className="px-3 py-2 font-mono text-xs text-gray-400">{f.fila}</td>
                      <td className="px-3 py-2"><span className={`font-body text-xs font-medium px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span></td>
                      {keyCols.map(c => <td key={c.key} className="px-3 py-2 font-body text-sm text-gray-700 max-w-[200px] truncate">{String(f.datos[c.key] ?? '—')}</td>)}
                      <td className="px-3 py-2 font-body text-xs text-red-600">{f.errores.join(' · ') || (f.estado === 'actualizar' ? 'Se actualizará el existente' : '')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="p-5 border-t border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <button onClick={reset} className="font-body text-sm text-gray-500 hover:text-gray-700">Cambiar archivo</button>
            <button onClick={confirmar} disabled={committing || (resumen.nuevos + resumen.actualizar) === 0}
              className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark transition-colors disabled:opacity-50">
              {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {committing ? 'Procesando...' : `Confirmar carga de ${resumen.nuevos + resumen.actualizar} filas`}
            </button>
          </div>
          {resumen.errores > 0 && (
            <p className="px-5 pb-4 -mt-2 font-body text-xs text-gray-400">Las filas con error se omiten; corrígelas y vuelve a subir el archivo.</p>
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

          <button onClick={reset} className="flex items-center gap-2 border border-gray-200 text-gray-600 font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-gray-50">
            <FileSpreadsheet className="w-4 h-4" /> Cargar otro archivo
          </button>
        </div>
      )}
    </div>
  )
}
