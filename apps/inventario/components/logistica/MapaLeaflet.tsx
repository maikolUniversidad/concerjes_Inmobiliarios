'use client'

/**
 * Mapa ligero sobre OpenStreetMap (Leaflet, sin capas de pago). Renderiza
 * conductores (con velocidad), puntos de entrega (sedes) y novedades, y puede
 * dibujar la ruta que une las paradas en orden.
 *
 * IMPORTANTE: Leaflet toca `window` al importarse, así que este componente debe
 * cargarse SIEMPRE con `next/dynamic` y `{ ssr: false }` desde el padre.
 */

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type TipoPunto = 'conductor' | 'sede' | 'novedad'

export interface PuntoMapa {
  id: string
  lat: number
  lng: number
  tipo: TipoPunto
  titulo: string
  detalle?: string
  /** Para sedes: PENDIENTE | EN_RUTA | ENTREGADO | NOVEDAD | REPROGRAMADO */
  estado?: string
  /** Para conductores: velocidad en km/h */
  velocidad?: number | null
  /** Nº de parada (para ordenar la línea de ruta y numerar el pin) */
  orden?: number
  activo?: boolean
}

interface Props {
  puntos: PuntoMapa[]
  /** Dibuja una polilínea uniendo las sedes en orden de `orden`. */
  dibujarRuta?: boolean
  alto?: number
  className?: string
  /** Centro por defecto si no hay puntos (Bogotá). */
  centroDefecto?: [number, number]
}

const COLOR_ESTADO: Record<string, string> = {
  ENTREGADO: '#22c55e',
  EN_RUTA: '#3b82f6',
  NOVEDAD: '#ef4444',
  REPROGRAMADO: '#eab308',
  PENDIENTE: '#9ca3af',
}

function iconoSede(p: PuntoMapa): L.DivIcon {
  const color = COLOR_ESTADO[p.estado ?? 'PENDIENTE'] ?? '#9ca3af'
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
}: Props) {
  const contRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const capaRef = useRef<L.LayerGroup | null>(null)

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

    const validos = puntos.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))

    // Línea de ruta entre sedes (en orden de parada).
    if (dibujarRuta) {
      const sedes = validos
        .filter(p => p.tipo === 'sede')
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
      if (sedes.length > 1) {
        L.polyline(sedes.map(s => [s.lat, s.lng] as [number, number]), {
          color: '#6366f1', weight: 3, opacity: 0.55, dashArray: '6 6',
        }).addTo(capa)
      }
    }

    for (const p of validos) {
      const icon = p.tipo === 'conductor' ? iconoConductor(p)
        : p.tipo === 'novedad' ? iconoNovedad()
        : iconoSede(p)
      const vel = p.tipo === 'conductor' && p.velocidad != null
        ? `<div style="color:#059669;font-weight:600">${Math.round(p.velocidad)} km/h</div>` : ''
      L.marker([p.lat, p.lng], { icon })
        .bindPopup(
          `<div style="font:500 13px system-ui;min-width:120px">
            <div style="font-weight:700">${p.titulo}</div>
            ${p.detalle ? `<div style="color:#6b7280">${p.detalle}</div>` : ''}
            ${vel}
          </div>`
        )
        .addTo(capa)
    }

    // Ajusta el encuadre a los puntos.
    if (validos.length === 1) {
      map.setView([validos[0].lat, validos[0].lng], 15)
    } else if (validos.length > 1) {
      map.fitBounds(L.latLngBounds(validos.map(p => [p.lat, p.lng] as [number, number])).pad(0.2))
    }
  }, [puntos, dibujarRuta])

  return (
    <>
      <style>{`@keyframes mapaPulse{0%{transform:scale(1);opacity:.35}100%{transform:scale(2.4);opacity:0}}`}</style>
      <div ref={contRef} className={className} style={{ height: alto, width: '100%', borderRadius: 12, zIndex: 0 }} />
    </>
  )
}
