# F1 — El contrato como eje · nota de cambios

Primera fase del módulo de Puntos QR (corte de fases: §6 del
[complemento 2](docs/puntos-qr-whatsapp/02-complemento-2-integracion.md)).
No hay nada de puntos, QR ni plantillas: solo el eje sobre el que las fases
siguientes cuelgan su `grupo_id`.

## Lo que quedó

**Nomenclatura cerrada** —
[03-nomenclatura.md](docs/puntos-qr-whatsapp/03-nomenclatura.md), fuente de
verdad única: prefijos `ronda_` / `mant_` / `crm_` / `grupo_`, claves de permiso
planas en `snake_case` (la propuesta `puntos_qr.crear` del ADR-01 queda
descartada: no existiría en `/roles` y `auth_permiso()` no la reconocería), ruta
pública **`/q/<token>`** y consecutivos desde `SEQUENCE`. Reserva además la
banda `20261019000010`–`...19` de numeración de migraciones para las fases del
módulo, porque el día ya estaba ocupado hasta `...000004` en ramas paralelas.

**Migración** —
[20261019000010_puntos_qr_f1_contrato.sql](supabase/migrations/20261019000010_puntos_qr_f1_contrato.sql):

- `grupos_contrato` gana `cliente_id`, `numero`, `objeto`, `vigencia_desde`,
  `vigencia_hasta`, `estado`, `arte_logo_path`, `arte_color`,
  `idioma_reportes` y `created_at`. Los 7 contratos que ya existen **no** caen
  en `BORRADOR`: se deducen de `activo`, para que `grupo_vigente()` no apague de
  golpe lo que está operando.
- `grupo_vigencias` (un periodo por fila: renovar agrega, no pisa) y los cuatro
  satélites con `grupo_id` en la PK: `grupo_servicios`, `grupo_sla`,
  `grupo_reglas`, `grupo_entregables`.
- `usuario_grupos` (`usuario_id`, `grupo_id`, `papel`, `desde`, `hasta`,
  `activo`), al estilo de `grupo_etiquetas`. **`usuarios.grupo_id` se conserva**
  como contrato principal: hay código y políticas RLS leyéndolo.
- `auth_grupos()` `STABLE SECURITY DEFINER` — el alcance del módulo: los
  contratos de `usuario_grupos` vigentes hoy + `usuarios.grupo_id`, y todos si
  el rol es `ADMIN`/`SUPER_ADMIN`. Más `auth_ve_grupo()` y
  `auth_papel_grupo()` para las políticas de `CLIENTE` y `PROVEEDOR` de las
  fases siguientes.
- `grupo_vigente()` y `grupo_vigencia_fin()` — la vigencia **calculada** de
  §2.5. De aquí se cuelga `ronda_qr_vigente()` en F2. Sin un solo `UPDATE`
  masivo de estados: al renovar, los QR vuelven a servir sin tocar ninguna fila.
- RLS en las seis tablas nuevas, **también en las lecturas**, con
  `auth_permiso*()` y el alcance por `auth_grupos()`. Las dos políticas
  existentes de `grupos_contrato` se reescriben de forma **aditiva**, solo para
  que las dos claves de conserjería también sirvan.

**Permisos** — no hizo falta inventar ninguna clave: `ver_contratos_conserjeria`
y `gestionar_contratos_conserjeria` ya estaban en el catálogo, sin usar. Se les
aclaró la etiqueta y se documentó en `lib/permisos.ts` la diferencia con
`ver_contratos` / `editar_contratos`, que son de `/contratos` (clasificación de
sedes para inventario) y se confunden con facilidad.

**Pantalla** — `/rondas/contratos`, aparte de `/contratos` como pide §4.1:
listado con estado, vigencia efectiva, aviso de vencimiento a 60 días y
servicios; detalle para editar los datos y la vigencia, los servicios
contratados, las reglas y los periodos/prórrogas. Más el ítem de menú en
Operación Conserjería y la lógica pura en
[lib/contratos-conserjeria.ts](apps/inventario/lib/contratos-conserjeria.ts),
que es el espejo en TypeScript de `grupo_vigente()` (si cambia una, cambian las
dos).

## La migración ya está aplicada

Se verificó primero en seco y se aplicó después, a pedido del usuario.

**Verificación en transacción**, con
[scripts/probar-puntos-qr-f1.mjs](scripts/probar-puntos-qr-f1.mjs), que corre
**dentro de `BEGIN … ROLLBACK`**: pasa el archivo completo dos veces seguidas en
la misma transacción (idempotencia de verdad, no de lectura) y prueba el alcance
con `set_config('request.jwt.claims', …)`. **28 pruebas, 0 fallas**, antes y
después de aplicar: un usuario de un contrato no lee los satélites de otro, un
`ADMIN` sí los ve y sí escribe, quien solo tiene `ver_*` no escribe, la prórroga
extiende la vigencia y `SUSPENDIDO` no está vigente aunque las fechas alcancen.

**Aplicación** con el script del repo:

```bash
NODE_OPTIONS=--use-system-ca node scripts/apply-migrations.mjs supabase/migrations/20261019000010_puntos_qr_f1_contrato.sql
```

Estado de la base después de aplicar: las 6 tablas nuevas, las 7 funciones
(`auth_grupos`, `auth_ve_grupo`, `auth_papel_grupo`, `grupo_vigente`,
`grupo_vigencia_fin`, `grupo_acceso`, `grupo_gestiona`) y 12 políticas. Los **7
contratos quedaron en `VIGENTE` y los 7 están vigentes hoy**: no se apagó nada.
Los satélites nacen vacíos a propósito —no se inventó ni una fila de servicios,
reglas o papeles—, así que hasta que alguien los llene la pantalla muestra los
contratos sin fechas, sin cliente y sin servicios, con las reglas en sus valores
por defecto. Es el estado esperado, pero conviene saberlo antes de mostrarla.

Para repetir las pruebas cuando haga falta (no deja nada escrito):

```bash
node --use-system-ca scripts/probar-puntos-qr-f1.mjs
```

## Verificación

- `npx tsc --noEmit -p .` en `apps/inventario`: limpio.
- `auditar-permisos.mjs`, `verificar-permisos.mjs`, `verificar-lecturas.mjs`:
  sin incoherencias nuevas (las 14 que reporta el auditor son las de antes, de
  programación de personal y servicios del hogar; `verificar-permisos` dice
  "sin discrepancias").
- [scripts/probar-vigencia-paridad.mjs](scripts/probar-vigencia-paridad.mjs):
  **11 de 11** casos coinciden entre `grupo_vigente()` en la base y
  `estaVigente()` en TypeScript (prórroga que extiende, prórroga sin fin, otrosí
  sobre un contrato sin fechas, periodo anterior al inicio, y los estados que no
  operan). La lógica está duplicada a propósito y este script es lo que vigila
  que no se separen.
- Revisión visual con la skill `banco-pruebas`: el componente real del detalle
  montado con datos reales, en 5 escenarios × 2 anchos (1280 y 375 px), sin
  desbordes ni scroll horizontal, con el contraste medido. Destapó y se
  arreglaron dos defectos:
  1. `textoVigencia()` ignoraba el `desde` de los periodos, así que un contrato
     sin fechas propias pero con un otrosí decía «Sin fechas» y justo debajo
     listaba el periodo. Ahora usa `vigenciaInicio()`, que es el mismo
     `LEAST(g.vigencia_desde, MIN(v.desde))` de `grupo_vigente()` — era una
     incoherencia real con el SQL, no un detalle de texto.
  2. El objeto del contrato se recortaba sin aviso en un `textarea` deshabilitado
     en móvil; en solo lectura ahora se pinta el texto entero.
  Y se agregaron dos cosas a partir de eso: `motivoNoVigente()`, para que el
  aviso ámbar diga **cuál** condición falló (el estado, las fechas o que el
  contrato esté inactivo), porque las dos insignias pueden contradecirse a la
  vista —un contrato «Vencido» con una prórroga muestra días por delante— y sin
  el motivo nadie entiende por qué sus QR no abren; e `insigniaEstado()`, porque
  `/contratos` da de baja un contrato poniéndole `activo = false` y ese
  contrato lucía un «Vigente» en verde.
  El aviso con el motivo se reverificó en el banco: 7 escenarios × 1280 y 375
  px, con el motivo correcto en cada rama y sin desbordes. La insignia de
  inactivo **no** pasó por el banco: es una etiqueta en los dos únicos sitios
  que la pintan, y hoy no hay ningún contrato inactivo con el que se vea.

## Pendientes que esta fase deja anotados

1. **`grupo_id` en `persona_vinculaciones`** — NO se agregó. Sigue pendiente de
   aprobación (§2.3 y §10.1 nº 2): toca una tabla de nómina con 6.564 personas
   cargadas y la asignación de cada una a su contrato no está resuelta. Mientras
   no esté, el contrato de una visita se deriva **del punto**, que sí lo tiene.
2. **El dominio de `grupo_reglas.nivel_antifraude`** — la columna es `TEXT` sin
   `CHECK`, con el motivo escrito en el comentario de la columna: lo cierra el
   complemento 1 (C1§3.3), que no ha llegado. La pantalla lo pinta como texto
   libre y avisa de que pasará a ser lista cerrada.
3. **`/p/` por `/q/`** en los documentos 00 y 02 — son de otras sesiones y no se
   tocaron. Quien abra F2 corrige el texto de paso.
4. **`grupo_sla` y `grupo_entregables` no tienen pantalla todavía**: las tablas y
   su RLS están, pero el ANS se calcula en F7/F12 y el catálogo de informes se
   define en F12. Editarlos ahora sería inventar su dominio.
5. **Papeles `CLIENTE` y `PROVEEDOR`** — existen en `usuario_grupos` y
   `auth_papel_grupo()` ya los expone, pero habilitarlos en la consola sigue
   pendiente de decisión (§10.1 nº 8), igual que el alcance por contrato de
   `mantenimiento_tickets`, que hoy no tiene ninguno.
