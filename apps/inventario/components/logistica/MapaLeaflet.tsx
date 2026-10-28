'use client'

/**
 * Mapa ligero sobre OpenStreetMap (Leaflet, sin capas de pago). Renderiza
 * conductores (con velocidad), puntos de entrega (sedes) y novedades, y puede
 * dibujar la ruta que une las paradas en orden.
 *
 * F8 (mapa operativo, §4.3 del complemento 2) lo EXTIENDE sin romper a sus tres
 * consumidores de logística: tipos de punto nuevos (`persona`, `punto`,
 * `parada`), capas que se prenden y apagan, círculos de alcance para la sede o
 * la geocerca de un punto, y el recorrido de un turno para el reproductor de
 * línea de tiempo. Todo lo nuevo es opcional.
 *
 * Dos cosas de F8 que NO son adorno y por eso viven aquí y no en la pantalla:
 *   · R2 — un marcador de persona NO se puede dibujar sin su antigüedad y su
 *     fuente. `antiguedadSeg` y `fuente` son obligatorios en el tipo
 *     `persona`, el icono cambia de estilo cuando `enVivo` es falso, y la
 *     etiqueta «hace 12 min · WhatsApp» la escribe este componente. Si la
 *     pantalla se olvidara de pasarlos, no compila.
 *   · la antigüedad llega CALCULADA desde el servidor. Este componente no mira
 *     el reloj del navegador para nada.
 *
 * IMPORTANTE: Leaflet toca `window` al importarse, así que este componente debe
 * cargarse SIEMPRE con `next/dynamic` y `{ ssr: false }` desde el padre.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type TipoPunto = 'conductor' | 'sede' | 'novedad' | 'persona' | 'punto' | 'parada'

/** Fuentes de una posición (espeja `persona_ubicacion_actual.fuente`). */
export type FuenteUbicacion = 'APP_VIVO' | 'APP_NATIVA' | 'WHATSAPP' | 'ESCANEO' | 'EVENTO'

export interface PuntoMapa {
  id: string
  lat: number
  lng: number
  tipo: TipoPunto
  titulo: string
  detalle?: string
  /** Para sedes: PENDIENTE | EN_RUTA | ENTREGADO | NOVEDAD | REPROGRAMADO
   *  Para paradas: PENDIENTE | EN_CURSO | CUMPLIDA | OMITIDA */
  estado?: string
  /** Para conductores: velocidad en km/h */
  velocidad?: number | null
  /** Nº de parada (para ordenar la línea de ruta y numerar el pin) */
  orden?: number
  activo?: boolean
  /** Color hex del pin de sede (p. ej. para colorear por cliente). */
  color?: string
  // ── Lo que agrega F8 ───────────────────────────────────────────────────────
  /** Capa a la que pertenece. Las capas se prenden y apagan desde el mapa.
   *  Puede ser el piso, para los «planos por piso» que hoy son capas. */
  capa?: string
  /** Radio en metros a dibujar alrededor (alcance de la sede, geocerca del
   *  punto). La sede como punto con radio es lo que los datos permiten
   *  mientras no exista el levantamiento 2D/3D (pendiente §10.1 nº 3). */
  radioMetros?: number
  /** R2: segundos desde que se capturó la posición, CALCULADOS EN EL SERVIDOR.
   *  Obligatorio en `tipo: 'persona'` (lo exige el tipo de abajo). */
  antiguedadSeg?: number
  /** R2: de dónde salió la posición. Obligatorio en `tipo: 'persona'`. */
  fuente?: FuenteUbicacion
  /** R2: ¿está dentro de la ventana de frescura del contrato? Si es falso, el
   *  marcador se dibuja en estilo «último registro», nunca en vivo. */
  enVivo?: boolean
}

/** Una persona en el mapa NO se puede dibujar sin su antigüedad, su fuente y si
 *  está en vivo: es R2 en el sistema de tipos, para que ninguna pantalla pueda
 *  presentar una posición vieja como si fuera actual. */
export type PuntoPersona = Omit<PuntoMapa, 'tipo'> & {
  tipo: 'persona'
  antiguedadSeg: number
  fuente: FuenteUbicacion
  enVivo: boolean
}

/** Un punto del recorrido de un turno, para el reproductor. */
export interface PuntoRecorrido {
  lat: number
  lng: number
  capturadoAt: string
  fuente?: FuenteUbicacion
  /** Si la lectura se hizo en un punto de control, su nombre. */
  puntoNombre?: string | null
}

interface Props {
  puntos: (PuntoMapa | PuntoPersona)[]
  /** Dibuja una polilínea uniendo las sedes (o las paradas) en orden de `orden`. */
  dibujarRuta?: boolean
  alto?: number
  className?: string
  /** Centro por defecto si no hay puntos (Bogotá). */
  centroDefecto?: [number, number]
  /** Si se pasa, centra el mapa en estas coordenadas (con zoom cercano). */
  centrarEn?: [number, number] | null
  // ── Lo que agrega F8 ───────────────────────────────────────────────────────
  /** Control de capas. Si se pasa, el mapa dibuja los interruptores con las
   *  capas presentes en `puntos` y solo muestra las encendidas. */
  capasVisibles?: boolean
  /** Capas apagadas al abrir (por nombre). */
  capasApagadas?: string[]
  /** El rastro de un turno. Se dibuja como línea continua, distinta de la línea
   *  de ruta planeada (que es a trazos): una es por dónde pasó y la otra por
   *  dónde tenía que pasar, y confundirlas invalida el replay. */
  recorrido?: PuntoRecorrido[]
  /** Hasta qué índice del recorrido mostrar (el reproductor de la pantalla lo
   *  avanza). `undefined` = todo el recorrido. */
  recorridoHasta?: number
}

const COLOR_ESTADO: Record<string, string> = {
  ENTREGADO: '#22c55e',
  EN_RUTA: '#3b82f6',
  NOVEDAD: '#ef4444',
  REPROGRAMADO: '#eab308',
  PENDIENTE: '#9ca3af',
  // Paradas de una ruta de ronda (F8)
  CUMPLIDA: '#22c55e',
  EN_CURSO: '#3b82f6',
  OMITIDA: '#a855f7',
}

const ETIQUETA_FUENTE: Record<FuenteUbicacion, string> = {
  APP_VIVO: 'App',
  APP_NATIVA: 'App (segundo plano)',
  WHATSAPP: 'WhatsApp',
  ESCANEO: 'Escaneo de un punto',
  EVENTO: 'Evento',
}

/** Texto de antigüedad del formato que pide §3.1: «hace 12 min». Se calcula con
 *  los segundos que manda el SERVIDOR, nunca con el reloj del navegador. */
export function textoAntiguedad(segundos: number): string {
  if (segundos < 45) return 'hace unos segundos'
  const min = Math.round(segundos / 60)
  if (min < 60) return `hace ${min} min`
  const horas = Math.floor(min / 60)
  const resto = min % 60
  if (horas < 24) return resto === 0 ? `hace ${horas} h` : `hace ${horas} h ${resto} min`
  const dias = Math.floor(horas / 24)
  return `hace ${dias} d`
}

/** «hace 12 min · WhatsApp», el rótulo literal que pide R2. */
export function rotuloPosicion(antiguedadSeg: number, fuente: FuenteUbicacion): string {
  return `${textoAntiguedad(antiguedadSeg)} · ${ETIQUETA_FUENTE[fuente] ?? fuente}`
}

/** Los títulos y detalles salen de la base (nombres de sede, de persona, texto
 *  de una novedad) y se interpolan en el HTML del globo, así que se escapan. */
function esc(texto: string | null | undefined): string {
  if (texto == null) return ''
  return String(texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function iconoSede(p: PuntoMapa): L.DivIcon {
  const color = p.color ?? COLOR_ESTADO[p.estado ?? 'PENDIENTE'] ?? '#9ca3af'
  const n = p.orden ?? ''
  return L.divIcon({
    className: 'mapa-pin-sede',
    html: `<div style="position:relative;width:28px;height:38px">
      <svg width="28" height="38" viewBox="0 0 28 38" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 0C6.3 0 0 6.3 0 14c0 9.5 14 24 14 24s14-14.5 14-24C28 6.3 21.7 0 14 0z" fill="${color}"/>
        <circle cx="14" cy="14" r="9" fill="#fff"/>
      </svg>
      <span style="position:absolute;top:5px;left:0;width:28px;text-align:center;font:700 12px system-ui;color:${color}">${n}</span>
    </div>`,
    iconSize: [28, 38],
    iconAnchor: [14, 38],
    popupAnchor: [0, -34],
  })
}

function iconoConductor(p: PuntoMapa): L.DivIcon {
  const activo = p.activo !== false
  const color = activo ? '#059669' : '#6b7280'
  const pulso = activo
    ? `<span style="position:absolute;inset:-6px;border-radius:9999px;background:${color};opacity:.25;animation:mapaPulse 1.6s ease-out infinite"></span>`
    : ''
  return L.divIcon({
    className: 'mapa-pin-conductor',
    html: `<div style="position:relative;width:34px;height:34px">
      ${pulso}
      <div style="position:absolute;inset:0;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>
      </div>
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  })
}

/**
 * Persona en el mapa (F8). DOS ESTILOS que no se parecen, porque es R2:
 *   · en vivo — verde, con pulso, como el conductor;
 *   · último registro — gris, hueco, con borde a trazos y SIN pulso. No existe
 *     ningún estado intermedio: una posición que pasó la frescura del contrato
 *     nunca se dibuja con el estilo de en vivo.
 */
function iconoPersona(p: PuntoPersona): L.DivIcon {
  const vivo = p.enVivo
  const color = vivo ? '#059669' : '#6b7280'
  const pulso = vivo
    ? `<span style="position:absolute;inset:-6px;border-radius:9999px;background:${color};opacity:.25;animation:mapaPulse 1.6s ease-out infinite"></span>`
    : ''
  const relleno = vivo ? color : '#f3f4f6'
  const trazo = vivo ? '#fff' : color
  const borde = vivo ? '3px solid #fff' : `2px dashed ${color}`
  return L.divIcon({
    className: vivo ? 'mapa-pin-persona-vivo' : 'mapa-pin-persona-viejo',
    html: `<div style="position:relative;width:34px;height:34px">
      ${pulso}
      <div style="position:absolute;inset:0;border-radius:9999px;background:${relleno};border:${borde};box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${trazo}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      </div>
    </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  })
}

/** Punto de control o parada de una ruta (F8): cuadrado, para que no se
 *  confunda con el pin de sede ni con el círculo de una persona. */
function iconoPunto(p: PuntoMapa): L.DivIcon {
  const color = p.color ?? COLOR_ESTADO[p.estado ?? 'PENDIENTE'] ?? '#6366f1'
  const n = p.orden != null ? String(p.orden) : ''
  return L.divIcon({
    className: 'mapa-pin-punto',
    html: `<div style="width:26px;height:26px;border-radius:7px;background:#fff;border:3px solid ${color};box-shadow:0 1px 3px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:700 12px system-ui;color:${color}">${esc(n)}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  })
}

function iconoNovedad(): L.DivIcon {
  return L.divIcon({
    className: 'mapa-pin-novedad',
    html: `<div style="width:26px;height:26px;border-radius:9999px;background:#ef4444;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  })
}

export default function MapaLeaflet({
  puntos, dibujarRuta = false, alto = 420, className = '', centroDefecto = [4.711, -74.0721],
  centrarEn = null, capasVisibles = false, capasApagadas = [], recorrido, recorridoHasta,
}: Props) {
  const contRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const capaRef = useRef<L.LayerGroup | null>(null)
  const [apagadas, setApagadas] = useState<string[]>(capasApagadas)

  // Las capas presentes en los datos, en orden estable.
  const capas = useMemo(() => {
    const vistas: string[] = []
    for (const p of puntos) {
      const c = p.capa
      if (c && !vistas.includes(c)) vistas.push(c)
    }
    return vistas.sort((a, b) => a.localeCompare(b, 'es'))
  }, [puntos])

  // Inicializa el mapa una vez.
  useEffect(() => {
    if (mapRef.current || !contRef.current) return
    const map = L.map(contRef.current, { zoomControl: true, attributionControl: true })
      .setView(centroDefecto, 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map)
    capaRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    // Recalcula tamaño tras el montaje (evita el mapa "gris" en contenedores flex).
    setTimeout(() => map.invalidateSize(), 100)
    return () => { map.remove(); mapRef.current = null; capaRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Redibuja marcadores cuando cambian los puntos.
  useEffect(() => {
    const map = mapRef.current
    const capa = capaRef.current
    if (!map || !capa) return
    capa.clearLayers()

    const validos = puntos
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .filter(p => !(p.capa && apagadas.includes(p.capa)))

    // El RECORRIDO de un turno: línea CONTINUA, para que no se confunda con la
    // ruta planeada (a trazos). Se dibuja primero, debajo de los marcadores.
    if (recorrido && recorrido.length > 1) {
      const hasta = recorridoHasta == null ? recorrido.length : Math.max(1, recorridoHasta + 1)
      const tramo = recorrido.slice(0, hasta)
        .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng))
      if (tramo.length > 1) {
        L.polyline(tramo.map(r => [r.lat, r.lng] as [number, number]), {
          color: '#0ea5e9', weight: 4, opacity: 0.8,
        }).addTo(capa)
      }
      // Dónde iba en ese instante del replay y de cuándo es ese instante.
      const cabeza = tramo[tramo.length - 1]
      if (cabeza) {
        L.circleMarker([cabeza.lat, cabeza.lng], {
          radius: 8, color: '#fff', weight: 3, fillColor: '#0284c7', fillOpacity: 1,
        }).bindTooltip(
          new Date(cabeza.capturadoAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }),
          { permanent: true, direction: 'top', className: 'mapa-tooltip-replay' },
        ).addTo(capa)
      }
      // Salida: el primer punto del turno, para no perder de vista de dónde salió.
      const salida = tramo[0]
      if (salida) {
        L.circleMarker([salida.lat, salida.lng], {
          radius: 5, color: '#0284c7', weight: 2, fillColor: '#fff', fillOpacity: 1,
        }).bindTooltip('Inicio del turno', { direction: 'top' }).addTo(capa)
      }
    }

    // Círculos de alcance (sede con radio, geocerca de un punto). Mientras no
    // exista el levantamiento 2D/3D, esto es el «polígono» de la sede.
    for (const p of validos) {
      if (!p.radioMetros || p.radioMetros <= 0) continue
      L.circle([p.lat, p.lng], {
        radius: p.radioMetros,
        color: p.color ?? '#6366f1', weight: 1, opacity: 0.6,
        fillColor: p.color ?? '#6366f1', fillOpacity: 0.07,
      }).addTo(capa)
    }

    // Línea de ruta PLANEADA entre sedes o paradas (en orden de parada), a
    // trazos. Es por dónde tenía que pasar, no por dónde pasó.
    if (dibujarRuta) {
      const ordenados = validos
        .filter(p => p.tipo === 'sede' || p.tipo === 'parada')
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      if (ordenados.length > 1) {
        L.polyline(ordenados.map(s => [s.lat, s.lng] as [number, number]), {
          color: '#6366f1', weight: 3, opacity: 0.55, dashArray: '6 6',
        }).addTo(capa)
      }
    }

    for (const p of validos) {
      const icon = p.tipo === 'conductor' ? iconoConductor(p)
        : p.tipo === 'persona' ? iconoPersona(p as PuntoPersona)
        : p.tipo === 'punto' || p.tipo === 'parada' ? iconoPunto(p)
        : p.tipo === 'novedad' ? iconoNovedad()
        : iconoSede(p)
      const vel = p.tipo === 'conductor' && p.velocidad != null
        ? `<div style="color:#059669;font-weight:600">${Math.round(p.velocidad)} km/h</div>` : ''
      // R2: la antigüedad y la fuente van SIEMPRE junto al marcador de una
      // persona, y en el estilo que corresponde a si está en vivo o no.
      const sello = p.tipo === 'persona'
        ? `<div style="margin-top:2px;font-weight:600;color:${(p as PuntoPersona).enVivo ? '#059669' : '#6b7280'}">
             ${esc(rotuloPosicion((p as PuntoPersona).antiguedadSeg, (p as PuntoPersona).fuente))}
           </div>${(p as PuntoPersona).enVivo ? '' : '<div style="color:#6b7280;font-size:11px">Último registro, no posición en vivo</div>'}`
        : ''
      const marcador = L.marker([p.lat, p.lng], { icon })
        .bindPopup(
          `<div style="font:500 13px system-ui;min-width:140px">
            <div style="font-weight:700">${esc(p.titulo)}</div>
            ${p.detalle ? `<div style="color:#6b7280">${esc(p.detalle)}</div>` : ''}
            ${sello}
            ${vel}
          </div>`
        )
      // La antigüedad también como etiqueta permanente, para no tener que abrir
      // el globo de cada persona para saber de cuándo es su posición.
      if (p.tipo === 'persona') {
        marcador.bindTooltip(
          `${esc(p.titulo)} · ${esc(textoAntiguedad((p as PuntoPersona).antiguedadSeg))}`,
          { direction: 'bottom', offset: [0, 14], className: 'mapa-tooltip-persona' },
        )
      }
      marcador.addTo(capa)
    }

    // Ajusta el encuadre a los puntos (y al recorrido, si hay).
    const coords: [number, number][] = validos.map(p => [p.lat, p.lng])
    if (recorrido) {
      for (const r of recorrido) {
        if (Number.isFinite(r.lat) && Number.isFinite(r.lng)) coords.push([r.lat, r.lng])
      }
    }
    if (coords.length === 1) {
      map.setView(coords[0], 15)
    } else if (coords.length > 1) {
      map.fitBounds(L.latLngBounds(coords).pad(0.2))
    }
  }, [puntos, dibujarRuta, apagadas, recorrido, recorridoHasta])

  // Centra en un punto concreto cuando se solicita (p. ej. al elegir una sede).
  useEffect(() => {
    if (mapRef.current && centrarEn) mapRef.current.setView(centrarEn, 16, { animate: true })
  }, [centrarEn])

  return (
    <>
      <style>{`
        @keyframes mapaPulse{0%{transform:scale(1);opacity:.35}100%{transform:scale(2.4);opacity:0}}
        .mapa-tooltip-persona,.mapa-tooltip-replay{font:600 11px system-ui;padding:1px 6px;border-radius:6px}
      `}</style>
      <div className="relative">
        <div ref={contRef} className={className} style={{ height: alto, width: '100%', borderRadius: 12, zIndex: 0 }} />
        {capasVisibles && capas.length > 0 && (
          <div className="absolute right-3 top-3 z-[400] rounded-xl border border-gray-200 bg-white/95 p-2 shadow-sm backdrop-blur">
            <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Capas
            </p>
            {capas.map((c) => (
              <label key={c} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={!apagadas.includes(c)}
                  onChange={() => setApagadas((prev) =>
                    prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c])}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-brand-green focus:ring-brand-green"
                />
                {c}
              </label>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
