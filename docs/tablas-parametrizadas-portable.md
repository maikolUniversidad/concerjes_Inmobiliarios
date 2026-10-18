# Tablas parametrizadas (`TablaEstandar`): lógica completa y portable

Este documento reúne todo lo necesario para llevar el componente de tablas del
portal de inventario a otro proyecto: el modelo mental, cada algoritmo y el
código fuente completo. Copia los 5 archivos del final en
`components/ui/tabla/` y ajusta los puntos de la sección **Adaptación**.

---

## 1. La idea

Cada pantalla **no pinta su tabla**: la **describe**. Entrega un arreglo de
datos y un arreglo de **columnas parametrizadas** (`ColumnaTabla<T>[]`). El
componente se encarga del resto, igual en todas las pantallas:

| Necesidad | Cómo lo resuelve |
|---|---|
| Responsive | Columnas con `prioridad` 1/2/3 que se ocultan según el ancho; en móvil arranca en **tarjetas**. La tabla hace scroll horizontal en su propio contenedor (la página nunca se desborda). |
| Tabla ⇄ tarjetas | Botón **Tabla / Tarjetas**. La elección se guarda por pantalla en `localStorage` (`tabla:<id>:vista`). |
| Búsqueda global | Un input que busca en el texto de todas las columnas. |
| Filtro por columna (estilo Excel) | Embudo en cada encabezado: orden A→Z / Z→A, filtro «contiene» y lista de valores con casillas. Los valores ofrecidos ya vienen filtrados por las **demás** columnas. |
| Orden | Numérico si ambos valores son número; si no, `localeCompare('es', { numeric: true })`; los vacíos siempre al final. |
| Paginación | 25 / 50 / 100 / 250 / Todas. `filasPorPagina={0}` la apaga (cuando el servidor ya pagina). |
| Selección tipo hoja de cálculo | Celda, rango (arrastre o Shift+clic), columna, fila, todo; flechas y Shift+flechas; auto‑scroll al arrastrar cerca del borde. |
| Copiar a Excel | `Ctrl+C` o botón: va al portapapeles como **TSV + HTML**, se pega en Excel con columnas separadas. |
| Descargar Excel | `.xlsx` real con `exceljs` (carga diferida): encabezado de color, fila congelada, autofiltro, anchos automáticos y números como número. |
| Acciones | Primera columna. Si hay `onFilaClick`, aparece un botón **Ver**; doble clic en la fila hace lo mismo. |
| Totales | `pie` devuelve por id de columna lo que se pinta al pie, con las filas ya filtradas. |
| Trazabilidad | Cada copia/descarga puede registrarse (qué tabla, cuántas filas, qué columnas; **nunca** el contenido). |

---

## 2. El contrato: la columna

La clave de todo es que **`valor` devuelve un dato plano** y todo sale de ahí:
búsqueda, filtros, orden y copiado. Lo visual (`celda`) es opcional y aparte.

| Campo | Para qué |
|---|---|
| `id` | **Obligatorio.** Identificador estable: filtros, orden y totales se indexan por él. |
| `header` | **Obligatorio.** Título de la columna (también encabezado en Excel). |
| `valor` | **Obligatorio.** `(fila) => string \| number \| boolean \| null \| undefined`. |
| `celda` | Pintado enriquecido (badges, enlaces, iconos). Si falta, se pinta `valor`. |
| `copiaTexto` | Texto exacto que va a Excel cuando difiere de lo visible (ej. precio sin `$`). |
| `prioridad` | `1` siempre · `2` se oculta bajo 640 px · `3` solo desde 1024 px. |
| `tarjeta` | Rol en la vista de tarjetas: `titulo`, `subtitulo`, `badge`, `cuerpo`, `meta`, `oculto`. |
| `copiable: false` | Fuera del copiado/descarga (iconos, acciones). |
| `interactiva: true` | La celda trae un control (input, checkbox, botón): queda fuera de la selección para no robarle el clic y su texto sí se puede seleccionar. |
| `filtrable` / `ordenable` | `false` quita el embudo o el orden. |
| `align`, `ancho`, `className`, `headerClassName` | Presentación. |

`textoDeValor()` convierte el valor plano a texto: `null/undefined → ''`,
`boolean → 'Sí' | 'No'`, lo demás con `String()`.

### Props del componente

| Prop | Default | Para qué |
|---|---|---|
| `id` | — | Clave de la preferencia de vista en `localStorage`. |
| `datos`, `columnas`, `filaId` | — | Datos, columnas y clave única de cada fila. |
| `titulo` | — | Nombre humano: log, nombre y hoja del Excel. |
| `modulo`, `entidad` | `'Sistema'` | Metadatos para el registro de copias. |
| `vistaInicial` | `'auto'` | `'auto'` = tarjetas bajo 768 px, tabla arriba. |
| `renderTarjeta` / `tarjetaSinMarco` / `gridTarjetas` | — | Tarjeta propia de la pantalla y su grid. |
| `onFilaClick` / `textoDetalle` | — / `'Ver'` | Abre el detalle (botón, doble clic o clic en tarjeta). |
| `acciones` / `anchoAcciones` | — / `'w-24'` | Botones propios en la primera columna. |
| `busqueda` | `true` | `false` la oculta; un string cambia el placeholder. |
| `herramientas` | — | Filtros de negocio de la pantalla dentro de la barra. |
| `vacio` | — | Mensaje propio sin filas. |
| `filasPorPagina` | `50` | `0` desactiva la paginación. |
| `copiable` / `descargable` | `true` | Apagan Copiar o Excel. |
| `filaClassName` | — | Resaltado por fila (crítico, vencido…). |
| `pie` | — | `(filasFiltradas) => ({ [idColumna]: ReactNode })`. |

---

## 3. Pipeline de datos (en este orden)

```
datos
  │  1. búsqueda global  → textoFila(fila) = todas las columnas unidas, en minúscula
  │  2. filtros por columna (pasaFiltro)
  ▼
filtradas
  │  3. orden (una sola columna activa)
  ▼
ordenadas  ─────────────► "Copiar tabla" y "Excel" usan TODO esto (todas las páginas)
  │  4. paginación (slice)
  ▼
filasPagina ────────────► lo que se pinta y sobre lo que se selecciona
```

- Cambiar búsqueda, filtros, orden o filas por página **vuelve a la página 1 y
  limpia la selección**.
- `pasaFiltro(fila, exceptoColumna?)`: para cada columna con filtro, exige que el
  texto contenga `f.texto` (sin mayúsculas) **y** que el valor esté en
  `f.valores` si la lista no es `null`. `valores: null` significa «todos».
- **Filtros en cascada**: la lista de valores de una columna se calcula con la
  búsqueda y con todos los filtros **excepto el de esa misma columna**
  (`pasaFiltro(fila, col.id)`). Así al filtrar «Sede = Norte», el embudo de
  «Producto» solo ofrece productos de Norte, pero el embudo de «Sede» sigue
  mostrando todas las sedes.
- Un filtro que queda vacío (`texto === ''` y `valores === null`) se **borra**
  del estado, así `hayFiltros` es exacto.

### Menú de filtro de columna (`FiltroColumna.tsx`)

- Se pinta en un **portal** (`createPortal` a `document.body`) con `position:
  fixed`, calculado desde el botón, para no quedar recortado por el
  `overflow-x-auto` de la tabla. Se cierra con clic fuera, `Esc`, `resize` o
  cualquier `scroll`.
- El valor vacío se muestra como `(Vacías)` pero se guarda como `''`.
- Marcar/desmarcar parte de `valores ?? todos`; si al final quedan marcados
  todos, se guarda `null` (sin filtro).
- «Solo lo visible» marca únicamente lo que coincide con el buscador interno.
- La lista se corta en 500 valores (aviso para usar el buscador).

---

## 4. Responsive

- `useTamano()` escucha `resize` y devuelve `xs` (<640), `sm` (640–1023) o `lg`
  (≥1024) — los mismos cortes de Tailwind, pero en JS. **Tiene que ser JS y no
  clases CSS**: la selección y el copiado trabajan sobre índices de
  `columnasVisibles`; si las columnas se ocultaran solo con CSS, un rango
  copiaría columnas que el usuario no ve.
- Antes de montar (SSR) se usan todas las columnas para evitar diferencias de
  hidratación; `montado` se vuelve `true` en el primer `useEffect`.
- La vista guardada en `localStorage` manda; si no hay, `'auto'` decide por
  `innerWidth < 768`. Todo acceso a `localStorage` va en `try/catch` (modo
  privado).

### Tarjeta automática

Si la pantalla no pasa `renderTarjeta`, la tarjeta se arma con los roles:
sin `tarjeta` declarado, la 1ª columna es `titulo`, la 2ª `subtitulo` y el
resto `meta`. `badge` va a la derecha arriba; `cuerpo` como líneas
«Etiqueta: valor»; `meta` en fila al pie. Las columnas de `cuerpo`/`meta`
**sin valor se omiten** (evita tarjetas llenas de «Cargo:» vacío). El grid lleva
`[&>*]:min-w-0` para que un texto largo no empuje la tarjeta fuera de pantalla.

---

## 5. Selección estilo hoja de cálculo

Estado: `sel = { filaInicio, colInicio, filaFin, colFin }` (índices sobre
`filasPagina` × `columnasVisibles`) + `ancla` (ref con la celda donde empezó).
`normalizar()` lo convierte en `r1..r2 × c1..c2`.

| Gesto | Resultado |
|---|---|
| `mousedown` en celda | Nueva selección de 1 celda; ancla = esa celda. Con Shift, extiende desde el ancla. |
| Arrastrar (`mouseenter` con botón apretado) | Rango ancla → celda actual. |
| Clic en el título | Columna completa (solo acerca la vista en horizontal). |
| Clic en el `#` de la fila | Fila completa. |
| Clic en la esquina `#` o `Ctrl+A` | Toda la página visible. |
| Flechas / Shift+flechas | Mueve / extiende desde `filaFin, colFin`, acotado a los bordes. |
| `Esc` | Limpia. |
| `Ctrl+C` | Copia la selección. |

Detalles que importan:

- La tabla es `select-none` y las celdas no son texto seleccionable, por eso el
  navegador **no dispara** `copy` solo: `Ctrl+C` se intercepta en `onKeyDown`
  del contenedor (`tabIndex={0}`) y se copia a mano. Igual hay un `onCopy` de
  respaldo.
- Celdas `interactiva` salen de la selección (`data-interactiva="1"`) y llevan
  `select-text`; la columna de acciones hace `stopPropagation` del `mousedown`.
- Cada celda lleva `data-celda="fila:col"` para localizarla en el DOM.
- **Seguir la celda activa**: tras cambiar `sel` se guarda un `objetivo` y un
  `useEffect` hace el scroll mínimo (margen 24 px) en horizontal sobre el
  contenedor y en vertical sobre el **ancestro que scrollea** (`ancestroVertical`
  busca el primer padre con `overflow-y: auto|scroll` que realmente desborda;
  si no hay, la ventana). El scroll vertical es `behavior: 'instant'` porque con
  `scroll-behavior: smooth` global la selección se quedaría atrás.
- **Auto‑scroll al arrastrar**: con el botón apretado, un bucle
  `requestAnimationFrame` mira el puntero (guardado en `mousemove` global); si
  está en la franja de borde (48 px, que se achica a 1/4 del tamaño en tablas
  pequeñas) desplaza con velocidad `min(40, 4 + distancia/3)` y extiende la
  selección con `document.elementFromPoint` sobre la celda bajo el puntero. Se
  detiene en `mouseup` global.

---

## 6. Copiado y descarga (`copiar.ts`)

`armarBloque(origen)` produce `{ encabezados: string[], filas: string[][] }`:

- **Sin selección o `'todo'`** → todas las `ordenadas` (todas las páginas) ×
  columnas visibles y copiables, **con** encabezados.
- **Con selección** → las filas/columnas del rango (quitando las
  `copiable: false`). Lleva encabezados **solo** si el rango cubre la columna
  completa (de la primera a la última fila de la página).
- Texto de celda: `copiaTexto(fila)` si existe; si no, `textoDeValor(valor)`.

Formatos:

- **TSV**: celdas separadas por `\t`, filas por `\r\n`; tabs y saltos dentro de
  una celda se cambian por espacio.
- **HTML** (`<table>` con `<thead>`), escapando `& < >`: Excel lo prefiere y
  conserva tildes y comas.
- Se escribe con `navigator.clipboard.write([new ClipboardItem({ 'text/plain', 'text/html' })])`;
  si no existe, `writeText(tsv)`; si falla, el truco del `textarea` +
  `execCommand('copy')`.
- **Excel** (`descargarExcel`): `import('exceljs')` bajo demanda; hoja con
  nombre saneado (sin `: \ / ? * [ ]`, máx. 31 caracteres), fila 1 congelada,
  encabezado en negrita blanca sobre el color de marca, autofiltro, ancho por
  columna = `min(60, largo + 2)` (mínimo 10). **Solo** convierte a número lo que
  vuelve idéntico al escribirlo (`String(Number(t)) === t`), así `007` o `1/1`
  no se deforman. Archivo: `<titulo>_<YYYY-MM-DD>.xlsx`.
- **CSV** (`aCSV`/`descargarCSV`, exportados aunque el botón usa Excel): `;` como
  separador, todo entre comillas, con BOM `﻿` para tildes en Excel en
  español.

Registro de trazabilidad (`registrarCopia`): acción `COPIAR` o `DESCARGAR`,
descripción humana («Copió una selección de Productos: 25 fila(s) × 4
columna(s)») y `detalle { tabla, origen, filas, columnas }`. Anti‑duplicado:
la misma firma dentro de 4 s no se vuelve a registrar. **Nunca** se guarda lo
copiado.

---

## 7. Adaptación a otro proyecto

Requisitos: React 18/19, Tailwind 3, `lucide-react`, `exceljs` (opcional, solo
para el botón Excel).

```bash
npm i lucide-react exceljs
```

1. **Registro de copias.** La versión de `copiar.ts` de este documento ya no
   depende de Supabase: expone `configurarRegistroCopia(fn)`. Llámalo una vez
   (por ejemplo en el layout del cliente) con lo que use tu proyecto; si no lo
   llamas, simplemente no se registra nada.

   ```ts
   import { configurarRegistroCopia } from '@/components/ui/tabla'

   configurarRegistroCopia(async (evento) => {
     // evento = { accion, modulo, descripcion, entidad, detalle }
     await fetch('/api/actividad', { method: 'POST', body: JSON.stringify(evento) })
   })
   ```

   En el proyecto original se insertaba en una tabla `actividad_log`
   (`usuario_id, usuario_email, usuario_nombre, accion, modulo, descripcion,
   entidad, entidad_id, detalle jsonb`).

2. **Colores y fuentes de Tailwind.** El código usa `brand-green`,
   `brand-green-dark`, `font-heading` y `font-body`. Agrégalos a tu
   `tailwind.config` o reemplázalos (buscar/reemplazar) por los tuyos:

   ```js
   theme: {
     extend: {
       colors: { brand: { green: { DEFAULT: '#2E7D32', dark: '#1B5E20' } } },
       fontFamily: { heading: ['var(--font-heading)', 'sans-serif'], body: ['var(--font-body)', 'sans-serif'] },
     },
   }
   ```

   El color del encabezado del Excel está en `copiar.ts` (`FF2E7D32` / `FF1B5E20`)
   y el autor del libro en `wb.creator`.

3. **Alias `@/`.** Solo `index.ts` y el uso en pantallas lo asumen; dentro de la
   carpeta todo es relativo.

4. **Next.js App Router.** `TablaEstandar.tsx` y `FiltroColumna.tsx` llevan
   `'use client'`. En Vite/CRA esa línea es inofensiva.

5. **Textos en español.** Todos los rótulos están en el JSX; si el otro proyecto
   es en otro idioma, se traducen ahí.

---

## 8. Ejemplo de uso

```tsx
'use client'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

type Fila = { id: string; nombre: string; sede: string; cantidad: number; precio: number; estado: string }

const columnas: ColumnaTabla<Fila>[] = [
  { id: 'nombre', header: 'Producto', valor: f => f.nombre, tarjeta: 'titulo' },
  { id: 'sede', header: 'Sede', valor: f => f.sede, prioridad: 2, tarjeta: 'subtitulo' },
  { id: 'cant', header: 'Cantidad', valor: f => f.cantidad, align: 'right' },
  {
    id: 'precio', header: 'Precio', align: 'right', prioridad: 3,
    valor: f => f.precio,
    celda: f => `$ ${f.precio.toLocaleString('es-CO')}`,
    copiaTexto: f => String(f.precio),          // a Excel va el número limpio
  },
  {
    id: 'estado', header: 'Estado', align: 'center', tarjeta: 'badge',
    valor: f => f.estado,
    celda: f => <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs">{f.estado}</span>,
  },
]

export function MiPantalla({ filas }: { filas: Fila[] }) {
  return (
    <TablaEstandar
      id="mi-pantalla"
      titulo="Mi pantalla"
      modulo="Inventario"
      entidad="productos"
      datos={filas}
      columnas={columnas}
      filaId={f => f.id}
      busqueda="Buscar producto…"
      onFilaClick={f => console.log('abrir', f.id)}
      acciones={f => <button onClick={() => console.log('editar', f.id)}>Editar</button>}
      filaClassName={f => (f.cantidad === 0 ? 'bg-red-50/60' : '')}
      pie={visibles => ({
        nombre: 'Total',
        cant: visibles.reduce((s, f) => s + f.cantidad, 0),
      })}
    />
  )
}
```

Celda editable dentro de la tabla:

```tsx
{
  id: 'conteo', header: 'Conteo', interactiva: true, copiable: false, filtrable: false,
  valor: f => f.conteo,
  celda: f => <input type="number" defaultValue={f.conteo} onBlur={e => guardar(f.id, e.target.value)} />,
}
```

---

## 9. Código fuente

Estructura:

```
components/ui/tabla/
├── index.ts
├── tipos.ts
├── copiar.ts          ← versión portable (sin Supabase)
├── FiltroColumna.tsx
└── TablaEstandar.tsx
```

### `copiar.ts` (portable)

```ts
import type { BloqueCopiado } from './tipos'

/** Evento de trazabilidad: qué se copió/descargó, nunca el contenido. */
export interface EventoCopia {
  accion: 'COPIAR' | 'DESCARGAR'
  modulo: string
  descripcion: string
  entidad?: string
  detalle: {
    tabla: string
    origen: 'seleccion' | 'todo' | 'descarga'
    filas: number
    columnas: string[]
  }
}

let registrador: ((evento: EventoCopia) => void | Promise<void>) | null = null

/** Conecta el registro de copias con el log de actividad del proyecto. */
export function configurarRegistroCopia(
  fn: ((evento: EventoCopia) => void | Promise<void>) | null
): void {
  registrador = fn
}

/** Excel separa columnas por tabulador y filas por salto de línea. */
function celdaPlana(valor: string): string {
  return valor.replace(/[\t\r\n]+/g, ' ').trim()
}

export function aTSV(bloque: BloqueCopiado): string {
  const filas = bloque.encabezados.length
    ? [bloque.encabezados, ...bloque.filas]
    : bloque.filas
  return filas.map((f) => f.map(celdaPlana).join('\t')).join('\r\n')
}

function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Excel respeta el HTML del portapapeles: así el pegado conserva encabezados en
 * negrita y no rompe los valores con comas o acentos.
 */
export function aHTML(bloque: BloqueCopiado): string {
  const thead = bloque.encabezados.length
    ? `<thead><tr>${bloque.encabezados
        .map((h) => `<th>${escaparHtml(celdaPlana(h))}</th>`)
        .join('')}</tr></thead>`
    : ''
  const tbody = `<tbody>${bloque.filas
    .map(
      (fila) =>
        `<tr>${fila.map((c) => `<td>${escaparHtml(celdaPlana(c))}</td>`).join('')}</tr>`
    )
    .join('')}</tbody>`
  return `<table border="1">${thead}${tbody}</table>`
}

/** Copia respaldada por textarea para navegadores sin API asíncrona. */
function copiarLegado(texto: string): boolean {
  try {
    const area = document.createElement('textarea')
    area.value = texto
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export async function copiarBloque(bloque: BloqueCopiado): Promise<boolean> {
  const tsv = aTSV(bloque)
  if (!tsv) return false
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([tsv], { type: 'text/plain' }),
          'text/html': new Blob([aHTML(bloque)], { type: 'text/html' }),
        }),
      ])
      return true
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(tsv)
      return true
    }
  } catch {
    /* cae al método legado */
  }
  return copiarLegado(tsv)
}

export interface DatosCopia {
  modulo: string
  entidad?: string
  titulo: string
  filas: number
  columnas: string[]
  origen: 'seleccion' | 'todo' | 'descarga'
}

/** Evita duplicar el log cuando alguien repite Ctrl+C sobre lo mismo. */
let ultimaFirma = ''
let ultimoInstante = 0

/**
 * Deja rastro de lo que se copió o descargó: de qué tabla, cuántas filas y qué
 * columnas. Nunca guarda el contenido copiado.
 */
export async function registrarCopia(datos: DatosCopia): Promise<void> {
  if (!registrador) return
  const firma = `${datos.titulo}|${datos.origen}|${datos.filas}|${datos.columnas.join(',')}`
  const ahora = Date.now()
  if (firma === ultimaFirma && ahora - ultimoInstante < 4000) return
  ultimaFirma = firma
  ultimoInstante = ahora

  const verbo =
    datos.origen === 'descarga'
      ? 'Descargó'
      : datos.origen === 'todo'
        ? 'Copió la tabla completa'
        : 'Copió una selección'
  const descripcion =
    `${verbo} de ${datos.titulo}: ${datos.filas} fila(s) × ${datos.columnas.length} columna(s)`

  try {
    await registrador({
      accion: datos.origen === 'descarga' ? 'DESCARGAR' : 'COPIAR',
      modulo: datos.modulo,
      descripcion,
      entidad: datos.entidad,
      detalle: {
        tabla: datos.titulo,
        origen: datos.origen,
        filas: datos.filas,
        columnas: datos.columnas,
      },
    })
  } catch (e) {
    console.error('registrarCopia', e)
  }
}

/**
 * Los números entran como número para que Excel los sume; el resto va como
 * texto. Solo se convierte lo que vuelve idéntico al escribirlo de nuevo, así
 * un código como `007` o un `1/1` conservan su forma.
 */
function valorExcel(valor: string): string | number {
  const texto = celdaPlana(valor)
  if (texto === '') return ''
  const numero = Number(texto)
  return Number.isFinite(numero) && String(numero) === texto ? numero : texto
}

/**
 * Descarga la tabla como un .xlsx de verdad: encabezado con el color de la
 * marca, fila congelada, autofiltro y anchos según el contenido. `exceljs` se
 * carga bajo demanda para no engordar la pantalla mientras nadie descarga.
 */
export async function descargarExcel(
  bloque: BloqueCopiado,
  nombre: string,
  hoja = 'Datos'
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Mi aplicación' // ← cambia por el nombre del proyecto
  wb.created = new Date()
  // Excel no admite : \ / ? * [ ] en el nombre de la hoja, ni más de 31 letras.
  const ws = wb.addWorksheet(hoja.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Datos', {
    views: [{ state: 'frozen', ySplit: bloque.encabezados.length ? 1 : 0 }],
  })

  if (bloque.encabezados.length) ws.addRow(bloque.encabezados)
  for (const fila of bloque.filas) ws.addRow(fila.map(valorExcel))

  const anchos = (bloque.encabezados.length ? [bloque.encabezados, ...bloque.filas] : bloque.filas)
    .reduce<number[]>((acc, fila) => {
      fila.forEach((c, i) => {
        acc[i] = Math.max(acc[i] ?? 10, Math.min(60, celdaPlana(c).length + 2))
      })
      return acc
    }, [])
  anchos.forEach((ancho, i) => {
    ws.getColumn(i + 1).width = ancho
  })

  if (bloque.encabezados.length) {
    const encabezado = ws.getRow(1)
    encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    encabezado.alignment = { vertical: 'middle' }
    encabezado.height = 20
    encabezado.eachCell((cell) => {
      // ← color de marca (ARGB)
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF1B5E20' } } }
    })
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } }
  }

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${nombre}_${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** CSV con BOM para que Excel en español abra las tildes bien. */
export function aCSV(bloque: BloqueCopiado): string {
  const filas = bloque.encabezados.length
    ? [bloque.encabezados, ...bloque.filas]
    : bloque.filas
  return filas
    .map((f) => f.map((c) => `"${celdaPlana(c).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n')
}

export function descargarCSV(bloque: BloqueCopiado, nombre: string): void {
  const blob = new Blob(['﻿' + aCSV(bloque)], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${nombre}_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
```

### `index.ts`

```ts
export { TablaEstandar } from './TablaEstandar'
export type { TablaEstandarProps } from './TablaEstandar'
export { FiltroColumnaMenu } from './FiltroColumna'
export {
  aCSV,
  aHTML,
  aTSV,
  configurarRegistroCopia,
  copiarBloque,
  descargarCSV,
  descargarExcel,
  registrarCopia,
} from './copiar'
export type { EventoCopia } from './copiar'
export { textoDeValor } from './tipos'
export type {
  AlineacionColumna,
  BloqueCopiado,
  ColumnaTabla,
  DireccionOrden,
  FiltroColumna,
  OrdenTabla,
  RangoSeleccion,
  RolTarjeta,
  ValorCelda,
  Vista,
} from './tipos'
```

### `tipos.ts`

```ts
import type { ReactNode } from 'react'

/** Valores planos que viajan a los filtros, al orden y al portapapeles. */
export type ValorCelda = string | number | boolean | null | undefined

export type AlineacionColumna = 'left' | 'center' | 'right'

/**
 * Rol de la columna cuando la tabla se pinta como tarjetas (móvil o vista
 * "Tarjetas"). Si no se declara, las dos primeras columnas hacen de título y
 * subtítulo y el resto cae en `meta`.
 */
export type RolTarjeta = 'titulo' | 'subtitulo' | 'badge' | 'meta' | 'cuerpo' | 'oculto'

export interface ColumnaTabla<T> {
  /** Identificador estable; se usa en filtros, orden y preferencias guardadas. */
  id: string
  header: string
  /** Valor plano de la celda: filtro, búsqueda, orden y copiado salen de aquí. */
  valor: (fila: T) => ValorCelda
  /** Pintado enriquecido. Por defecto se muestra `valor`. */
  celda?: (fila: T) => ReactNode
  /** Texto exacto que se pega en Excel. Por defecto, `valor` formateado. */
  copiaTexto?: (fila: T) => string
  align?: AlineacionColumna
  /** 1 = siempre visible · 2 = se oculta en móvil · 3 = solo pantallas grandes. */
  prioridad?: 1 | 2 | 3
  /** Por defecto true. */
  ordenable?: boolean
  /** Por defecto true. */
  filtrable?: boolean
  /** Por defecto true. Las columnas de acciones o iconos deben ir en false. */
  copiable?: boolean
  /**
   * La celda trae controles (input, checkbox, botón). Queda fuera de la
   * selección de rango para no robarle el clic al control, y su texto sí se
   * puede seleccionar con el mouse.
   */
  interactiva?: boolean
  /** Ubicación dentro de la tarjeta. */
  tarjeta?: RolTarjeta
  className?: string
  headerClassName?: string
  /** Clase de ancho, ej. 'w-12' o 'min-w-[220px]'. */
  ancho?: string
}

export type Vista = 'tabla' | 'tarjetas'

export type DireccionOrden = 'asc' | 'desc'

export interface OrdenTabla {
  columna: string
  direccion: DireccionOrden
}

/** Filtro interno de una columna: texto "contiene" + valores marcados. */
export interface FiltroColumna {
  texto: string
  valores: string[] | null
}

/** Selección rectangular estilo hoja de cálculo (índices sobre lo visible). */
export interface RangoSeleccion {
  filaInicio: number
  colInicio: number
  filaFin: number
  colFin: number
}

export interface BloqueCopiado {
  encabezados: string[]
  filas: string[][]
}

export function textoDeValor(valor: ValorCelda): string {
  if (valor === null || valor === undefined) return ''
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  return String(valor)
}
```

### `FiltroColumna.tsx`

```tsx
'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownAZ, ArrowUpAZ, Check, Filter, Search, X } from 'lucide-react'
import type { DireccionOrden, FiltroColumna as EstadoFiltro } from './tipos'

interface Props {
  titulo: string
  /** Valores distintos de la columna, ya filtrados por las demás columnas. */
  valoresUnicos: string[]
  filtro: EstadoFiltro
  orden: DireccionOrden | null
  ordenable: boolean
  onOrden: (direccion: DireccionOrden | null) => void
  onCambio: (filtro: EstadoFiltro) => void
}

const VACIO = '(Vacías)'
const TOPE_LISTA = 500

export function FiltroColumnaMenu({
  titulo,
  valoresUnicos,
  filtro,
  orden,
  ordenable,
  onOrden,
  onCambio,
}: Props) {
  const [abierto, setAbierto] = useState(false)
  const [buscar, setBuscar] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const botonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const activo = filtro.texto.trim() !== '' || filtro.valores !== null

  useLayoutEffect(() => {
    if (!abierto || !botonRef.current) return
    const r = botonRef.current.getBoundingClientRect()
    const ancho = 260
    const left = Math.min(Math.max(8, r.left - ancho + r.width), window.innerWidth - ancho - 8)
    setPos({ top: r.bottom + 6, left })
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || botonRef.current?.contains(t)) return
      setAbierto(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    const cerrar = () => setAbierto(false)
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', cerrar)
    window.addEventListener('scroll', cerrar, true)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', cerrar)
      window.removeEventListener('scroll', cerrar, true)
    }
  }, [abierto])

  const listado = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    const base = valoresUnicos.map((v) => (v === '' ? VACIO : v))
    const filtrados = q ? base.filter((v) => v.toLowerCase().includes(q)) : base
    return filtrados.slice(0, TOPE_LISTA)
  }, [valoresUnicos, buscar])

  const marcados = useMemo(
    () => (filtro.valores === null ? null : new Set(filtro.valores)),
    [filtro.valores]
  )

  const estaMarcado = (valor: string) =>
    marcados === null || marcados.has(valor === VACIO ? '' : valor)

  const alternar = (valor: string) => {
    const real = valor === VACIO ? '' : valor
    const actuales = new Set(marcados ?? valoresUnicos)
    if (actuales.has(real)) actuales.delete(real)
    else actuales.add(real)
    const lista = valoresUnicos.filter((v) => actuales.has(v))
    onCambio({ ...filtro, valores: lista.length === valoresUnicos.length ? null : lista })
  }

  const marcarSoloVisibles = () => {
    onCambio({ ...filtro, valores: listado.map((v) => (v === VACIO ? '' : v)) })
  }

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setAbierto((v) => !v)
        }}
        title={`Filtrar y ordenar por ${titulo}`}
        aria-label={`Filtrar y ordenar por ${titulo}`}
        className={`shrink-0 rounded-md p-1 transition-colors ${
          activo || orden
            ? 'bg-brand-green/10 text-brand-green'
            : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500'
        }`}
      >
        {orden === 'asc' ? (
          <ArrowUpAZ className="h-3.5 w-3.5" />
        ) : orden === 'desc' ? (
          <ArrowDownAZ className="h-3.5 w-3.5" />
        ) : (
          <Filter className="h-3.5 w-3.5" />
        )}
      </button>

      {abierto &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: pos.top, left: pos.left, width: 260 }}
            className="fixed z-50 rounded-xl border border-gray-200 bg-white shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <p className="truncate font-heading text-xs font-bold text-gray-700">{titulo}</p>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {ordenable && (
              <div className="flex gap-1 border-b border-gray-100 px-2 py-2">
                <button
                  type="button"
                  onClick={() => onOrden(orden === 'asc' ? null : 'asc')}
                  className={`flex-1 rounded-lg px-2 py-1.5 font-body text-xs font-semibold transition-colors ${
                    orden === 'asc'
                      ? 'bg-brand-green text-white'
                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  A → Z
                </button>
                <button
                  type="button"
                  onClick={() => onOrden(orden === 'desc' ? null : 'desc')}
                  className={`flex-1 rounded-lg px-2 py-1.5 font-body text-xs font-semibold transition-colors ${
                    orden === 'desc'
                      ? 'bg-brand-green text-white'
                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Z → A
                </button>
              </div>
            )}

            <div className="px-2 py-2">
              <input
                value={filtro.texto}
                onChange={(e) => onCambio({ ...filtro, texto: e.target.value })}
                placeholder="Contiene…"
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 font-body text-xs outline-none focus:border-brand-green"
              />
            </div>

            <div className="border-t border-gray-100 px-2 pt-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-300" />
                <input
                  value={buscar}
                  onChange={(e) => setBuscar(e.target.value)}
                  placeholder="Buscar valor…"
                  className="w-full rounded-lg border border-gray-200 py-1.5 pl-7 pr-2 font-body text-xs outline-none focus:border-brand-green"
                />
              </div>
              <div className="mt-1 flex items-center justify-between px-1 py-1">
                <button
                  type="button"
                  onClick={() => onCambio({ ...filtro, valores: null })}
                  className="font-body text-[11px] font-semibold text-brand-green hover:underline"
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={marcarSoloVisibles}
                  className="font-body text-[11px] font-semibold text-gray-500 hover:underline"
                >
                  Solo lo visible
                </button>
              </div>
              <div className="max-h-52 overflow-y-auto pb-1">
                {listado.length === 0 && (
                  <p className="px-2 py-3 font-body text-xs text-gray-400">Sin valores.</p>
                )}
                {listado.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => alternar(v)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-gray-50"
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                        estaMarcado(v)
                          ? 'border-brand-green bg-brand-green text-white'
                          : 'border-gray-300 bg-white'
                      }`}
                    >
                      {estaMarcado(v) && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <span className="truncate font-body text-xs text-gray-700">{v}</span>
                  </button>
                ))}
                {valoresUnicos.length > TOPE_LISTA && (
                  <p className="px-2 py-1 font-body text-[11px] text-gray-400">
                    Mostrando {TOPE_LISTA} de {valoresUnicos.length}. Usa el buscador.
                  </p>
                )}
              </div>
            </div>

            {(activo || orden) && (
              <div className="border-t border-gray-100 p-2">
                <button
                  type="button"
                  onClick={() => {
                    onCambio({ texto: '', valores: null })
                    onOrden(null)
                  }}
                  className="w-full rounded-lg bg-gray-50 px-2 py-1.5 font-body text-xs font-semibold text-gray-600 hover:bg-gray-100"
                >
                  Limpiar columna
                </button>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}
```

### `TablaEstandar.tsx`

```tsx
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
  Eye,
  FileSpreadsheet,
  FilterX,
  LayoutGrid,
  Rows3,
  Search,
} from 'lucide-react'
import { FiltroColumnaMenu } from './FiltroColumna'
import { copiarBloque, descargarExcel, registrarCopia } from './copiar'
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
  /** Nombre humano de la tabla: sale en el log, en el Excel y en su hoja. */
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

/** Aire que se deja entre la celda activa y el borde al seguir la selección. */
const MARGEN_SCROLL = 24
/** Franja del borde donde arrastrar empieza a mover la vista (estilo Excel). */
const ZONA_ARRASTRE = 48

/** Ancestro que hace el scroll vertical (el `main` del shell). null = la ventana. */
function ancestroVertical(el: HTMLElement | null): HTMLElement | null {
  let padre = el?.parentElement ?? null
  while (padre && padre !== document.body) {
    const overflow = window.getComputedStyle(padre).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && padre.scrollHeight > padre.clientHeight) {
      return padre
    }
    padre = padre.parentElement
  }
  return null
}

/** Franja visible en vertical: la del ancestro con scroll o la ventana. */
function limitesVerticales(vertical: HTMLElement | null) {
  if (!vertical) return { arriba: 0, abajo: window.innerHeight }
  const r = vertical.getBoundingClientRect()
  return { arriba: r.top, abajo: r.bottom }
}

/** Siempre instantáneo: la página usa `scroll-behavior: smooth` y una animación
 *  por fotograma dejaría la selección atrás mientras se arrastra. */
function desplazarVertical(vertical: HTMLElement | null, delta: number) {
  if (!delta) return
  const opciones: ScrollToOptions = { top: delta, behavior: 'instant' as ScrollBehavior }
  if (vertical) vertical.scrollBy(opciones)
  else window.scrollBy(opciones)
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
  const [descargando, setDescargando] = useState(false)
  const arrastrando = useRef(false)
  const ancla = useRef<{ fila: number; col: number } | null>(null)
  const contenedorRef = useRef<HTMLDivElement>(null)
  /** Celda que la vista debe seguir tras el próximo repintado. */
  const objetivo = useRef<{ fila: number; col: number; ejes: 'ambos' | 'horizontal' } | null>(null)
  const puntero = useRef<{ x: number; y: number } | null>(null)
  const autoScroll = useRef<number | null>(null)

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

  const descargar = async () => {
    const bloque = armarBloque('todo')
    if (!bloque) return
    setDescargando(true)
    try {
      await descargarExcel(bloque, titulo.toLowerCase().replace(/\s+/g, '_'), titulo)
      anunciar('Excel descargado')
    } catch {
      anunciar('No se pudo generar el Excel')
      return
    } finally {
      setDescargando(false)
    }
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
  const detenerAutoScroll = useCallback(() => {
    if (autoScroll.current !== null) {
      cancelAnimationFrame(autoScroll.current)
      autoScroll.current = null
    }
  }, [])

  useEffect(() => {
    const soltar = () => {
      arrastrando.current = false
      detenerAutoScroll()
    }
    const mover = (e: MouseEvent) => {
      puntero.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mouseup', soltar)
    window.addEventListener('mousemove', mover)
    return () => {
      window.removeEventListener('mouseup', soltar)
      window.removeEventListener('mousemove', mover)
      detenerAutoScroll()
    }
  }, [detenerAutoScroll])

  const celdaDom = (fila: number, col: number) =>
    contenedorRef.current?.querySelector<HTMLElement>(`[data-celda="${fila}:${col}"]`) ?? null

  /** Mueve lo mínimo para dejar la celda a la vista, como haría una hoja de cálculo. */
  const acercarCelda = (fila: number, col: number, ejes: 'ambos' | 'horizontal' = 'ambos') => {
    const contenedor = contenedorRef.current
    const celda = celdaDom(fila, col)
    if (!contenedor || !celda) return
    const c = contenedor.getBoundingClientRect()
    const e = celda.getBoundingClientRect()
    if (e.left < c.left + MARGEN_SCROLL) contenedor.scrollLeft += e.left - c.left - MARGEN_SCROLL
    else if (e.right > c.right - MARGEN_SCROLL) {
      contenedor.scrollLeft += e.right - c.right + MARGEN_SCROLL
    }
    if (ejes === 'horizontal') return
    const vertical = ancestroVertical(contenedor)
    const { arriba, abajo } = limitesVerticales(vertical)
    if (e.top < arriba + MARGEN_SCROLL) desplazarVertical(vertical, e.top - arriba - MARGEN_SCROLL)
    else if (e.bottom > abajo - MARGEN_SCROLL) {
      desplazarVertical(vertical, e.bottom - abajo + MARGEN_SCROLL)
    }
  }

  // La vista sigue a la celda activa después de pintar la nueva selección.
  useEffect(() => {
    const destino = objetivo.current
    objetivo.current = null
    if (!destino || vista !== 'tabla') return
    acercarCelda(destino.fila, destino.col, destino.ejes)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, vista])

  /** Extiende la selección hasta la celda que hay bajo un punto de la pantalla. */
  const extenderHastaPunto = (x: number, y: number) => {
    if (!ancla.current) return
    const celda = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>(
      '[data-celda]'
    )
    const dato = celda?.dataset.celda
    if (!dato || celda?.dataset.interactiva === '1') return
    const [fila, col] = dato.split(':').map(Number)
    const desde = ancla.current
    setSel((prev) =>
      prev &&
      prev.filaInicio === desde.fila &&
      prev.colInicio === desde.col &&
      prev.filaFin === fila &&
      prev.colFin === col
        ? prev
        : { filaInicio: desde.fila, colInicio: desde.col, filaFin: fila, colFin: col }
    )
  }

  /** Con el botón apretado cerca del borde, la vista avanza sola y la selección
   *  la sigue: así se puede marcar más allá de lo que se ve. */
  const iniciarAutoScroll = () => {
    if (autoScroll.current !== null) return
    const paso = () => {
      autoScroll.current = null
      if (!arrastrando.current) return
      const contenedor = contenedorRef.current
      const p = puntero.current
      if (contenedor && p) {
        const c = contenedor.getBoundingClientRect()
        const vertical = ancestroVertical(contenedor)
        const limites = limitesVerticales(vertical)
        const arriba = Math.max(c.top, limites.arriba)
        const abajo = Math.min(c.bottom, limites.abajo)
        const velocidad = (d: number) => Math.min(40, Math.round(4 + d / 3))
        // En tablas cortas o angostas la franja se encoge: si no, todo el
        // arrastre caería dentro de la zona de borde y la vista se iría sola.
        const zonaX = Math.min(ZONA_ARRASTRE, (c.right - c.left) / 4)
        const zonaY = Math.min(ZONA_ARRASTRE, Math.max(0, (abajo - arriba) / 4))
        let dx = 0
        let dy = 0
        if (p.x > c.right - zonaX) dx = velocidad(p.x - (c.right - zonaX))
        else if (p.x < c.left + zonaX) dx = -velocidad(c.left + zonaX - p.x)
        if (p.y > abajo - zonaY) dy = velocidad(p.y - (abajo - zonaY))
        else if (p.y < arriba + zonaY) dy = -velocidad(arriba + zonaY - p.y)
        const scrollAntes = contenedor.scrollLeft
        const verticalAntes = vertical ? vertical.scrollTop : window.scrollY
        if (dx) contenedor.scrollLeft += dx
        if (dy) desplazarVertical(vertical, dy)
        const verticalDespues = vertical ? vertical.scrollTop : window.scrollY
        if (contenedor.scrollLeft !== scrollAntes || verticalDespues !== verticalAntes) {
          extenderHastaPunto(
            Math.min(Math.max(p.x, c.left + 4), c.right - 4),
            Math.min(Math.max(p.y, arriba + 4), abajo - 4)
          )
        }
      }
      autoScroll.current = requestAnimationFrame(paso)
    }
    autoScroll.current = requestAnimationFrame(paso)
  }

  const seleccionarCelda = (fila: number, col: number, extender: boolean) => {
    objetivo.current = { fila, col, ejes: 'ambos' }
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
    // Solo se acerca en horizontal: al marcar una columna la vista no debe saltar de fila.
    objetivo.current = { fila: 0, col, ejes: 'horizontal' }
    setSel({ filaInicio: 0, colInicio: col, filaFin: filasPagina.length - 1, colFin: col })
    contenedorRef.current?.focus()
  }

  const seleccionarFila = (fila: number) => {
    ancla.current = { fila, col: 0 }
    objetivo.current = { fila, col: 0, ejes: 'ambos' }
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
      objetivo.current = { fila, col, ejes: 'ambos' }
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
    // Una etiqueta sin valor («Cargo:» y nada más) solo mete ruido en la
    // tarjeta, y en tablas con filas incompletas —la planta de personal, donde
    // los retirados no traen cargo ni centro de costos— serían casi todas.
    const conValor = (c: ColumnaTabla<T>) => textoDeValor(c.valor(fila)).trim() !== ''
    const cuerpo = de('cuerpo').filter(conValor)
    const metas = de('meta').filter(conValor)
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
            onClick={() => void descargar()}
            disabled={descargando}
            title="Descargar lo filtrado como Excel (.xlsx)"
            className="inline-flex items-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-3 py-2 font-body text-sm font-semibold text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> {descargando ? 'Generando…' : 'Excel'}
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
                      data-celda={`${ri}:${ci}`}
                      data-interactiva={c.interactiva ? '1' : undefined}
                      onMouseDown={(e) => {
                        // Las celdas con controles no entran en la selección:
                        // el clic es del input, no de la hoja.
                        if (c.interactiva || e.button !== 0) return
                        arrastrando.current = true
                        puntero.current = { x: e.clientX, y: e.clientY }
                        seleccionarCelda(ri, ci, e.shiftKey)
                        contenedorRef.current?.focus()
                        iniciarAutoScroll()
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
```
