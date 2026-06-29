'use client'

import { useState, useMemo } from 'react'
import { QrCode, Barcode, Search, Check, AlertTriangle, ScanLine, Sparkles, Pencil } from 'lucide-react'
import { BarcodeGenerator, type BarcodeFormat } from '@/components/ui/BarcodeGenerator'
import { createClient } from '@/lib/supabase/client'

type Origen = 'ESCANEADO' | 'GENERADO'

interface Producto {
  id: string
  codigo: number | null
  ref: number | null
  nombre_estandar: string
  presentacion: string | null
  codigo_barras: string | null
  codigo_barras_formato: string | null
  codigo_barras_origen: string | null
}

const FORMATS: { key: BarcodeFormat; label: string; desc: string; icon: React.ReactNode }[] = [
  { key: 'QR',      label: 'QR Code',   desc: 'Texto, URL, cualquier dato',      icon: <QrCode className="w-4 h-4" /> },
  { key: 'CODE128', label: 'Code 128',  desc: 'Estándar logístico universal',    icon: <Barcode className="w-4 h-4" /> },
  { key: 'EAN13',   label: 'EAN-13',    desc: 'Retail — exactamente 12 dígitos', icon: <Barcode className="w-4 h-4" /> },
  { key: 'CODE39',  label: 'Code 39',   desc: 'Industrial, alfanumérico',        icon: <Barcode className="w-4 h-4" /> },
]

function randomDigits(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10)
  return s
}

/** Genera un valor único (no presente en `usados`) apropiado para el formato. */
function generarValorUnico(format: BarcodeFormat, usados: Set<string>): string {
  for (let i = 0; i < 60; i++) {
    let v: string
    if (format === 'EAN13') {
      // 12 dígitos (el 13° lo calcula el codificador)
      v = (Date.now().toString().slice(-6) + randomDigits(6)).slice(0, 12)
    } else {
      v = 'CI' + Date.now().toString(36).toUpperCase() + randomDigits(2)
    }
    if (!usados.has(v)) return v
  }
  // Respaldo extremadamente improbable
  return 'CI' + Date.now().toString(36).toUpperCase() + randomDigits(4)
}

const ORIGEN_BADGE: Record<Origen, { label: string; cls: string; icon: React.ReactNode }> = {
  ESCANEADO: { label: 'Escaneado del producto', cls: 'bg-blue-50 text-blue-700 border-blue-100', icon: <ScanLine className="w-3.5 h-3.5" /> },
  GENERADO:  { label: 'Generado por nosotros',  cls: 'bg-green-50 text-green-700 border-green-100', icon: <Sparkles className="w-3.5 h-3.5" /> },
}

export default function CodigosClient({ productos }: { productos: Producto[] }) {
  const supabase = createClient()

  const [prods, setProds] = useState<Producto[]>(productos)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Producto | null>(null)
  const [format, setFormat] = useState<BarcodeFormat>('CODE128')
  const [mode, setMode] = useState<'auto' | 'custom'>('auto')
  const [customValue, setCustomValue] = useState('')
  const [customOrigen, setCustomOrigen] = useState<Origen>('ESCANEADO')
  const [regenKey, setRegenKey] = useState(0)
  const [replacing, setReplacing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  // Mapa de código → producto dueño (para detectar duplicados).
  const codeOwners = useMemo(() => {
    const m = new Map<string, Producto>()
    for (const p of prods) if (p.codigo_barras) m.set(p.codigo_barras, p)
    return m
  }, [prods])

  const usados = useMemo(() => new Set(codeOwners.keys()), [codeOwners])

  const filteredProductos = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return prods.slice(0, 50)
    return prods.filter(p =>
      p.nombre_estandar.toLowerCase().includes(q) ||
      String(p.codigo ?? '').includes(q) ||
      String(p.ref ?? '').includes(q) ||
      (p.codigo_barras ?? '').toLowerCase().includes(q)
    ).slice(0, 50)
  }, [prods, search])

  // Valor autogenerado, estable por producto/formato hasta que se pida regenerar.
  const autoValue = useMemo(
    () => generarValorUnico(format, usados),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [format, selected?.id, regenKey],
  )

  const existing = selected?.codigo_barras || null
  const showingExisting = !!existing && !replacing

  let codeValue = ''
  let origen: Origen = 'GENERADO'
  if (showingExisting) {
    codeValue = existing as string
    origen = (selected?.codigo_barras_origen as Origen) || 'ESCANEADO'
  } else if (mode === 'custom') {
    codeValue = customValue
    origen = customOrigen
  } else {
    codeValue = autoValue
    origen = 'GENERADO'
  }

  const owner = codeValue ? codeOwners.get(codeValue) : undefined
  const conflicto = owner && owner.id !== selected?.id ? owner : null

  function selectProducto(p: Producto) {
    setSelected(p)
    setSaved(false)
    setAssignError(null)
    setReplacing(false)
    setMode('auto')
    setCustomValue('')
    setCustomOrigen('ESCANEADO')
  }

  function activarCustom(checked: boolean) {
    setMode(checked ? 'custom' : 'auto')
    if (checked && !customValue) setCustomValue(codeValue) // prellenar con el valor actual
  }

  function iniciarReemplazo() {
    setReplacing(true)
    setSaved(false)
    setAssignError(null)
    setMode('auto')
    setCustomValue('')
  }

  async function handleAssign(value: string, dataUrl: string) {
    if (!selected || !value || conflicto) return
    setSaving(true)
    setAssignError(null)
    try {
      // Subir imagen del código a storage
      try {
        const blob = await (await fetch(dataUrl)).blob()
        const path = `codigos/${selected.id}_${format}.png`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).storage.from('productos-fotos').upload(path, blob, { upsert: true, contentType: 'image/png' })
      } catch { /* la imagen es opcional; no bloquea la asignación */ }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('productos')
        .update({ codigo_barras: value, codigo_barras_formato: format, codigo_barras_origen: origen })
        .eq('id', selected.id)

      if (error) {
        if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) {
          setAssignError('Ese código ya está asignado a otro producto. Usa otro valor.')
        } else if (/row-level security|permission/i.test(error.message || '')) {
          setAssignError('No tienes permisos para asignar códigos.')
        } else {
          setAssignError('No se pudo asignar el código: ' + error.message)
        }
        return
      }

      // Reflejar el cambio en el estado local
      const actualizado: Producto = {
        ...selected,
        codigo_barras: value,
        codigo_barras_formato: format,
        codigo_barras_origen: origen,
      }
      setProds(prev => prev.map(p => (p.id === selected.id ? actualizado : p)))
      setSelected(actualizado)
      setReplacing(false)
      setMode('auto')
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  const formatHint =
    format === 'EAN13' ? 'EAN-13 requiere exactamente 12 dígitos (el 13° se calcula automáticamente).'
    : format === 'CODE128' ? 'Code 128 acepta cualquier texto o número.'
    : format === 'CODE39' ? 'Code 39: solo mayúsculas, dígitos y - . $ / + % espacio.'
    : 'QR acepta cualquier texto, URL o dato.'

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-4 sm:gap-5">

      {/* ── Panel izquierdo: selección ── */}
      <div className="space-y-4 min-w-0">

        {/* Formato */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <p className="font-body font-semibold text-xs text-gray-500 uppercase tracking-wide mb-3">Tipo de código</p>
          <div className="grid grid-cols-2 gap-2">
            {FORMATS.map(f => (
              <button key={f.key} onClick={() => setFormat(f.key)}
                className={`flex flex-col gap-1 p-3 rounded-xl border text-left transition-all min-w-0 ${
                  format === f.key
                    ? 'border-brand-green bg-green-50 text-brand-green'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="shrink-0">{f.icon}</span>
                  <span className="font-heading font-bold text-xs truncate">{f.label}</span>
                </div>
                <span className="font-body text-[11px] opacity-70 leading-tight">{f.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Buscar producto */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <p className="font-body font-semibold text-xs text-gray-500 uppercase tracking-wide mb-3">Asignar a producto</p>
          <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 mb-2 focus-within:border-brand-green">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar producto..."
              className="flex-1 min-w-0 font-body text-sm outline-none placeholder:text-gray-400" />
          </div>

          <div className="space-y-1 max-h-64 overflow-y-auto">
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
                  <p className="font-mono text-xs text-gray-400 truncate">
                    {p.codigo ? `Cód: ${p.codigo}` : p.ref ? `REF: ${p.ref}` : 'Sin código interno'}
                    {p.presentacion && ` · ${p.presentacion}`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {p.codigo_barras && <Barcode className="w-3.5 h-3.5 text-brand-green" />}
                  {selected?.id === p.id && <Check className="w-4 h-4 text-brand-green" />}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Panel derecho: valor + preview ── */}
      <div className="space-y-4 min-w-0">

        {/* Valor del código */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm space-y-3">
          <p className="font-body font-semibold text-xs text-gray-500 uppercase tracking-wide">Valor del código</p>

          {/* Si el producto ya tiene un código asignado */}
          {showingExisting ? (
            <div className="space-y-2.5">
              <div className="flex items-start gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
                <Check className="w-4 h-4 text-brand-green shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-body text-xs text-gray-500">Este producto ya tiene un código asignado:</p>
                  <p className="font-mono text-sm text-gray-900 break-all">{existing}</p>
                  <span className={`inline-flex items-center gap-1 mt-1.5 font-body text-[11px] px-2 py-0.5 rounded-full border ${ORIGEN_BADGE[origen].cls}`}>
                    {ORIGEN_BADGE[origen].icon} {ORIGEN_BADGE[origen].label}
                  </span>
                </div>
              </div>
              <button onClick={iniciarReemplazo}
                className="flex items-center gap-1.5 font-body text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
                <Pencil className="w-3.5 h-3.5" /> Reemplazar código
              </button>
            </div>
          ) : (
            <>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={mode === 'custom'} onChange={e => activarCustom(e.target.checked)}
                  className="accent-brand-green w-4 h-4" />
                <span className="font-body text-sm text-gray-700">Usar valor personalizado</span>
              </label>

              {mode === 'auto' ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 flex items-center gap-2 border border-gray-200 bg-gray-50 rounded-lg px-3 py-2">
                    <Sparkles className="w-4 h-4 text-brand-green shrink-0" />
                    <span className="font-mono text-sm text-gray-900 truncate">{autoValue}</span>
                  </div>
                  <button onClick={() => setRegenKey(k => k + 1)} title="Generar otro"
                    className="font-body text-xs text-gray-600 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50 transition-colors whitespace-nowrap">
                    Otro
                  </button>
                </div>
              ) : (
                <>
                  <input
                    value={customValue}
                    onChange={e => { setCustomValue(e.target.value); setSaved(false) }}
                    placeholder="Ej: 7702001234567 o CI-PROD-001"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 font-mono text-sm outline-none focus:border-brand-green"
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-body text-xs text-gray-500">Origen:</span>
                    {(['ESCANEADO', 'GENERADO'] as Origen[]).map(o => (
                      <button key={o} onClick={() => setCustomOrigen(o)}
                        className={`inline-flex items-center gap-1 font-body text-[11px] px-2 py-1 rounded-full border transition-colors ${
                          customOrigen === o ? ORIGEN_BADGE[o].cls : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                        }`}>
                        {ORIGEN_BADGE[o].icon} {ORIGEN_BADGE[o].label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <p className="font-body text-xs text-gray-400">{formatHint}</p>
            </>
          )}

          {/* Conflicto de duplicado */}
          {conflicto && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="font-body text-xs">
                Este código ya pertenece a <span className="font-semibold">{conflicto.nombre_estandar}</span>. Elige otro valor.
              </p>
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 sm:p-6 shadow-sm flex flex-col items-center gap-5 min-w-0">
          {selected && (
            <div className="w-full text-center border-b border-gray-100 pb-4">
              <p className="font-heading font-bold text-base text-gray-900">{selected.nombre_estandar}</p>
              <p className="font-body text-sm text-gray-500">{selected.presentacion}</p>
            </div>
          )}

          {codeValue && !conflicto ? (
            <>
              <BarcodeGenerator
                value={codeValue}
                format={format}
                onAssign={selected ? handleAssign : undefined}
                printLabel={{ titulo: selected?.nombre_estandar, subtitulo: selected?.presentacion }}
              />
              {!selected && (
                <p className="font-body text-xs text-gray-400 text-center">
                  Selecciona un producto para poder asignar e imprimir el código.
                </p>
              )}
              {assignError && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-red-700 font-body text-sm">
                  <AlertTriangle className="w-4 h-4" /> {assignError}
                </div>
              )}
              {saved && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2 text-green-700 font-body text-sm">
                  <Check className="w-4 h-4" /> Código asignado al producto correctamente
                </div>
              )}
              {saving && <p className="font-body text-sm text-gray-500 animate-pulse">Guardando...</p>}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-16">
              <QrCode className="w-16 h-16 text-gray-200" />
              <p className="font-body text-sm text-gray-400">
                {conflicto ? 'Resuelve el conflicto de código para ver la vista previa' : 'Selecciona un producto o ingresa un valor para generar el código'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
