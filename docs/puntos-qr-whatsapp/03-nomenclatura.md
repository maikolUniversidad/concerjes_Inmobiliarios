# Nomenclatura del módulo Puntos QR — fuente de verdad

Los cuatro documentos de planeación quedaron con convenciones distintas para lo
mismo (el cuadro está en la §8.0 de
[02-complemento-2-integracion.md](docs/puntos-qr-whatsapp/02-complemento-2-integracion.md)).
Este archivo las unifica y **manda sobre los cuatro** en todo lo que nombre.
Se escribe antes de la primera migración a propósito: cambiar un nombre después
cuesta una migración de renombres, y en el caso del QR cuesta reimprimir placas.

Decisiones tomadas por el usuario. No se reabren en las fases siguientes.

---

## 1. Prefijos de tabla

| Prefijo | Para qué | Ejemplos |
|---|---|---|
| `ronda_` | el núcleo operativo: zonas, puntos, QR, catálogo, asignaciones, visitas, evidencia, reportes, rutas | `ronda_puntos`, `ronda_qr`, `ronda_visitas` |
| `mant_` | mantenimiento nuevo: planes preventivos, tareas de plan, materiales, costos | `mant_planes`, `mant_plan_tareas` |
| `crm_` | conversaciones y envíos (WhatsApp y cualquier otro canal de mensajería) | `crm_conversaciones`, `crm_envios` |
| `grupo_` | satélites del contrato (`grupos_contrato`), siguiendo a `grupo_etiquetas`, que ya existe | `grupo_servicios`, `grupo_reglas` |
| `persona_` | lo que extiende a la persona, siguiendo a `persona_vinculaciones` | `persona_ubicacion_actual` |
| `activo_` | lo que cuelga del activo fijo del cliente | `activo_medidores`, `activo_lecturas` |

Quedan **descartados**: `puntos_*` (ocupado por el módulo de recompensas:
`parametros_puntos`, `movimientos_puntos`), `control_*` (se lee como control de
acceso), y los prefijos sueltos de los ADR —
`visitas_*` del ADR-01 y `qr_parametros` / `puntaje_detalle` del ADR-02 pasan a
`ronda_*`.

Lo que ya existe **no se renombra**: `mantenimiento_tickets`,
`mantenimiento_mensajes`, `maquinaria_eventos`, `pqrs*` y `grupos_contrato` se
extienden con su nombre actual.

Convenciones de columna que ya rigen en el repo y este módulo respeta:
`UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `VARCHAR(n)` con
`CHECK (… IN ('MAYUSCULAS'))` en vez de enums nuevos, `created_at` /
`updated_at TIMESTAMPTZ` con el trigger `set_updated_at()`, **`lat` / `lng`**
(nunca `lon`) en `DECIMAL(10,7)` con `precision_metros DECIMAL(8,2)`, y
`grupo_id` —no `contrato_id`— para la referencia a `grupos_contrato`.

## 2. Claves de permiso: planas, `snake_case`, sin punto

La forma es `ver_<cosa>` / `gestionar_<cosa>`, exactamente como las 12 grupos de
[lib/permisos.ts](apps/inventario/lib/permisos.ts), donde no hay **ni una** clave
con punto.

**La propuesta del ADR-01 de usar claves con punto (`puntos_qr.crear`) queda
descartada.** No es una cuestión de estilo: `auth_permiso()` compara la clave
contra las llaves del JSONB `roles.permisos` / `usuarios.permisos`, que se
llenan desde el catálogo de `permisos.ts`. Una clave que no esté en el catálogo
no aparece en `/roles`, nadie la puede marcar, y la política RLS que la exija
rechaza a todo el mundo menos a `ADMIN` y `SUPER_ADMIN`.

Las claves van al grupo **Operación Conserjería**, donde ya está PQRS. Las dos
del contrato **ya existen sin usar** y no hay que inventarlas:
`ver_contratos_conserjeria` y `gestionar_contratos_conserjeria`.

Ojo con las dos parejas que se parecen y son de módulos distintos:

| Clave | Pantalla | Qué es |
|---|---|---|
| `ver_contratos` / `editar_contratos` | `/contratos` | clasificación de contratos y sedes **para inventario** (etiquetas, tipo Directo/Privado) |
| `ver_contratos_conserjeria` / `gestionar_contratos_conserjeria` | `/rondas/contratos` | el contrato como eje de la operación: vigencia, servicios, ANS, reglas, entregables |

## 3. Ruta pública del QR: `/q/<token>`

**La buena es `/q/<token>`.** Lo decide el prompt maestro del usuario, y el
ADR-01 ya la escribe así (`https://<app>/q/{codigo}`).

Los documentos 00 y 02 escriben `/p/<token>` en varios lugares (00 §1.5 punto 3
y el ADR-B; 02 §4.2, §4.6 y la fase F2 del cuadro de §6). **Esas menciones
quedan por corregir**: son de otras sesiones y no se tocan desde aquí, pero
donde digan `/p/` hay que leer `/q/`. Quien abra F2 corrige el texto de paso.

Es la decisión más irreversible del módulo: el token va impreso en una placa
pegada a una pared.

Rutas de la consola, para que no se mezclen con la pública:

- `/q/<token>` — pública, sin sesión. Resuelve el QR (punto o activo) y decide
  qué mostrar según la sesión y las reglas del contrato.
- `/rondas/...` — la consola del módulo, con sesión y permiso. El contrato vive
  en `/rondas/contratos`, aparte de `/contratos`, que es de inventario.

## 4. Consecutivos: siempre desde `SEQUENCE`

Un número legible sale de una `SEQUENCE` propia, nunca de un contador por fecha
ni de `COUNT(*)+1`. Es lo que ya hacen `pqrs_numero_seq` (`PQ-00001`),
`mantenimiento_ticket_seq` y `contrato_consecutivo_seq`, cuya migración dejó
escrito "NUNCA `COUNT(*)+1`" — un contador del día colisiona en cuanto dos
dispositivos cierran una visita en el mismo segundo, que es justo lo que pasa en
un cambio de turno.

Queda descartado el `RV-2026-10-19-0147` del ADR-01. El formato es
**`<PREFIJO>-<6 dígitos>`** con relleno de ceros:

| Serie | Formato | Secuencia |
|---|---|---|
| Reporte de visita | `RV-000001` | `ronda_reporte_seq` |
| Lote de QR | `LQ-000001` | `ronda_lote_seq` |
| Orden de trabajo | la que ya tiene `mantenimiento_tickets` | `mantenimiento_ticket_seq` |

Si alguna serie necesita el año por exigencia del cliente, va como columna
aparte (`anio`), no dentro del consecutivo.

## 5. Numeración de los archivos de migración

La convención del repo es `YYYYMMDD` + contador de 6 dígitos + slug. El módulo
corre en varias ramas a la vez y el día 20261019 ya está ocupado hasta
`...000004` por compras, bodegas, no conformes y proveedores en ramas
paralelas; ya hubo que renumerar una vez por una colisión así (commit
`f0f7437`).

**Se reserva la banda `20261019000010`–`20261019000019` para las fases del
módulo**, por fuera del tramo que usan las otras ramas:

| Fase | Archivo |
|---|---|
| F1 — contrato | `20261019000010_puntos_qr_f1_contrato.sql` |
| F2 y siguientes | `...000011`, `...000012`, … en orden de fase |

Antes de crear el archivo, reservar el número y comprobar que no esté usado en
**ninguna** rama:

```bash
git branch -a --format='%(refname)' | while read b; do git ls-tree --name-only "$b" supabase/migrations/; done | sort -u | grep 20261019
```

## 6. Vocabulario de interfaz

En la base de datos la columna es `grupo_id` y la tabla `grupos_contrato`; en la
pantalla se dice **"contrato"**, como ya se dice hoy en `/contratos`. Nunca se
escribe `contrato_id` apuntando a `grupos_contrato`: se leería como una
referencia a `contratos`, que es el **contrato laboral** del ATS.

Los papeles de `usuario_grupos` se escriben en mayúsculas y sin tilde en la base
(`SUPERVISOR`, `COORDINADOR`, `TECNICO`, `CLIENTE`, `PROVEEDOR`) y con tilde en
la interfaz ("Técnico").

Textos de interfaz en español de Colombia; fechas y horas en `America/Bogota`.
