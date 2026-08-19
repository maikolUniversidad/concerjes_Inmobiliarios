'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Sparkles, CornerDownLeft, ArrowRight } from 'lucide-react'
import { navegacionVisible } from '@/components/layout/navigation'
import { usePermisos } from '@/components/permisos/PermisosProvider'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

interface Destino { label: string; href: string; modulo: string }

/**
 * Buscador inteligente de la barra superior: escribe el nombre de un módulo y te
 * lleva ahí; si no coincide con ninguno (o es una pregunta), te lleva al
 * Asistente IA con esa consulta. Respeta permisos: solo sugiere lo que puedes ver.
 */
export function TopSearch() {
  const router = useRouter()
  const { puede } = usePermisos()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [activo, setActivo] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)

  // Lista plana de destinos visibles según permisos.
  const destinos = useMemo<Destino[]>(() => {
    return navegacionVisible(puede).flatMap((mod) =>
      mod.items.map((it) => ({ label: it.label, href: it.href, modulo: mod.title })),
    )
  }, [puede])

  const matches = useMemo(() => {
    const query = norm(q.trim())
    if (!query) return []
    const tokens = query.split(/\s+/)
    return destinos
      .filter((d) => {
        const hay = norm(`${d.label} ${d.modulo}`)
        return tokens.every((t) => hay.includes(t))
      })
      .slice(0, 6)
  }, [q, destinos])

  const tieneTexto = q.trim().length > 0
  // Opciones = módulos que coinciden + (siempre) preguntar a la IA.
  const totalOpciones = matches.length + (tieneTexto ? 1 : 0)
  const idxIA = matches.length // la opción IA va al final

  function irA(href: string) {
    setQ(''); setOpen(false)
    router.push(href)
  }
  function preguntarIA() {
    const pregunta = q.trim()
    if (!pregunta) return
    setQ(''); setOpen(false)
    router.push(`/ia/asistente?q=${encodeURIComponent(pregunta)}`)
  }

  function activar(i: number) {
    if (i === idxIA) preguntarIA()
    else if (matches[i]) irA(matches[i].href)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!tieneTexto) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActivo((a) => Math.min(a + 1, totalOpciones - 1)); setOpen(true) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActivo((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      // Si hay un módulo resaltado se navega; si no hay coincidencias, va a la IA.
      if (totalOpciones === 0) return
      activar(Math.min(activo, totalOpciones - 1))
    } else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div ref={boxRef} className="relative flex-1 max-w-xs hidden sm:block"
      onBlur={(e) => { if (!boxRef.current?.contains(e.relatedTarget as Node)) setOpen(false) }}>
      <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2">
        <Search className="w-4 h-4 text-gray-400 shrink-0" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setActivo(0); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Buscar módulo o preguntar a la IA…"
          className="bg-transparent font-body text-sm text-gray-700 placeholder:text-gray-400 flex-1 outline-none w-0"
        />
      </div>

      {open && tieneTexto && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 top-full mt-1 z-40 w-[min(22rem,90vw)] rounded-xl border border-gray-200 bg-white shadow-lg py-1 overflow-hidden">

          {matches.length > 0 && (
            <>
              <p className="px-3 pt-1.5 pb-1 font-body text-[10px] font-semibold uppercase tracking-wide text-gray-400">Ir al módulo</p>
              {matches.map((d, i) => (
                <button
                  key={d.href}
                  onMouseEnter={() => setActivo(i)}
                  onClick={() => irA(d.href)}
                  className={`w-full flex items-center gap-2 text-left px-3 py-2 transition-colors ${activo === i ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                  <ArrowRight className="w-3.5 h-3.5 text-brand-green shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="font-body text-sm text-gray-800">{d.label}</span>
                    <span className="font-body text-[11px] text-gray-400"> · {d.modulo}</span>
                  </span>
                  {activo === i && <CornerDownLeft className="w-3.5 h-3.5 text-gray-300 shrink-0" />}
                </button>
              ))}
              <div className="my-1 border-t border-gray-100" />
            </>
          )}
          {/* Preguntar a la IA (siempre disponible) */}
          <button
            onMouseEnter={() => setActivo(idxIA)}
            onClick={preguntarIA}
            className={`w-full flex items-center gap-2 text-left px-3 py-2 transition-colors ${activo === idxIA ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
            <Sparkles className="w-4 h-4 text-brand-green shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="font-body text-sm text-gray-800">Preguntar a la IA</span>
              <span className="block font-body text-[11px] text-gray-400 truncate">“{q.trim()}”</span>
            </span>
            {activo === idxIA && <CornerDownLeft className="w-3.5 h-3.5 text-gray-300 shrink-0" />}
          </button>

          {matches.length === 0 && (
            <p className="px-3 pt-1 pb-1.5 font-body text-[11px] text-gray-400">Ningún módulo coincide — pulsa Enter para preguntar a la IA.</p>
          )}
        </div>
      )}
    </div>
  )
}
