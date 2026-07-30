'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CheckCircle2, ChevronRight, ChevronLeft, Loader2, Calendar, Clock, MapPin, User, Phone, Mail, Home } from 'lucide-react'

const SERVICIOS = [
  { nombre: 'Aseo Regular',        icono: '🧹', duraciones: ['2 horas','Medio día','Día completo'] },
  { nombre: 'Limpieza Profunda',   icono: '✨', duraciones: ['Medio día','Día completo','2 personas - Medio día'] },
  { nombre: 'Post-Obra',           icono: '🏗️', duraciones: ['Cotización personalizada'] },
  { nombre: 'Atención en Eventos', icono: '🎉', duraciones: ['4h · 1 persona','8h · 1 persona','8h · 2 personas','12h · 2 personas'] },
  { nombre: 'Servicio de Cocina',  icono: '🍳', duraciones: ['Medio día','Día completo'] },
  { nombre: 'Jardín y Exteriores', icono: '🌿', duraciones: ['2 horas','Medio día'] },
]

const FRECUENCIAS = [
  { value: 'UNICA',      label: 'Una vez',     desc: 'Servicio puntual sin compromiso' },
  { value: 'SEMANAL',    label: 'Semanal',     desc: 'Cada semana, con descuento' },
  { value: 'QUINCENAL',  label: 'Quincenal',   desc: 'Cada 15 días, con descuento' },
  { value: 'MENSUAL',    label: 'Mensual',     desc: 'Una vez al mes, con descuento' },
]

const HORAS = ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00']

const PASOS = ['Servicio', 'Horario', 'Tus datos', 'Confirmar']

interface Form {
  servicio: string; duracion: string; frecuencia: string
  fecha: string; hora: string; mascotas: boolean; m2: string; notas: string
  nombre: string; email: string; telefono: string
  direccion: string; ciudad: string; barrio: string
}

const EMPTY: Form = {
  servicio:'', duracion:'', frecuencia:'UNICA',
  fecha:'', hora:'', mascotas: false, m2:'', notas:'',
  nombre:'', email:'', telefono:'',
  direccion:'', ciudad:'Bogotá', barrio:'',
}

export default function SolicitudWizard() {
  const params = useSearchParams()
  const router = useRouter()
  const servicioInicial = params.get('servicio') ?? ''

  const [paso, setPaso] = useState(servicioInicial ? 1 : 0)
  const [form, setForm] = useState<Form>({ ...EMPTY, servicio: servicioInicial })
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm(p => ({ ...p, [k]: v }))
  }

  function puedeAvanzar() {
    if (paso === 0) return !!form.servicio && !!form.duracion && !!form.frecuencia
    if (paso === 1) return !!form.fecha && !!form.hora
    if (paso === 2) return !!form.nombre && !!form.email && !!form.telefono && !!form.direccion
    return true
  }

  async function enviar() {
    setEnviando(true)
    setError('')
    try {
      const res = await fetch('/api/servicios-hogar/solicitar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Error al enviar')
      router.push('/servicios-hogar/solicitar/confirmacion')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ocurrió un error. Intenta de nuevo.')
    } finally {
      setEnviando(false)
    }
  }

  const servSel = SERVICIOS.find(s => s.nombre === form.servicio)

  return (
    <div className="max-w-2xl mx-auto">
      {/* Stepper */}
      <div className="flex items-center mb-10">
        {PASOS.map((p, i) => (
          <div key={p} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                i < paso  ? 'bg-brand-green border-brand-green text-white' :
                i === paso ? 'bg-white border-brand-green text-brand-green' :
                             'bg-white border-gray-200 text-gray-400'
              }`}>
                {i < paso ? <CheckCircle2 className="w-5 h-5" /> : i + 1}
              </div>
              <span className={`text-xs font-body mt-1.5 hidden sm:block ${i === paso ? 'text-brand-green font-semibold' : 'text-gray-400'}`}>{p}</span>
            </div>
            {i < PASOS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 ${i < paso ? 'bg-brand-green' : 'bg-gray-200'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Paso 0 — Elegir servicio */}
      {paso === 0 && (
        <div className="space-y-6">
          <h2 className="font-heading font-bold text-2xl text-gray-900">¿Qué servicio necesitas?</h2>

          <div className="grid sm:grid-cols-2 gap-3">
            {SERVICIOS.map(s => (
              <button key={s.nombre} onClick={() => { set('servicio', s.nombre); set('duracion', '') }}
                className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                  form.servicio === s.nombre
                    ? 'border-brand-green bg-green-50 shadow-md'
                    : 'border-gray-200 hover:border-green-300 hover:bg-gray-50'
                }`}>
                <span className="text-3xl">{s.icono}</span>
                <span className="font-body font-semibold text-gray-800">{s.nombre}</span>
              </button>
            ))}
          </div>

          {servSel && (
            <div className="space-y-3">
              <label className="font-body font-semibold text-gray-700 block">Duración</label>
              <div className="flex flex-wrap gap-2">
                {servSel.duraciones.map(d => (
                  <button key={d} onClick={() => set('duracion', d)}
                    className={`px-4 py-2 rounded-lg border-2 text-sm font-body font-medium transition-all ${
                      form.duracion === d ? 'border-brand-green bg-green-50 text-brand-green' : 'border-gray-200 text-gray-600 hover:border-green-200'
                    }`}>{d}</button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3">
            <label className="font-body font-semibold text-gray-700 block">Frecuencia</label>
            <div className="grid sm:grid-cols-2 gap-2">
              {FRECUENCIAS.map(f => (
                <button key={f.value} onClick={() => set('frecuencia', f.value)}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${
                    form.frecuencia === f.value ? 'border-brand-green bg-green-50' : 'border-gray-200 hover:border-green-200'
                  }`}>
                  <p className="font-body font-semibold text-gray-800 text-sm">{f.label}</p>
                  <p className="text-xs text-gray-500 font-body mt-0.5">{f.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Paso 1 — Horario */}
      {paso === 1 && (
        <div className="space-y-6">
          <h2 className="font-heading font-bold text-2xl text-gray-900">¿Cuándo lo necesitas?</h2>

          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label className="flex items-center gap-2 font-body font-semibold text-gray-700 mb-2">
                <Calendar className="w-4 h-4 text-brand-green" /> Fecha *
              </label>
              <input type="date" value={form.fecha}
                min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                onChange={e => set('fecha', e.target.value)}
                className="w-full border-2 border-gray-200 focus:border-brand-green rounded-xl px-4 py-3 text-gray-800 font-body outline-none transition-colors" />
            </div>
            <div>
              <label className="flex items-center gap-2 font-body font-semibold text-gray-700 mb-2">
                <Clock className="w-4 h-4 text-brand-green" /> Hora de inicio *
              </label>
              <select value={form.hora} onChange={e => set('hora', e.target.value)}
                className="w-full border-2 border-gray-200 focus:border-brand-green rounded-xl px-4 py-3 text-gray-800 font-body outline-none transition-colors">
                <option value="">Seleccionar hora</option>
                {HORAS.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <label className="font-body font-semibold text-gray-700 mb-2 block">Metros cuadrados aprox.</label>
              <input type="number" value={form.m2} onChange={e => set('m2', e.target.value)}
                placeholder="Ej: 80"
                className="w-full border-2 border-gray-200 focus:border-brand-green rounded-xl px-4 py-3 text-gray-800 font-body outline-none transition-colors" />
            </div>
            <div className="flex items-center gap-3 pt-8">
              <button onClick={() => set('mascotas', !form.mascotas)}
                className={`w-12 h-6 rounded-full transition-colors relative ${form.mascotas ? 'bg-brand-green' : 'bg-gray-300'}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-all ${form.mascotas ? 'left-6' : 'left-0.5'}`} />
              </button>
              <span className="font-body text-gray-700">Hay mascotas en el hogar</span>
            </div>
          </div>

          <div>
            <label className="font-body font-semibold text-gray-700 mb-2 block">Notas adicionales</label>
            <textarea value={form.notas} onChange={e => set('notas', e.target.value)}
              placeholder="Indícanos algo especial: áreas prioritarias, acceso, materiales de limpieza disponibles, etc."
              rows={3}
              className="w-full border-2 border-gray-200 focus:border-brand-green rounded-xl px-4 py-3 text-gray-800 font-body outline-none resize-none transition-colors" />
          </div>
        </div>
      )}

      {/* Paso 2 — Datos del cliente */}
      {paso === 2 && (
        <div className="space-y-6">
          <h2 className="font-heading font-bold text-2xl text-gray-900">Tus datos de contacto</h2>

          <div className="space-y-4">
            <div>
              <label className="flex items-center gap-2 font-body font-semibold text-gray-700 mb-2">
                <User className="w-4 h-4 text-brand-green" /> Nombre completo *
              </label>
              <input type="text" value={form.nombre} onChange={e => set('nombre', e.target.value)}
                placeholder="Tu nombre completo"
                className="w-full border-2 border-gray-200 focus:border-brand-green rounded-xl px-4 py-3 font-body outline-none transition-colors" />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-2 font-body font-semibold text-gray-700 mb-2">
                  <Mail className="w-4 h-4 text-brand-green" /> Correo electrónico *
                </label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                  placeholder="correo@ejemplo.com"
                  className="w-full border-2 border-gray-200 focus:border-brand-green rounded-xl px-4 py-3 font-body outline-none transition-colors" />
              </div>
              <div>
                <label className="flex items-center gap-2 font-body font-semibold text-gray-700 mb-2">
                  <Phone className="w-4 h-4 text-brand-green" /> Teléfono *
                </label>
                <input type="tel" value={form.telefono} onChange={e => set('telefono', e.target.value)}
                  placeholder="310 000 0000"
                  className="w-full border-2 border-gray-200 focus:border-brand-green rounded-xl px-4 py-3 font-body outline-none transition-colors" />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 font-body font-semibold text-gray-700 mb-2">
                <MapPin className="w-4 h-4 text-brand-green" /> Dirección *
              </label>
              <input type="text" value={form.direccion} onChange={e => set('direccion', e.target.value)}
                placeholder="Calle 72 # 10-03, Apto 501"
                className="w-full border-2 border-gray-200 focus:border-brand-green rounded-xl px-4 py-3 font-body outline-none transition-colors" />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-2 font-body font-semibold text-gray-700 mb-2">
                  <Home className="w-4 h-4 text-brand-green" /> Ciudad *
                </label>
                <input type="text" value={form.ciudad} onChange={e => set('ciudad', e.target.value)}
                  className="w-full border-2 border-gray-200 focus:border-brand-green rounded-xl px-4 py-3 font-body outline-none transition-colors" />
              </div>
              <div>
                <label className="font-body font-semibold text-gray-700 mb-2 block">Barrio</label>
                <input type="text" value={form.barrio} onChange={e => set('barrio', e.target.value)}
                  placeholder="Ej: Chapinero, Usaquén..."
                  className="w-full border-2 border-gray-200 focus:border-brand-green rounded-xl px-4 py-3 font-body outline-none transition-colors" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Paso 3 — Resumen */}
      {paso === 3 && (
        <div className="space-y-6">
          <h2 className="font-heading font-bold text-2xl text-gray-900">Confirma tu solicitud</h2>

          <div className="bg-green-50 border border-green-100 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-green-200">
              <span className="text-3xl">{servSel?.icono}</span>
              <div>
                <p className="font-heading font-bold text-gray-900 text-lg">{form.servicio}</p>
                <p className="text-gray-500 font-body text-sm">{form.duracion} · {FRECUENCIAS.find(f => f.value === form.frecuencia)?.label}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm font-body">
              <div><span className="text-gray-500">Fecha</span><br /><strong>{form.fecha ? new Date(form.fecha + 'T12:00:00').toLocaleDateString('es-CO', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) : '—'}</strong></div>
              <div><span className="text-gray-500">Hora</span><br /><strong>{form.hora}</strong></div>
              <div><span className="text-gray-500">Nombre</span><br /><strong>{form.nombre}</strong></div>
              <div><span className="text-gray-500">Teléfono</span><br /><strong>{form.telefono}</strong></div>
              <div className="col-span-2"><span className="text-gray-500">Dirección</span><br /><strong>{form.direccion}, {form.barrio} — {form.ciudad}</strong></div>
              {form.m2 && <div><span className="text-gray-500">Área aprox.</span><br /><strong>{form.m2} m²</strong></div>}
              {form.mascotas && <div><span className="text-gray-500">Mascotas</span><br /><strong>Sí</strong></div>}
              {form.notas && <div className="col-span-2"><span className="text-gray-500">Notas</span><br /><strong>{form.notas}</strong></div>}
            </div>
          </div>

          <p className="text-sm text-gray-500 font-body">
            Al confirmar, un asesor de Conserjes Inmobiliarios te contactará en los próximos 30 minutos para confirmar el servicio y darte el precio final.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 font-body text-sm">{error}</div>
          )}
        </div>
      )}

      {/* Navegación */}
      <div className="flex justify-between mt-10 pt-6 border-t border-gray-100">
        <button onClick={() => setPaso(p => p - 1)} disabled={paso === 0}
          className="flex items-center gap-2 px-6 py-3 border-2 border-gray-200 rounded-xl font-body font-semibold text-gray-600 hover:border-gray-300 disabled:opacity-40 transition-colors">
          <ChevronLeft className="w-4 h-4" /> Anterior
        </button>

        {paso < 3 ? (
          <button onClick={() => setPaso(p => p + 1)} disabled={!puedeAvanzar()}
            className="flex items-center gap-2 px-8 py-3 bg-brand-green text-white rounded-xl font-body font-semibold hover:bg-brand-green-dark disabled:opacity-40 shadow-md transition-all">
            Siguiente <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <button onClick={enviar} disabled={enviando}
            className="flex items-center gap-2 px-8 py-3 bg-brand-green text-white rounded-xl font-body font-bold hover:bg-brand-green-dark disabled:opacity-60 shadow-md transition-all">
            {enviando ? <><Loader2 className="w-4 h-4 animate-spin" /> Enviando...</> : <><CheckCircle2 className="w-4 h-4" /> Confirmar solicitud</>}
          </button>
        )}
      </div>
    </div>
  )
}
