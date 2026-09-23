'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FileStack, ArrowUp, ArrowDown, X, Star, Save, Download, Plus, Loader2, RotateCcw, CheckCircle2, Circle, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { logActivity } from '@/lib/activity'
import { armarPaquetePdf, type ItemPaquete, type PiezaPaquete } from '@/lib/documentos/paquete'
import { itemsFaltantes, nombreItem, planPaquete, type FuentesPaquete } from '@/lib/documentos/paquete-plan'
import { htmlParaMostrar, limpiarHtml, resolverMarcadores } from '@/lib/documentos/html'
import { htmlResultadoPrueba } from '@/lib/ats/resultado-prueba'
import { Seccion, Boton, Badge, inputCls } from '../ui'
import type { PropsTab } from './tipos'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Paquete { id: string; nombre: string; descripcion: string | null; items: ItemPaquete[]; predeterminado: boolean }

const ICONO: Record<ItemPaquete['tipo'], string> = { plantilla: 'Formato', documento: 'Documento', prueba: 'Prueba' }

/**
 * Descarga todo el expediente en un solo PDF, en el orden elegido. Los órdenes
 * se guardan (varios) y uno queda predeterminado para todos los candidatos.
 */
export function PaqueteDocumentos({ d, sb, catalogos, puedeGestionar }: PropsTab) {
  const [paquetes, setPaquetes] = useState<Paquete[]>([])
  const [selId, setSelId] = useState<string>('')
  const [orden, setOrden] = useState<ItemPaquete[]>([])
  const [agregar, setAgregar] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [progreso, setProgreso] = useState<{ hechas: number; total: number; titulo: string } | null>(null)

  const cargar = useCallback(async (preferido?: string) => {
    const { data, error } = await sb.from('paquetes_documentos').select('id, nombre, descripcion, items, predeterminado')
      .eq('activo', true).order('predeterminado', { ascending: false }).order('nombre')
    if (error) { toast.error(error.message); return }
    const lista = (data ?? []) as Paquete[]
    setPaquetes(lista)
    const elegido = lista.find((p) => p.id === preferido) ?? lista.find((p) => p.predeterminado) ?? lista[0]
    if (elegido) { setSelId(elegido.id); setOrden(elegido.items ?? []) }
  }, [sb])

  useEffect(() => { void cargar() }, [cargar])

  const fuentes: FuentesPaquete = useMemo(() => ({
    generados: d.generados, docs: d.docs, intentos: d.intentos,
    tipos: catalogos.tipos.map((t) => ({ id: t.id, codigo: t.codigo, nombre: t.nombre })),
    plantillas: catalogos.plantillas.map((p) => ({ codigo: p.codigo, nombre: p.nombre })),
  }), [d.generados, d.docs, d.intentos, catalogos.tipos, catalogos.plantillas])

  const plan = useMemo(() => planPaquete(orden, fuentes), [orden, fuentes])
  const conContenido = plan.filter((p) => p.fuente).length
  const faltantes = useMemo(() => itemsFaltantes(orden, fuentes), [orden, fuentes])
  const sel = paquetes.find((p) => p.id === selId) ?? null
  const cambiado = !!sel && JSON.stringify(sel.items) !== JSON.stringify(orden)

  const mover = (i: number, paso: number) => setOrden((o) => {
    const j = i + paso
    if (j < 0 || j >= o.length) return o
    const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n
  })

  async function guardarOrden() {
    if (!sel) return
    setOcupado('guardar')
    const { error } = await sb.from('paquetes_documentos').update({ items: orden }).eq('id', sel.id)
    setOcupado(null)
    if (error) { toast.error(error.message); return }
    toast.success(`Orden «${sel.nombre}» guardado.`)
    await cargar(sel.id)
  }

  async function guardarComo() {
    const nombre = window.prompt('Nombre del nuevo orden (p. ej. «Carpeta para el cliente»):')?.trim()
    if (!nombre) return
    setOcupado('nuevo')
    const { data, error } = await sb.from('paquetes_documentos').insert({ nombre, items: orden, creado_por: d.yo.id })
      .select('id').single()
    setOcupado(null)
    if (error) { toast.error(error.code === '23505' ? 'Ya existe un orden con ese nombre.' : error.message); return }
    toast.success(`Orden «${nombre}» guardado.`)
    await cargar(data.id)
  }

  async function predeterminar() {
    if (!sel) return
    setOcupado('pred')
    const { error } = await sb.from('paquetes_documentos').update({ predeterminado: true, items: orden }).eq('id', sel.id)
    setOcupado(null)
    if (error) { toast.error(error.message); return }
    toast.success(`«${sel.nombre}» es ahora el orden predeterminado.`)
    await cargar(sel.id)
  }

  async function eliminar() {
    if (!sel || sel.predeterminado) return
    if (!window.confirm(`¿Eliminar el orden «${sel.nombre}»?`)) return
    const { error } = await sb.from('paquetes_documentos').delete().eq('id', sel.id)
    if (error) { toast.error(error.message); return }
    toast.success('Orden eliminado.')
    await cargar()
  }

  /** Arma las piezas (con lo que hay) y descarga el PDF. */
  async function descargar() {
    const partes = plan.filter((p) => p.fuente)
    if (partes.length === 0) { toast.error('No hay documentos para armar el paquete.'); return }
    setOcupado('pdf')
    setProgreso({ hechas: 0, total: partes.length, titulo: 'Preparando' })
    try {
      // Enlaces de los archivos y de los escaneados firmados, en una sola petición.
      const rutas = partes.flatMap((p) => p.fuente?.clase === 'archivos' ? p.fuente.archivos.map((a) => a.path) : p.fuente?.clase === 'escaneado' ? [p.fuente.path] : [])
      const urls: Record<string, string> = {}
      if (rutas.length) {
        const { data } = await sb.storage.from('registro-vacantes').createSignedUrls(rutas, 1800)
        for (const x of data ?? []) if (x.path && x.signedUrl) urls[x.path] = x.signedUrl
      }
      // Formatos generados y resultados de pruebas (HTML).
      const idsGen = partes.flatMap((p) => p.fuente?.clase === 'generado' ? [p.fuente.id] : [])
      const intentos = partes.flatMap((p) => p.fuente?.clase === 'prueba' ? [d.intentos.find((x) => x.id === (p.fuente as any).intentoId)] : []).filter(Boolean)
      const [genR, pregR, empR, fotoR] = await Promise.all([
        idsGen.length ? sb.from('documentos_generados').select('id, nombre, html_render, html_firmado, firma_evidencia, sha256').in('id', idsGen) : Promise.resolve({ data: [] }),
        intentos.length ? sb.from('prueba_preguntas').select('id, prueba_id, orden, enunciado, opciones, respuesta_correcta, dimension').in('prueba_id', intentos.map((x: any) => x.prueba_id)) : Promise.resolve({ data: [] }),
        sb.from('vac_empresa').select('razon_social, nit').eq('id', 1).maybeSingle(),
        d.c.foto_perfil_path ? sb.storage.from('registro-vacantes').createSignedUrl(d.c.foto_perfil_path, 1800) : Promise.resolve({ data: null }),
      ])
      const fotoUrl = fotoR.data?.signedUrl ?? d.fotoUrl
      const nombre = `${d.c.nombres ?? ''} ${d.c.apellidos ?? ''}`.trim()
      const cargo = catalogos.cargos.find((x) => x.id === d.c.cargo_postulacion_id)?.nombre ?? ''

      const piezas: PiezaPaquete[] = []
      for (const p of partes) {
        const f = p.fuente!
        if (f.clase === 'generado') {
          const g = (genR.data ?? []).find((x: any) => x.id === f.id)
          if (g) piezas.push({ clase: 'html', titulo: p.titulo, html: htmlParaMostrar(g, { fotoUrl }) })
        } else if (f.clase === 'escaneado') {
          if (urls[f.path]) piezas.push({ clase: 'archivo', titulo: p.titulo, url: urls[f.path], mime: null, nombre: f.nombre })
        } else if (f.clase === 'archivos') {
          for (const a of f.archivos) if (urls[a.path]) piezas.push({ clase: 'archivo', titulo: p.titulo, url: urls[a.path], mime: a.mime, nombre: a.nombre })
        } else {
          const intento = d.intentos.find((x) => x.id === f.intentoId)
          if (!intento) continue
          const html = htmlResultadoPrueba({
            empresa: empR.data, intento,
            candidato: { nombre, tipo_documento: d.c.tipo_documento, numero_documento: d.c.numero_documento, cargo, ciudad: d.nombres.munTrabajo || d.nombres.munResidencia || null },
            prueba: intento.prueba ?? { nombre: p.titulo, tipo: '' },
            preguntas: (pregR.data ?? []).filter((q: any) => q.prueba_id === intento.prueba_id),
          })
          piezas.push({ clase: 'html', titulo: p.titulo, html: resolverMarcadores(limpiarHtml(html), { fotoUrl }) })
        }
      }

      const hoy = new Date().toLocaleDateString('es-CO')
      const pdf = await armarPaquetePdf(piezas, {
        portada: {
          titulo: `Paquete de contratación · ${nombre}`,
          lineas: [`${d.c.tipo_documento ?? ''} ${d.c.numero_documento ?? ''} · ${cargo}`, `Orden: ${sel?.nombre ?? 'personalizado'} · generado el ${hoy}`],
        },
        onProgreso: (hechas, total, titulo) => setProgreso({ hechas, total, titulo }),
      })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(pdf)
      a.download = `Paquete ${nombre} ${d.c.numero_documento ?? ''}.pdf`.replace(/\s+/g, ' ').trim()
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10000)
      toast.success(`Paquete listo: ${piezas.length} parte(s), ${(pdf.size / 1048576).toFixed(1)} MB.`)
      void logActivity(sb, { accion: 'DESCARGAR', modulo: 'Postulaciones', descripcion: `Paquete de contratación de ${nombre} (${sel?.nombre ?? 'orden personalizado'})`, entidad: 'candidatos', entidad_id: d.c.id })
    } catch (e) {
      toast.error(e instanceof Error ? `No se pudo armar el paquete: ${e.message}` : 'No se pudo armar el paquete.')
    } finally {
      setOcupado(null)
      setProgreso(null)
    }
  }

  return (
    <Seccion titulo="Paquete de contratación (un solo PDF)" icono={<FileStack className="h-4 w-4 text-brand-green" />}>
      <p className="mb-3 text-xs text-gray-500">
        Descarga todo el expediente en un PDF, en el orden de la lista: formatos (el escaneado si se firmó en papel), documentos
        que subió el candidato y resultados de las pruebas. Lo que no esté se salta. Guarde los órdenes que usa (carpeta física,
        nómina, cliente…) y deje uno como predeterminado.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select value={selId} onChange={(e) => { const p = paquetes.find((x) => x.id === e.target.value); setSelId(e.target.value); setOrden(p?.items ?? []) }}
          className={inputCls + ' max-w-xs'}>
          {paquetes.map((p) => <option key={p.id} value={p.id}>{p.predeterminado ? '★ ' : ''}{p.nombre}</option>)}
        </select>
        {sel?.predeterminado && <Badge className="bg-amber-100 text-amber-800">Predeterminado</Badge>}
        {cambiado && <Badge className="bg-blue-50 text-blue-700">Orden modificado</Badge>}
        {puedeGestionar && (
          <div className="flex flex-wrap gap-1.5">
            {cambiado && <Boton variante="secundario" onClick={guardarOrden} disabled={!!ocupado}><Save className="h-4 w-4" /> Guardar orden</Boton>}
            {cambiado && <Boton variante="secundario" onClick={() => setOrden(sel?.items ?? [])} disabled={!!ocupado}><RotateCcw className="h-4 w-4" /> Deshacer</Boton>}
            <Boton variante="secundario" onClick={guardarComo} disabled={!!ocupado}><Plus className="h-4 w-4" /> Guardar como nuevo</Boton>
            {sel && !sel.predeterminado && <Boton variante="secundario" onClick={predeterminar} disabled={!!ocupado}><Star className="h-4 w-4" /> Dejar predeterminado</Boton>}
            {sel && !sel.predeterminado && <Boton variante="secundario" onClick={eliminar} disabled={!!ocupado}><Trash2 className="h-4 w-4 text-red-600" /></Boton>}
          </div>
        )}
      </div>
      {sel?.descripcion && <p className="mt-1 text-[11px] text-gray-400">{sel.descripcion}</p>}

      <ol className="mt-3 max-h-[420px] divide-y divide-gray-50 overflow-y-auto rounded-lg border border-gray-100">
        {plan.map((p, i) => (
          <li key={`${p.item.tipo}:${p.item.codigo}`} className={'flex items-center gap-2 px-2.5 py-1.5 ' + (p.fuente ? '' : 'bg-gray-50/60')}>
            <span className="w-6 shrink-0 text-right text-[11px] font-bold text-gray-400">{i + 1}</span>
            {p.fuente ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" /> : <Circle className="h-4 w-4 shrink-0 text-gray-300" />}
            <div className="min-w-0 flex-1">
              <p className={'truncate text-sm ' + (p.fuente ? 'text-gray-800' : 'text-gray-400')}>{p.titulo}</p>
              <p className="text-[11px] text-gray-400">{ICONO[p.item.tipo]} · {p.texto}</p>
            </div>
            <div className="flex shrink-0 items-center">
              <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" aria-label="Subir"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" onClick={() => mover(i, 1)} disabled={i === plan.length - 1} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" aria-label="Bajar"><ArrowDown className="h-4 w-4" /></button>
              <button type="button" onClick={() => setOrden((o) => o.filter((_, j) => j !== i))} className="p-1 text-gray-400 hover:text-red-600" aria-label="Quitar"><X className="h-4 w-4" /></button>
            </div>
          </li>
        ))}
        {plan.length === 0 && <li className="px-3 py-6 text-center text-sm text-gray-400">El orden está vacío: agregue documentos abajo.</li>}
      </ol>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select value={agregar} onChange={(e) => setAgregar(e.target.value)} className={inputCls + ' max-w-sm'}>
          <option value="">Agregar al orden…</option>
          {(['plantilla', 'documento', 'prueba'] as const).map((tipo) => {
            const lista = faltantes.filter((x) => x.tipo === tipo)
            return lista.length ? (
              <optgroup key={tipo} label={tipo === 'plantilla' ? 'Formatos' : tipo === 'documento' ? 'Documentos subidos' : 'Pruebas'}>
                {lista.map((x) => <option key={x.codigo} value={`${x.tipo}:${x.codigo}`}>{nombreItem(x, fuentes)}</option>)}
              </optgroup>
            ) : null
          })}
        </select>
        <Boton variante="suave" disabled={!agregar} onClick={() => {
          const [tipo, codigo] = agregar.split(':')
          setOrden((o) => [...o, { tipo: tipo as ItemPaquete['tipo'], codigo }])
          setAgregar('')
        }}><Plus className="h-4 w-4" /> Agregar</Boton>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Boton onClick={descargar} disabled={!!ocupado || conContenido === 0}>
          {ocupado === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Descargar PDF ({conContenido} de {plan.length})
        </Boton>
        {progreso && (
          <div className="min-w-[220px] flex-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full bg-brand-green transition-all" style={{ width: `${progreso.total ? (progreso.hechas / progreso.total) * 100 : 0}%` }} />
            </div>
            <p className="mt-0.5 truncate text-[11px] text-gray-500">Armando {Math.min(progreso.hechas + 1, progreso.total)} de {progreso.total}: {progreso.titulo}</p>
          </div>
        )}
      </div>
    </Seccion>
  )
}
