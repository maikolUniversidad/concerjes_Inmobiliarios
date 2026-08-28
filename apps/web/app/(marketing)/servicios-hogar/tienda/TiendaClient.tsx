'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Search, Star, Play, MapPin, Clock, ChevronRight, X, ChevronLeft, ChevronRight as ChevRight,
  BadgeCheck, Sparkles, ImageIcon, Loader2, ShieldCheck,
} from 'lucide-react'
import { getPublico } from '@/lib/supabase/publico'
import { traerTodo } from '@/lib/supabase/paginado'

interface Tipo { id: string; nombre: string; descripcion: string | null; icono: string | null; color: string | null; incluye: string[] | null }
interface Tarifa { tipo_id: string; precio_unico: number; duracion_horas: number }
interface Media { id: string; tipo_id: string | null; media_tipo: string; url: string; poster_url: string | null; titulo: string | null }
interface Resena { tipo_id: string | null; calificacion: number }
interface Concerje {
  id: string; nombre: string; foto_url: string | null; bio: string | null
  anios_experiencia: number | null; ciudad: string | null; calificacion_prom: number
  servicios_count: number; disponible: boolean
}
interface ConcerjeServ { concerje_id: string; tipo_id: string }

const GRAD: Record<string, string> = {
  green: 'from-green-500 to-emerald-600', blue: 'from-blue-500 to-indigo-600',
  orange: 'from-orange-500 to-amber-600', purple: 'from-purple-500 to-violet-600',
  amber: 'from-amber-500 to-yellow-600', emerald: 'from-emerald-500 to-teal-600',
}

function fmtPrecio(p: number | null) {
  if (p === null || p === undefined) return 'A consultar'
  return `$${Number(p).toLocaleString('es-CO')}`
}

export function TiendaClient() {
  const [tipos, setTipos] = useState<Tipo[]>([])
  const [tarifas, setTarifas] = useState<Tarifa[]>([])
  const [media, setMedia] = useState<Media[]>([])
  const [resenas, setResenas] = useState<Resena[]>([])
  const [concerjes, setConcerjes] = useState<Concerje[]>([])
  const [concServ, setConcServ] = useState<ConcerjeServ[]>([])
  const [cargando, setCargando] = useState(true)

  const [cat, setCat] = useState<string>('todos')
  const [busca, setBusca] = useState('')
  const [modal, setModal] = useState<{ tipoId: string; idx: number } | null>(null)

  useEffect(() => {
    const sb = getPublico()
    Promise.all([
      sb.from('tipos_servicio_hogar').select('id, nombre, descripcion, icono, color, incluye').eq('activo', true).order('orden'),
      sb.from('tarifas_servicio_hogar').select('tipo_id, precio_unico, duracion_horas').eq('activo', true),
      sb.from('galeria_servicio_hogar').select('id, tipo_id, media_tipo, url, poster_url, titulo').eq('activo', true).order('orden'),
      // Paginada: de aquí sale el promedio de calificación por servicio y
      // PostgREST devuelve máximo 1.000 filas por respuesta.
      traerTodo((desde, hasta) => sb.from('resenas_servicio_hogar')
        .select('tipo_id, calificacion').eq('aprobada', true).order('id').range(desde, hasta))
        .then((data) => ({ data })),
      sb.from('concerjes_hogar').select('id, nombre, foto_url, bio, anios_experiencia, ciudad, calificacion_prom, servicios_count, disponible').eq('activo', true).order('orden'),
      sb.from('concerje_servicio_hogar').select('concerje_id, tipo_id').eq('activo', true),
    ]).then(([t, ta, g, r, c, cs]) => {
      setTipos((t.data as Tipo[]) ?? [])
      setTarifas((ta.data as Tarifa[]) ?? [])
      setMedia((g.data as Media[]) ?? [])
      setResenas((r.data as Resena[]) ?? [])
      setConcerjes((c.data as Concerje[]) ?? [])
      setConcServ((cs.data as ConcerjeServ[]) ?? [])
      setCargando(false)
    })
  }, [])

  // Índices auxiliares
  const precioDesde = useMemo(() => {
    const m: Record<string, number> = {}
    for (const t of tarifas) if (m[t.tipo_id] === undefined || t.precio_unico < m[t.tipo_id]) m[t.tipo_id] = t.precio_unico
    return m
  }, [tarifas])

  const mediaPorTipo = useMemo(() => {
    const m: Record<string, Media[]> = {}
    for (const g of media) if (g.tipo_id) (m[g.tipo_id] ??= []).push(g)
    return m
  }, [media])

  const ratingPorTipo = useMemo(() => {
    const acc: Record<string, { s: number; n: number }> = {}
    for (const r of resenas) if (r.tipo_id) { acc[r.tipo_id] ??= { s: 0, n: 0 }; acc[r.tipo_id].s += r.calificacion; acc[r.tipo_id].n++ }
    const m: Record<string, { prom: number; n: number }> = {}
    for (const k in acc) m[k] = { prom: acc[k].s / acc[k].n, n: acc[k].n }
    return m
  }, [resenas])

  const servPorConcerje = useMemo(() => {
    const m: Record<string, Set<string>> = {}
    for (const cs of concServ) (m[cs.concerje_id] ??= new Set()).add(cs.tipo_id)
    return m
  }, [concServ])

  // Solo medios con imagen mostrable (foto, o video con poster) para el carrusel.
  const destacados = useMemo(() => {
    const conPoster = media.filter((m) => m.media_tipo === 'video' && m.poster_url)
    const fotos = media.filter((m) => m.media_tipo === 'imagen')
    return [...conPoster, ...fotos].slice(0, 8)
  }, [media])

  // Filtro
  const tiposVis = tipos.filter((t) =>
    (cat === 'todos' || t.id === cat) &&
    (!busca || t.nombre.toLowerCase().includes(busca.toLowerCase()) || (t.descripcion ?? '').toLowerCase().includes(busca.toLowerCase()))
  )
  const concerjesVis = concerjes.filter((c) => cat === 'todos' || servPorConcerje[c.id]?.has(cat))

  if (cargando) {
    return <div className="flex min-h-[60vh] items-center justify-center pt-20"><Loader2 className="h-8 w-8 animate-spin text-brand-green" /></div>
  }

  return (
    <div className="pt-16">
      {/* Barra sticky: buscar + categorías */}
      <div className="sticky top-14 z-30 border-b border-gray-100 bg-white/95 backdrop-blur-md">
        <div className="container-max px-4 py-3">
          <div className="relative mb-3">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              value={busca} onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar servicio (aseo, eventos, jardín…)"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-3 pl-12 pr-4 text-base outline-none focus:border-brand-green focus:bg-white"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Pill activo={cat === 'todos'} onClick={() => setCat('todos')}>🛒 Todos</Pill>
            {tipos.map((t) => (
              <Pill key={t.id} activo={cat === t.id} onClick={() => setCat(t.id)}>{t.icono} {t.nombre}</Pill>
            ))}
          </div>
        </div>
      </div>

      {/* Hero mini */}
      <section className="container-max px-4 pt-6">
        <div className="rounded-2xl gradient-brand p-6 text-white sm:p-8">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold"><Sparkles className="h-3.5 w-3.5" /> Tienda de Servicios del Hogar</span>
          <h1 className="mt-3 font-heading text-2xl font-bold sm:text-3xl">Pide tu servicio como pides un domicilio</h1>
          <p className="mt-1 max-w-xl text-white/80">Explora servicios con fotos y video, mira a tus concerjes y agenda en minutos. Sin registro para ver.</p>
        </div>
      </section>

      {/* Carrusel de destacados (fotos + videos) */}
      {destacados.length > 0 && (
        <section className="container-max px-4 pt-8">
          <h2 className="mb-3 font-heading text-lg font-bold text-gray-900">Destacados</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {destacados.map((m) => (
              <button key={m.id} onClick={() => m.tipo_id && setModal({ tipoId: m.tipo_id, idx: (mediaPorTipo[m.tipo_id] ?? []).findIndex((x) => x.id === m.id) })}
                className="relative aspect-[4/3] w-64 shrink-0 overflow-hidden rounded-xl bg-gray-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.media_tipo === 'video' ? (m.poster_url ?? '') : m.url} alt={m.titulo ?? ''} className="h-full w-full object-cover" />
                {m.media_tipo === 'video' && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-brand-green shadow-lg"><Play className="ml-0.5 h-6 w-6 fill-current" /></span>
                  </span>
                )}
                {m.titulo && <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-left text-sm font-semibold text-white">{m.titulo}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Grid de servicios (product tiles) */}
      <section className="container-max px-4 py-8">
        <h2 className="mb-4 font-heading text-xl font-bold text-gray-900">Servicios disponibles</h2>
        {tiposVis.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-gray-400">No encontramos servicios para “{busca}”.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {tiposVis.map((t) => {
              const ms = mediaPorTipo[t.id] ?? []
              const cover = ms.find((x) => x.media_tipo === 'imagen') ?? ms.find((x) => x.poster_url) ?? ms[0]
              const coverImg = cover ? (cover.media_tipo === 'imagen' ? cover.url : cover.poster_url) : null
              const tieneVideo = ms.some((x) => x.media_tipo === 'video')
              const rt = ratingPorTipo[t.id]
              const grad = GRAD[t.color ?? 'green'] ?? GRAD.green
              return (
                <div key={t.id} className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition-shadow hover:shadow-lg">
                  {/* Media */}
                  <button onClick={() => ms.length && setModal({ tipoId: t.id, idx: 0 })} className="relative block aspect-[16/10] w-full overflow-hidden bg-gray-100">
                    {coverImg ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={coverImg} alt={t.nombre} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        {tieneVideo && <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-xs font-semibold text-white"><Play className="h-3 w-3 fill-current" /> Video</span>}
                      </>
                    ) : (
                      <div className={`relative flex h-full w-full items-center justify-center bg-gradient-to-br ${grad}`}>
                        <span className="text-6xl">{t.icono}</span>
                        {tieneVideo && <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-1 text-xs font-semibold text-white"><Play className="h-3 w-3 fill-current" /> Video</span>}
                      </div>
                    )}
                  </button>
                  {/* Cuerpo */}
                  <div className="flex flex-1 flex-col p-4">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <h3 className="font-heading font-bold text-gray-900">{t.icono} {t.nombre}</h3>
                      {rt && (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {rt.prom.toFixed(1)}
                        </span>
                      )}
                    </div>
                    <p className="mb-3 line-clamp-2 text-sm text-gray-500">{t.descripcion}</p>
                    {t.incluye && t.incluye.length > 0 && (
                      <div className="mb-3 flex flex-wrap gap-1">
                        {t.incluye.slice(0, 3).map((i) => <span key={i} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{i}</span>)}
                      </div>
                    )}
                    <div className="mt-auto flex items-center justify-between pt-2">
                      <div>
                        <p className="text-xs text-gray-400">Desde</p>
                        <p className="font-heading text-lg font-bold text-brand-green">{fmtPrecio(precioDesde[t.id] ?? null)}</p>
                      </div>
                      <Link href={`/servicios-hogar/solicitar?servicio=${encodeURIComponent(t.nombre)}`}
                        className={`inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r ${grad} px-4 py-2.5 text-sm font-bold text-white shadow-md transition-opacity hover:opacity-90`}>
                        Agendar <ChevronRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Concerjes disponibles */}
      {concerjesVis.length > 0 && (
        <section className="bg-gray-50 py-10">
          <div className="container-max px-4">
            <div className="mb-5 flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-brand-green" />
              <h2 className="font-heading text-xl font-bold text-gray-900">Concerjes habilitados</h2>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {concerjesVis.map((c) => {
                const servicios = tipos.filter((t) => servPorConcerje[c.id]?.has(t.id))
                return (
                  <div key={c.id} className="w-64 shrink-0 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-3">
                      {c.foto_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.foto_url} alt={c.nombre} className="h-14 w-14 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-green/10 font-heading text-xl font-bold text-brand-green">{c.nombre.charAt(0)}</div>
                      )}
                      <div className="min-w-0">
                        <p className="flex items-center gap-1 truncate font-heading font-bold text-gray-900">{c.nombre} <BadgeCheck className="h-4 w-4 shrink-0 text-brand-green" /></p>
                        <p className="flex items-center gap-1 text-xs text-amber-600"><Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {Number(c.calificacion_prom).toFixed(1)} · {c.servicios_count} servicios</p>
                      </div>
                    </div>
                    {c.bio && <p className="mt-3 line-clamp-2 text-sm text-gray-500">{c.bio}</p>}
                    <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
                      {c.ciudad && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {c.ciudad}</span>}
                      {!!c.anios_experiencia && <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {c.anios_experiencia} años</span>}
                      <span className={`ml-auto rounded-full px-2 py-0.5 font-semibold ${c.disponible ? 'bg-green-100 text-brand-green' : 'bg-gray-100 text-gray-400'}`}>{c.disponible ? 'Disponible' : 'Ocupado'}</span>
                    </div>
                    {servicios.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {servicios.slice(0, 4).map((s) => <span key={s.id} title={s.nombre} className="text-base">{s.icono}</span>)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* CTA seguimiento */}
      <section className="container-max px-4 py-12 text-center">
        <p className="text-gray-500">¿Quieres seguimiento, agenda y direcciones guardadas?</p>
        <Link href="/portal" className="mt-3 inline-flex items-center gap-2 rounded-xl border-2 border-brand-green px-6 py-3 font-semibold text-brand-green hover:bg-brand-green/5">
          <BadgeCheck className="h-5 w-5" /> Crea tu cuenta o ingresa a tu portal
        </Link>
      </section>

      {/* Modal de medios */}
      {modal && <MediaModal items={mediaPorTipo[modal.tipoId] ?? []} idx={modal.idx} onIdx={(i) => setModal({ ...modal, idx: i })} onClose={() => setModal(null)} />}
    </div>
  )
}

function Pill({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${activo ? 'border-brand-green bg-brand-green text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-green/40'}`}>
      {children}
    </button>
  )
}

function MediaModal({ items, idx, onIdx, onClose }: { items: Media[]; idx: number; onIdx: (i: number) => void; onClose: () => void }) {
  const it = items[idx]
  if (!it) return null
  const mover = (d: number) => onIdx((idx + d + items.length) % items.length)
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4" onClick={onClose}>
      <button onClick={onClose} className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><X className="h-6 w-6" /></button>
      {items.length > 1 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); mover(-1) }} className="absolute left-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><ChevronLeft className="h-7 w-7" /></button>
          <button onClick={(e) => { e.stopPropagation(); mover(1) }} className="absolute right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><ChevRight className="h-7 w-7" /></button>
        </>
      )}
      <figure className="max-h-[85vh] max-w-4xl" onClick={(e) => e.stopPropagation()}>
        {it.media_tipo === 'video' ? (
          <video src={it.url} poster={it.poster_url ?? undefined} controls autoPlay className="max-h-[80vh] w-auto rounded-xl" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={it.url} alt={it.titulo ?? ''} className="max-h-[80vh] w-auto rounded-xl object-contain" />
        )}
        {it.titulo && <figcaption className="mt-3 text-center font-heading font-bold text-white">{it.titulo}</figcaption>}
      </figure>
    </div>
  )
}
