-- =============================================================================
-- PUNTOS QR — F1: EL CONTRATO COMO EJE
-- =============================================================================
-- Primera migración del módulo de Puntos QR, Tareas y Bot de WhatsApp. No crea
-- nada de puntos, QR ni plantillas: crea el EJE sobre el que todas esas tablas
-- van a colgar su `grupo_id`. Plan: docs/puntos-qr-whatsapp/02-complemento-2-
-- integracion.md (§2, §4.1 y §6) y docs/puntos-qr-whatsapp/03-nomenclatura.md.
--
-- Por qué el contrato y no la sede: el alcance de la operación lo da el
-- contrato del cliente, y en este repositorio **un contrato es una fila de
-- `grupos_contrato`** — es lo que muestra /contratos y lo que ya referencian
-- `sedes.grupo_id`, `usuarios.grupo_id` y `pqrs.grupo_id`. Así que se EXTIENDE
-- `grupos_contrato`; no se crea ninguna tabla `contrato` (ese nombre ya es el
-- contrato laboral del ATS) y no se agrega `tenant_id`.
--
-- Qué entra:
--   1. Columnas de vigencia, estado, cliente y arte en `grupos_contrato`.
--   2. `grupo_vigencias` — un periodo por fila, para que renovar o prorrogar
--      AGREGUE una fila en vez de pisar el histórico (§1.2 del complemento).
--   3. Satélites `grupo_servicios`, `grupo_sla`, `grupo_reglas`,
--      `grupo_entregables`, todos con `grupo_id` en la llave primaria.
--   4. `usuario_grupos` — un usuario en varios contratos, con papel y vigencia.
--      `usuarios.grupo_id` SE CONSERVA como contrato principal: hay código y
--      políticas RLS leyéndolo, y romperlo dejaría a medio mundo sin alcance.
--   5. `auth_grupos()` — la función de alcance del módulo, al estilo de
--      `auth_permiso()`. Todas las políticas de F2 en adelante filtran con ella.
--   6. `grupo_vigente()` — vigencia EFECTIVA, calculada. De aquí se colgará
--      `ronda_qr_vigente()` en F2: "contrato vencido apaga sus QR" se resuelve
--      preguntando, NO con un UPDATE masivo de estados (§2.5). Al renovar, los
--      QR vuelven a servir sin tocar ni una fila.
--
-- Permisos: las dos claves YA existían sin usar en lib/permisos.ts, grupo
-- "Operación Conserjería" — no se inventa ninguna:
--   ver_contratos_conserjeria        entra a /rondas/contratos y lee.
--   gestionar_contratos_conserjeria  edita vigencia, servicios, ANS y reglas.
-- Se agregan además a las políticas YA EXISTENTES de `grupos_contrato`
-- (lectura y escritura), de forma ADITIVA: quien ya podía, sigue pudiendo.
--
-- RLS: todo lo nuevo la lleva, y también en las LECTURAS, con `auth_permiso*()`
-- como exige este repositorio. El alcance de las lecturas es
-- `auth_grupos()`: un usuario de un contrato no ve los satélites de otro.
--
-- PENDIENTE ANOTADO, FUERA DE ESTA MIGRACIÓN A PROPÓSITO:
--   · `grupo_id` en `persona_vinculaciones` (§2.3 y §10.1 nº 2). Está pendiente
--     de aprobación: toca una tabla de nómina con 6.564 personas cargadas y la
--     asignación de cada una a su contrato no está resuelta. Mientras no esté,
--     el contrato de una visita se deriva DEL PUNTO, que sí lo tiene.
--   · El dominio de `grupo_reglas.nivel_antifraude` (ver el comentario de esa
--     columna): lo cierra el complemento 1, que todavía no ha llegado.
--
-- IDEMPOTENTE de punta a punta: se puede volver a aplicar sin daño.
-- =============================================================================

SET search_path TO public;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. `grupos_contrato` como registro del contrato de cliente
-- ──────────────────────────────────────────────────────────────────────────────
-- La tabla ya estaba preparada para esto: 20260806000000 liberó `codigo` del
-- enum de 5 valores justamente "para permitir dar de alta cualquier contrato
-- desde la aplicación". Lo que falta es la vigencia y el estado.
--
-- `numero` es el número del contrato del CLIENTE (el del documento firmado) y
-- es distinto de `codigo`, que es la sigla interna con la que la operación
-- nombra el contrato (CA, MO, MB…) y que ya se usa en toda la app.

ALTER TABLE grupos_contrato
  ADD COLUMN IF NOT EXISTS cliente_id       UUID REFERENCES empresas_usuarias(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS numero           VARCHAR(60),
  ADD COLUMN IF NOT EXISTS objeto           TEXT,
  ADD COLUMN IF NOT EXISTS vigencia_desde   DATE,
  ADD COLUMN IF NOT EXISTS vigencia_hasta   DATE,
  ADD COLUMN IF NOT EXISTS estado           VARCHAR(12),
  ADD COLUMN IF NOT EXISTS arte_logo_path   TEXT,
  ADD COLUMN IF NOT EXISTS arte_color       VARCHAR(20),
  ADD COLUMN IF NOT EXISTS idioma_reportes  VARCHAR(5) NOT NULL DEFAULT 'es-CO',
  ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ;

-- `estado` nace SIN default a propósito: así las filas que ya existen quedan en
-- NULL y el UPDATE de abajo las deduce de `activo`, en vez de que todas caigan
-- en BORRADOR y `grupo_vigente()` apague de golpe los contratos que están
-- operando (tienen sedes, usuarios y PQRS colgando). El default BORRADOR se
-- pone DESPUÉS, para los contratos nuevos que se creen desde la pantalla.
-- Repetir la migración no revierte nada: ya no hay filas en NULL.
UPDATE grupos_contrato
   SET estado = CASE WHEN COALESCE(activo, true) THEN 'VIGENTE' ELSE 'TERMINADO' END
 WHERE estado IS NULL;

ALTER TABLE grupos_contrato
  ALTER COLUMN estado SET DEFAULT 'BORRADOR',
  ALTER COLUMN estado SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW();

-- Los CHECK van aparte para que el ALTER de arriba sea repetible.
DO $$ BEGIN
  ALTER TABLE grupos_contrato
    ADD CONSTRAINT grupos_contrato_estado_chk
    CHECK (estado IN ('BORRADOR','VIGENTE','SUSPENDIDO','VENCIDO','TERMINADO'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE grupos_contrato
    ADD CONSTRAINT grupos_contrato_vigencia_chk
    CHECK (vigencia_hasta IS NULL OR vigencia_desde IS NULL OR vigencia_hasta >= vigencia_desde);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- `numero` es único cuando está informado (dos contratos no comparten número).
CREATE UNIQUE INDEX IF NOT EXISTS idx_grupos_contrato_numero
  ON grupos_contrato(numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grupos_contrato_cliente ON grupos_contrato(cliente_id);
CREATE INDEX IF NOT EXISTS idx_grupos_contrato_estado  ON grupos_contrato(estado);

COMMENT ON COLUMN grupos_contrato.estado IS
  'BORRADOR (se está armando) · VIGENTE · SUSPENDIDO (parado, se puede reanudar) · VENCIDO · TERMINADO. La vigencia que mandan los QR y las visitas la calcula grupo_vigente(), no esta columna sola.';
COMMENT ON COLUMN grupos_contrato.numero IS
  'Número del contrato del cliente (el del documento firmado). `codigo` sigue siendo la sigla interna.';
COMMENT ON COLUMN grupos_contrato.idioma_reportes IS
  'Idioma de los informes y reportes del contrato. Por defecto es-CO.';

-- ── 1.1 Prórrogas y renovaciones ─────────────────────────────────────────────
-- Un periodo por fila. Renovar agrega una fila; no se pisa el histórico ni se
-- pierden las condiciones con las que se operó antes (§1.2 del complemento).
CREATE TABLE IF NOT EXISTS grupo_vigencias (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id      UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  desde         DATE NOT NULL,
  hasta         DATE,                                   -- NULL = sin fecha de fin pactada
  tipo          VARCHAR(12) NOT NULL DEFAULT 'PRORROGA'
                CHECK (tipo IN ('INICIAL','PRORROGA','RENOVACION','OTROSI')),
  motivo        TEXT,
  condiciones   JSONB NOT NULL DEFAULT '{}'::jsonb,     -- foto de las condiciones del periodo
  documento_path TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (hasta IS NULL OR hasta >= desde)
);
CREATE INDEX IF NOT EXISTS idx_grupo_vigencias_grupo ON grupo_vigencias(grupo_id, desde DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_grupo_vigencias_periodo
  ON grupo_vigencias(grupo_id, desde, tipo);

COMMENT ON TABLE grupo_vigencias IS
  'Periodos de vigencia del contrato: el inicial y cada prórroga, renovación u otrosí. Renovar AGREGA una fila; nunca se pisa el histórico (§1.2 del complemento 2).';

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Satélites del contrato
-- ──────────────────────────────────────────────────────────────────────────────
-- Todos llevan `grupo_id` en la PK, al estilo de `grupo_etiquetas` y
-- `sede_etiquetas`, que ya existen desde 20260803000000.

-- ── 2.1 Servicios contratados ────────────────────────────────────────────────
-- Activables por separado: un contrato puede tener aseo y conserjería pero no
-- mantenimiento. Agregar un servicio al catálogo es un ALTER del CHECK.
CREATE TABLE IF NOT EXISTS grupo_servicios (
  grupo_id    UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  servicio    VARCHAR(20) NOT NULL
              CHECK (servicio IN ('ASEO','CONSERJERIA','MANTENIMIENTO','SEGURIDAD')),
  activo      BOOLEAN NOT NULL DEFAULT true,
  desde       DATE,
  hasta       DATE,
  observacion TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (grupo_id, servicio),
  CHECK (hasta IS NULL OR desde IS NULL OR hasta >= desde)
);

COMMENT ON TABLE grupo_servicios IS
  'Qué servicios del contrato están activos. El módulo pregunta por aquí antes de ofrecer un flujo (p. ej. no hay órdenes de mantenimiento si MANTENIMIENTO no está contratado).';

-- ── 2.2 Acuerdos de nivel de servicio ────────────────────────────────────────
-- Por servicio y prioridad. Los plazos de PQRS SIGUEN en `pqrs_plazos` (en días
-- hábiles, con su calendario); esta tabla los puede sobreescribir por contrato
-- cuando el cliente pactó algo distinto, y es la única fuente para el resto de
-- la operación (visitas y órdenes de trabajo).
CREATE TABLE IF NOT EXISTS grupo_sla (
  grupo_id            UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  servicio            VARCHAR(20) NOT NULL
                      CHECK (servicio IN ('ASEO','CONSERJERIA','MANTENIMIENTO','SEGURIDAD')),
  prioridad           VARCHAR(10) NOT NULL DEFAULT 'MEDIA'
                      CHECK (prioridad IN ('BAJA','MEDIA','ALTA','CRITICA')),
  frecuencia_min_dias INT          CHECK (frecuencia_min_dias IS NULL OR frecuencia_min_dias BETWEEN 1 AND 365),
  respuesta_horas     NUMERIC(6,2) CHECK (respuesta_horas  IS NULL OR respuesta_horas  > 0),
  solucion_horas      NUMERIC(6,2) CHECK (solucion_horas   IS NULL OR solucion_horas   > 0),
  cumplimiento_min    NUMERIC(5,2) CHECK (cumplimiento_min IS NULL OR cumplimiento_min BETWEEN 0 AND 100),
  penalidad           TEXT,                                  -- cómo se penaliza; el cálculo es de F12
  horas_habiles       BOOLEAN NOT NULL DEFAULT true,         -- ¿los plazos corren solo en jornada hábil?
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (grupo_id, servicio, prioridad),
  CHECK (solucion_horas IS NULL OR respuesta_horas IS NULL OR solucion_horas >= respuesta_horas)
);

COMMENT ON TABLE grupo_sla IS
  'ANS por servicio y prioridad. `penalidad` se guarda como texto en F1: calcularla es trabajo de los informes (F12), y escribir una fórmula aquí ahora sería adivinar.';

-- ── 2.3 Reglas del contrato ──────────────────────────────────────────────────
-- Una fila por contrato. Mismo criterio que `programacion_reglas`: los valores
-- van en tabla, no quemados en el código. Aquí vive la retención de evidencia
-- de 12 meses (decisión §1.3), como PARÁMETRO.
CREATE TABLE IF NOT EXISTS grupo_reglas (
  grupo_id                  UUID PRIMARY KEY REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  nivel_antifraude          TEXT,
  permite_whatsapp          BOOLEAN NOT NULL DEFAULT false,
  pqrs_publico              BOOLEAN NOT NULL DEFAULT false,
  comparte_seguimiento_vivo BOOLEAN NOT NULL DEFAULT false,
  mensajeria_desde          TIME,
  mensajeria_hasta          TIME,
  retencion_evidencia_meses INT NOT NULL DEFAULT 12
                            CHECK (retencion_evidencia_meses BETWEEN 1 AND 120),
  geocerca_radio_m          INT NOT NULL DEFAULT 50
                            CHECK (geocerca_radio_m BETWEEN 5 AND 5000),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE grupo_reglas IS
  'Reglas operativas del contrato. Una fila por contrato; si no existe, el módulo usa los valores por defecto de estas columnas.';
-- OJO: `nivel_antifraude` queda TEXT y SIN CHECK a propósito.
COMMENT ON COLUMN grupo_reglas.nivel_antifraude IS
  'Nivel de rigor antifraude del contrato (C1§3.3). SIN dominio definido: el complemento 1 todavía no ha llegado y no se sabe cuántos niveles hay, cómo se llaman ni qué exige cada uno. El CHECK se agrega cuando llegue C1 — no inventar valores antes.';
COMMENT ON COLUMN grupo_reglas.retencion_evidencia_meses IS
  'Meses que se conserva la evidencia (fotos, audio, ubicación). Por defecto 12, como decidió el usuario, y ajustable por contrato. Aplica a ronda_evidencias, persona_ubicacion_historial y los medios entrantes de WhatsApp.';
COMMENT ON COLUMN grupo_reglas.comparte_seguimiento_vivo IS
  'Si el cliente puede ver la ubicación de las personas en vivo. Por defecto NO: es el dato más sensible del módulo.';
COMMENT ON COLUMN grupo_reglas.geocerca_radio_m IS
  'Radio de geocerca por defecto para los puntos del contrato, en metros. Cada punto lo puede sobreescribir (F2).';

-- ── 2.4 Entregables ──────────────────────────────────────────────────────────
-- Qué informe, cada cuánto y a qué lista del directorio. NO se copian correos:
-- se apunta a `directorio_listas`, que ya es la fuente de verdad (20260923000000).
CREATE TABLE IF NOT EXISTS grupo_entregables (
  grupo_id               UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  tipo_informe           VARCHAR(40) NOT NULL,
  periodicidad           VARCHAR(12) NOT NULL
                         CHECK (periodicidad IN ('DIARIA','SEMANAL','QUINCENAL','MENSUAL','TRIMESTRAL','ANUAL')),
  dia_corte              SMALLINT CHECK (dia_corte IS NULL OR dia_corte BETWEEN 1 AND 31),
  directorio_lista_codigo VARCHAR(60) REFERENCES directorio_listas(codigo) ON DELETE SET NULL,
  formatos               TEXT[] NOT NULL DEFAULT ARRAY['PDF']::text[],
  activo                 BOOLEAN NOT NULL DEFAULT true,
  observacion            TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (grupo_id, tipo_informe, periodicidad)
);
CREATE INDEX IF NOT EXISTS idx_grupo_entregables_lista ON grupo_entregables(directorio_lista_codigo);

COMMENT ON TABLE grupo_entregables IS
  'Qué se le entrega al cliente, cada cuánto y a qué lista de correos. Apunta a directorio_listas en vez de copiar direcciones.';
COMMENT ON COLUMN grupo_entregables.tipo_informe IS
  'Sin CHECK en F1: el catálogo de informes se define en F12 (seis niveles: INDIVIDUAL/EQUIPO/SEDE/CONTRATO/CLIENTE/EMPRESA). Cerrar el dominio ahora obligaría a adivinarlo.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. `usuario_grupos` — un usuario en varios contratos
-- ──────────────────────────────────────────────────────────────────────────────
-- `usuarios.grupo_id` admite uno solo y se conserva como CONTRATO PRINCIPAL:
-- lo leen la app y políticas RLS que ya están en producción. Esta tabla lo
-- complementa, no lo reemplaza, y `auth_grupos()` suma las dos fuentes.
--
-- La PK incluye el papel para que la misma persona pueda figurar con dos
-- papeles en un contrato (p. ej. coordina y además es el técnico de guardia).
CREATE TABLE IF NOT EXISTS usuario_grupos (
  usuario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  grupo_id    UUID NOT NULL REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  papel       VARCHAR(12) NOT NULL
              CHECK (papel IN ('SUPERVISOR','COORDINADOR','TECNICO','CLIENTE','PROVEEDOR')),
  desde       DATE,
  hasta       DATE,
  activo      BOOLEAN NOT NULL DEFAULT true,
  observacion TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usuario_id, grupo_id, papel),
  CHECK (hasta IS NULL OR desde IS NULL OR hasta >= desde)
);
CREATE INDEX IF NOT EXISTS idx_usuario_grupos_grupo   ON usuario_grupos(grupo_id);
CREATE INDEX IF NOT EXISTS idx_usuario_grupos_usuario ON usuario_grupos(usuario_id) WHERE activo;

COMMENT ON TABLE usuario_grupos IS
  'Contratos de cada usuario, con papel y vigencia. usuarios.grupo_id SIGUE siendo el contrato principal y no se toca: hay código y RLS leyéndolo.';
COMMENT ON COLUMN usuario_grupos.papel IS
  'SUPERVISOR · COORDINADOR · TECNICO · CLIENTE (ve solo su contrato) · PROVEEDOR (ve solo las OT que se le asignan). Habilitar CLIENTE y PROVEEDOR en la consola está pendiente de decisión (§10.1 nº 8).';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. Triggers de `updated_at`
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['grupo_vigencias','grupo_servicios','grupo_sla',
                           'grupo_reglas','grupo_entregables','usuario_grupos'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tr_%1$s_upd ON public.%1$s', t);
    EXECUTE format('CREATE TRIGGER tr_%1$s_upd BEFORE UPDATE ON public.%1$s
                    FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t);
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. `auth_grupos()` — el alcance por contrato
-- ──────────────────────────────────────────────────────────────────────────────
-- Al estilo de `auth_permiso()`: STABLE SECURITY DEFINER con search_path fijo.
-- SECURITY DEFINER no es un lujo, es lo que evita la recursión: la política de
-- `usuario_grupos` llama a esta función, que lee `usuario_grupos`.
--
-- Devuelve:
--   · TODOS los contratos si el usuario es ADMIN o SUPER_ADMIN (es la misma
--     excepción que ya hacen auth_permiso() y auth_permiso_any()).
--   · si no, los de `usuario_grupos` vigentes hoy, más `usuarios.grupo_id`.
--
-- Las políticas lo usan como `grupo_id IN (SELECT public.auth_grupos())`: el
-- planner lo resuelve como un subplan hasheado una sola vez por consulta, no
-- una llamada por fila. `auth_ve_grupo()` es la misma pregunta en booleano,
-- para las RPC y el código de la app, donde el contrato viene de a uno.
CREATE OR REPLACE FUNCTION public.auth_grupos()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- ADMIN / SUPER_ADMIN: todos los contratos
  SELECT g.id
    FROM public.grupos_contrato g
   WHERE EXISTS (
           SELECT 1 FROM public.usuarios u
            WHERE u.id = (SELECT auth.uid())
              AND u.rol IN ('SUPER_ADMIN','ADMIN')
         )
  UNION
  -- Contratos asignados y vigentes hoy
  SELECT ug.grupo_id
    FROM public.usuario_grupos ug
   WHERE ug.usuario_id = (SELECT auth.uid())
     AND ug.activo
     AND (ug.desde IS NULL OR ug.desde <= CURRENT_DATE)
     AND (ug.hasta IS NULL OR ug.hasta >= CURRENT_DATE)
  UNION
  -- Contrato principal del usuario (lo que el repo ya usaba como alcance)
  SELECT u.grupo_id
    FROM public.usuarios u
   WHERE u.id = (SELECT auth.uid())
     AND u.grupo_id IS NOT NULL
$$;

COMMENT ON FUNCTION public.auth_grupos() IS
  'Contratos (grupos_contrato) a los que alcanza el usuario autenticado: usuario_grupos vigentes + usuarios.grupo_id, o TODOS si es ADMIN/SUPER_ADMIN. Es el alcance con el que filtran las políticas del módulo de Puntos QR.';
GRANT EXECUTE ON FUNCTION public.auth_grupos() TO authenticated;

/** ¿Este contrato está en el alcance del usuario? Azúcar sobre auth_grupos(). */
CREATE OR REPLACE FUNCTION public.auth_ve_grupo(p_grupo UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_grupo IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.auth_grupos() g WHERE g = p_grupo)
$$;
COMMENT ON FUNCTION public.auth_ve_grupo(UUID) IS
  'TRUE si el contrato indicado está en el alcance del usuario autenticado (ver auth_grupos()).';
GRANT EXECUTE ON FUNCTION public.auth_ve_grupo(UUID) TO authenticated;

/** Papeles del usuario en un contrato. Lo necesitan las políticas de CLIENTE y
    PROVEEDOR de las fases siguientes (§4.7). */
CREATE OR REPLACE FUNCTION public.auth_papel_grupo(p_grupo UUID)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(ug.papel::text ORDER BY ug.papel), ARRAY[]::text[])
    FROM public.usuario_grupos ug
   WHERE ug.usuario_id = (SELECT auth.uid())
     AND ug.grupo_id = p_grupo
     AND ug.activo
     AND (ug.desde IS NULL OR ug.desde <= CURRENT_DATE)
     AND (ug.hasta IS NULL OR ug.hasta >= CURRENT_DATE)
$$;
COMMENT ON FUNCTION public.auth_papel_grupo(UUID) IS
  'Papeles del usuario autenticado en un contrato (vacío si no tiene ninguno). Para las políticas de CLIENTE y PROVEEDOR de F6 y F7.';
GRANT EXECUTE ON FUNCTION public.auth_papel_grupo(UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. Vigencia EFECTIVA del contrato (§2.5)
-- ──────────────────────────────────────────────────────────────────────────────
-- "Contrato vencido apaga sus QR" se implementa PREGUNTANDO, no con un UPDATE
-- masivo de estados: un UPDATE pierde el estado real de cada QR y no se puede
-- deshacer al renovar. `ronda_qr_vigente(qr_id)` de F2 será
-- `qr.estado = 'ACTIVO' AND grupo_vigente(qr.grupo_id)`.
--
-- Criterio, con los NULL explicados porque los contratos que ya existen no
-- tienen fechas cargadas:
--   · `estado` tiene que ser VIGENTE. BORRADOR, SUSPENDIDO, VENCIDO y
--     TERMINADO no operan.
--   · `vigencia_desde` NULL = sin fecha de inicio pactada → no restringe.
--   · el fin es el MÁS TARDÍO entre `vigencia_hasta` y el `hasta` de sus
--     periodos en `grupo_vigencias`: así una prórroga extiende la vigencia sin
--     tocar la fila del contrato. Si alguno es NULL (periodo sin fin pactado),
--     no hay fin.
-- IMMUTABLE no: lee tablas. STABLE, que es lo que una política puede cachear.

/** Fecha en la que termina la vigencia efectiva, o NULL si no termina. */
CREATE OR REPLACE FUNCTION public.grupo_vigencia_fin(p_grupo UUID)
RETURNS DATE
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Reglas, en este orden:
  --   · el contrato sin `vigencia_hasta` no termina (así nacieron los que ya
  --     existen, y no se les puede inventar una fecha de fin);
  --   · un periodo con `hasta` NULL tampoco: se pactó sin fecha de fin;
  --   · si no, manda la fecha MÁS TARDÍA. GREATEST ignora los NULL, así que una
  --     prórroga extiende la vigencia sin tocar la fila del contrato.
  SELECT CASE
           WHEN g.vigencia_hasta IS NULL THEN NULL
           WHEN EXISTS (SELECT 1 FROM public.grupo_vigencias v
                         WHERE v.grupo_id = g.id AND v.hasta IS NULL) THEN NULL
           ELSE GREATEST(
                  g.vigencia_hasta,
                  (SELECT MAX(v.hasta) FROM public.grupo_vigencias v WHERE v.grupo_id = g.id)
                )
         END
    FROM public.grupos_contrato g
   WHERE g.id = p_grupo
$$;
COMMENT ON FUNCTION public.grupo_vigencia_fin(UUID) IS
  'Fin de la vigencia efectiva del contrato: el más tardío entre grupos_contrato.vigencia_hasta y el hasta de sus periodos en grupo_vigencias. NULL = no termina (o el contrato no existe).';
GRANT EXECUTE ON FUNCTION public.grupo_vigencia_fin(UUID) TO authenticated;

/** ¿El contrato está vigente en la fecha dada? Es la función de la que cuelga
    `ronda_qr_vigente()` en F2. */
CREATE OR REPLACE FUNCTION public.grupo_vigente(p_grupo UUID, p_fecha DATE DEFAULT CURRENT_DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT g.estado = 'VIGENTE'
       AND COALESCE(g.activo, true)
       -- inicio: el del contrato o el del primer periodo, el que haya
       AND COALESCE(
             LEAST(g.vigencia_desde,
                   (SELECT MIN(v.desde) FROM public.grupo_vigencias v WHERE v.grupo_id = g.id)),
             p_fecha
           ) <= p_fecha
       -- fin: el efectivo, que las prórrogas extienden
       AND COALESCE(public.grupo_vigencia_fin(g.id), p_fecha) >= p_fecha
      FROM public.grupos_contrato g
     WHERE g.id = p_grupo
  ), false)
$$;
COMMENT ON FUNCTION public.grupo_vigente(UUID, DATE) IS
  'TRUE si el contrato está vigente en la fecha dada (estado VIGENTE y dentro de la vigencia efectiva, prórrogas incluidas). Vigencia CALCULADA: nada de UPDATE masivo de estados, así que al renovar los QR vuelven a servir sin tocar ninguna fila (§2.5 del complemento 2).';
GRANT EXECUTE ON FUNCTION public.grupo_vigente(UUID, DATE) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. Acceso al módulo de contratos de conserjería
-- ──────────────────────────────────────────────────────────────────────────────
-- Dos funciones, al estilo de `pqrs_acceso()` / `pqrs_coordina()`, para que las
-- políticas no repitan la lista de claves.
CREATE OR REPLACE FUNCTION public.grupo_acceso()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{ver_contratos_conserjeria,gestionar_contratos_conserjeria}'::text[])
$$;
COMMENT ON FUNCTION public.grupo_acceso() IS
  'Entra a /rondas/contratos y lee el contrato y sus satélites (dentro de su alcance).';
GRANT EXECUTE ON FUNCTION public.grupo_acceso() TO authenticated;

CREATE OR REPLACE FUNCTION public.grupo_gestiona()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('gestionar_contratos_conserjeria')
$$;
COMMENT ON FUNCTION public.grupo_gestiona() IS
  'Edita vigencia, servicios, ANS, reglas, entregables y la asignación de usuarios a contratos.';
GRANT EXECUTE ON FUNCTION public.grupo_gestiona() TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. RLS de lo nuevo — también en las lecturas
-- ──────────────────────────────────────────────────────────────────────────────
-- Lectura  = acceso al módulo Y el contrato en el alcance (`auth_grupos()`).
-- Escritura = `gestionar_contratos_conserjeria` Y el contrato en el alcance.
-- Un ADMIN está en todos los alcances por `auth_grupos()`, así que ve todo.
ALTER TABLE grupo_vigencias    ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupo_servicios    ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupo_sla          ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupo_reglas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE grupo_entregables  ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_grupos     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['grupo_vigencias','grupo_servicios','grupo_sla',
                           'grupo_reglas','grupo_entregables'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY %I_read ON public.%I
      FOR SELECT TO authenticated
      USING ((SELECT public.grupo_acceso()) AND grupo_id IN (SELECT public.auth_grupos()))$p$, t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format($p$CREATE POLICY %I_write ON public.%I
      FOR ALL TO authenticated
      USING ((SELECT public.grupo_gestiona()) AND grupo_id IN (SELECT public.auth_grupos()))
      WITH CHECK ((SELECT public.grupo_gestiona()) AND grupo_id IN (SELECT public.auth_grupos()))$p$, t, t);
  END LOOP;
END $$;

-- `usuario_grupos` lleva además "lo propio": cada quien ve sus contratos sin
-- necesitar permiso, igual que /carnet y /perfil leen su sede y su grupo. Sin
-- esta cláusula, un Conserje no podría saber a qué contrato pertenece.
DROP POLICY IF EXISTS usuario_grupos_read ON usuario_grupos;
CREATE POLICY usuario_grupos_read ON usuario_grupos
  FOR SELECT TO authenticated
  USING (
    usuario_id = (SELECT auth.uid())
    OR ((SELECT public.grupo_acceso()) AND grupo_id IN (SELECT public.auth_grupos()))
    OR ((SELECT public.auth_permiso_any('{ver_usuarios,gestionar_usuarios}'::text[]))
        AND grupo_id IN (SELECT public.auth_grupos()))
  );

-- Asignar un usuario a un contrato es gestionar el contrato O gestionar
-- usuarios: las dos pantallas lo van a necesitar.
DROP POLICY IF EXISTS usuario_grupos_write ON usuario_grupos;
CREATE POLICY usuario_grupos_write ON usuario_grupos
  FOR ALL TO authenticated
  USING (
    (SELECT public.auth_permiso_any('{gestionar_contratos_conserjeria,gestionar_usuarios}'::text[]))
    AND grupo_id IN (SELECT public.auth_grupos())
  )
  WITH CHECK (
    (SELECT public.auth_permiso_any('{gestionar_contratos_conserjeria,gestionar_usuarios}'::text[]))
    AND grupo_id IN (SELECT public.auth_grupos())
  );

-- ── 8.1 `grupos_contrato`: las dos claves nuevas, de forma ADITIVA ───────────
-- La tabla es una dimensión que se lee desde casi todos los módulos, así que su
-- política de lectura (20261018000002) enumera una lista larga de permisos.
-- Recortarla rompería pantallas; lo único que se hace es AGREGAR las dos claves
-- de conserjería, para que quien solo tenga esas pueda abrir /rondas/contratos.
DROP POLICY IF EXISTS auth_read_grupos ON grupos_contrato;
CREATE POLICY auth_read_grupos ON grupos_contrato
  FOR SELECT TO authenticated
  USING (
    auth_permiso_any(array[
      'ver_contratos', 'editar_contratos',
      'ver_contratos_conserjeria', 'gestionar_contratos_conserjeria',
      'ver_parametrizacion', 'gestionar_parametrizacion',
      'ver_usuarios', 'gestionar_usuarios',
      'ver_personas', 'gestionar_personas', 'ver_planta_personal',
      'ver_aprovisionamiento', 'editar_aprovisionamiento',
      'ver_movimientos', 'ver_productos', 'ver_stock',
      'ver_ordenes_insumo', 'crear_ordenes_insumo', 'aprobar_ordenes_insumo',
      'alistar_ordenes_insumo', 'recibir_ordenes_insumo', 'ver_alistamiento',
      'ver_logistica', 'gestionar_rutas', 'ver_monitoreo_entregas',
      'ver_ubicacion_conductores', 'gestionar_horarios_entrega',
      'ver_reportes', 'importar_datos', 'exportar_datos'
    ])
    -- el grupo del propio usuario (/carnet, /perfil)
    or id = (select u.grupo_id from usuarios u where u.id = (select auth.uid()))
    -- los contratos a los que alcanza por usuario_grupos (papel CLIENTE incluido)
    or id IN (SELECT public.auth_grupos())
  );

-- Escritura: quien edita contratos de inventario (`editar_contratos`, que es la
-- pantalla /contratos) o quien gestiona los de conserjería. Se conserva la
-- alternativa por rol enum que traía la política original de init.sql.
DROP POLICY IF EXISTS write_grupos ON grupos_contrato;
CREATE POLICY write_grupos ON grupos_contrato
  FOR ALL TO authenticated
  USING (
    public.auth_rol() IN ('SUPER_ADMIN','ADMIN')
    OR auth_permiso_any(array['editar_contratos','gestionar_contratos_conserjeria'])
  )
  WITH CHECK (
    public.auth_rol() IN ('SUPER_ADMIN','ADMIN')
    OR auth_permiso_any(array['editar_contratos','gestionar_contratos_conserjeria'])
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. Sincronización incremental (packages/offline)
-- ──────────────────────────────────────────────────────────────────────────────
-- Las tablas nuevas tienen `updated_at`; el índice es lo que falta para que el
-- PULL por watermark no haga seq scan.
CREATE INDEX IF NOT EXISTS idx_grupo_vigencias_upd   ON grupo_vigencias(updated_at);
CREATE INDEX IF NOT EXISTS idx_grupo_servicios_upd   ON grupo_servicios(updated_at);
CREATE INDEX IF NOT EXISTS idx_grupo_sla_upd         ON grupo_sla(updated_at);
CREATE INDEX IF NOT EXISTS idx_grupo_reglas_upd      ON grupo_reglas(updated_at);
CREATE INDEX IF NOT EXISTS idx_grupo_entregables_upd ON grupo_entregables(updated_at);
CREATE INDEX IF NOT EXISTS idx_usuario_grupos_upd    ON usuario_grupos(updated_at);
