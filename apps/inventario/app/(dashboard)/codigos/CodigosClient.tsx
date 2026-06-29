'use client'

import { useState, useMemo } from 'react'
import { QrCode, Barcode, Search, Check, Printer } from 'lucide-react'
import { BarcodeGenerator, type BarcodeFormat } from '@/components/ui/BarcodeGenerator'
import { createClient } from '@/lib/supabase/client'

interface Producto {
  id: string
  codigo: number | null
  ref: number | null
  nombre_estandar: string
  presentacion: string | null
}

const FORMATS: { key: BarcodeFormat; label: string; desc: string; icon: React.ReactNode }[] = [
  { key: 'QR',      label: 'QR Code',   desc: 'Texto, URL, cualquier dato',    icon: <QrCode className="w-4 h-4" /> },
  { key: 'CODE128', label: 'Code 128',  desc: 'Estándar logístico universal',  icon: <Barcode className="w-4 h-4" /> },
  { key: 'EAN13',   label: 'EAN-13',    desc: 'Retail — exactamente 12 dígitos', icon: <Barcode className="w-4 h-4" /> },
  { key: 'CODE39',  label: 'Code 39',   desc: 'Industrial, alfanumérico',       icon: <Barcode className="w-4 h-4" /> },
]

function generateSerial(productoId: string): string {
  const ts = Date.now().toString(36).toUpperCase()
  const suffix = productoId.replace(/-/g, '').slice(0, 6).toUpperCase()
  return `CI${suffix}${ts}`
}

export default function CodigosClient({ productos }: { productos: Producto[] }) {
  const supabase = createClient()

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Producto | null>(null)
  const [format, setFormat] = useState<BarcodeFormat>('CODE128')
  const [customValue, setCustomValue] = useState('')
  const [useCustom, setUseCustom] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const filteredProductos = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return productos.slice(0, 50)
    return productos.filter(p =>
      p.nombre_estandar.toLowerCase().includes(q) ||
      String(p.codigo ?? '').includes(q) ||
      String(p.ref ?? '').includes(q)
    ).slice(0, 50)
  }, [productos, search])

  function selectProducto(p: Producto) {
    setSelected(p)
    setSaved(false)
    const defaultVal = p.codigo ? String(p.codigo) : p.ref ? String(p.ref) : generateSerial(p.id)
    setCustomValue(defaultVal)
    setUseCustom(false)
  }

  const codeValue = useCustom
    ? customValue
    : selected
      ? (selected.codigo ? String(selected.codigo) : selected.ref ? String(selected.ref) : generateSerial(selected.id))
      : customValue

  async function handleAssign(value: string, dataUrl: string) {
    if (!selected) return
    setSaving(true)
    try {
      // Subir imagen del código a storage
      const blob = await (await fetch(dataUrl)).blob()
      const path = `codigos/${selected.id}_${format}.png`
      await (supabase as any).storage.from('productos-fotos').upload(path, blob, { upsert: true, contentType: 'image/png' })

      // Actualizar el campo codigo del producto si es numérico
      if (/^\d+$/.test(value)) {
        await (supabase as any).from('productos').update({ codigo: parseInt(value) }).eq('id', selected.id)
      }
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid lg:grid-cols-[380px_1fr] gap-5">

      {/* ── Panel izquierdo: selección ── */}
      <div className="space-y-4">

        {/* Formato */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <p className="font-body font-semibold text-xs text-gray-500 uppercase tracking-wide mb-3">Tipo de código</p>
          <div className="grid grid-cols-2 gap-2">
            {FORMATS.map(f => (
              <button key={f.key} onClick={() => setFormat(f.key)}
                className={`flex flex-col gap-1 p-3 rounded-xl border text-left transition-all ${
                  format === f.key
                    ? 'border-brand-green bg-green-50 text-brand-green'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}>
                <div className="flex items-center gap-1.5">
                  {f.icon}
                  <span className="font-heading font-bold text-xs">{f.label}</span>
                </div>
                <span className="font-body text-xs opacity-70 leading-tight">{f.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Valor del código */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm space-y-3">
          <p className="font-body font-semibold text-xs text-gray-500 uppercase tracking-wide">Valor del código</p>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={useCustom} onChange={e => setUseCustom(e.target.checked)}
              className="accent-brand-green w-4 h-4" />
            <span className="font-body text-sm text-gray-700">Usar valor personalizado</span>
          </label>

          <input
            value={useCustom ? customValue : codeValue}
            onChange={e => { setCustomValue(e.target.value); setUseCustom(true) }}
            placeholder="Ej: 7702001234567 o CI-PROD-001"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 font-mono text-sm outline-none focus:border-brand-green"
          />
          <p className="font-body text-xs text-gray-400">
            {format === 'EAN13' && 'EAN-13 requiere exactamente 12 dígitos (el 13° se calcula automáticamente).'}
            {format === 'CODE128' && 'Code 128 acepta cualquier texto o número.'}
            {format === 'CODE39' && 'Code 39: solo mayúsculas, dígitos y - . $ / + % SPACE.'}
            {format === 'QR' && 'QR acepta cualquier texto, URL o dato.'}
          </p>
        </div>

        {/* Buscar producto */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <p className="font-body font-semibold text-xs text-gray-500 uppercase tracking-wide mb-3">Asignar a producto</p>
          <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 mb-2 focus-within:border-brand-green">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar producto..."
              className="flex-1 font-body text-sm outline-none placeholder:text-gray-400" />
          </div>

          <div className="space-y-1 max-h-52 overflow-y-auto">
            {filteredProductos.length === 0 && (
              <p className="font-body text-xs text-gray-400 text-center py-4">Sin resultados</p>
            )}
            {filteredProductos.map(p => (
              <button key={p.id} onClick={() => selectProducto(p)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center justify-between gap-2 ${
                  selected?.id === p.id ? 'bg-green-50 border border-brand-green' : 'hover:bg-gray-50'
                }`}>
                <div className="min-w-0">
                  <p className="font-body text-sm font-medium text-gray-900 truncate">{p.nombre_estandar}</p>
                  <p className="font-mono text-xs text-gray-400">
                    {p.codigo ? `Cód: ${p.codigo}` : p.ref ? `REF: ${p.ref}` : 'Sin código'}
                    {p.presentacion && ` · ${p.presentacion}`}
                  </p>
                </div>
                {selected?.id === p.id && <Check className="w-4 h-4 text-brand-green shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Panel derecho: preview ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm flex flex-col items-center gap-5">
        {selected && (
          <div className="w-full text-center border-b border-gray-100 pb-4">
            <p className="font-heading font-bold text-base text-gray-900">{selected.nombre_estandar}</p>
            <p className="font-body text-sm text-gray-500">{selected.presentacion}</p>
          </div>
        )}

        {codeValue ? (
          <>
            <BarcodeGenerator
              value={codeValue}
              format={format}
              onAssign={selected ? handleAssign : undefined}
            />
            {saved && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2 text-green-700 font-body text-sm">
                <Check className="w-4 h-4" />
                Código asignado al producto correctamente
              </div>
            )}
            {saving && (
              <p className="font-body text-sm text-gray-500 animate-pulse">Guardando...</p>
            )}

            <button onClick={() => window.print()}
              className="flex items-center gap-2 border border-gray-200 rounded-xl px-4 py-2 font-body text-sm text-gray-600 hover:bg-gray-50 transition-colors">
              <Printer className="w-4 h-4" />
              Imprimir etiqueta
            </button>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-16">
            <QrCode className="w-16 h-16 text-gray-200" />
            <p className="font-body text-sm text-gray-400">Selecciona un producto o ingresa un valor<br />para generar el código</p>
          </div>
        )}
      </div>
    </div>
  )
}
