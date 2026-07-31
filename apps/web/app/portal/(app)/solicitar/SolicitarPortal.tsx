'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  CheckCircle2, ChevronRight, ChevronLeft, Loader2, Calendar, Clock, MapPin, Phone, Home, Plus,
} from 'lucide-react'
import { toast } from 'sonner'
import { getPortalSupabase, tokenActual } from '@/lib/supabase/portal'
import { usePortal } from '../_portal/PortalProvider'
import { SERVICIOS, FRECUENCIAS, HORAS } from '../_portal/datos'

const PASOS = ['Servicio', 'Horario', 'Dirección', 'Confirmar']

interface Direccion {
  id: string; etiqueta: string; direccion: string; ciudad: string; barrio: string | null; es_principal: boolean
}

interface Form {
  servicio: string; duracion: string; frecuencia: string
  fecha: string; hora: string; mascotas: boolean; m2: string; notas: string
  telefono: string; direccion: string; ciudad: string; barrio: string
}

export function SolicitarPortal() {
  const router = useRouter()
  const params = useSearchParams()
  const { cliente, session } = usePortal()

  const servicioInicial = params.get('servicio') ?? ''
  const [paso, setPaso] = useState(servicioInicial ? 1 : 0)
  const [form, setForm] = useState<Form>({
    servicio: servicioInicial, duracion: '', frecuencia: 'UNICA',
    fecha: params.get('fecha') ?? '', hora: params.get('hora') ?? '',
    mascotas: false, m2: '', notas: '',
    telefono: '', direccion: '', ciudad: 'Bogotá', barrio: '',
  })
  const [direcciones, setDirecciones] = useState<Direccion[]>([])
  const [dirSel, setDirSel] = useState<string>('nueva')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  function set<K extends keyof Form>(k: K, v: Form[K]) { setForm((p) => ({ ...p, [k]: v })) }

  // Prefill teléfono y direcciones guardadas.
  useEffect(() => {
    if (cliente?.telefono) setForm((p) => ({ ...p, telefono: p.telefono || cliente.telefono! }))
    const sb = getPortalSupabase()
    sb.from('direcciones_cliente').select('*').eq('cliente_id', session.user.id).order('es_principal', { ascending: false })
      .then(({ data }) => {
        const ds = (data as Direccion[]) ?? []
        setDirecciones(ds)
        const principal = ds.find((d) => d.es_principal) ?? ds[0]
        if (principal) {
          setDirSel(principal.id)
          setForm((p) => ({ ...p, direccion: principal.direccion, ciudad: principal.ciudad, barrio: principal.barrio ?? '' }))
        }
      })
  }, [cliente?.telefono, session.user.id])

  function elegirDireccion(id: string) {
    setDirSel(id)
    if (id === 'nueva') { set('direccion', ''); set('barrio', ''); set('ciudad', 'Bogotá'); return }
    const d = direcciones.find((x) => x.id === id)
    if (d) { set('direccion', d.direccion); set('ciudad', d.ciudad); set('barrio', d.barrio ?? '') }
  }

  function puedeAvanzar() {
    if (paso === 0) return !!form.servicio && !!form.duracion && !!form.frecuencia
    if (paso === 1) return !!form.fecha && !!form.hora
    if (paso === 2) return !!form.telefono && !!form.direccion
    return true
  }

  async function enviar() {
    setEnviando(true); setError('')
    try {
      const token = await tokenActual()
      const res = await fetch('/api/portal/solicitar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...form, nombre: cliente?.nombre ?? 'Cliente', email: cliente?.email ?? '' }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Error al enviar')
      toast.success('¡Solicitud enviada! Te contactaremos pronto.')
      router.push('/portal/servicios')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ocurrió un error. Intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  const servSel = SERVICIOS.find((s) => s.nombre === form.servicio)

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 font-heading text-2xl font-bold text-gray-900">Agendar servicio</h1>

      {/* Stepper */}
      <div className="mb-8 flex items-center">
        {PASOS.map((p, i) => (
          <div key={p} className="flex flex-1 items-center">
            <div className="flex flex-col items-center">
              <div className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-bold transition-colors ${
                i < paso ? 'border-brand-green bg-brand-green text-white' :
                i === paso ? 'border-brand-green bg-white text-brand-green' : 'border-gray-200 bg-white text-gray-400'
              }`}>
                {i < paso ? <CheckCircle2 className="h-5 w-5" /> : i + 1}
              </div>
              <span className={`mt-1.5 hidden text-xs sm:block ${i === paso ? 'font-semibold text-brand-green' : 'text-gray-400'}`}>{p}</span>
            </div>
            {i < PASOS.length - 1 && <div className={`mx-2 h-0.5 flex-1 ${i < paso ? 'bg-brand-green' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {/* Paso 0 */}
      {paso === 0 && (
        <div className="space-y-6">
          <h2 className="font-heading text-xl font-bold text-gray-900">¿Qué servicio necesitas?</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {SERVICIOS.map((s) => (
              <button key={s.nombre} onClick={() => { set('servicio', s.nombre); set('duracion', '') }}
                className={`flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all ${form.servicio === s.nombre ? 'border-brand-green bg-green-50 shadow-md' : 'border-gray-200 hover:border-green-300 hover:bg-gray-50'}`}>
                <span className="text-3xl">{s.icono}</span>
                <span className="font-semibold text-gray-800">{s.nombre}</span>
              </button>
            ))}
          </div>
          {servSel && (
            <div className="space-y-3">
              <label className="block font-semibold text-gray-700">Duración</label>
              <div className="flex flex-wrap gap-2">
                {servSel.duraciones.map((d) => (
                  <button key={d} onClick={() => set('duracion', d)}
                    className={`rounded-lg border-2 px-4 py-2 text-sm font-medium transition-all ${form.duracion === d ? 'border-brand-green bg-green-50 text-brand-green' : 'border-gray-200 text-gray-600 hover:border-green-200'}`}>{d}</button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-3">
            <label className="block font-semibold text-gray-700">Frecuencia</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {FRECUENCIAS.map((f) => (
                <button key={f.value} onClick={() => set('frecuencia', f.value)}
                  className={`rounded-xl border-2 p-3 text-left transition-all ${form.frecuencia === f.value ? 'border-brand-green bg-green-50' : 'border-gray-200 hover:border-green-200'}`}>
                  <p className="text-sm font-semibold text-gray-800">{f.label}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{f.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Paso 1 */}
      {paso === 1 && (
        <div className="space-y-6">
          <h2 className="font-heading text-xl font-bold text-gray-900">¿Cuándo lo necesitas?</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="mb-2 flex items-center gap-2 font-semibold text-gray-700"><Calendar className="h-4 w-4 text-brand-green" /> Fecha *</label>
              <input type="date" value={form.fecha} min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                onChange={(e) => set('fecha', e.target.value)}
                className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-gray-800 outline-none transition-colors focus:border-brand-green" />
            </div>
            <div>
              <label className="mb-2 flex items-center gap-2 font-semibold text-gray-700"><Clock className="h-4 w-4 text-brand-green" /> Hora *</label>
              <select value={form.hora} onChange={(e) => set('hora', e.target.value)}
                className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-gray-800 outline-none transition-colors focus:border-brand-green">
                <option value="">Seleccionar</option>
                {HORAS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="mb-2 block font-semibold text-gray-700">Metros cuadrados aprox.</label>
              <input type="number" value={form.m2} onChange={(e) => set('m2', e.target.value)} placeholder="Ej: 80"
                className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 text-gray-800 outline-none transition-colors focus:border-brand-green" />
            </div>
            <div className="flex items-center gap-3 pt-8">
              <button onClick={() => set('mascotas', !form.mascotas)} className={`relative h-6 w-12 rounded-full transition-colors ${form.mascotas ? 'bg-brand-green' : 'bg-gray-300'}`}>
                <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${form.mascotas ? 'left-6' : 'left-0.5'}`} />
              </button>
              <span className="text-gray-700">Hay mascotas</span>
            </div>
          </div>
          <div>
            <label className="mb-2 block font-semibold text-gray-700">Notas adicionales</label>
            <textarea value={form.notas} onChange={(e) => set('notas', e.target.value)} rows={3}
              placeholder="Áreas prioritarias, acceso, materiales disponibles…"
              className="w-full resize-none rounded-xl border-2 border-gray-200 px-4 py-3 text-gray-800 outline-none transition-colors focus:border-brand-green" />
          </div>
        </div>
      )}

      {/* Paso 2 — Dirección */}
      {paso === 2 && (
        <div className="space-y-5">
          <h2 className="font-heading text-xl font-bold text-gray-900">¿Dónde será el servicio?</h2>

          {direcciones.length > 0 && (
            <div className="space-y-2">
              {direcciones.map((d) => (
                <button key={d.id} onClick={() => elegirDireccion(d.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border-2 p-3.5 text-left transition-all ${dirSel === d.id ? 'border-brand-green bg-green-50' : 'border-gray-200 hover:border-green-200'}`}>
                  <Home className="h-5 w-5 shrink-0 text-brand-green" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800">{d.etiqueta}{d.es_principal && <span className="ml-2 text-xs text-brand-green">Principal</span>}</p>
                    <p className="truncate text-xs text-gray-500">{d.direccion} — {d.barrio ? d.barrio + ', ' : ''}{d.ciudad}</p>
                  </div>
                </button>
              ))}
              <button onClick={() => elegirDireccion('nueva')}
                className={`flex w-full items-center gap-3 rounded-xl border-2 border-dashed p-3.5 text-left transition-all ${dirSel === 'nueva' ? 'border-brand-green bg-green-50' : 'border-gray-300 hover:border-green-200'}`}>
                <Plus className="h-5 w-5 text-brand-green" />
                <span className="text-sm font-semibold text-gray-700">Usar otra dirección</span>
              </button>
            </div>
          )}

          {(dirSel === 'nueva' || direcciones.length === 0) && (
            <div className="space-y-4">
              <div>
                <label className="mb-2 flex items-center gap-2 font-semibold text-gray-700"><MapPin className="h-4 w-4 text-brand-green" /> Dirección *</label>
                <input type="text" value={form.direccion} onChange={(e) => set('direccion', e.target.value)} placeholder="Calle 72 # 10-03, Apto 501"
                  className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 outline-none transition-colors focus:border-brand-green" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block font-semibold text-gray-700">Ciudad *</label>
                  <input type="text" value={form.ciudad} onChange={(e) => set('ciudad', e.target.value)}
                    className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 outline-none transition-colors focus:border-brand-green" />
                </div>
                <div>
                  <label className="mb-2 block font-semibold text-gray-700">Barrio</label>
                  <input type="text" value={form.barrio} onChange={(e) => set('barrio', e.target.value)} placeholder="Ej: Chapinero"
                    className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 outline-none transition-colors focus:border-brand-green" />
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="mb-2 flex items-center gap-2 font-semibold text-gray-700"><Phone className="h-4 w-4 text-brand-green" /> Teléfono de contacto *</label>
            <input type="tel" value={form.telefono} onChange={(e) => set('telefono', e.target.value)} placeholder="310 000 0000"
              className="w-full rounded-xl border-2 border-gray-200 px-4 py-3 outline-none transition-colors focus:border-brand-green" />
          </div>
        </div>
      )}

      {/* Paso 3 — Confirmar */}
      {paso === 3 && (
        <div className="space-y-6">
          <h2 className="font-heading text-xl font-bold text-gray-900">Confirma tu solicitud</h2>
          <div className="space-y-4 rounded-2xl border border-green-100 bg-green-50 p-6">
            <div className="flex items-center gap-3 border-b border-green-200 pb-3">
              <span className="text-3xl">{servSel?.icono}</span>
              <div>
                <p className="font-heading text-lg font-bold text-gray-900">{form.servicio}</p>
                <p className="text-sm text-gray-500">{form.duracion} · {FRECUENCIAS.find((f) => f.value === form.frecuencia)?.label}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">Fecha</span><br /><strong>{form.fecha ? new Date(form.fecha + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }) : '—'}</strong></div>
              <div><span className="text-gray-500">Hora</span><br /><strong>{form.hora}</strong></div>
              <div className="col-span-2"><span className="text-gray-500">Dirección</span><br /><strong>{form.direccion}{form.barrio ? `, ${form.barrio}` : ''} — {form.ciudad}</strong></div>
              <div><span className="text-gray-500">Teléfono</span><br /><strong>{form.telefono}</strong></div>
              {form.m2 && <div><span className="text-gray-500">Área</span><br /><strong>{form.m2} m²</strong></div>}
              {form.notas && <div className="col-span-2"><span className="text-gray-500">Notas</span><br /><strong>{form.notas}</strong></div>}
            </div>
          </div>
          <p className="text-sm text-gray-500">Un asesor confirmará el servicio y el precio final en los próximos 30 minutos. Podrás seguir el estado en «Mis servicios».</p>
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        </div>
      )}

      {/* Navegación */}
      <div className="mt-8 flex justify-between border-t border-gray-100 pt-6">
        <button onClick={() => setPaso((p) => p - 1)} disabled={paso === 0}
          className="flex items-center gap-2 rounded-xl border-2 border-gray-200 px-6 py-3 font-semibold text-gray-600 transition-colors hover:border-gray-300 disabled:opacity-40">
          <ChevronLeft className="h-4 w-4" /> Anterior
        </button>
        {paso < 3 ? (
          <button onClick={() => setPaso((p) => p + 1)} disabled={!puedeAvanzar()}
            className="flex items-center gap-2 rounded-xl bg-brand-green px-8 py-3 font-semibold text-white shadow-md transition-all hover:bg-brand-green-dark disabled:opacity-40">
            Siguiente <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <button onClick={enviar} disabled={enviando}
            className="flex items-center gap-2 rounded-xl bg-brand-green px-8 py-3 font-bold text-white shadow-md transition-all hover:bg-brand-green-dark disabled:opacity-60">
            {enviando ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando…</> : <><CheckCircle2 className="h-4 w-4" /> Confirmar</>}
          </button>
        )}
      </div>
    </div>
  )
}
