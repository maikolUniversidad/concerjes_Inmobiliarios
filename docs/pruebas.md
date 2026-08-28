# Pruebas automatizadas y verificación previa al despliegue

El objetivo de esta suite es simple: **antes de publicar, comprobar en segundos
que nada de lo que ya funcionaba se dañó.**

## Los dos comandos que importan

```bash
npm test          # todas las pruebas (~2 segundos)
npm run verificar # pruebas + tipos + los tres builds reales
```

`npm run deploy` ya llama a `npm run verificar` por dentro: si algo falla, **no
despliega**. Si alguna vez necesitas publicar saltándote el control (bajo tu
responsabilidad), usa `npm run deploy:sin-verificar`.

Otros comandos:

| Comando | Para qué |
| --- | --- |
| `npm run test:watch` | Deja las pruebas corriendo mientras programas. |
| `npm run verificar:rapido` | Pruebas + tipos, sin los builds (para el preview). |
| `npx vitest run --project inventario` | Solo un grupo (`offline`, `inventario`, `proyecto`). |
| `npx vitest run tests/inventario/utils.test.ts` | Un solo archivo. |

## Qué se está verificando

Las pruebas viven todas en `tests/`, fuera de las apps, para que `next build` no
intente compilarlas. Están repartidas en tres grupos (`vitest.config.ts`):

### `tests/offline` — motor de sincronización (`packages/offline`)

El corazón de la app móvil/escritorio. Se prueba contra un doble del cliente de
Supabase, sin red:

- El *pull* incremental baja solo lo modificado y avanza el watermark; la segunda
  sincronización no vuelve a bajar lo mismo.
- Pagina bien por encima de las 1000 filas.
- El modo `append` (ledger de movimientos) usa `created_at`; el modo `full` no
  guarda watermark.
- El *push* del outbox sube los pendientes, y **si el servidor falla los deja en
  la cola para reintentar** en vez de perderlos.
- Un intent sin manejador no bloquea a los demás.

### `tests/inventario` — lógica de negocio de la app de inventario

- **Permisos**: el catálogo no tiene claves repetidas, los contadores cuadran y
  siguen existiendo los permisos que las pantallas consultan por nombre.
- **Semanas ISO**: `2026-W32` se traduce al rango lunes→lunes en hora de
  Colombia; semanas consecutivas quedan pegadas, sin huecos ni solapes.
- **Fechas y moneda**: una hora UTC de madrugada sigue siendo el día anterior en
  Bogotá (la regresión que mostraba los movimientos de las 9 p. m. al día
  siguiente), y el peso se formatea sin decimales.
- **Cargas masivas** (cuatro archivos, ver [cargas-masivas.md](cargas-masivas.md)):
  - *lectura de valores*: `$ 18.900` entra como 18900 y no como 18,9; `no aplica`
    es error y no un cero; fechas en cualquiera de los formatos que usa la gente;
    SI/NO; encabezados con tildes y alias; CSV separado por punto y coma.
  - *validación del lote*: filas repetidas dentro del archivo, fila de ejemplo de
    la plantilla, columnas obligatorias que faltan y columnas que sobran.
  - *plantilla*: se genera y se vuelve a leer completa (ida y vuelta), lo que
    también comprueba las listas desplegables de Excel.
  - *escritura*: **actualizar solo toca las columnas del archivo** (antes borraba
    el resto de la ficha), los valores por defecto se aplican solo al crear, y el
    servidor descarta campos ajenos y claves repetidas.

### El sitio público ya no se prueba desde aquí

Las pruebas del sitio (cobros del portal, consentimientos, documentos del
registro y fotos) se fueron con él a
[`maikolUniversidad/Concerjes_Web`](https://github.com/maikolUniversidad/Concerjes_Web),
donde se corren con `npm test` desde la raíz de ese repo.

### `tests/proyecto` — que el repositorio siga sano

Son las que responden a "¿se dañó algo?" sin tener que abrir el navegador:

- Cada `route.ts` exporta algún método HTTP; cada `page.tsx` y `layout.tsx` tiene
  `export default`; cada `actions.ts` empieza con `'use server'`.
- **Ningún componente de cliente** toca `SUPABASE_SERVICE_ROLE_KEY`, importa el
  cliente admin ni `server-only`.
- No quedan conflictos de merge sin resolver ni pruebas con `.only`.
- Toda variable de entorno que usa el código está documentada en `.env.example` y
  declarada en `turbo.json` (si no, Turborepo puede reutilizar una caché vieja).
- No hay secretos incrustados en el código.
- Las migraciones siguen la convención de nombre, no están vacías, no se repiten,
  el orden alfabético coincide con el cronológico y no hay `DROP TABLE` sin
  `IF EXISTS` ni `DROP SCHEMA`.
- Web e inventario no tienen versiones distintas de la misma dependencia.
- **Toda imagen referenciada en el código existe** en la carpeta `public` de su
  app (una ruta mal escrita solo se nota como un hueco en la página).

## Nota sobre ESLint

Next 16 eliminó el comando `next lint`, así que el script `lint` de `inventario`
llevaba tiempo fallando (y con él, el paso "Lint" del CI). En su
lugar la verificación corre `npm run typecheck` (`tsc --noEmit` en los cuatro
paquetes), que sí funciona y atrapa más.

Si se quiere recuperar ESLint hay que crear un `eslint.config.mjs` por app y
limpiar lo que reporte. Es un trabajo aparte, no un
requisito para desplegar.

## Qué NO cubre (todavía)

- No hay pruebas de interfaz (clics en pantalla). Para eso haría falta añadir
  Playwright.
- No se conecta a la base de datos real: las políticas RLS y los triggers no se
  ejercitan aquí. Lo que se prueba es la lógica que corre en la aplicación.
- Los componentes React no se renderizan; se prueba la lógica que hay detrás.

## Cómo agregar una prueba

1. Crea el archivo en el grupo que corresponda: `tests/<grupo>/<tema>.test.ts`.
2. En `inventario` y `web` puedes importar con el mismo alias que usa la app
   (`@/lib/...`); cada grupo tiene el suyo apuntando a la app correcta.
3. Escribe el nombre de la prueba como una frase que explique **qué debe pasar**,
   no cómo está hecho el código.
4. Corre `npm test`.

Regla práctica: cuando arregles un error, escribe primero la prueba que lo
reproduce. Así ese error no vuelve.
