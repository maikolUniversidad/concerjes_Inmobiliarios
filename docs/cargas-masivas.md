# Cargas masivas (importar desde Excel/CSV)

Módulo `/importar` de la app de inventario, más la pestaña de cargue de
**Gestión Humana → Personas**. Permite crear y actualizar productos,
proveedores, usuarios, clientes, sedes y personas desde un archivo.

Archivos que lo componen:

| Archivo | Qué hace |
| --- | --- |
| `lib/import/config.ts` | Qué columnas tiene cada entidad, cómo se leen los valores y cómo se valida cada fila. |
| `lib/import/csv.ts` | Lectura de CSV (separador, comillas, encabezados). |
| `lib/import/xlsx-client.ts` | Genera la plantilla, lee el .xlsx y exporta el informe del resultado. |
| `components/import/BulkImport.tsx` | Los 3 pasos: plantilla → subir → vista previa → confirmar. |
| `app/(dashboard)/importar/actions.ts` | La escritura en la base (server action). |

## Cómo funciona

1. **Plantilla.** Se descarga un `.xlsx` con los encabezados, una fila de ejemplo,
   listas desplegables en las columnas de lista, validación numérica y una hoja
   de instrucciones.
2. **Subida.** Se acepta `.xlsx` o `.csv`. Los encabezados se emparejan con las
   columnas sin importar mayúsculas, tildes, espacios ni guiones, y admitiendo
   alias (`precio` → `precio_lista`, `cedula` → `documento`, …).
3. **Vista previa.** Cada fila se clasifica antes de tocar la base:

   | Estado | Significado |
   | --- | --- |
   | Nuevo | Su clave no existe todavía: se crea. |
   | Actualizar | La clave ya existe: se actualiza **solo con las columnas del archivo**. |
   | Repetida | La misma clave ya venía en una fila anterior del archivo; se carga solo la primera. |
   | Ejemplo | Es la fila de ejemplo de la plantilla; se omite. |
   | Error | No se carga; se explica qué está mal y en qué fila. |

4. **Confirmar.** Se envían solo las filas nuevas y las de actualizar. El
   servidor vuelve a filtrar campos y repetidos (no confía en el navegador),
   registra el lote en el historial y deja traza en el log de actividad.
5. **Informe.** Al terminar se puede descargar un Excel con el resultado fila por
   fila, incluidos los errores, para corregir y volver a cargar.

## Reglas de lectura de valores

**Números** (`aNumero`) — pensados para cómo se escribe en Colombia:

| Se escribe | Se guarda |
| --- | --- |
| `18.900`, `$ 18.900`, `18900`, `18 900` | `18900` |
| `1.234.567` | `1234567` |
| `$ 18.900,50` | `18900.5` |
| `18,5` | `18.5` |
| `18.5` (el punto no agrupa 3 dígitos) | `18.5` |
| `(1.500)` | `-1500` |
| `no aplica`, `N/A`, `doce` | **Error** en la vista previa |

> Un solo punto seguido de exactamente tres dígitos se lee como separador de
> miles. Es lo que arregla el caso `18.900`, que antes entraba como `18,9`.

**Fechas** (`aFecha`): `AAAA-MM-DD`, `DD/MM/AAAA`, `DD-MM-AAAA`, una celda con
formato de fecha de Excel o su número de serie. `31/02/2026` es un error, no un
valor vacío.

**SI/NO** (`aBooleano`): `SI`, `Sí`, `true`, `1`, `X` → sí; `NO`, `false`, `0` →
no; cualquier otra cosa es error.

**Listas**: se aceptan en minúsculas y con tildes (`aseo` → `ASEO`).

## La regla más importante: lo vacío no se toca

Una columna vacía **no se envía**. Si subes un Excel con `ref` y `precio_lista`
para actualizar precios, se actualiza el precio y nada más: la presentación, el
tipo de insumo, el proveedor y el stock mínimo se quedan como están.

> Antes se enviaban todas las columnas con `null`, así que una carga de dos
> columnas borraba el resto de la ficha y ponía `tipo_insumo = OTROS`. Es el
> cambio de comportamiento más importante de este módulo.

Los valores por defecto (`tipo_insumo: OTROS`, `cat_rotacion: C`,
`es_principal: false`, `activo: true`, …) se aplican **solo al crear**.

## Cómo se evitan los duplicados

- Cada entidad tiene sus `matchKeys` en orden de prioridad (productos: `ref`,
  luego `codigo`, luego `nombre_estandar`).
- La comparación es **sin distinguir mayúsculas**, tanto en la vista previa como
  en la consulta al servidor (`ilike` para texto, `=` para números). Antes el
  preview decía "actualizar" y el servidor creaba un registro nuevo.
- Los repetidos dentro del mismo archivo se detectan en la vista previa y se
  vuelven a bloquear en el servidor.

## Límites

- 2000 filas por carga.
- Las filas se procesan una por una: **no hay transacción**. Si una falla, las
  anteriores quedan guardadas (por eso el informe indica exactamente cuáles).
- `stock_inicial` solo aplica a productos nuevos.
- Al importar **personas**, cada persona nueva recibe cuenta de acceso
  (usuario = email o `documento@conserje.local`, contraseña = documento). Eso
  requiere `SUPABASE_SERVICE_ROLE_KEY`; sin ella la persona se crea sin acceso.

## Pruebas

Todo lo anterior está cubierto en `tests/inventario/`:
`import-parseo.test.ts` (lectura de valores, encabezados, CSV, lotes),
`import-config.test.ts` (validación de filas y coherencia de las plantillas),
`import-plantilla.test.ts` (generar la plantilla y volver a leerla) y
`import-actions.test.ts` (lo que se escribe en la base). Ver
[pruebas.md](pruebas.md).
