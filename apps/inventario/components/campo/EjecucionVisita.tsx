'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, Camera, Check, ChevronLeft, ChevronRight, CloudUpload, FileText,
  Image as ImagenIcono, Loader2, Megaphone, PenLine, Trash2, X,
} from 'lucide-react'
import {
  adjuntarEvidencia, agregarNovedad, cerrarVisita, faltantesCierre, firmar, fotosDe,
  nuevoId, pasosVisibles, progreso, quitarEvidencia, rangoFotos, responderPaso,
  rutaEvidenciaDePaso, rutaFirma, validarEvidencia,
  type EvidenciaLocal, type Falta, type Paso, type ValorRespuesta, type VisitaLocal,
} from '@conserjes/ronda-core'
import { PadFirma } from '@/components/firma/PadFirma'
import { almacen } from '@/lib/campo/idb'
import { crearPuente, encolarMedio, encolarVisita, sincronizar } from '@/lib/campo/cola'
import { dataUrlABlob, prepararFoto } from '@/lib/campo/imagen'
import { CamaraVivo } from './CamaraVivo'
import type { ActorPwa } from './InicioCampo'

/**
 * La ejecución de la visita, paso por paso.
 *
 * Cómo está pensada, y por qué:
 *   · UN paso por pantalla. Una lista con quince preguntas en un celular de
 *     5 pulgadas se contesta mal;
 *   · todo se guarda en IndexedDB en CADA cambio. Una llamada entrante mata la
 *     pestaña en un celular de gama baja, y perder media ronda es perder el
 *     trabajo de alguien;
 *   · las fotos se comprimen y se encolan al tomarlas, no al cerrar: si suben
 *     mientras la persona sigue trabajando, el cierre es inmediato;
 *   · el resumen deja CORREGIR antes de enviar. Tocar un paso vuelve a él;
 *   · cerrar nunca se bloquea. Si falta algo, se pide el motivo y la visita
 *     queda incompleta (ADR-02 §2.9). Lo mismo que hace la base.
 */
type Vista = 'pasos' | 'resumen' | 'enviada'

export function EjecucionVisita({
  visitaId, actor,
}: { visitaId: string; actor: ActorPwa }) {
  const router = useRouter()
  const [visita, setVisita] = useState<VisitaLocal | null>(null)
  const [cargando, setCargando] = useState(true)
  const [i, setI] = useState(0)
  const [vista, setVista] = useState<Vista>('pasos')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [motivoIncompleta, setMotivoIncompleta] = useState('')
  const [reporte, setReporte] = useState<{ ruta: string; sha256: string } | null>(null)
  const [pendiente, setPendiente] = useState(false)
  const [novedad, setNovedad] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const v = await almacen.leerVisita<VisitaLocal>(visitaId)
        setVisita(v ?? null)
      } finally {
        setCargando(false)
      }
    })()
  }, [visitaId])

  /** Guardar siempre que algo cambie: es lo que hace que no se pierda nada. */
  const aplicar = useCallback(async (v: VisitaLocal) => {
    setVisita(v)
    await almacen.guardarVisita(v)
  }, [])

  const visibles = useMemo(() => (visita ? pasosVisibles(visita) : []), [visita])
  const paso = visibles[i]
  const avance = visita ? progreso(visita) : { hechos: 0, total: 1, porcentaje: 0 }
  const faltantes: Falta[] = visita ? faltantesCierre(visita) : []

  if (cargando) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-green" />
      </main>
    )
  }

  if (!visita) {
    return (
      <main className="px-4 py-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 text-center">
          <h1 className="font-heading text-xl font-bold">Esta visita no está en este celular</h1>
          <p className="mt-2 text-sm text-gray-600">
            Puede que ya se haya enviado, o que la hayas empezado en otro teléfono.
          </p>
          <button
            type="button"
            onClick={() => router.push('/campo')}
            className="mt-5 h-14 w-full rounded-xl bg-gray-900 font-bold text-white"
          >
            Volver al inicio
          </button>
        </div>
      </main>
    )
  }

  // ── Enviar ────────────────────────────────────────────────────────────────
  async function enviar() {
    if (!visita || enviando) return
    setError(null)
    const cierre = cerrarVisita(visita, { motivoIncompleta })
    if (!cierre.ok) { setError(cierre.error); return }
    setEnviando(true)
    try {
      const cerrada = cierre.visita
      await aplicar(cerrada)
      await encolarVisita(cerrada, { personaId: actor.personaId, sesionId: actor.sesionId })
      const r = await sincronizar(crearPuente(actor.modo))
      const quedoPendiente = r.visitasDetenidas.includes(cerrada.id)
        || r.mediosPendientes > 0 || r.errores.length > 0
      setPendiente(quedoPendiente)
      setVista('enviada')

      if (!quedoPendiente) {
        // El reporte solo se puede armar cuando el servidor ya tiene la visita.
        try {
          const res = await fetch('/api/campo/reporte', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ visita: cerrada.id }),
          })
          const j = await res.json().catch(() => ({}))
          if (res.ok && j.ok) setReporte({ ruta: j.ruta, sha256: j.sha256 })
        } catch { /* el reporte se puede volver a pedir; la visita ya está */ }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo enviar.')
      setVista('enviada')
      setPendiente(true)
    } finally {
      setEnviando(false)
    }
  }

  // ── Pantalla de confirmación ──────────────────────────────────────────────
  if (vista === 'enviada') {
    return (
      <main className="px-4 py-8">
        <div className={'rounded-2xl border p-5 text-center '
          + (pendiente ? 'border-sky-200 bg-sky-50' : 'border-emerald-200 bg-emerald-50')}>
          {pendiente ? <CloudUpload className="mx-auto h-10 w-10 text-sky-700" />
            : <Check className="mx-auto h-10 w-10 text-emerald-700" />}
          <h1 className="font-heading mt-3 text-xl font-bold">
            {pendiente ? 'Guardada en tu celular' : 'Enviada'}
          </h1>
          <p className="mt-2 text-sm">
            {pendiente
              ? 'No hay señal suficiente. Se envía sola cuando vuelva: no tienes que hacer nada más, '
                + 'y la hora en que trabajaste queda guardada.'
              : 'Tu ronda quedó registrada con la hora del servidor.'}
          </p>
          {reporte && (
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-emerald-900">
              <FileText className="h-3.5 w-3.5" /> El reporte en PDF quedó guardado.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => router.push('/campo')}
          className="mt-6 h-16 w-full rounded-2xl bg-brand-green text-lg font-bold text-white"
        >
          Listo
        </button>
        {pendiente && (
          <button
            type="button"
            onClick={() => router.push('/campo/cola')}
            className="mt-3 h-12 w-full rounded-xl border border-gray-300 font-semibold text-gray-700"
          >
            Ver lo que falta por enviar
          </button>
        )}
      </main>
    )
  }

  // ── Resumen ───────────────────────────────────────────────────────────────
  if (vista === 'resumen') {
    return (
      <main className="px-4 py-6">
        <h1 className="font-heading text-xl font-bold">Revisa antes de enviar</h1>
        <p className="mt-1 text-sm text-gray-500">
          Toca cualquier paso para corregirlo.
        </p>

        <ul className="mt-4 space-y-2">
          {visibles.map((p, idx) => {
            const r = visita.respuestas[p.id]
            const fotos = fotosDe(visita, p.id)
            const falta = faltantes.find((f) => f.pasoId === p.id)
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => { setI(idx); setVista('pasos') }}
                  className={'flex w-full items-start gap-3 rounded-xl border-2 bg-white p-3 text-left '
                    + (falta ? 'border-amber-300' : 'border-gray-200')}
                >
                  <span className="mt-0.5 text-xs font-bold text-gray-400">{p.orden}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold leading-snug">{p.titulo}</span>
                    <span className="block text-sm text-gray-600">
                      {resumenRespuesta(p, r, fotos)}
                    </span>
                    {falta && (
                      <span className="mt-1 block text-xs font-semibold text-amber-700">
                        {textoFalta(falta)}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-gray-300" />
                </button>
              </li>
            )
          })}
        </ul>

        {visita.firmas.length > 0 && (
          <p className="mt-4 flex items-center gap-2 text-sm text-gray-600">
            <PenLine className="h-4 w-4" /> Firmado por{' '}
            {visita.firmas.map((f) => f.nombre ?? f.quien.toLowerCase()).join(', ')}
          </p>
        )}

        {visita.novedades.length > 0 && (
          <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3">
            <p className="flex items-center gap-2 font-semibold">
              <Megaphone className="h-4 w-4" /> Novedades que reportaste
            </p>
            <ul className="mt-1 list-disc pl-5 text-sm text-gray-700">
              {visita.novedades.map((n) => <li key={n.id}>{n.titulo}</li>)}
            </ul>
          </div>
        )}

        {faltantes.length > 0 && (
          <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <p className="flex items-center gap-2 font-semibold text-amber-900">
              <AlertTriangle className="h-4 w-4" />
              {faltantes.length === 1 ? 'Falta una cosa' : `Faltan ${faltantes.length} cosas`}
            </p>
            <p className="mt-1 text-sm text-amber-800">
              Puedes enviar igual, pero escribe por qué queda incompleta. Nadie se queda atrapado
              aquí.
            </p>
            <textarea
              value={motivoIncompleta}
              onChange={(e) => setMotivoIncompleta(e.target.value)}
              rows={2}
              placeholder="Ej.: el cuarto de bombas estaba con candado"
              className="mt-2 w-full rounded-xl border-2 border-amber-200 p-3 text-base focus:border-amber-500 focus:outline-none"
            />
          </div>
        )}

        {error && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}

        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={enviando}
            className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-brand-green text-lg font-bold text-white disabled:opacity-50"
          >
            {enviando ? <Loader2 className="h-6 w-6 animate-spin" /> : <Check className="h-6 w-6" />}
            {enviando ? 'Enviando…' : 'Cerrar y enviar'}
          </button>
          <button
            type="button"
            onClick={() => setVista('pasos')}
            className="h-14 w-full rounded-xl border-2 border-gray-300 font-bold text-gray-700"
          >
            Seguir editando
          </button>
        </div>
      </main>
    )
  }

  // ── Pasos ─────────────────────────────────────────────────────────────────
  return (
    <main className="px-4 py-5">
      <header className="mb-4">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span className="truncate">{visita.puntoNombre}</span>
          <span>{avance.hechos} de {avance.total}</span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-brand-green transition-all"
            style={{ width: `${avance.porcentaje}%` }}
          />
        </div>
      </header>

      {paso ? (
        <PasoEnPantalla
          paso={paso}
          visita={visita}
          actor={actor}
          aplicar={aplicar}
          setError={setError}
          setAviso={setAviso}
        />
      ) : (
        <p className="rounded-2xl bg-white p-4 text-sm text-gray-600">
          Esta tarea no tiene pasos. Avísale a tu supervisor.
        </p>
      )}

      {aviso && <p className="mt-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-900">{aviso}</p>}
      {error && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          onClick={() => { setError(null); setAviso(null); setI(Math.max(0, i - 1)) }}
          disabled={i === 0}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-gray-300 text-gray-700 disabled:opacity-30"
          aria-label="Paso anterior"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        {i + 1 < visibles.length ? (
          <button
            type="button"
            onClick={() => { setError(null); setAviso(null); setI(i + 1) }}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-gray-900 text-base font-bold text-white"
          >
            Siguiente <ChevronRight className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { setError(null); setVista('resumen') }}
            className="flex h-14 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-green text-base font-bold text-white"
          >
            Ver el resumen <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setNovedad(true)}
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-300 text-sm font-semibold text-gray-700"
      >
        <Megaphone className="h-4 w-4" /> Reportar una novedad
      </button>

      {novedad && (
        <FormaNovedad
          onCerrar={() => setNovedad(false)}
          onGuardar={async (n) => {
            const r = agregarNovedad(visita, { ...n, id: nuevoId(), pasoId: paso?.id ?? null })
            if (!r.ok) { setError(r.error); return }
            await aplicar(r.visita)
            setNovedad(false)
            setAviso('La novedad va con la visita. Si es de un equipo, abre un ticket al llegar al servidor.')
          }}
        />
      )}
    </main>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Un paso en pantalla
// ──────────────────────────────────────────────────────────────────────────────
function PasoEnPantalla({
  paso, visita, actor, aplicar, setError, setAviso,
}: {
  paso: Paso
  visita: VisitaLocal
  actor: ActorPwa
  aplicar: (v: VisitaLocal) => Promise<void>
  setError: (s: string | null) => void
  setAviso: (s: string | null) => void
}) {
  const r = visita.respuestas[paso.id]
  const [camara, setCamara] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  const [texto, setTexto] = useState(r?.texto ?? '')
  const [numero, setNumero] = useState(r?.numero != null ? String(r.numero) : '')
  const [motivo, setMotivo] = useState(r?.motivo ?? '')
  const fotos = visita.evidencias.filter((e) => e.pasoId === paso.id)

  async function responder(valor: ValorRespuesta, extra: { motivo?: string } = {}) {
    setError(null)
    const res = responderPaso(visita, paso.id, valor, { motivo: extra.motivo ?? motivo })
    if (!res.ok) { setError(res.error); return }
    await aplicar(res.visita)
  }

  /** Toma la foto, la comprime, le saca la huella y la encola. */
  async function guardarFoto(original: Blob, origen: 'CAMARA_VIVO' | 'GALERIA') {
    setTrabajando(true)
    setError(null)
    try {
      const prep = await prepararFoto(original)
      const id = nuevoId()
      // La respuesta tiene que existir ANTES que su evidencia: comparten id
      // local y la cola las manda en ese orden.
      let v = visita
      if (!v.respuestas[paso.id]) {
        const res = responderPaso(v, paso.id, {}, { motivo: null })
        // Un paso de FOTO se contesta con la foto; si la validación se queja
        // por el mínimo, se guarda igual la respuesta vacía para colgarle el
        // archivo y el mínimo se revisa en el resumen.
        v = res.ok ? res.visita : {
          ...v,
          estado: v.estado === 'ABIERTA' ? 'EN_CURSO' : v.estado,
          respuestas: {
            ...v.respuestas,
            [paso.id]: {
              id: nuevoId(), pasoId: paso.id, omitido: false,
              marca: { tDispositivo: new Date().toISOString(), monoMs: null },
            },
          },
        }
      }
      const respuestaId = v.respuestas[paso.id].id
      const ev: EvidenciaLocal = {
        id,
        pasoId: paso.id,
        tipo: 'FOTO',
        origen,
        sha256: prep.sha256,
        hashPerceptual: prep.hashPerceptual,
        mime: prep.mime,
        tamano: prep.tamano,
        ancho: prep.ancho,
        alto: prep.alto,
        lat: visita.lat,
        lng: visita.lng,
        precisionMetros: visita.precisionMetros,
        capturadoDispositivo: new Date().toISOString(),
        qrDetectado: prep.qrDetectado,
        rutaArchivo: rutaEvidenciaDePaso(visita.id, respuestaId, `${id}.jpg`),
      }
      const problema = validarEvidencia(paso, ev)
      if (problema) { setError(problema); return }

      const res = adjuntarEvidencia(v, ev)
      if (!res.ok) { setError(res.error); return }
      await aplicar(res.visita)
      await encolarMedio({
        id,
        grupo: visita.id,
        ruta: ev.rutaArchivo as string,
        mime: prep.mime,
        sha256: prep.sha256,
        tamano: prep.tamano,
        blob: prep.blob,
        creadoEn: new Date().toISOString(),
        intentos: 0,
      })

      if (paso.config.exige_qr_en_encuadre && !prep.qrDetectado) {
        setAviso('No se alcanzó a leer el QR en la foto. Si puedes, toma otra con la placa dentro del encuadre.')
      } else if (visita.evidencias.some((e) => e.sha256 === prep.sha256)) {
        setAviso('Esta foto es igual a otra de esta visita. Queda registrada como repetida.')
      } else {
        setAviso(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la foto.')
    } finally {
      setTrabajando(false)
      setCamara(false)
    }
  }

  return (
    <section>
      <p className="text-[11px] uppercase tracking-wide text-gray-400">
        Paso {paso.orden} {paso.obligatorio ? '· obligatorio' : '· opcional'}
      </p>
      <h2 className="font-heading mt-0.5 text-xl font-bold leading-snug">{paso.titulo}</h2>
      {paso.ayuda && <p className="mt-1.5 text-sm text-gray-600">{paso.ayuda}</p>}

      {/* ── Casilla ─────────────────────────────────────────────────────── */}
      {paso.tipo === 'CASILLA' && (
        <div className="mt-5 space-y-3">
          {(['SI', 'NO', 'NO_APLICA'] as const).map((op) => {
            const activo = r?.casilla === op
            return (
              <button
                key={op}
                type="button"
                onClick={() => void responder({ casilla: op }, { motivo: op === 'NO' ? motivo : '' })}
                className={'h-16 w-full rounded-2xl border-2 text-lg font-bold '
                  + (activo
                    ? op === 'NO' ? 'border-amber-500 bg-amber-50 text-amber-800'
                      : 'border-brand-green bg-brand-green/5 text-brand-green'
                    : 'border-gray-200 bg-white text-gray-700')}
              >
                {op === 'SI' ? 'Sí' : op === 'NO' ? 'No' : 'No aplica'}
              </button>
            )
          })}
          {r?.casilla === 'NO' && (
            <div>
              <label htmlFor="motivo-no" className="text-sm font-semibold text-gray-700">
                ¿Qué pasó? (obligatorio)
              </label>
              <textarea
                id="motivo-no"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                onBlur={() => void responder({ casilla: 'NO' }, { motivo })}
                rows={3}
                className="mt-1.5 w-full rounded-xl border-2 border-gray-200 p-3 text-base focus:border-brand-green focus:outline-none"
              />
            </div>
          )}
        </div>
      )}

      {/* ── Foto ────────────────────────────────────────────────────────── */}
      {paso.tipo === 'FOTO' && (
        <div className="mt-5">
          <p className="text-sm text-gray-600">
            {(() => {
              const { min, max } = rangoFotos(paso.config)
              return `${min === max ? min : `${min} a ${max}`} ${min === 1 && max === 1 ? 'foto' : 'fotos'}`
                + (paso.config.solo_camara_vivo ? ' · tomadas aquí mismo' : '')
                + (paso.config.exige_qr_en_encuadre ? ' · con la placa en el encuadre' : '')
            })()}
          </p>

          {camara ? (
            <div className="mt-3">
              <CamaraVivo
                ayuda={paso.config.exige_qr_en_encuadre
                  ? 'Que la placa del QR salga en la foto' : paso.titulo}
                alTomar={(b) => guardarFoto(b, 'CAMARA_VIVO')}
                alCerrar={() => setCamara(false)}
              />
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <button
                type="button"
                onClick={() => setCamara(true)}
                disabled={trabajando || fotos.length >= rangoFotos(paso.config).max}
                className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-brand-green text-lg font-bold text-white disabled:opacity-40"
              >
                {trabajando ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
                {trabajando ? 'Guardando…' : 'Tomar la foto'}
              </button>

              {/* La galería SOLO cuando el paso no exige cámara en vivo. Si la
                  exige, el archivo lo rechaza la base y la pantalla no lo
                  ofrece: no se le da un botón que no va a funcionar. */}
              {!paso.config.solo_camara_vivo && (
                <label className="flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-gray-300 font-semibold text-gray-700">
                  <ImagenIcono className="h-5 w-5" /> Escoger una de la galería
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void guardarFoto(f, 'GALERIA')
                      e.target.value = ''
                    }}
                  />
                </label>
              )}
            </div>
          )}

          {fotos.length > 0 && (
            <ul className="mt-4 space-y-2">
              {fotos.map((f, n) => (
                <li
                  key={f.id}
                  className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-sm font-bold text-gray-500">
                    {n + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block font-semibold">
                      {f.origen === 'CAMARA_VIVO' ? 'Tomada aquí' : 'De la galería'}
                    </span>
                    <span className="block text-xs text-gray-500">
                      {Math.round((f.tamano ?? 0) / 1024)} KB
                      {f.qrDetectado ? ' · con la placa' : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-label="Quitar la foto"
                    onClick={() => void aplicar(quitarEvidencia(visita, f.id))}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Texto ───────────────────────────────────────────────────────── */}
      {paso.tipo === 'TEXTO' && (
        <div className="mt-5">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onBlur={() => void responder({ texto })}
            rows={5}
            maxLength={paso.config.max_caracteres ?? 500}
            className="w-full rounded-xl border-2 border-gray-200 p-3 text-base focus:border-brand-green focus:outline-none"
          />
          <p className="mt-1 text-right text-xs text-gray-400">
            {texto.length}/{paso.config.max_caracteres ?? 500}
          </p>
        </div>
      )}

      {/* ── Número ──────────────────────────────────────────────────────── */}
      {paso.tipo === 'NUMERO' && (
        <div className="mt-5">
          <div className="flex items-center gap-2">
            <input
              value={numero}
              onChange={(e) => setNumero(e.target.value.replace(/[^0-9.,-]/g, ''))}
              onBlur={() => {
                const n = Number(numero.replace(',', '.'))
                if (!Number.isNaN(n) && numero !== '') void responder({ numero: n })
              }}
              inputMode="decimal"
              className="h-16 flex-1 rounded-xl border-2 border-gray-200 px-4 text-center text-2xl font-bold focus:border-brand-green focus:outline-none"
            />
            {paso.config.unidad && (
              <span className="text-lg font-semibold text-gray-500">{paso.config.unidad}</span>
            )}
          </div>
          {(paso.config.min !== undefined || paso.config.max !== undefined) && (
            <p className="mt-1.5 text-xs text-gray-500">
              Entre {paso.config.min ?? 0} y {paso.config.max ?? '—'}
            </p>
          )}
        </div>
      )}

      {/* ── Selección ───────────────────────────────────────────────────── */}
      {paso.tipo === 'SELECCION' && (
        <div className="mt-5 space-y-3">
          {(paso.config.opciones ?? []).map((o) => {
            const elegidas = r?.opciones ?? []
            const activo = elegidas.includes(o.valor)
            return (
              <button
                key={o.valor}
                type="button"
                onClick={() => {
                  const siguientes = paso.config.multiple
                    ? activo ? elegidas.filter((x) => x !== o.valor) : [...elegidas, o.valor]
                    : [o.valor]
                  void responder({ opciones: siguientes })
                }}
                className={'h-14 w-full rounded-xl border-2 px-4 text-left text-base font-semibold '
                  + (activo ? 'border-brand-green bg-brand-green/5 text-brand-green'
                    : 'border-gray-200 bg-white text-gray-700')}
              >
                {o.etiqueta}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Escaneo ─────────────────────────────────────────────────────── */}
      {paso.tipo === 'ESCANEO' && (
        <div className="mt-5">
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value.toUpperCase())}
            onBlur={() => void responder({
              texto, entidad_codigo: texto,
              entidad_tipo: paso.config.entidad ?? 'producto',
            })}
            placeholder="Código del insumo o del equipo"
            className="h-16 w-full rounded-xl border-2 border-gray-200 px-4 text-center font-mono text-lg focus:border-brand-green focus:outline-none"
          />
          <p className="mt-1.5 text-xs text-gray-500">
            Escríbelo como está en la etiqueta.
          </p>
        </div>
      )}

      {/* ── Nota de voz y video: por ahora con el grabador del celular ──── */}
      {(paso.tipo === 'NOTA_VOZ' || paso.tipo === 'VIDEO') && (
        <div className="mt-5">
          <p className="rounded-xl bg-gray-100 p-3 text-sm text-gray-700">
            {paso.tipo === 'NOTA_VOZ'
              ? 'Puedes escribir la nota en vez de grabarla: queda igual en el reporte.'
              : 'Graba el video con la cámara del celular y escoge el archivo.'}
          </p>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onBlur={() => void responder({ texto, transcripcion: texto })}
            rows={4}
            placeholder="Escribe lo que ibas a decir"
            className="mt-3 w-full rounded-xl border-2 border-gray-200 p-3 text-base focus:border-brand-green focus:outline-none"
          />
        </div>
      )}

      {/* ── Firma ───────────────────────────────────────────────────────── */}
      {paso.tipo === 'FIRMA' && (
        <FirmaPaso
          paso={paso}
          visita={visita}
          actor={actor}
          aplicar={aplicar}
          setError={setError}
        />
      )}

      {/* Saltar: solo si el paso no es el de firma. */}
      {paso.tipo !== 'FIRMA' && (
        <SaltarPaso
          visita={visita}
          paso={paso}
          aplicar={aplicar}
          setError={setError}
        />
      )}
    </section>
  )
}

function SaltarPaso({
  visita, paso, aplicar, setError,
}: {
  visita: VisitaLocal
  paso: Paso
  aplicar: (v: VisitaLocal) => Promise<void>
  setError: (s: string | null) => void
}) {
  const r = visita.respuestas[paso.id]
  const [abierto, setAbierto] = useState(r?.omitido === true)
  const [motivo, setMotivo] = useState(r?.omisionMotivo ?? '')

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="mt-6 h-12 w-full text-sm font-semibold text-gray-500 underline"
      >
        No pude hacer este paso
      </button>
    )
  }
  return (
    <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <p className="font-semibold text-amber-900">¿Por qué no se pudo?</p>
      <textarea
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        rows={2}
        placeholder="Ej.: la puerta estaba con candado"
        className="mt-2 w-full rounded-xl border-2 border-amber-200 p-3 text-base focus:border-amber-500 focus:outline-none"
      />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={async () => {
            const res = responderPaso(visita, paso.id, {}, { omitido: true, omisionMotivo: motivo })
            if (!res.ok) { setError(res.error); return }
            setError(null)
            await aplicar(res.visita)
          }}
          className="h-12 flex-1 rounded-xl bg-amber-700 font-bold text-white"
        >
          Guardar
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="h-12 rounded-xl border border-amber-300 px-4 font-semibold text-amber-900"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

function FirmaPaso({
  paso, visita, actor, aplicar, setError,
}: {
  paso: Paso
  visita: VisitaLocal
  actor: ActorPwa
  aplicar: (v: VisitaLocal) => Promise<void>
  setError: (s: string | null) => void
}) {
  const quien = (paso.config.quien ?? 'trabajador').toUpperCase() as 'TRABAJADOR' | 'CLIENTE'
  const ya = visita.firmas.find((f) => f.quien === quien)
  const [nombre, setNombre] = useState(ya?.nombre ?? (quien === 'TRABAJADOR' ? actor.nombre ?? '' : ''))
  const [documento, setDocumento] = useState(ya?.documento ?? '')
  const [trazo, setTrazo] = useState<string | null>(ya?.trazo ?? null)
  const [guardando, setGuardando] = useState(false)

  return (
    <div className="mt-5">
      <p className="text-sm text-gray-600">
        {quien === 'TRABAJADOR' ? 'Tu firma' : 'Firma de quien recibe'}
      </p>

      <div className="mt-3">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre de quien firma"
          className="h-14 w-full rounded-xl border-2 border-gray-200 px-4 text-base focus:border-brand-green focus:outline-none"
        />
        <input
          value={documento}
          onChange={(e) => setDocumento(e.target.value)}
          placeholder="Documento (opcional)"
          inputMode="numeric"
          className="mt-2 h-14 w-full rounded-xl border-2 border-gray-200 px-4 text-base focus:border-brand-green focus:outline-none"
        />
      </div>

      <div className="mt-3">
        <PadFirma onCambio={setTrazo} alto={200} />
      </div>

      {/* La firma facial no se ofrece aquí: la verificación de rostro es de F13
          y hoy el servicio corre sin prueba de vida. Quien no autoriza
          biometría firma con trazo, y el motivo lo registra la base. */}
      <button
        type="button"
        disabled={!trazo || guardando}
        onClick={async () => {
          if (!trazo) return
          setGuardando(true)
          try {
            const res = firmar(visita, {
              quien,
              metodo: 'TRAZO',
              trazo,
              rutaTrazo: rutaFirma(visita.id, quien),
              nombre: nombre.trim() || null,
              documento: documento.trim() || null,
            })
            if (!res.ok) { setError(res.error); return }
            await aplicar(res.visita)
            await encolarMedio({
              id: `firma-${visita.id}-${quien}`,
              grupo: visita.id,
              ruta: rutaFirma(visita.id, quien),
              mime: 'image/png',
              sha256: await (async () => {
                const b = dataUrlABlob(trazo)
                const h = await crypto.subtle.digest('SHA-256', await b.arrayBuffer())
                return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('')
              })(),
              tamano: dataUrlABlob(trazo).size,
              blob: dataUrlABlob(trazo),
              creadoEn: new Date().toISOString(),
              intentos: 0,
            })
            setError(null)
          } finally {
            setGuardando(false)
          }
        }}
        className="mt-4 flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-brand-green text-lg font-bold text-white disabled:opacity-40"
      >
        <PenLine className="h-6 w-6" /> {ya ? 'Volver a firmar' : 'Guardar la firma'}
      </button>
      {ya && (
        <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-emerald-700">
          <Check className="h-4 w-4" /> Firmado
        </p>
      )}
    </div>
  )
}

function FormaNovedad({
  onCerrar, onGuardar,
}: {
  onCerrar: () => void
  onGuardar: (n: {
    clase: 'MANTENIMIENTO' | 'PQRS' | 'SOPORTE'
    titulo: string
    descripcion: string | null
    prioridad: 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA'
    maquinariaId: string | null
  }) => Promise<void>
}) {
  const [clase, setClase] = useState<'MANTENIMIENTO' | 'PQRS'>('MANTENIMIENTO')
  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [prioridad, setPrioridad] = useState<'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA'>('MEDIA')

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5">
        <div className="flex items-start justify-between">
          <h2 className="font-heading text-xl font-bold">Reportar una novedad</h2>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {([['MANTENIMIENTO', 'Algo está dañado'], ['PQRS', 'Una queja o petición']] as const)
            .map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => setClase(v)}
                className={'h-14 rounded-xl border-2 px-2 text-sm font-semibold '
                  + (clase === v ? 'border-brand-green bg-brand-green/5 text-brand-green'
                    : 'border-gray-200 text-gray-600')}
              >
                {l}
              </button>
            ))}
        </div>

        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="¿Qué pasó? En una línea"
          className="mt-3 h-14 w-full rounded-xl border-2 border-gray-200 px-4 text-base focus:border-brand-green focus:outline-none"
        />
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={3}
          placeholder="Cuéntalo con más detalle (opcional)"
          className="mt-2 w-full rounded-xl border-2 border-gray-200 p-3 text-base focus:border-brand-green focus:outline-none"
        />

        <div className="mt-3 grid grid-cols-4 gap-2">
          {(['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPrioridad(p)}
              className={'h-12 rounded-xl border-2 text-xs font-bold '
                + (prioridad === p ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 text-gray-600')}
            >
              {p === 'CRITICA' ? 'CRÍTICA' : p}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={titulo.trim().length < 4}
          onClick={() => void onGuardar({
            clase, titulo: titulo.trim(),
            descripcion: descripcion.trim() || null, prioridad, maquinariaId: null,
          })}
          className="mt-4 h-16 w-full rounded-2xl bg-brand-green text-lg font-bold text-white disabled:opacity-40"
        >
          Guardar la novedad
        </button>
        <p className="mt-2 text-center text-xs text-gray-500">
          Va con la visita. Si es de un equipo, en el servidor se convierte en ticket de
          mantenimiento.
        </p>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Textos del resumen
// ──────────────────────────────────────────────────────────────────────────────
function resumenRespuesta(
  paso: Paso,
  r: VisitaLocal['respuestas'][string] | undefined,
  fotos: number,
): string {
  if (paso.tipo === 'FIRMA') return 'Firma'
  if (!r) return 'Sin contestar'
  if (r.omitido) return `Saltado: ${r.omisionMotivo ?? 'sin motivo'}`
  switch (paso.tipo) {
    case 'CASILLA':
      return (r.casilla === 'SI' ? 'Sí' : r.casilla === 'NO' ? 'No' : 'No aplica')
        + (r.motivo ? ` · ${r.motivo}` : '')
    case 'FOTO':
      return fotos === 1 ? '1 foto' : `${fotos} fotos`
    case 'NUMERO':
      return `${r.numero ?? '-'}${paso.config.unidad ? ' ' + paso.config.unidad : ''}`
    case 'SELECCION':
      return (r.opciones ?? []).join(', ') || 'Sin escoger'
    case 'ESCANEO':
      return r.entidadCodigo ?? r.texto ?? 'Sin escanear'
    default:
      return r.texto ? r.texto.slice(0, 80) : 'Contestado'
  }
}

function textoFalta(f: Falta): string {
  switch (f.falta) {
    case 'SIN_RESPONDER': return 'Falta contestar'
    case 'OMITIDO': return 'Lo saltaste'
    case 'FOTOS': return `Faltan fotos (${f.detalle ?? ''})`
    case 'FIRMA': return 'Falta la firma'
    case 'FIRMA_TRABAJADOR': return 'Falta tu firma'
    default: return 'Falta algo'
  }
}
