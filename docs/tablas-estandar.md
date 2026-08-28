# Estándar de tablas y tarjetas (`TablaEstandar`)

Todas las pantallas de listado del portal usan un mismo componente:
`apps/inventario/components/ui/tabla/TablaEstandar.tsx`.

Resuelve de una sola vez lo que antes cada pantalla resolvía a su manera:

| Necesidad | Cómo lo resuelve |
|---|---|
| Responsive | En móvil arranca en **tarjetas**; en tabla, las columnas de prioridad 2 y 3 se ocultan solas y el resto hace scroll horizontal dentro de su propio contenedor (la página nunca se desborda). |
| Cambiar tabla ⇄ tarjetas | Botón **Tabla / Tarjetas** arriba a la derecha de la barra. La elección se recuerda por pantalla en `localStorage` (`tabla:<id>:vista`). |
| Filtro por columna | Cada encabezado tiene un embudo: orden A→Z / Z→A, filtro «contiene» y lista de valores con casillas (estilo Excel). Los valores que ofrece cada columna ya vienen filtrados por las demás columnas. |
| Copiar a Excel | Selección de celdas, rangos, columnas completas o toda la tabla → `Ctrl+C` o el botón **Copiar**. Va al portapapeles como TSV + HTML, así que se pega directo en Excel con las columnas separadas. |
| Descargar | Botón **CSV** (separador `;`, con BOM para las tildes). |
| Acciones | Van en la **primera columna**, junto al número de fila. Si la pantalla define `onFilaClick`, ahí aparece un botón verde **Ver** que abre el detalle (el texto se cambia con `textoDetalle`). |
| Trazabilidad | Cada copia y cada descarga queda registrada en `actividad_log`. |

## Cómo se selecciona (igual que en una hoja de cálculo)

- **Clic** en una celda: la selecciona.
- **Arrastrar** o **Shift + clic**: rango rectangular.
- **Clic en el título de la columna**: selecciona la columna entera (y al copiar se incluye el encabezado).
- **Clic en el número de fila** (columna `#` de la izquierda): selecciona la fila.
- **Clic en la esquina `#`** o **Ctrl+A**: selecciona todo lo que se ve en la página.
- **Flechas** mueven la selección, **Shift+flechas** la extienden, **Esc** la limpia.
- **Ctrl+C** copia; sin selección, el botón **Copiar tabla** copia todo lo filtrado (todas las páginas).
- **Doble clic** en la fila abre el detalle, igual que el botón **Ver** de la primera columna.

## Qué queda en el log

`components/ui/tabla/copiar.ts` → `registrarCopia()` escribe en `actividad_log`:

- `accion`: `COPIAR` o `DESCARGAR`
- `modulo`: el que declare la pantalla (`Inventario`, `Compras`, `Usuarios`…)
- `entidad`: la tabla de datos (`productos`, `movimientos`…)
- `descripcion`: `Copió una selección de Productos: 25 fila(s) × 4 columna(s)`
- `detalle`: `{ tabla, origen: 'seleccion' | 'todo' | 'descarga', filas, columnas }`

**Nunca se guarda el contenido copiado**, solo el qué/cuánto/quién/cuándo. Copias
idénticas repetidas dentro de 4 segundos no se duplican en el log.

Se ve en **Log de Actividad** (`/actividad-log`), filtrando por acción `COPIAR`.

## Cómo se usa en una pantalla nueva

```tsx
'use client'
import { TablaEstandar, type ColumnaTabla } from '@/components/ui/tabla'

const columnas: ColumnaTabla<Fila>[] = [
  { id: 'nombre', header: 'Producto', valor: f => f.nombre, tarjeta: 'titulo' },
  { id: 'sede',   header: 'Sede',     valor: f => f.sede,   prioridad: 2, tarjeta: 'subtitulo' },
  { id: 'cant',   header: 'Cantidad', valor: f => f.cantidad, align: 'right' },
  {
    id: 'estado', header: 'Estado', align: 'center', tarjeta: 'badge',
    valor: f => f.estado,
    celda: f => <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs">{f.estado}</span>,
  },
]

<TablaEstandar
  id="mi-pantalla"          // clave de la preferencia de vista
  titulo="Mi pantalla"      // sale en el log y en el nombre del CSV
  modulo="Inventario"       // módulo para actividad_log
  entidad="mi_tabla"
  datos={filas}
  columnas={columnas}
  filaId={f => f.id}
  busqueda="Buscar…"        // false para usar el buscador propio de la pantalla
  acciones={f => <BotonEditar fila={f} />}
  herramientas={<MisFiltrosDeNegocio />}
/>
```

### La columna, campo por campo

| Campo | Para qué |
|---|---|
| `valor` | **Obligatorio.** Dato plano: alimenta búsqueda, filtros, orden y copiado. |
| `celda` | Pintado enriquecido (badges, enlaces, iconos). Si falta, se pinta `valor`. |
| `copiaTexto` | Texto exacto que va a Excel cuando difiere de lo que se ve (ej.: precio sin `$`). |
| `prioridad` | `1` siempre visible · `2` se oculta bajo 640 px · `3` solo desde 1024 px. |
| `tarjeta` | Lugar en la tarjeta: `titulo`, `subtitulo`, `badge`, `cuerpo`, `meta`, `oculto`. |
| `copiable: false` | Deja la columna fuera del copiado (iconos, acciones). |
| `interactiva: true` | La celda trae un control (input, checkbox, botón): queda fuera de la selección para no robarle el clic, y su texto sí se puede seleccionar. |
| `filtrable` / `ordenable` | `false` quita el embudo o el orden de esa columna. |
| `align`, `ancho`, `className`, `headerClassName` | Presentación. |

### Props útiles

- `renderTarjeta` — la pantalla pinta su propia tarjeta (fotos, barras de progreso).
  Con `tarjetaSinMarco` la tarjeta trae también su propio marco.
- `gridTarjetas` — clases del grid de tarjetas.
- `filasPorPagina` — `50` por defecto; `0` desactiva la paginación (útil cuando el
  servidor ya pagina).
- `copiable` / `descargable` — apagan los botones de copiar o CSV.
- `vacio` — mensaje propio cuando no hay filas.
- `filaClassName` — resaltados por fila (crítico, vencido…).
- `acciones` / `anchoAcciones` — botones propios de la pantalla, en la primera columna.
- `textoDetalle` — etiqueta del botón que abre el detalle (`Ver` por defecto).
- `pie` — fila de totales al pie (solo en vista de tabla): devuelve, por id de
  columna, lo que se pinta; recibe las filas ya filtradas.

## Pantallas migradas

**Listados:** productos, stock, movimientos, usuarios, órdenes de insumo,
órdenes de compra, sedes/contratos, log de actividad, historial de cambios,
servicios del hogar (solicitudes y precios).

**Panel y reportes:** pedidos en curso y alertas de stock crítico del dashboard,
recomendación de compra y plan de reabastecimiento (aprovisionamiento),
actividad por usuario (reportes), reporte de órdenes por creador, historial de
cargas masivas.

**Vistas de trabajo (celdas editables con `interactiva`):** alistamiento,
detalle de orden de insumo, productos de la solicitud, envío restante, nueva
orden, movimientos en lote, arqueo, parametrización por sede, ítems de orden de
compra y la vista previa de las cargas masivas.

## Qué sigue sin el estándar, a propósito

| Dónde | Por qué |
|---|---|
| Detalle de un cambio en el historial | Es un diff campo/antes/después dentro de un desplegable, no una rejilla de datos. |
| Respuestas del asistente de IA (`Markdown.tsx`) | Pinta tablas de markdown arbitrario; ya va dentro de un contenedor con scroll propio. |
| Impresión de la orden de compra | Es una hoja A4: una barra de herramientas o paginación arruinaría el impreso. Se le agregó scroll horizontal solo en pantalla. |
| Agenda del portal web (`apps/web`) | Es una grilla de horas × días para reservar, no un listado. |
