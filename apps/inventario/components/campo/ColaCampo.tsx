'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, CloudUpload, Loader2, Trash2 } from 'lucide-react'
import { textoHoraPendiente } from '@conserjes/ronda-core'
import { descartarMedio } from '@conserjes/offline'
import { almacen } from '@/lib/campo/idb'
import { crearPuente, estadoCola, sincronizar, type ModoPuente } from '@/lib/campo/cola'

/**
 * La cola: qué falta por enviar, desde cuándo, y qué se puede hacer.
 *
 * Lo que esta pantalla dice y que es importante decir: la hora en que se
 * trabajó SE CONSERVA, y la que queda como oficial es la del servidor. Si no se
 * dijera, alguien vería su ronda de las 2 a. m. aparecer con la hora en que
 * hubo señal y pensaría que el sistema le cambió el trabajo.
 *
 * Y un archivo que no sube nunca se puede descartar CON MOTIVO: el motivo queda
 * y la visita puede explicar por qué le falta esa foto, en vez de quedarse
 * atascada para siempre sin que nadie entienda nada (ADR-D).
 */
export function ColaCampo({ modo }: { modo: ModoPuente }) {
  const router = useRouter()
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)
  const [cola, setCola] = useState<Awaited<ReturnType<typeof estadoCola>>>({ visitas: [], intents: 0 })
  const [atascados, setAtascados] = useState<{ id: string; ruta: string; error: string | null }[]>([])

  const refrescar = useCallback(async () => {
    try {
      setCola(await estadoCola())
      const medios = await almacen.getMedios()
      setAtascados(medios
        .filter((m) => !m.descartadoEn && m.intentos >= 6)
        .map((m) => ({ id: m.id, ruta: m.ruta, error: m.ultimoError ?? null })))
    } catch {
      setResultado('Este navegador no guarda datos sin conexión.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { void refrescar() }, [refrescar])

  async function enviar() {
    setEnviando(true)
    setResultado(null)
    try {
      const r = await sincronizar(crearPuente(modo))
      await refrescar()
      setResultado(
        r.errores.length === 0
          ? `Listo: ${r.intentsEnviados} envíos y ${r.mediosSubidos} archivos.`
          : `Se enviaron ${r.intentsEnviados} y quedaron ${r.mediosPendientes} archivos. `
            + 'Lo que falta se intenta otra vez solo.')
    } catch {
      setResultado('No hay señal. Lo que hiciste está guardado.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="px-4 py-6">
      <button
        type="button"
        onClick={() => router.push('/campo')}
        className="mb-3 flex items-center gap-1 text-sm font-semibold text-gray-500"
      >
        <ChevronLeft className="h-4 w-4" /> Inicio
      </button>

      <h1 className="font-heading text-2xl font-bold">Falta por enviar</h1>

      {cargando ? (
        <Loader2 className="mt-8 h-8 w-8 animate-spin text-brand-green" />
      ) : cola.visitas.length === 0 && atascados.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          No falta nada: todo lo que hiciste ya llegó al servidor.
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-3">
            {cola.visitas.map((v) => (
              <li key={v.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <p className="font-semibold leading-snug">{v.punto}</p>
                <p className="mt-0.5 text-sm text-gray-600">{textoHoraPendiente(v.cuando)}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {v.estado === 'COMPLETADA' ? 'Completa' : v.estado === 'INCOMPLETA' ? 'Incompleta' : 'Sin cerrar'}
                  {v.medios > 0 && ` · ${v.medios} archivos pendientes`}
                </p>
                {v.estado !== 'COMPLETADA' && v.estado !== 'INCOMPLETA' && (
                  <button
                    type="button"
                    onClick={() => router.push(`/campo/visita/${v.id}`)}
                    className="mt-3 h-12 w-full rounded-xl border-2 border-gray-300 font-semibold text-gray-700"
                  >
                    Seguir con esta ronda
                  </button>
                )}
              </li>
            ))}
          </ul>

          {atascados.length > 0 && (
            <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
              <p className="font-semibold text-amber-900">
                {atascados.length === 1 ? 'Un archivo no pudo subir' : `${atascados.length} archivos no pudieron subir`}
              </p>
              <p className="mt-1 text-sm text-amber-800">
                Se intentó varias veces. Puedes descartarlos diciendo por qué; la visita queda con
                la explicación en vez de quedarse pegada.
              </p>
              <ul className="mt-3 space-y-2">
                {atascados.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 rounded-xl bg-white p-3">
                    <span className="min-w-0 flex-1 text-xs">
                      <span className="block truncate font-mono">{m.ruta.split('/').pop()}</span>
                      {m.error && <span className="block text-gray-500">{m.error}</span>}
                    </span>
                    <button
                      type="button"
                      aria-label="Descartar el archivo"
                      onClick={async () => {
                        const motivo = window.prompt('¿Por qué se descarta este archivo?')
                        if (!motivo?.trim()) return
                        await descartarMedio(almacen, m.id, motivo.trim())
                        await refrescar()
                      }}
                      className="flex h-11 w-11 items-center justify-center rounded-lg text-amber-700"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            onClick={() => void enviar()}
            disabled={enviando}
            className="mt-6 flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-brand-green text-lg font-bold text-white disabled:opacity-50"
          >
            {enviando ? <Loader2 className="h-6 w-6 animate-spin" /> : <CloudUpload className="h-6 w-6" />}
            {enviando ? 'Enviando…' : 'Intentar enviar ahora'}
          </button>
        </>
      )}

      {resultado && (
        <p className="mt-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-900">{resultado}</p>
      )}
    </main>
  )
}
