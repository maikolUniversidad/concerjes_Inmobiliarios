'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Save, Loader2, Plus, Pencil, Trash2, X, CheckCircle2, CreditCard, SlidersHorizontal, Eye, EyeOff,
} from 'lucide-react'
import { guardarParametrosPago, upsertMetodoPago, eliminarMetodoPago } from '../pagos-actions'

const TIPOS = [
  { value: 'TRANSFERENCIA', label: 'Transferencia bancaria' },
  { value: 'BILLETERA',     label: 'Billetera digital' },
  { value: 'EFECTIVO',      label: 'Efectivo' },
  { value: 'PASARELA',      label: 'Pasarela / link de pago' },
  { value: 'TARJETA',       label: 'Tarjeta' },
  { value: 'DATAFONO',      label: 'Datáfono' },
]

const METODO_VACIO = {
  codigo: '', nombre: '', tipo: 'TRANSFERENCIA', icono: '🏦', instrucciones: '',
  titular: '', entidad: '', numero_cuenta: '', tipo_cuenta: '', url_pago: '',
  requiere_comprobante: true, requiere_referencia: false,
  visible_cliente: true, activo: true, orden: 0,
}

export default function ParametrosPagoClient({ parametros, metodos }: { parametros: any; metodos: any[] }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [tab, setTab] = useState<'politica' | 'metodos'>('politica')

  return (
    <div className="space-y-6">
      <div className="flex rounded-xl bg-gray-100 p-1 max-w-md">
        <button onClick={() => setTab('politica')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-colors ${tab === 'politica' ? 'bg-white text-brand-green shadow-sm' : 'text-gray-500'}`}>
          <SlidersHorizontal className="w-4 h-4" /> Política de cobro
        </button>
        <button onClick={() => setTab('metodos')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-colors ${tab === 'metodos' ? 'bg-white text-brand-green shadow-sm' : 'text-gray-500'}`}>
          <CreditCard className="w-4 h-4" /> Formas de pago
        </button>
      </div>

      {tab === 'politica'
        ? <Politica parametros={parametros} onGuardado={() => startTransition(() => router.refresh())} />
        : <Metodos metodos={metodos} onCambio={() => startTransition(() => router.refresh())} />}
    </div>
  )
}

// ── Política de cobro ────────────────────────────────────────────────────────

function Politica({ parametros, onGuardado }: { parametros: any; onGuardado: () => void }) {
  const [f, setF] = useState<any>(parametros ?? {})
  const [guardando, setGuardando] = useState(false)
  const [ok, setOk] = useState(false)
  const [error, setError] = useState('')

  function set(k: string, v: any) { setF((p: any) => ({ ...p, [k]: v })); setOk(false) }

  async function guardar() {
    setError(''); setGuardando(true)
    try {
      await guardarParametrosPago({
        ...f,
        iva_porcentaje: Number(f.iva_porcentaje ?? 0),
        anticipo_porcentaje: Number(f.anticipo_porcentaje ?? 0),
        dias_vencimiento: Number(f.dias_vencimiento ?? 0),
        recargo_mora_porcentaje: Number(f.recargo_mora_porcentaje ?? 0),
      })
      setOk(true)
      onGuardado()
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo guardar.')
    } finally {
      setGuardando(false)
    }
  }

  if (!parametros) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-sm text-gray-400">
        No se encontró la parametrización de pagos. Aplica la migración de pagos y vuelve a intentarlo.
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <Seccion titulo="Impuestos y moneda">
        <div className="grid sm:grid-cols-3 gap-3">
          <Campo label="Moneda">
            <input value={f.moneda ?? ''} onChange={(e) => set('moneda', e.target.value.toUpperCase())} className={inputCls} />
          </Campo>
          <Campo label="IVA (%)">
            <input type="number" value={f.iva_porcentaje ?? 0} onChange={(e) => set('iva_porcentaje', e.target.value)} className={inputCls} />
          </Campo>
          <Interruptor label="Los precios ya incluyen IVA" valor={!!f.precios_incluyen_iva}
            onCambio={(v) => set('precios_incluyen_iva', v)} />
        </div>
        <p className="text-xs text-gray-400">
          Si los precios incluyen IVA, el impuesto se discrimina dentro del total; si no, se suma al subtotal.
        </p>
      </Seccion>

      <Seccion titulo="Plazos y anticipos">
        <div className="grid sm:grid-cols-3 gap-3">
          <Campo label="Días para pagar">
            <input type="number" value={f.dias_vencimiento ?? 0} onChange={(e) => set('dias_vencimiento', e.target.value)} className={inputCls} />
          </Campo>
          <Campo label="Anticipo (%)">
            <input type="number" value={f.anticipo_porcentaje ?? 0} onChange={(e) => set('anticipo_porcentaje', e.target.value)} className={inputCls} />
          </Campo>
          <Campo label="Recargo por mora (%)">
            <input type="number" value={f.recargo_mora_porcentaje ?? 0} onChange={(e) => set('recargo_mora_porcentaje', e.target.value)} className={inputCls} />
          </Campo>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Interruptor label="Exigir anticipo para confirmar" valor={!!f.requiere_anticipo} onCambio={(v) => set('requiere_anticipo', v)} />
          <Interruptor label="Permitir abonos parciales" valor={!!f.permitir_pago_parcial} onCambio={(v) => set('permitir_pago_parcial', v)} />
        </div>
      </Seccion>

      <Seccion titulo="Numeración y avisos">
        <div className="grid sm:grid-cols-3 gap-3">
          <Campo label="Prefijo de la cuenta de cobro">
            <input value={f.prefijo_cobro ?? ''} onChange={(e) => set('prefijo_cobro', e.target.value.toUpperCase())} className={inputCls} />
          </Campo>
          <Campo label="Consecutivo actual">
            <input value={f.consecutivo ?? 0} readOnly className={`${inputCls} bg-gray-50 text-gray-400`} />
          </Campo>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Interruptor label="Avisar en el portal del cliente" valor={!!f.notificar_portal} onCambio={(v) => set('notificar_portal', v)} />
          <Interruptor label="Enviar aviso por correo" valor={!!f.notificar_email} onCambio={(v) => set('notificar_email', v)} />
        </div>
        <Campo label="URL del portal de clientes">
          <input value={f.url_portal ?? ''} onChange={(e) => set('url_portal', e.target.value)}
            placeholder="https://www.conserjesinmobiliarios.com" className={inputCls} />
        </Campo>
        <p className="text-xs text-gray-400">
          El correo usa la integración SMTP configurada en Integraciones; si no está activa, el aviso queda encolado.
          La URL del portal hace que el enlace del correo lleve al cliente a su cuenta de cobro (y no a esta app interna).
        </p>
      </Seccion>

      <Seccion titulo="Textos que ve el cliente">
        <Campo label="Instrucciones de pago">
          <textarea rows={3} value={f.instrucciones_pago ?? ''} onChange={(e) => set('instrucciones_pago', e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Política de cancelación">
          <textarea rows={2} value={f.politica_cancelacion ?? ''} onChange={(e) => set('politica_cancelacion', e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Términos del servicio">
          <textarea rows={2} value={f.terminos ?? ''} onChange={(e) => set('terminos', e.target.value)} className={inputCls} />
        </Campo>
      </Seccion>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={guardar} disabled={guardando}
          className="flex items-center gap-2 bg-brand-green text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-green-dark disabled:opacity-50">
          {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar parámetros
        </button>
        {ok && <span className="flex items-center gap-1.5 text-sm text-brand-green"><CheckCircle2 className="w-4 h-4" /> Guardado</span>}
      </div>
    </div>
  )
}

// ── Formas de pago ───────────────────────────────────────────────────────────

function Metodos({ metodos, onCambio }: { metodos: any[]; onCambio: () => void }) {
  const [modal, setModal] = useState<any | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function guardar() {
    setError(''); setGuardando(true)
    try {
      await upsertMetodoPago({ ...modal, orden: Number(modal.orden ?? 0) })
      setModal(null)
      onCambio()
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo guardar la forma de pago.')
    } finally {
      setGuardando(false)
    }
  }

  async function eliminar(id: string) {
    if (!confirm('¿Eliminar esta forma de pago? Los pagos ya registrados la conservan por nombre.')) return
    await eliminarMetodoPago(id).catch((e: any) => alert(e?.message ?? 'No se pudo eliminar.'))
    onCambio()
  }

  async function alternar(m: any, campo: 'activo' | 'visible_cliente') {
    await upsertMetodoPago({ ...m, [campo]: !m[campo] }).catch((e: any) => alert(e?.message ?? 'No se pudo actualizar.'))
    onCambio()
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex justify-between items-center">
        <p className="text-sm text-gray-500">Estas son las formas de pago que el cliente ve en su cuenta de cobro.</p>
        <button onClick={() => setModal({ ...METODO_VACIO, orden: metodos.length + 1 })}
          className="flex items-center gap-2 bg-brand-green text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-green-dark shrink-0">
          <Plus className="w-4 h-4" /> Nueva forma de pago
        </button>
      </div>

      {metodos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-sm text-gray-400">
          Aún no hay formas de pago configuradas.
        </div>
      ) : (
        <div className="space-y-2.5">
          {metodos.map((m) => (
            <div key={m.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-4">
              <span className="text-2xl shrink-0">{m.icono ?? '💳'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-gray-900 truncate">{m.nombre}</span>
                  <span className="text-xs text-gray-400 font-mono">{m.codigo}</span>
                  {!m.activo && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500">Inactiva</span>}
                  {m.activo && !m.visible_cliente && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">Oculta al cliente</span>}
                </div>
                <p className="text-xs text-gray-500 truncate">
                  {TIPOS.find((t) => t.value === m.tipo)?.label ?? m.tipo}
                  {m.entidad ? ` · ${m.entidad}` : ''}
                  {m.numero_cuenta ? ` · ${m.numero_cuenta}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => alternar(m, 'visible_cliente')} title="Mostrar/ocultar al cliente"
                  className="p-2 text-gray-400 hover:text-brand-green">
                  {m.visible_cliente ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                </button>
                <button onClick={() => alternar(m, 'activo')} title="Activar/desactivar"
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${m.activo ? 'border-green-200 text-brand-green' : 'border-gray-200 text-gray-400'}`}>
                  {m.activo ? 'Activa' : 'Inactiva'}
                </button>
                <button onClick={() => setModal({ ...m })} className="p-2 text-gray-400 hover:text-brand-green"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => eliminar(m.id)} className="p-2 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 my-8 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-gray-900">{modal.id ? 'Editar forma de pago' : 'Nueva forma de pago'}</h2>
              <button onClick={() => setModal(null)} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid sm:grid-cols-3 gap-3">
              <Campo label="Código">
                <input value={modal.codigo} onChange={(e) => setModal({ ...modal, codigo: e.target.value })}
                  disabled={!!modal.id} className={`${inputCls} ${modal.id ? 'bg-gray-50 text-gray-400' : ''}`} />
              </Campo>
              <Campo label="Nombre">
                <input value={modal.nombre} onChange={(e) => setModal({ ...modal, nombre: e.target.value })} className={inputCls} />
              </Campo>
              <Campo label="Icono">
                <input value={modal.icono ?? ''} onChange={(e) => setModal({ ...modal, icono: e.target.value })} className={inputCls} />
              </Campo>
            </div>

            <Campo label="Tipo">
              <select value={modal.tipo} onChange={(e) => setModal({ ...modal, tipo: e.target.value })} className={inputCls}>
                {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Campo>

            <Campo label="Instrucciones para el cliente">
              <textarea rows={2} value={modal.instrucciones ?? ''} onChange={(e) => setModal({ ...modal, instrucciones: e.target.value })} className={inputCls} />
            </Campo>

            <div className="grid sm:grid-cols-2 gap-3">
              <Campo label="Entidad / banco">
                <input value={modal.entidad ?? ''} onChange={(e) => setModal({ ...modal, entidad: e.target.value })} className={inputCls} />
              </Campo>
              <Campo label="Titular de la cuenta">
                <input value={modal.titular ?? ''} onChange={(e) => setModal({ ...modal, titular: e.target.value })} className={inputCls} />
              </Campo>
              <Campo label="Número de cuenta / celular">
                <input value={modal.numero_cuenta ?? ''} onChange={(e) => setModal({ ...modal, numero_cuenta: e.target.value })} className={inputCls} />
              </Campo>
              <Campo label="Tipo de cuenta">
                <input value={modal.tipo_cuenta ?? ''} onChange={(e) => setModal({ ...modal, tipo_cuenta: e.target.value })}
                  placeholder="Ahorros / Corriente / Celular" className={inputCls} />
              </Campo>
            </div>

            <Campo label="URL de pago (pasarela)">
              <input value={modal.url_pago ?? ''} onChange={(e) => setModal({ ...modal, url_pago: e.target.value })}
                placeholder="https://checkout.tu-pasarela.com/..." className={inputCls} />
            </Campo>

            <div className="grid sm:grid-cols-2 gap-3">
              <Interruptor label="Exigir comprobante" valor={!!modal.requiere_comprobante}
                onCambio={(v) => setModal({ ...modal, requiere_comprobante: v })} />
              <Interruptor label="Exigir número de referencia" valor={!!modal.requiere_referencia}
                onCambio={(v) => setModal({ ...modal, requiere_referencia: v })} />
              <Interruptor label="Visible para el cliente" valor={!!modal.visible_cliente}
                onCambio={(v) => setModal({ ...modal, visible_cliente: v })} />
              <Interruptor label="Activa" valor={!!modal.activo}
                onCambio={(v) => setModal({ ...modal, activo: v })} />
            </div>

            <Campo label="Orden">
              <input type="number" value={modal.orden ?? 0} onChange={(e) => setModal({ ...modal, orden: e.target.value })} className={inputCls} />
            </Campo>

            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <button onClick={guardar} disabled={guardando}
              className="flex w-full items-center justify-center gap-2 bg-brand-green text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-green-dark disabled:opacity-50">
              {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── UI compartida ────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-green'

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
      <h2 className="font-semibold text-gray-900">{titulo}</h2>
      {children}
    </section>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-500">{label}</span>
      {children}
    </label>
  )
}

function Interruptor({ label, valor, onCambio }: { label: string; valor: boolean; onCambio: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onCambio(!valor)}
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
        valor ? 'border-green-200 bg-green-50 text-brand-green' : 'border-gray-200 text-gray-500'
      }`}
    >
      <span className="text-left">{label}</span>
      <span className={`h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors ${valor ? 'bg-brand-green' : 'bg-gray-300'}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${valor ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  )
}
