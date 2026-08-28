'use client'

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Download,
  Eye,
  FilterX,
  LayoutGrid,
  Rows3,
  Search,
} from 'lucide-react'
import { FiltroColumnaMenu } from './FiltroColumna'
import { copiarBloque, descargarCSV, registrarCopia } from './copiar'
import {
  textoDeValor,
  type BloqueCopiado,
  type ColumnaTabla,
  type DireccionOrden,
  type FiltroColumna,
  type RangoSeleccion,
  type Vista,
} from './tipos'

export interface TablaEstandarProps<T> {
  /** Clave estable: recuerda vista, orden y densidad del usuario. */
  id: string
  datos: T[]
  columnas: ColumnaTabla<T>[]
  filaId: (fila: T) => string
  /** Nombre humano de la tabla: sale en el log y en el CSV. */
  titulo: string
  /** Módulo para `actividad_log` (Inventario, Compras, Usuarios…). */
  modulo?: string
  entidad?: string
  /** Vista por defecto la primera vez. 'auto' = tarjetas en móvil, tabla en escritorio. */
  vistaInicial?: Vista | 'auto'
  /** Tarjeta propia de la pantalla. Si no se pasa, se arma con los roles `tarjeta`. */
  renderTarjeta?: (fila: T) => ReactNode
  gridTarjetas?: string
  /** La pantalla pinta su propio marco de tarjeta (foto a sangre, bordes propios). */
  tarjetaSinMarco?: boolean
  /** Doble clic en la fila (la tabla usa el clic simple para seleccionar) y clic en la tarjeta. */
  onFilaClick?: (fila: T) => void
  /** Columna de acciones, al inicio de la fila y fuera del copiado. */
  acciones?: (fila: T) => ReactNode
  anchoAcciones?: string
  /** Texto del botón que abre el detalle. Solo aparece si hay `onFilaClick`. */
  textoDetalle?: string
  /** `false` oculta el buscador; un string cambia el placeholder. */
  busqueda?: boolean | string
  /** Controles propios de la pantalla dentro de la barra. */
  herramientas?: ReactNode
  vacio?: ReactNode
  filasPorPagina?: number
  copiable?: boolean
  descargable?: boolean
  filaClassName?: (fila: T) => string
  /**
   * Fila de totales al pie (solo en vista de tabla): devuelve, por id de
   * columna, lo que se pinta. Recibe las filas ya filtradas y ordenadas.
   */
  pie?: (filas: T[]) => Partial<Record<string, ReactNode>>
  className?: string
}

type Tamano = 'xs' | 'sm' | 'lg'

const OPCIONES_PAGINA = [25, 50, 100, 250, 0]

function normalizar(rango: RangoSeleccion) {
  return {
    r1: Math.min(rango.filaInicio, rango.filaFin),
    r2: Math.max(rango.filaInicio, rango.filaFin),
    c1: Math.min(rango.colInicio, rango.colFin),
    c2: Math.max(rango.colInicio, rango.colFin),
  }
}

/** Punto de corte de Tailwind sin depender de clases: hace falta para que la
 *  selección y el copiado no incluyan columnas que en pantalla están ocultas. */
function useTamano(): Tamano {
  const [tamano, setTamano] = useState<Tamano>('lg')
  useEffect(() => {
    const calcular = () => {
      const w = window.innerWidth
      setTamano(w >= 1024 ? 'lg' : w >= 640 ? 'sm' : 'xs')
    }
    calcular()
    window.addEventListener('resize', calcular)
    return () => window.removeEventListener('resize', calcular)
  }, [])
  return tamano
}

export function TablaEstandar<T>({
  id,
  datos,
  columnas,
  filaId,
  titulo,
  modulo = 'Sistema',
  entidad,
  vistaInicial = 'auto',
  renderTarjeta,
  gridTarjetas = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3',
  tarjetaSinMarco = false,
  onFilaClick,
  acciones,
  anchoAcciones = 'w-24',
  textoDetalle = 'Ver',
  busqueda = true,
  herramientas,
  vacio,
  filasPorPagina = 50,
  copiable = true,
  descargable = true,
  filaClassName,
  pie,
  className = '',
}: TablaEstandarProps<T>) {
  const tamano = useTamano()
  const [montado, setMontado] = useState(false)
  const [vista, setVista] = useState<Vista>(vistaInicial === 'tarjetas' ? 'tarjetas' : 'tabla')
  const [q, setQ] = useState('')
  const [filtros, setFiltros] = useState<Record<string, FiltroColumna>>({})
  const [orden, setOrden] = useState<{ columna: string; direccion: DireccionOrden } | null>(null)
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState(filasPorPagina)
  const [sel, setSel] = useState<RangoSeleccion | null>(null)
  const [aviso, setAviso] = useState('')
  const arrastrando = useRef(false)
  const ancla = useRef<{ fila: number; col: number } | null>(null)
  const contenedorRef = useRef<HTMLDivElement>(null)

  // ── Preferencia de vista ────────────────────────────────────────────────────
  useEffect(() => {
    setMontado(true)
    let guardada: string | null = null
    try {
      guardada = window.localStorage.getItem(`tabla:${id}:vista`)
    } catch {
      /* modo privado */
    }
    if (guardada === 'tabla' || guardada === 'tarjetas') {
      setVista(guardada)
      return
    }
    if (vistaInicial === 'auto') {
      setVista(window.innerWidth < 768 ? 'tarjetas' : 'tabla')
    }
  }, [id, vistaInicial])

  const cambiarVista = (nueva: Vista) => {
    setVista(nueva)
    setSel(null)
    try {
      window.localStorage.setItem(`tabla:${id}:vista`, nueva)
    } catch {
      /* modo privado */
    }
  }

  // ── Columnas visibles según el ancho de pantalla ─────────────────────────────
  const columnasVisibles = useMemo(() => {
    if (!montado) return columnas
    return columnas.filter((c) => {
      const p = c.prioridad ?? 1
      if (p === 1) return true
      if (p === 2) return tamano !== 'xs'
      return tamano === 'lg'
    })
  }, [columnas, tamano, montado])

  // ── Filtrado ────────────────────────────────────────────────────────────────
  const textoFila = useCallback(
    (fila: T) => columnas.map((c) => textoDeValor(c.valor(fila))).join(' ').toLowerCase(),
    [columnas]
  )

  const pasaFiltro = useCallback(
    (fila: T, exceptoColumna?: string) => {
      for (const col of columnas) {
        if (col.id === exceptoColumna) continue
        const f = filtros[col.id]
        if (!f) continue
        const valor = textoDeValor(col.valor(fila))
        if (f.texto.trim() && !valor.toLowerCase().includes(f.texto.trim().toLowerCase())) {
          return false
        }
        if (f.valores && !f.valores.includes(valor)) return false
      }
      return true
    },
    [columnas, filtros]
  )

  const filtradas = useMemo(() => {
    const busca = q.trim().toLowerCase()
    return datos.filter((fila) => {
      if (busca && !textoFila(fila).includes(busca)) return false
      return pasaFiltro(fila)
    })
  }, [datos, q, textoFila, pasaFiltro])

  const ordenadas = useMemo(() => {
    if (!orden) return filtradas
    const col = columnas.find((c) => c.id === orden.columna)
    if (!col) return filtradas
    const signo = orden.direccion === 'asc' ? 1 : -1
    return [...filtradas].sort((a, b) => {
      const va = col.valor(a)
      const vb = col.valor(b)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * signo
      const ta = textoDeValor(va)
      const tb = textoDeValor(vb)
      if (ta === '' && tb !== '') return 1
      if (tb === '' && ta !== '') return -1
      return ta.localeCompare(tb, 'es', { numeric: true, sensitivity: 'base' }) * signo
    })
  }, [filtradas, orden, columnas])

  const totalPaginas = porPagina > 0 ? Math.max(1, Math.ceil(ordenadas.length / porPagina)) : 1
  const paginaActual = Math.min(pagina, totalPaginas - 1)
  const filasPagina = useMemo(
    () =>
      porPagina > 0
        ? ordenadas.slice(paginaActual * porPagina, (paginaActual + 1) * porPagina)
        : ordenadas,
    [ordenadas, paginaActual, porPagina]
  )

  useEffect(() => {
    setPagina(0)
    setSel(null)
  }, [q, filtros, orden, porPagina])

  // Valores distintos por columna, calculados con los demás filtros aplicados.
  const valoresUnicos = useCallback(
    (col: ColumnaTabla<T>) => {
      const busca = q.trim().toLowerCase()
      const set = new Set<string>()
      for (const fila of datos) {
        if (busca && !textoFila(fila).includes(busca)) continue
        if (!pasaFiltro(fila, col.id)) continue
        set.add(textoDeValor(col.valor(fila)))
      }
      return [...set].sort((a, b) =>
        a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' })
      )
    },
    [datos, q, textoFila, pasaFiltro]
  )

  const hayFiltros = q.trim() !== '' || Object.values(filtros).some((f) => f.texto || f.valores)

  const limpiarTodo = () => {
    setQ('')
    setFiltros({})
    setOrden(null)
    setSel(null)
  }

  // ── Copiado estilo Excel ────────────────────────────────────────────────────
  const columnasCopiables = useMemo(
    () => columnasVisibles.filter((c) => c.copiable !== false),
    [columnasVisibles]
  )

  const textoCelda = (col: ColumnaTabla<T>, fila: T) =>
    col.copiaTexto ? col.copiaTexto(fila) : textoDeValor(col.valor(fila))

  const armarBloque = useCallback(
    (origen: 'seleccion' | 'todo'): BloqueCopiado | null => {
      if (origen === 'todo' || !sel) {
        if (!ordenadas.length || !columnasCopiables.length) return null
        return {
          encabezados: columnasCopiables.map((c) => c.header),
          filas: ordenadas.map((fila) => columnasCopiables.map((c) => textoCelda(c, fila))),
        }
      }
      const { r1, r2, c1, c2 } = normalizar(sel)
      const cols = columnasVisibles.slice(c1, c2 + 1).filter((c) => c.copiable !== false)
      const filas = filasPagina.slice(r1, r2 + 1)
      if (!cols.length || !filas.length) return null
      // Al seleccionar columnas completas se copian también los encabezados.
      const columnaCompleta = r1 === 0 && r2 === filasPagina.length - 1
      return {
        encabezados: columnaCompleta ? cols.map((c) => c.header) : [],
        filas: filas.map((fila) => cols.map((c) => textoCelda(c, fila))),
      }
    },
    [sel, ordenadas, filasPagina, columnasVisibles, columnasCopiables]
  )

  const anunciar = (mensaje: string) => {
    setAviso(mensaje)
    window.setTimeout(() => setAviso(''), 2200)
  }

  const copiar = useCallback(
    async (origen: 'seleccion' | 'todo') => {
      const bloque = armarBloque(origen)
      if (!bloque) return
      const ok = await copiarBloque(bloque)
      if (!ok) {
        anunciar('No se pudo copiar')
        return
      }
      anunciar(`${bloque.filas.length} fila(s) copiadas`)
      void registrarCopia({
        modulo,
        entidad,
        titulo,
        filas: bloque.filas.length,
        columnas: bloque.encabezados.length
          ? bloque.encabezados
          : columnasCopiables.map((c) => c.header),
        origen: sel && origen === 'seleccion' ? 'seleccion' : 'todo',
      })
    },
    [armarBloque, modulo, entidad, titulo, columnasCopiables, sel]
  )

  const descargar = () => {
    const bloque = armarBloque('todo')
    if (!bloque) return
    descargarCSV(bloque, titulo.toLowerCase().replace(/\s+/g, '_'))
    anunciar('CSV descargado')
    void registrarCopia({
      modulo,
      entidad,
      titulo,
      filas: bloque.filas.length,
      columnas: bloque.encabezados,
      origen: 'descarga',
    })
  }

  // ── Selección con mouse y teclado ───────────────────────────────────────────
  useEffect(() => {
    const soltar = () => {
      arrastrando.current = false
    }
    window.addEventListener('mouseup', soltar)
    return () => window.removeEventListener('mouseup', soltar)
  }, [])

  const seleccionarCelda = (fila: number, col: number, extender: boolean) => {
    if (extender && ancla.current) {
      setSel({
        filaInicio: ancla.current.fila,
        colInicio: ancla.current.col,
        filaFin: fila,
        colFin: col,
      })
      return
    }
    ancla.current = { fila, col }
    setSel({ filaInicio: fila, colInicio: col, filaFin: fila, colFin: col })
  }

  const seleccionarColumna = (col: number) => {
    if (!filasPagina.length) return
    ancla.current = { fila: 0, col }
    setSel({ filaInicio: 0, colInicio: col, filaFin: filasPagina.length - 1, colFin: col })
    contenedorRef.current?.focus()
  }

  const seleccionarFila = (fila: number) => {
    ancla.current = { fila, col: 0 }
    setSel({
      filaInicio: fila,
      colInicio: 0,
      filaFin: fila,
      colFin: columnasVisibles.length - 1,
    })
    contenedorRef.current?.focus()
  }

  const seleccionarTodo = () => {
    if (!filasPagina.length) return
    ancla.current = { fila: 0, col: 0 }
    setSel({
      filaInicio: 0,
      colInicio: 0,
      filaFin: filasPagina.length - 1,
      colFin: columnasVisibles.length - 1,
    })
  }

  const enCeldaSeleccionada = (fila: number, col: number) => {
    if (!sel) return false
    const { r1, r2, c1, c2 } = normalizar(sel)
    return fila >= r1 && fila <= r2 && col >= c1 && col <= c2
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      seleccionarTodo()
      return
    }
    if (e.key === 'Escape') {
      setSel(null)
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      // Las celdas no son texto seleccionable, así que el navegador no dispara
      // el evento `copy`: hay que copiar a mano desde la tecla.
      if (!copiable || !sel) return
      e.preventDefault()
      void copiar('seleccion')
      return
    }
    if (!sel) return
    const mover = (df: number, dc: number) => {
      e.preventDefault()
      const base = { fila: sel.filaFin, col: sel.colFin }
      const fila = Math.min(Math.max(0, base.fila + df), Math.max(0, filasPagina.length - 1))
      const col = Math.min(Math.max(0, base.col + dc), columnasVisibles.length - 1)
      if (e.shiftKey && ancla.current) {
        setSel({
          filaInicio: ancla.current.fila,
          colInicio: ancla.current.col,
          filaFin: fila,
          colFin: col,
        })
      } else {
        ancla.current = { fila, col }
        setSel({ filaInicio: fila, colInicio: col, filaFin: fila, colFin: col })
      }
    }
    if (e.key === 'ArrowDown') mover(1, 0)
    else if (e.key === 'ArrowUp') mover(-1, 0)
    else if (e.key === 'ArrowRight') mover(0, 1)
    else if (e.key === 'ArrowLeft') mover(0, -1)
  }

  const onCopy = (e: React.ClipboardEvent) => {
    if (!copiable || !sel) return
    const bloque = armarBloque('seleccion')
    if (!bloque) return
    e.preventDefault()
    const filas = bloque.encabezados.length
      ? [bloque.encabezados, ...bloque.filas]
      : bloque.filas
    e.clipboardData.setData(
      'text/plain',
      filas.map((f) => f.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\r\n')
    )
    e.clipboardData.setData(
      'text/html',
      `<table>${filas
        .map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join('')}</tr>`)
        .join('')}</table>`
    )
    anunciar(`${bloque.filas.length} fila(s) copiadas`)
    void registrarCopia({
      modulo,
      entidad,
      titulo,
      filas: bloque.filas.length,
      columnas: bloque.encabezados.length
        ? bloque.encabezados
        : columnasVisibles.slice(normalizar(sel).c1, normalizar(sel).c2 + 1).map((c) => c.header),
      origen: 'seleccion',
    })
  }

  // ── Tarjeta por defecto ─────────────────────────────────────────────────────
  const tarjetaAutomatica = (fila: T) => {
    // Sin roles declarados: la 1ª columna es el título, la 2ª el subtítulo y el
    // resto queda como metadatos al pie de la tarjeta.
    const conRol = columnas.map((c, i) => ({
      col: c,
      rol: c.tarjeta ?? (i === 0 ? 'titulo' : i === 1 ? 'subtitulo' : 'meta'),
    }))
    const de = (rol: string) => conRol.filter((x) => x.rol === rol).map((x) => x.col)
    const titulos = de('titulo')
    const subtitulos = de('subtitulo')
    const badges = de('badge')
    const cuerpo = de('cuerpo')
    const metas = de('meta')
    return (
      <>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {titulos.map((c) => (
              <div key={c.id} className="font-heading text-sm font-bold text-gray-900">
                {c.celda ? c.celda(fila) : textoDeValor(c.valor(fila))}
              </div>
            ))}
            {subtitulos.map((c) => (
              <div key={c.id} className="mt-0.5 truncate font-body text-xs text-gray-500">
                {c.celda ? c.celda(fila) : textoDeValor(c.valor(fila))}
              </div>
            ))}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {badges.map((c) => (
              <div key={c.id}>{c.celda ? c.celda(fila) : textoDeValor(c.valor(fila))}</div>
            ))}
          </div>
        </div>
        {cuerpo.length > 0 && (
          <div className="mt-3 space-y-1">
            {cuerpo.map((c) => (
              <div key={c.id} className="font-body text-xs text-gray-600">
                <span className="text-gray-400">{c.header}: </span>
                {c.celda ? c.celda(fila) : textoDeValor(c.valor(fila))}
              </div>
            ))}
          </div>
        )}
        {metas.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-xs text-gray-500">
            {metas.map((c) => (
              <span key={c.id} className="inline-flex items-center gap-1">
                <span className="text-gray-400">{c.header}:</span>
                {c.celda ? c.celda(fila) : textoDeValor(c.valor(fila))}
              </span>
            ))}
          </div>
        )}
        {hayAcciones && (
          <div className="mt-3 flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {botonDetalle(fila)}
            {acciones?.(fila)}
          </div>
        )}
      </>
    )
  }

  const pieValores = pie ? pie(ordenadas) : {}

  // Las acciones van al inicio de la fila: es lo primero que se busca al
  // llegar a la tabla, y el botón de detalle deja de depender del doble clic.
  const hayAcciones = !!acciones || !!onFilaClick

  const botonDetalle = (fila: T) =>
    onFilaClick ? (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onFilaClick(fila)
        }}
        title="Abrir el detalle"
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-brand-green px-2.5 py-1.5 font-body text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-green-dark"
      >
        <Eye className="h-3.5 w-3.5" /> {textoDetalle}
      </button>
    ) : null

  const alineacion = (c: ColumnaTabla<T>) =>
    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'

  // ── Barra de herramientas ───────────────────────────────────────────────────
  const barra = (
    <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {busqueda !== false && (
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={typeof busqueda === 'string' ? busqueda : 'Buscar…'}
              className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 font-body text-sm outline-none transition-colors focus:border-brand-green"
            />
          </div>
        )}
        <span className="whitespace-nowrap font-body text-xs text-gray-400">
          {ordenadas.length} de {datos.length}
        </span>
        {hayFiltros && (
          <button
            type="button"
            onClick={limpiarTodo}
            className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1.5 font-body text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100"
          >
            <FilterX className="h-3.5 w-3.5" /> Limpiar filtros
          </button>
        )}
        {herramientas}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {aviso && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2 py-1 font-body text-[11px] font-semibold text-green-700">
            <ClipboardCheck className="h-3 w-3" /> {aviso}
          </span>
        )}
        {copiable && (
          <button
            type="button"
            onClick={() => void copiar(sel ? 'seleccion' : 'todo')}
            title="Copiar al portapapeles en formato Excel (Ctrl+C con una selección)"
            className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 font-body text-sm font-semibold text-gray-600 transition-colors hover:bg-gray-50"
          >
            <Copy className="h-3.5 w-3.5" />
            {sel ? 'Copiar selección' : 'Copiar tabla'}
          </button>
        )}
        {descargable && (
          <button
            type="button"
            onClick={descargar}
            title="Descargar lo filtrado como CSV (se abre en Excel)"
            className="inline-flex items-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-3 py-2 font-body text-sm font-semibold text-green-700 transition-colors hover:bg-green-100"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
        )}
        <div className="inline-flex rounded-xl border border-gray-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => cambiarVista('tabla')}
            title="Ver como tabla"
            aria-pressed={vista === 'tabla'}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-body text-xs font-semibold transition-colors ${
              vista === 'tabla' ? 'bg-brand-green text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            <Rows3 className="h-3.5 w-3.5" /> Tabla
          </button>
          <button
            type="button"
            onClick={() => cambiarVista('tarjetas')}
            title="Ver como tarjetas"
            aria-pressed={vista === 'tarjetas'}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-body text-xs font-semibold transition-colors ${
              vista === 'tarjetas' ? 'bg-brand-green text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Tarjetas
          </button>
        </div>
      </div>
    </div>
  )

  const paginador = porPagina > 0 && ordenadas.length > porPagina && (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 font-body text-xs text-gray-500">
        <span>Filas por página</span>
        <select
          value={porPagina}
          onChange={(e) => setPorPagina(Number(e.target.value))}
          className="rounded-lg border border-gray-200 bg-white px-2 py-1 font-body text-xs outline-none focus:border-brand-green"
        >
          {OPCIONES_PAGINA.map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'Todas' : n}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={paginaActual === 0}
          onClick={() => setPagina((p) => Math.max(0, p - 1))}
          className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-body text-xs text-gray-500">
          {paginaActual + 1} / {totalPaginas}
        </span>
        <button
          type="button"
          disabled={paginaActual >= totalPaginas - 1}
          onClick={() => setPagina((p) => Math.min(totalPaginas - 1, p + 1))}
          className="rounded-lg border border-gray-200 bg-white p-1.5 text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )

  const sinDatos = (
    <div className="rounded-2xl border border-gray-100 bg-white p-12 text-center shadow-sm">
      {vacio ?? (
        <p className="font-body text-sm text-gray-400">
          {hayFiltros ? 'Nada coincide con los filtros.' : 'Aún no hay información.'}
        </p>
      )}
    </div>
  )

  return (
    <div className={className}>
      {barra}

      {filasPagina.length === 0 ? (
        sinDatos
      ) : vista === 'tarjetas' ? (
        // `[&>*]:min-w-0`: sin esto los ítems del grid no bajan de su ancho
        // de contenido y una sede larga empuja la tarjeta fuera de la pantalla.
        <div className={`${gridTarjetas} [&>*]:min-w-0`}>
          {filasPagina.map((fila) => tarjetaSinMarco && renderTarjeta ? (
            <Fragment key={filaId(fila)}>{renderTarjeta(fila)}</Fragment>
          ) : (
            <div
              key={filaId(fila)}
              onClick={onFilaClick ? () => onFilaClick(fila) : undefined}
              className={`min-w-0 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition-all ${
                onFilaClick ? 'cursor-pointer hover:border-brand-green/40 hover:shadow' : ''
              } ${filaClassName?.(fila) ?? ''}`}
            >
              {renderTarjeta ? renderTarjeta(fila) : tarjetaAutomatica(fila)}
            </div>
          ))}
        </div>

      ) : (
        <div
          ref={contenedorRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onCopy={onCopy}
          className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm outline-none"
        >
          <table className="w-full select-none border-collapse">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60">
                <th
                  onClick={seleccionarTodo}
                  title="Seleccionar toda la tabla (Ctrl+A)"
                  className="w-10 cursor-pointer px-2 py-2.5 text-center font-body text-[10px] font-semibold text-gray-300 hover:bg-gray-100"
                >
                  #
                </th>
                {hayAcciones && (
                  <th className={`px-3 py-2.5 text-left font-body text-xs font-semibold uppercase tracking-wide text-gray-500 ${anchoAcciones}`}>
                    Acciones
                  </th>
                )}
                {columnasVisibles.map((c, ci) => (
                  <th
                    key={c.id}
                    className={`px-3 py-2.5 font-body text-xs font-semibold uppercase tracking-wide text-gray-500 ${alineacion(
                      c
                    )} ${c.ancho ?? ''} ${c.headerClassName ?? ''}`}
                  >
                    <div
                      className={`flex items-center gap-1 ${
                        c.align === 'right'
                          ? 'justify-end'
                          : c.align === 'center'
                            ? 'justify-center'
                            : 'justify-start'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => seleccionarColumna(ci)}
                        title={`Seleccionar la columna ${c.header}`}
                        className="min-w-0 truncate rounded px-0.5 text-left uppercase hover:text-brand-green"
                      >
                        {c.header}
                      </button>
                      {c.filtrable !== false && (
                        <FiltroColumnaMenu
                          titulo={c.header}
                          valoresUnicos={valoresUnicos(c)}
                          filtro={filtros[c.id] ?? { texto: '', valores: null }}
                          orden={orden?.columna === c.id ? orden.direccion : null}
                          ordenable={c.ordenable !== false}
                          onOrden={(d) => setOrden(d ? { columna: c.id, direccion: d } : null)}
                          onCambio={(f) =>
                            setFiltros((prev) => {
                              const siguiente = { ...prev }
                              if (!f.texto && f.valores === null) delete siguiente[c.id]
                              else siguiente[c.id] = f
                              return siguiente
                            })
                          }
                        />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filasPagina.map((fila, ri) => (
                <tr
                  key={filaId(fila)}
                  onDoubleClick={onFilaClick ? () => onFilaClick(fila) : undefined}
                  className={`border-b border-gray-50 transition-colors last:border-0 hover:bg-gray-50/60 ${
                    onFilaClick ? 'cursor-pointer' : ''
                  } ${filaClassName?.(fila) ?? ''}`}
                >
                  <td
                    onClick={() => seleccionarFila(ri)}
                    title="Seleccionar la fila"
                    className="w-10 cursor-pointer px-2 py-2.5 text-center font-body text-[10px] text-gray-300 hover:bg-gray-100"
                  >
                    {paginaActual * (porPagina || 0) + ri + 1}
                  </td>
                  {hayAcciones && (
                    <td className="select-text px-3 py-2.5" onMouseDown={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {botonDetalle(fila)}
                        {acciones?.(fila)}
                      </div>
                    </td>
                  )}
                  {columnasVisibles.map((c, ci) => (
                    <td
                      key={c.id}
                      onMouseDown={(e) => {
                        // Las celdas con controles no entran en la selección:
                        // el clic es del input, no de la hoja.
                        if (c.interactiva || e.button !== 0) return
                        arrastrando.current = true
                        seleccionarCelda(ri, ci, e.shiftKey)
                        contenedorRef.current?.focus()
                      }}
                      onMouseEnter={() => {
                        if (c.interactiva || !arrastrando.current || !ancla.current) return
                        setSel({
                          filaInicio: ancla.current.fila,
                          colInicio: ancla.current.col,
                          filaFin: ri,
                          colFin: ci,
                        })
                      }}
                      className={`px-3 py-2.5 font-body text-sm text-gray-700 ${alineacion(c)} ${
                        c.interactiva ? 'select-text' : ''
                      } ${c.className ?? ''} ${
                        enCeldaSeleccionada(ri, ci)
                          ? 'bg-brand-green/10 ring-1 ring-inset ring-brand-green/30'
                          : ''
                      }`}
                    >
                      {c.celda ? c.celda(fila) : textoDeValor(c.valor(fila))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {pie && (
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-2 py-2.5" />
                  {hayAcciones && <td className="px-3 py-2.5" />}
                  {columnasVisibles.map((c) => (
                    <td key={c.id} className={`px-3 py-2.5 font-body text-sm text-gray-700 ${alineacion(c)}`}>
                      {pieValores[c.id] ?? null}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {vista === 'tabla' && filasPagina.length > 0 && (
        <p className="mt-2 px-1 font-body text-[11px] text-gray-400">
          Clic para seleccionar · arrastra o Shift+clic para un rango · clic en el título de la
          columna para toda la columna · Ctrl+C para pegar en Excel
          {onFilaClick ? ' · «Ver» o doble clic para abrir el detalle' : ''}
        </p>
      )}

      {paginador}
    </div>
  )
}
