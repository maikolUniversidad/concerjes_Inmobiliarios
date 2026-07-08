'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Circle, ScanLine, Loader2, RefreshCw, Upload, FolderSearch } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { tiposParaSelect, type TipoDoc } from './tipos'
import { PersonaPicker } from './PersonaPicker'
import { ScannerCaptura } from './ScannerCaptura'
import type { PersonaLite } from './DocumentosClient'

interface Props {
  personas: PersonaLite[]
  tipos: TipoDoc[]
  initialPersonaId?: string
}

export function EscanerDocumentos({ personas, tipos, initialPersonaId = '' }: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [sb] = useState<any>(() => createClient())
  const [personaId, setPersonaId] = useState(initialPersonaId)
  const [presentes, setPresentes] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [tipoActivo, setTipoActivo] = useState<{ id: string; label: string } | null>(null)

  const opciones = useMemo(() => tiposParaSelect(tipos), [tipos])
  const personaSel = personas.find((p) => p.id === personaId) ?? null

  const cargarEstado = useMemo(() => async (pid: string) => {
    if (!pid) { setPresentes(new Set()); return }
    setLoading(true)
    try {
      const { data } = await sb.from('documentos_persona').select('tipo_documental_id').eq('persona_id', pid)
      setPresentes(new Set((data ?? []).map((d: { tipo_documental_id: string | null }) => d.tipo_documental_id).filter(Boolean)))
    } finally {
      setLoading(false)
    }
  }, [sb])

  useEffect(() => { cargarEstado(personaId) }, [personaId, cargarEstado])

  const totalConDoc = opciones.filter((o) => presentes.has(o.id)).length

  return (
    <div className="space-y-4">
      {/* Persona */}
      <div>
        <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Persona <span className="text-red-500">*</span></label>
        <PersonaPicker personas={personas} value={personaId} onChange={setPersonaId} placeholder="Selecciona a quién escanear documentos…" />
      </div>

      {!personaId ? (
        <div className="py-14 text-center">
          <FolderSearch className="w-10 h-10 text-gray-200 mx-auto mb-2" />
          <p className="font-body text-sm text-gray-400">Selecciona una persona para ver sus tipos documentales.</p>
        </div>
      ) : opciones.length === 0 ? (
        <div className="py-14 text-center">
          <p className="font-body text-sm text-gray-400">No hay tipos documentales. Créalos en la pestaña «Tipos documentales».</p>
        </div>
      ) : (
        <>
          {/* Resumen */}
          <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-2.5 shadow-sm">
            <p className="font-body text-sm text-gray-600">
              <span className="font-semibold text-brand-green">{totalConDoc}</span> de {opciones.length} con documento
            </p>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </div>

          {/* Grilla de tipos con estado */}
          <div className="grid gap-2 sm:grid-cols-2">
            {opciones.map((o) => {
              const tiene = presentes.has(o.id)
              return (
                <button
                  key={o.id}
                  onClick={() => setTipoActivo(o)}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all shadow-sm hover:shadow-md ${
                    tiene ? 'border-green-200 bg-green-50/50 hover:border-green-300' : 'border-red-200 bg-red-50/40 hover:border-red-300'
                  }`}
                >
                  {tiene ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" /> : <Circle className="w-5 h-5 text-red-400 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-body text-sm font-medium text-gray-800 truncate">{o.label}</p>
                    <p className={`font-body text-xs ${tiene ? 'text-green-600' : 'text-red-500'}`}>
                      {tiene ? 'Cargado' : 'Pendiente'}
                    </p>
                  </div>
                  <span className={`flex items-center gap-1 shrink-0 rounded-lg px-2 py-1 text-xs font-medium ${
                    tiene ? 'bg-white text-gray-500 border border-gray-200' : 'bg-brand-green text-white'
                  }`}>
                    {tiene ? <><RefreshCw className="w-3 h-3" /> Reemplazar</> : <><ScanLine className="w-3 h-3" /> Escanear</>}
                  </span>
                </button>
              )
            })}
          </div>

          <p className="flex items-center gap-1.5 font-body text-xs text-gray-400">
            <Upload className="w-3.5 h-3.5" /> Toca un tipo para escanear con la cámara. Varias fotos se unen en un solo PDF.
          </p>
        </>
      )}

      {/* Modal de escaneo */}
      {tipoActivo && personaSel && (
        <ScannerCaptura
          personaId={personaId}
          personaNombre={`${personaSel.nombres} ${personaSel.apellidos}`}
          tipo={tipoActivo}
          yaExiste={presentes.has(tipoActivo.id)}
          onClose={() => setTipoActivo(null)}
          onSaved={(tipoId) => {
            setPresentes((prev) => new Set(prev).add(tipoId))
            setTipoActivo(null)
          }}
        />
      )}
    </div>
  )
}
