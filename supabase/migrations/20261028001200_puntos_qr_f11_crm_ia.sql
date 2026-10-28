-- =============================================================================
-- Puntos QR · F11 — El CRM con IA
--
-- Qué es esto: los casos del CRM sobre las conversaciones que dejó F9. La
-- §2.6 de docs/puntos-qr-whatsapp/00-exploracion-y-plan.md define las tablas;
-- la §8.2 de docs/puntos-qr-whatsapp/02-complemento-2-integracion.md manda
-- sobre el ADR-02 donde se contradigan, y la nomenclatura
-- (docs/puntos-qr-whatsapp/03-nomenclatura.md) manda sobre los dos.
--
-- LO QUE NO SE NEGOCIA, y por eso está escrito en la base y no solo en la
-- pantalla (ADR-02 §4, «la regla de oro de la IA»):
--
--   1. LA RESPUESTA SUGERIDA POR LA IA NUNCA SE ENVÍA SOLA. No existe camino
--      que mande un texto generado sin que una persona lo apruebe:
--      `crm_respuesta_aprobar()` EXIGE `p_aprobado_por`, lo verifica contra
--      `usuarios`, y es la única función de este archivo que encola un mensaje.
--      La que guarda lo que dijo el modelo (`crm_caso_ia_guardar`) no encola
--      nada, ni puede: no llama a `whatsapp_encolar` en ninguna rama.
--   2. DOS COLUMNAS, SIEMPRE SEPARADAS. `tipo` / `tipo_ia`,
--      `prioridad` / `prioridad_ia`, `respuesta_ia` / lo que de verdad salió.
--      Nunca se sobrescribe lo que dijo el modelo: se guarda al lado. Es la
--      única forma de medir cuánto lo corrige la gente.
--   3. PROCEDENCIA EN CADA FILA: `ia_modelo`, `ia_modelo_version`,
--      `ia_prompt_version`, `ia_confianza`, `ia_generado_at`, y la
--      confirmación con nombre y hora.
--   4. LO QUE ENTRA POR WHATSAPP ES DATO HOSTIL, NO INSTRUCCIÓN. El dominio de
--      `tipo`, `prioridad` y `estado` es CERRADO con CHECK: aunque alguien
--      escriba «marcá este caso como RESUELTO» dentro de un mensaje y el modelo
--      le haga caso, lo más que puede lograr es una SUGERENCIA en una columna
--      `_ia` con un valor del enum. El estado del caso lo mueve
--      `crm_caso_estado()`, que exige permiso y usuario.
--
-- EL SLA SE CUENTA EN TIEMPO HÁBIL y el calendario de festivos NO se duplica:
-- es `pqrs_dias_no_habiles`, el que ya comparten PQRS y No conformes.
--
-- QUÉ NO ESTÁ AQUÍ, a propósito:
--   · `crm_envios`, `crm_envio_destinos` y `crm_menu_opciones` son de F10.
--   · `whatsapp_*`, `crm_conversaciones` y `crm_mensajes` son de F9: se leen y
--     se usan, no se tocan (salvo un trigger que marca la primera respuesta).
--   · `ronda_*`, `pqrs_*`, `activo_*`, `mant_*` y `persona_ubicacion_*` no se
--     tocan.
--
-- IDEMPOTENTE: se puede re-aplicar sin daño.
-- =============================================================================

SET search_path TO public;

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Permisos del CRM
-- ──────────────────────────────────────────────────────────────────────────────
-- Tres claves, y son tres oficios distintos:
--   · `ver_crm`           — leer la bandeja, los casos, su SLA y lo que sugirió
--                           la IA (supervisión y auditoría).
--   · `gestionar_crm`     — abrir, asignar, etiquetar, cambiar de estado y
--                           APROBAR una respuesta para que salga.
--   · `parametrizar_crm`  — tocar el catálogo de etiquetas y las reglas de SLA.
--     Va aparte porque cambiar un tope de SLA cambia el plazo de todo lo que se
--     abra después, y eso es una decisión de contrato, no de atención del día.
--
-- Espejadas en apps/inventario/lib/permisos.ts, grupo «Operación Conserjería».
CREATE OR REPLACE FUNCTION public.crm_acceso()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso_any('{ver_crm,gestionar_crm}'::text[])
$$;
COMMENT ON FUNCTION public.crm_acceso() IS
  'Lee la bandeja del CRM, los casos y su SLA dentro de su alcance de contratos.';
GRANT EXECUTE ON FUNCTION public.crm_acceso() TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_gestiona()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('gestionar_crm')
$$;
COMMENT ON FUNCTION public.crm_gestiona() IS
  'Abre, asigna, etiqueta y cierra casos, y APRUEBA una respuesta sugerida para que salga.';
GRANT EXECUTE ON FUNCTION public.crm_gestiona() TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_parametriza()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.auth_permiso('parametrizar_crm')
$$;
COMMENT ON FUNCTION public.crm_parametriza() IS
  'Edita el catálogo de etiquetas y las reglas de SLA. Va aparte: un tope de SLA cambia el plazo de todo lo que se abra después.';
GRANT EXECUTE ON FUNCTION public.crm_parametriza() TO authenticated;

-- El guardián que llevan todas las RPC de consola de este archivo.
--
-- POR QUÉ ESTÁ CONDICIONADO A QUE HAYA SESIÓN, que es lo que más llama la
-- atención de este bloque: las RPC de F11 las llaman DOS mundos distintos.
--   · La consola, con la sesión del usuario. Ahí `auth.uid()` es la persona y
--     la BASE exige el permiso: que la pantalla ya lo haya comprobado no
--     alcanza, porque una server action se puede llamar sin pasar por la
--     pantalla.
--   · El bot de F9 (`motor.ts`) y el cron, con la llave de servicio. Ahí
--     `auth.uid()` es NULL y `auth_permiso()` diría que no a TODO, así que el
--     bot no podría abrir un caso. En ese camino el guardián es el route
--     handler con el `CRON_SECRET` o la firma del webhook, exactamente como
--     decidió F9 para `whatsapp_encolar()`.
--
-- Lo que esto NO debilita: `crm_respuesta_aprobar()` exige además una persona
-- que apruebe y que exista en `usuarios`. Ni la llave de servicio puede
-- fabricar una aprobación anónima.
CREATE OR REPLACE FUNCTION public.crm_exige_gestion()
RETURNS VOID LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT auth.uid()) IS NOT NULL AND NOT public.crm_gestiona() THEN
    RAISE EXCEPTION 'No tienes permiso para gestionar casos del CRM. Pide a un administrador que habilite «gestionar_crm» en Roles y Permisos.';
  END IF;
END $$;
COMMENT ON FUNCTION public.crm_exige_gestion() IS
  'Guardián de las RPC de consola: si hay sesión, exige `gestionar_crm` en la BASE. Sin sesión (bot y cron con llave de servicio) no frena, porque ahí auth.uid() es NULL y el guardián es el route handler, igual que en F9.';
GRANT EXECUTE ON FUNCTION public.crm_exige_gestion() TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. El reloj hábil
-- ──────────────────────────────────────────────────────────────────────────────
-- El plazo del SLA corre en MINUTOS HÁBILES: solo de lunes a viernes, solo
-- dentro de la franja de atención, y saltando los festivos.
--
-- EL CALENDARIO NO SE DUPLICA. Es `pqrs_dias_no_habiles` (20261018000004), la
-- misma tabla que usan PQRS y No conformes. Cargar ahí los festivos del año
-- alarga automáticamente los plazos que se calculen DESPUÉS; los ya calculados
-- conservan el suyo, igual que en PQRS.
--
-- `pqrs_sumar_habiles(DATE, INT)` ya existe pero suma DÍAS enteros, y un SLA de
-- «4 horas hábiles» no se puede expresar en días. De ahí estas dos funciones,
-- que son la versión en minutos del mismo calendario.
--
-- La franja NO puede cruzar la medianoche (`desde < hasta`): un turno de noche
-- es un intervalo continuo y eso exige otra aritmética. Lo frena el CHECK de
-- `crm_sla_reglas` y aquí se devuelve NULL en vez de girar en falso.
--
-- OJO con la zona horaria: se trabaja en hora local de `p_zona` con
-- `AT TIME ZONE`, que usa la base de datos de zonas de PostgreSQL. Colombia no
-- tiene horario de verano, pero la aritmética es correcta igual si algún día el
-- módulo atiende otra zona.
CREATE OR REPLACE FUNCTION public.crm_sumar_habiles_min(
  p_desde      TIMESTAMPTZ,
  p_minutos    INT,
  p_desde_hora TIME DEFAULT '08:00',
  p_hasta_hora TIME DEFAULT '17:00',
  p_zona       TEXT DEFAULT 'America/Bogota'
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_cursor   TIMESTAMP;          -- hora LOCAL de p_zona
  v_restan   INT := GREATEST(COALESCE(p_minutos, 0), 0);
  v_dia      DATE;
  v_ini      TIMESTAMP;
  v_fin      TIMESTAMP;
  v_cabe     INT;
  v_vueltas  INT := 0;
BEGIN
  IF p_desde IS NULL OR p_desde_hora >= p_hasta_hora THEN RETURN NULL; END IF;

  v_cursor := p_desde AT TIME ZONE p_zona;

  LOOP
    v_vueltas := v_vueltas + 1;
    -- Tope de seguridad: 1.000 días hábiles son casi cuatro años de plazo. Si
    -- se llega acá es que los parámetros están mal, y girar para siempre dentro
    -- de una consulta de Supabase (que corta a los 8 s) es peor que devolver
    -- NULL y que se vea.
    IF v_vueltas > 1000 THEN RETURN NULL; END IF;

    v_dia := v_cursor::date;

    -- ¿Día hábil? 1..5 = lunes a viernes (ISO), y no estar en el calendario.
    IF EXTRACT(ISODOW FROM v_dia) > 5
       OR EXISTS (SELECT 1 FROM pqrs_dias_no_habiles d WHERE d.fecha = v_dia) THEN
      v_cursor := (v_dia + 1) + p_desde_hora;
      CONTINUE;
    END IF;

    v_ini := v_dia + p_desde_hora;
    v_fin := v_dia + p_hasta_hora;

    -- Antes de abrir: el reloj arranca cuando abre.
    IF v_cursor < v_ini THEN v_cursor := v_ini; END IF;
    -- Ya cerró: al día siguiente.
    IF v_cursor >= v_fin THEN
      v_cursor := (v_dia + 1) + p_desde_hora;
      CONTINUE;
    END IF;

    v_cabe := FLOOR(EXTRACT(EPOCH FROM (v_fin - v_cursor)) / 60)::int;
    IF v_restan <= v_cabe THEN
      RETURN (v_cursor + make_interval(mins => v_restan)) AT TIME ZONE p_zona;
    END IF;

    v_restan := v_restan - v_cabe;
    v_cursor := (v_dia + 1) + p_desde_hora;
  END LOOP;
END $$;
COMMENT ON FUNCTION public.crm_sumar_habiles_min(TIMESTAMPTZ, INT, TIME, TIME, TEXT) IS
  'Suma minutos HÁBILES a un instante: solo lunes a viernes, solo dentro de la franja, saltando las fechas de pqrs_dias_no_habiles (el mismo calendario de PQRS y No conformes). Si el instante cae fuera de la franja, el reloj arranca cuando abre. Devuelve NULL si la franja cruza la medianoche o si el plazo pasa de 1.000 días hábiles.';
GRANT EXECUTE ON FUNCTION public.crm_sumar_habiles_min(TIMESTAMPTZ, INT, TIME, TIME, TEXT) TO authenticated;

-- Cuántos minutos HÁBILES pasaron entre dos instantes. Es lo que se le suma a
-- `crm_sla.pausado_min` cuando el reloj estuvo parado: si el caso quedó en
-- espera un viernes a las 16:00 y se reanudó el lunes a las 9:00, lo que estuvo
-- parado NO son 65 horas, son 2 horas hábiles.
CREATE OR REPLACE FUNCTION public.crm_minutos_habiles(
  p_desde      TIMESTAMPTZ,
  p_hasta      TIMESTAMPTZ,
  p_desde_hora TIME DEFAULT '08:00',
  p_hasta_hora TIME DEFAULT '17:00',
  p_zona       TEXT DEFAULT 'America/Bogota'
) RETURNS INT
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_a       TIMESTAMP;
  v_b       TIMESTAMP;
  v_dia     DATE;
  v_ini     TIMESTAMP;
  v_fin     TIMESTAMP;
  v_desde   TIMESTAMP;
  v_hasta   TIMESTAMP;
  v_total   INT := 0;
  v_vueltas INT := 0;
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_desde_hora >= p_hasta_hora THEN RETURN NULL; END IF;
  IF p_hasta <= p_desde THEN RETURN 0; END IF;

  v_a   := p_desde AT TIME ZONE p_zona;
  v_b   := p_hasta AT TIME ZONE p_zona;
  v_dia := v_a::date;

  WHILE v_dia <= v_b::date LOOP
    v_vueltas := v_vueltas + 1;
    IF v_vueltas > 2000 THEN RETURN NULL; END IF;

    IF EXTRACT(ISODOW FROM v_dia) <= 5
       AND NOT EXISTS (SELECT 1 FROM pqrs_dias_no_habiles d WHERE d.fecha = v_dia) THEN
      v_ini   := v_dia + p_desde_hora;
      v_fin   := v_dia + p_hasta_hora;
      v_desde := GREATEST(v_a, v_ini);
      v_hasta := LEAST(v_b, v_fin);
      IF v_hasta > v_desde THEN
        v_total := v_total + FLOOR(EXTRACT(EPOCH FROM (v_hasta - v_desde)) / 60)::int;
      END IF;
    END IF;
    v_dia := v_dia + 1;
  END LOOP;

  RETURN v_total;
END $$;
COMMENT ON FUNCTION public.crm_minutos_habiles(TIMESTAMPTZ, TIMESTAMPTZ, TIME, TIME, TEXT) IS
  'Minutos HÁBILES transcurridos entre dos instantes, con el mismo calendario. Es lo que se acumula en crm_sla.pausado_min: un caso en espera de un viernes a las 16:00 al lunes a las 9:00 estuvo parado 2 horas hábiles, no 65.';
GRANT EXECUTE ON FUNCTION public.crm_minutos_habiles(TIMESTAMPTZ, TIMESTAMPTZ, TIME, TIME, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. `crm_etiquetas` — el catálogo
-- ──────────────────────────────────────────────────────────────────────────────
-- `grupo_id` NULLABLE: catálogo general, donde NULL significa «aplica a todos
-- los contratos» (§2.4 del complemento, el mismo patrón de
-- `ronda_tipos_actividad`).
CREATE TABLE IF NOT EXISTS crm_etiquetas (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo     VARCHAR(40) NOT NULL,
  nombre     VARCHAR(80) NOT NULL,
  color      VARCHAR(7)  NOT NULL DEFAULT '#64748B'
             CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  grupo_id   UUID REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  descripcion TEXT,
  activo     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_crm_etiquetas_codigo CHECK (codigo ~ '^[A-Z0-9_]{2,40}$')
);
-- Único por código DENTRO de su ámbito: el contrato puede tener su propia
-- «MOROSO» sin chocar con la general. `COALESCE` sobre un UUID fijo porque en
-- un índice único dos NULL no son iguales y se podrían crear dos generales.
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_etiquetas_codigo
  ON crm_etiquetas(codigo, COALESCE(grupo_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_crm_etiquetas_grupo ON crm_etiquetas(grupo_id) WHERE grupo_id IS NOT NULL;

COMMENT ON TABLE crm_etiquetas IS
  'Catálogo de etiquetas de los casos. `grupo_id` NULL = aplica a todos los contratos (§2.4 del complemento 2).';

DROP TRIGGER IF EXISTS tr_crm_etiquetas_upd ON crm_etiquetas;
CREATE TRIGGER tr_crm_etiquetas_upd BEFORE UPDATE ON crm_etiquetas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. `crm_sla_reglas` — los topes, parametrizables
-- ──────────────────────────────────────────────────────────────────────────────
-- Al estilo de `pqrs_plazos`: los valores van en tabla, no quemados en el
-- código. Y con cascada de ámbito, como la parametrización del ADR-02 §2.10
-- corregida por la §8.2 del complemento (el eje es el CONTRATO, no el cliente):
--
--     default (grupo NULL, tipo NULL) → tipo → contrato → contrato + tipo
--
-- La resuelve `crm_sla_regla()`, que devuelve la MÁS específica.
CREATE TABLE IF NOT EXISTS crm_sla_reglas (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id                  UUID REFERENCES grupos_contrato(id) ON DELETE CASCADE,
  tipo                      VARCHAR(20),
  prioridad                 VARCHAR(10) NOT NULL DEFAULT 'MEDIA'
                            CHECK (prioridad IN ('BAJA','MEDIA','ALTA','CRITICA')),
  minutos_primera_respuesta INT NOT NULL CHECK (minutos_primera_respuesta BETWEEN 5 AND 100000),
  minutos_resolucion        INT NOT NULL CHECK (minutos_resolucion BETWEEN 5 AND 1000000),
  horas_habiles             BOOLEAN NOT NULL DEFAULT true,
  jornada_desde             TIME NOT NULL DEFAULT '08:00',
  jornada_hasta             TIME NOT NULL DEFAULT '17:00',
  zona                      TEXT NOT NULL DEFAULT 'America/Bogota',
  activo                    BOOLEAN NOT NULL DEFAULT true,
  observacion               TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_crm_sla_reglas_orden CHECK (minutos_resolucion >= minutos_primera_respuesta),
  -- La franja no puede cruzar la medianoche: el reloj hábil no lo sabe contar y
  -- devolvería NULL. Mejor que no se pueda guardar.
  CONSTRAINT ck_crm_sla_reglas_franja CHECK (jornada_desde < jornada_hasta)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_sla_reglas_ambito
  ON crm_sla_reglas(COALESCE(grupo_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    COALESCE(tipo, '*'), prioridad);

COMMENT ON TABLE crm_sla_reglas IS
  'Topes de SLA por ámbito, al estilo de pqrs_plazos. Cascada: default → tipo → contrato → contrato+tipo, y la resuelve crm_sla_regla(). Cambiar un tope NO re-calcula lo ya abierto: cada caso guarda en crm_sla los minutos con los que nació.';
COMMENT ON COLUMN crm_sla_reglas.horas_habiles IS
  'TRUE: el plazo corre solo en la franja hábil y saltando festivos (pqrs_dias_no_habiles). FALSE: corre en reloj de pared, 24/7. Por defecto TRUE, igual que grupo_sla.horas_habiles de F1.';
COMMENT ON COLUMN crm_sla_reglas.tipo IS
  'Tipo de caso al que aplica la regla, o NULL = cualquier tipo. Sin FK porque el dominio es el CHECK de crm_casos.tipo.';

DROP TRIGGER IF EXISTS tr_crm_sla_reglas_upd ON crm_sla_reglas;
CREATE TRIGGER tr_crm_sla_reglas_upd BEFORE UPDATE ON crm_sla_reglas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. `crm_casos` — el caso
-- ──────────────────────────────────────────────────────────────────────────────
-- `numero` es `CS-00001` desde una secuencia, como `PQ-00001` y `RV-000001`
-- (nomenclatura §4). `grupo_id` y `sede_id` NULLABLE, por la misma razón que en
-- `crm_conversaciones`: una conversación puede empezar sin contrato conocido, y
-- el caso hereda ese desconocimiento (§2.4 del complemento).
CREATE SEQUENCE IF NOT EXISTS crm_caso_seq;

CREATE TABLE IF NOT EXISTS crm_casos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero              VARCHAR(30) NOT NULL UNIQUE,
  conversacion_id     UUID REFERENCES crm_conversaciones(id) ON DELETE SET NULL,
  canal               VARCHAR(10) NOT NULL DEFAULT 'WHATSAPP'
                      CHECK (canal IN ('WHATSAPP','WEB','TELEFONO','CORREO','CONSOLA')),
  -- Dominio CERRADO a propósito: es la primera defensa contra un mensaje
  -- entrante que trae instrucciones. Lo más que puede conseguir una inyección
  -- es un valor de esta lista en la columna de SUGERENCIA.
  tipo                VARCHAR(20) NOT NULL DEFAULT 'OTRO'
                      CHECK (tipo IN ('CONSULTA','VISITA','PQRS','MANTENIMIENTO','SOPORTE',
                                      'IDENTIDAD','CONSENTIMIENTO','ADMINISTRATIVO','OTRO')),
  estado              VARCHAR(12) NOT NULL DEFAULT 'NUEVO'
                      CHECK (estado IN ('NUEVO','EN_TRAMITE','EN_ESPERA','RESUELTO','CERRADO')),
  prioridad           VARCHAR(10) NOT NULL DEFAULT 'MEDIA'
                      CHECK (prioridad IN ('BAJA','MEDIA','ALTA','CRITICA')),
  grupo_id            UUID REFERENCES grupos_contrato(id) ON DELETE SET NULL,
  sede_id             UUID REFERENCES sedes(id) ON DELETE SET NULL,
  persona_id          UUID REFERENCES personas(id) ON DELETE SET NULL,
  contacto_nombre     VARCHAR(120),
  asunto              VARCHAR(200) NOT NULL,
  descripcion         TEXT,

  -- ── Lo que sugirió la IA, SIEMPRE al lado de lo real, nunca encima ────────
  resumen_ia          TEXT,
  clasificacion_ia    JSONB,
  tipo_ia             VARCHAR(20)
                      CHECK (tipo_ia IS NULL OR tipo_ia IN
                             ('CONSULTA','VISITA','PQRS','MANTENIMIENTO','SOPORTE',
                              'IDENTIDAD','CONSENTIMIENTO','ADMINISTRATIVO','OTRO')),
  prioridad_ia        VARCHAR(10)
                      CHECK (prioridad_ia IS NULL OR prioridad_ia IN ('BAJA','MEDIA','ALTA','CRITICA')),
  respuesta_ia        TEXT,
  ia_modelo           VARCHAR(60),
  ia_modelo_version   VARCHAR(40),
  ia_prompt_version   VARCHAR(20),
  ia_confianza        NUMERIC(4,3) CHECK (ia_confianza IS NULL OR ia_confianza BETWEEN 0 AND 1),
  ia_generado_at      TIMESTAMPTZ,
  ia_mensajes_vistos  INT,
  ia_confirmado_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  ia_confirmado_at    TIMESTAMPTZ,
  -- La respuesta sugerida, aprobada por una PERSONA. Sin estas dos columnas
  -- llenas no sale nada: lo exige `crm_respuesta_aprobar()`.
  respuesta_aprobada_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  respuesta_aprobada_at    TIMESTAMPTZ,
  respuesta_aprobada_texto TEXT,
  respuesta_editada        BOOLEAN NOT NULL DEFAULT false,
  respuesta_mensaje_id     UUID REFERENCES crm_mensajes(id) ON DELETE SET NULL,

  -- ── Quién lo atiende (el vigente; el historial está en crm_asignaciones) ──
  asignado_a          UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  asignado_nombre     VARCHAR(200),
  asignado_at         TIMESTAMPTZ,

  -- ── Puentes a lo que ya existe ────────────────────────────────────────────
  pqrs_id             UUID REFERENCES pqrs(id) ON DELETE SET NULL,
  ticket_id           UUID REFERENCES mantenimiento_tickets(id) ON DELETE SET NULL,
  visita_id           UUID REFERENCES ronda_visitas(id) ON DELETE SET NULL,

  motivo_apertura     VARCHAR(40),
  abierto_por_tipo    VARCHAR(10) NOT NULL DEFAULT 'SISTEMA'
                      CHECK (abierto_por_tipo IN ('USUARIO','BOT','SISTEMA')),
  abierto_por         UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  abierto_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelto_at         TIMESTAMPTZ,
  cerrado_at          TIMESTAMPTZ,
  cierre_motivo       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Una sugerencia aprobada tiene que decir QUIÉN y CUÁNDO. Es la regla de oro
  -- hecha restricción: sin persona no hay aprobación.
  CONSTRAINT ck_crm_casos_aprobacion CHECK (
    (respuesta_aprobada_at IS NULL AND respuesta_aprobada_por IS NULL)
    OR (respuesta_aprobada_at IS NOT NULL AND respuesta_aprobada_por IS NOT NULL
        AND NULLIF(btrim(respuesta_aprobada_texto), '') IS NOT NULL)
  ),
  -- Confirmar lo que dijo la IA también tiene nombre y hora.
  CONSTRAINT ck_crm_casos_ia_confirmada CHECK (
    (ia_confirmado_at IS NULL) = (ia_confirmado_por IS NULL)
  ),
  -- No se puede confirmar lo que el modelo nunca dijo.
  CONSTRAINT ck_crm_casos_ia_orden CHECK (
    ia_confirmado_at IS NULL OR ia_generado_at IS NOT NULL
  ),
  CONSTRAINT ck_crm_casos_resuelto CHECK (estado NOT IN ('RESUELTO','CERRADO') OR resuelto_at IS NOT NULL),
  CONSTRAINT ck_crm_casos_cerrado  CHECK ((estado = 'CERRADO') = (cerrado_at IS NOT NULL)),
  CONSTRAINT ck_crm_casos_asignado CHECK ((asignado_a IS NULL) = (asignado_at IS NULL))
);
-- UN caso abierto por conversación. Dos casos abiertos sobre el mismo hilo
-- partirían el SLA en dos y nadie sabría cuál es el que vence; y el bot deriva
-- al agente varias veces en una misma conversación. `crm_caso_abrir()` es
-- idempotente justamente por esto: devuelve el que ya está abierto.
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_casos_abierto
  ON crm_casos(conversacion_id)
  WHERE conversacion_id IS NOT NULL AND estado IN ('NUEVO','EN_TRAMITE','EN_ESPERA');
CREATE INDEX IF NOT EXISTS idx_crm_casos_estado  ON crm_casos(estado, abierto_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_casos_grupo   ON crm_casos(grupo_id, estado, abierto_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_casos_asignado ON crm_casos(asignado_a, estado) WHERE asignado_a IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_casos_conv    ON crm_casos(conversacion_id) WHERE conversacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_casos_persona ON crm_casos(persona_id) WHERE persona_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crm_casos_upd     ON crm_casos(updated_at);
-- Los que esperan una respuesta sugerida sin aprobar: es la cola de trabajo de
-- la bandeja, y la pantalla la cuenta en SQL con este índice.
CREATE INDEX IF NOT EXISTS idx_crm_casos_sugerencia ON crm_casos(abierto_at DESC)
  WHERE respuesta_ia IS NOT NULL AND respuesta_aprobada_at IS NULL;

COMMENT ON TABLE crm_casos IS
  'El caso del CRM sobre una conversación. Numerado CS-00001. `grupo_id` y `sede_id` nullable porque una conversación puede empezar sin contrato conocido (§2.4 del complemento 2). Las columnas `*_ia` son SUGERENCIAS y viven SIEMPRE al lado de las reales, nunca encima.';
COMMENT ON COLUMN crm_casos.tipo IS
  'Tipo real del caso, el que decide una persona. Dominio CERRADO: es parte de la defensa contra un mensaje entrante con instrucciones dentro.';
COMMENT ON COLUMN crm_casos.tipo_ia IS
  'Tipo que SUGIRIÓ el modelo. Nunca se copia a `tipo` automáticamente: lo pasa una persona desde la pantalla, y entonces queda `ia_confirmado_por`.';
COMMENT ON COLUMN crm_casos.respuesta_ia IS
  'Borrador de respuesta que redactó el modelo. NO SE ENVÍA SOLA: para que salga hay que pasar por crm_respuesta_aprobar(), que exige el usuario que la aprueba. Guardar esto no encola nada.';
COMMENT ON COLUMN crm_casos.respuesta_aprobada_texto IS
  'El texto EXACTO que una persona aprobó, que puede no ser el de `respuesta_ia` si lo editó (`respuesta_editada`). Se guarda aparte para poder medir cuánto corrige la gente al modelo, que es la única métrica real de si el modelo sirve (ADR-02 §4.1).';
COMMENT ON COLUMN crm_casos.ia_mensajes_vistos IS
  'Cuántos mensajes de la conversación vio el modelo. Si después entran más, lo que sugirió está viejo y la pantalla lo avisa.';

DROP TRIGGER IF EXISTS tr_crm_casos_upd ON crm_casos;
CREATE TRIGGER tr_crm_casos_upd BEFORE UPDATE ON crm_casos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- 6. `crm_caso_etiquetas`
-- ──────────────────────────────────────────────────────────────────────────────
-- `origen` existe por la regla de oro: una etiqueta que puso el modelo se ve
-- distinta de una que puso una persona, también en la pantalla.
CREATE TABLE IF NOT EXISTS crm_caso_etiquetas (
  caso_id     UUID NOT NULL REFERENCES crm_casos(id) ON DELETE CASCADE,
  etiqueta_id UUID NOT NULL REFERENCES crm_etiquetas(id) ON DELETE CASCADE,
  origen      VARCHAR(8) NOT NULL DEFAULT 'HUMANO'
              CHECK (origen IN ('HUMANO','IA','REGLA')),
  puesta_por  UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (caso_id, etiqueta_id),
  -- Una etiqueta puesta por una persona dice quién. Una puesta por el modelo o
  -- por una regla, no: no hay persona a la que atribuirla.
  CONSTRAINT ck_crm_caso_etq_origen CHECK (origen <> 'HUMANO' OR puesta_por IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_crm_caso_etq_etiqueta ON crm_caso_etiquetas(etiqueta_id);

COMMENT ON TABLE crm_caso_etiquetas IS
  'Etiquetas de un caso. `origen` distingue lo que puso una persona de lo que sugirió el modelo: es la regla de oro del ADR-02 §4 aplicada a las etiquetas.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 7. `crm_asignaciones` — el historial de a quién le toca
-- ──────────────────────────────────────────────────────────────────────────────
-- Historial, no estado: `crm_casos.asignado_a` es el vigente (desnormalizado
-- para que la bandeja no tenga que hacer un LATERAL por fila), y acá queda la
-- cadena completa con el motivo de cada pase.
CREATE TABLE IF NOT EXISTS crm_asignaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id        UUID NOT NULL REFERENCES crm_casos(id) ON DELETE CASCADE,
  usuario_id     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  usuario_nombre VARCHAR(200),
  asignado_por   UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  motivo         TEXT,
  desde          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hasta          TIMESTAMPTZ,
  CONSTRAINT ck_crm_asig_orden CHECK (hasta IS NULL OR hasta >= desde)
);
-- Una sola asignación vigente por caso.
CREATE UNIQUE INDEX IF NOT EXISTS ux_crm_asig_vigente
  ON crm_asignaciones(caso_id) WHERE hasta IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_asig_caso    ON crm_asignaciones(caso_id, desde DESC);
CREATE INDEX IF NOT EXISTS idx_crm_asig_usuario ON crm_asignaciones(usuario_id, desde DESC);

COMMENT ON TABLE crm_asignaciones IS
  'Historial de asignación de un caso. `crm_casos.asignado_a` es el vigente, desnormalizado para que la bandeja no haga un LATERAL por fila; acá está la cadena con el motivo de cada pase.';
COMMENT ON COLUMN crm_asignaciones.usuario_nombre IS
  'Nombre al momento de asignar. Se copia a propósito: si la cuenta se borra, el historial tiene que seguir diciendo a quién le tocaba.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 8. `crm_sla` — el reloj de un caso
-- ──────────────────────────────────────────────────────────────────────────────
-- Una fila por caso, con los minutos CONGELADOS con los que nació: cambiar un
-- tope en `crm_sla_reglas` no re-calcula lo que ya estaba abierto (el mismo
-- criterio de `pqrs_plazos` y de `parametros_version` del ADR-02 §2.10).
--
-- CUÁNDO SE PARA EL RELOJ — `pausado_min`. Esto es lo que más se presta a
-- discusión, así que queda escrito:
--
--   · Se pausa cuando el caso pasa a `EN_ESPERA`, que significa UNA sola cosa:
--     estamos esperando algo de la otra parte (la persona, el cliente, un
--     tercero). Mientras eso no llegue, el tiempo no es imputable a la empresa.
--   · NO se puede pausar antes de la primera respuesta. Para poder quedar
--     esperando algo hay que haber escrito antes preguntándolo, y eso YA es la
--     primera respuesta. Un caso que nadie tocó no se puede «poner en espera»
--     para que no venza: lo frena `crm_caso_estado()`.
--   · Solo se pausa el reloj de RESOLUCIÓN. El de primera respuesta no se pausa
--     nunca, porque contestar por primera vez no depende de nadie más.
--   · Mientras el reloj está en pausa el caso NO puede quedar incumplido. Lo
--     respeta `crm_sla_barrer()`.
--   · Lo que estuvo parado se mide en minutos HÁBILES (`crm_minutos_habiles`),
--     no de reloj de pared: un caso en espera del viernes a las 16:00 al lunes
--     a las 9:00 estuvo parado 2 horas, no 65.
CREATE TABLE IF NOT EXISTS crm_sla (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caso_id                   UUID NOT NULL UNIQUE REFERENCES crm_casos(id) ON DELETE CASCADE,
  regla_id                  UUID REFERENCES crm_sla_reglas(id) ON DELETE SET NULL,
  prioridad                 VARCHAR(10) NOT NULL
                            CHECK (prioridad IN ('BAJA','MEDIA','ALTA','CRITICA')),
  minutos_primera_respuesta INT NOT NULL CHECK (minutos_primera_respuesta > 0),
  minutos_resolucion        INT NOT NULL CHECK (minutos_resolucion > 0),
  horas_habiles             BOOLEAN NOT NULL DEFAULT true,
  jornada_desde             TIME NOT NULL DEFAULT '08:00',
  jornada_hasta             TIME NOT NULL DEFAULT '17:00',
  zona                      TEXT NOT NULL DEFAULT 'America/Bogota',
  arranca_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  vence_primera_at          TIMESTAMPTZ,
  vence_resolucion_at       TIMESTAMPTZ,
  primera_respuesta_at      TIMESTAMPTZ,
  resuelto_at               TIMESTAMPTZ,
  pausado_min               INT NOT NULL DEFAULT 0 CHECK (pausado_min >= 0),
  pausado_desde             TIMESTAMPTZ,
  pausas                    INT NOT NULL DEFAULT 0 CHECK (pausas >= 0),
  incumplido                BOOLEAN NOT NULL DEFAULT false,
  incumplido_que            VARCHAR(12)
                            CHECK (incumplido_que IS NULL
                                   OR incumplido_que IN ('PRIMERA','RESOLUCION','AMBOS')),
  incumplido_at             TIMESTAMPTZ,
  calculado_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_crm_sla_franja CHECK (jornada_desde < jornada_hasta),
  CONSTRAINT ck_crm_sla_incumplido CHECK ((incumplido = false) = (incumplido_que IS NULL)),
  -- No se puede estar en pausa sin haber contestado: para esperar algo de la
  -- otra parte hubo que preguntárselo antes.
  CONSTRAINT ck_crm_sla_pausa CHECK (pausado_desde IS NULL OR primera_respuesta_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_crm_sla_vence_primera ON crm_sla(vence_primera_at)
  WHERE primera_respuesta_at IS NULL AND incumplido = false;
CREATE INDEX IF NOT EXISTS idx_crm_sla_vence_resol ON crm_sla(vence_resolucion_at)
  WHERE resuelto_at IS NULL AND pausado_desde IS NULL;
CREATE INDEX IF NOT EXISTS idx_crm_sla_incumplido ON crm_sla(incumplido, incumplido_at DESC)
  WHERE incumplido = true;
CREATE INDEX IF NOT EXISTS idx_crm_sla_upd ON crm_sla(updated_at);

COMMENT ON TABLE crm_sla IS
  'El reloj de un caso, con los minutos CONGELADOS con los que nació: cambiar un tope en crm_sla_reglas no re-calcula lo ya abierto. Se para solo en EN_ESPERA (esperando a la otra parte), solo el reloj de resolución, nunca antes de la primera respuesta, y en pausa el caso no puede quedar incumplido.';
COMMENT ON COLUMN crm_sla.pausado_min IS
  'Minutos HÁBILES acumulados con el reloj parado. El vencimiento es siempre arranca_at + minutos_resolucion + pausado_min, recalculado al reanudar.';
COMMENT ON COLUMN crm_sla.pausado_desde IS
  'Si no es NULL, el reloj está parado AHORA y el caso no puede quedar incumplido mientras lo esté.';

DROP TRIGGER IF EXISTS tr_crm_sla_upd ON crm_sla;
CREATE TRIGGER tr_crm_sla_upd BEFORE UPDATE ON crm_sla
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- 9. `crm_sla_regla()` — la cascada de ámbito
-- ──────────────────────────────────────────────────────────────────────────────
-- Devuelve la regla MÁS específica que aplica: contrato + tipo gana a contrato,
-- que gana a tipo, que gana al default. Si no hay ninguna (alguien borró el
-- default), devuelve 0 filas y quien llama decide; `crm_caso_abrir()` usa
-- entonces un plazo de respaldo y lo deja anotado.
CREATE OR REPLACE FUNCTION public.crm_sla_regla(
  p_grupo     UUID,
  p_tipo      TEXT,
  p_prioridad TEXT
) RETURNS crm_sla_reglas
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.* FROM crm_sla_reglas r
   WHERE r.activo
     AND r.prioridad = upper(COALESCE(p_prioridad, 'MEDIA'))
     AND (r.grupo_id IS NULL OR r.grupo_id = p_grupo)
     AND (r.tipo     IS NULL OR r.tipo     = upper(COALESCE(p_tipo, 'OTRO')))
   ORDER BY (r.grupo_id IS NOT NULL)::int DESC, (r.tipo IS NOT NULL)::int DESC
   LIMIT 1
$$;
COMMENT ON FUNCTION public.crm_sla_regla(UUID, TEXT, TEXT) IS
  'La regla de SLA más específica que aplica: contrato+tipo → contrato → tipo → default. El eje es el CONTRATO, no el cliente (§8.2 del complemento 2 corrigiendo al ADR-02 §2.10).';
GRANT EXECUTE ON FUNCTION public.crm_sla_regla(UUID, TEXT, TEXT) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 10. `crm_sla_calcular()` — las dos fechas de vencimiento
-- ──────────────────────────────────────────────────────────────────────────────
-- Una sola función que se usa al abrir, al reanudar y al recalcular, para que no
-- haya dos aritméticas distintas del mismo plazo.
CREATE OR REPLACE FUNCTION public.crm_sla_calcular(p_sla UUID)
RETURNS crm_sla
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_s crm_sla;
BEGIN
  SELECT * INTO v_s FROM crm_sla WHERE id = p_sla FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_s.horas_habiles THEN
    v_s.vence_primera_at := public.crm_sumar_habiles_min(
      v_s.arranca_at, v_s.minutos_primera_respuesta,
      v_s.jornada_desde, v_s.jornada_hasta, v_s.zona);
    -- El vencimiento de resolución es SIEMPRE el plazo más lo que estuvo
    -- parado. Así, reanudar no «regala» tiempo ni lo quita: lo corre.
    v_s.vence_resolucion_at := public.crm_sumar_habiles_min(
      v_s.arranca_at, v_s.minutos_resolucion + v_s.pausado_min,
      v_s.jornada_desde, v_s.jornada_hasta, v_s.zona);
  ELSE
    v_s.vence_primera_at    := v_s.arranca_at + make_interval(mins => v_s.minutos_primera_respuesta);
    v_s.vence_resolucion_at := v_s.arranca_at + make_interval(mins => v_s.minutos_resolucion + v_s.pausado_min);
  END IF;

  UPDATE crm_sla SET
    vence_primera_at    = v_s.vence_primera_at,
    vence_resolucion_at = v_s.vence_resolucion_at,
    calculado_at        = NOW()
  WHERE id = p_sla
  RETURNING * INTO v_s;

  RETURN v_s;
END $$;
COMMENT ON FUNCTION public.crm_sla_calcular(UUID) IS
  'Recalcula las dos fechas de vencimiento de un SLA con su propio calendario y su propio `pausado_min`. Única aritmética del plazo: la usan abrir, reanudar y recalcular.';
REVOKE ALL ON FUNCTION public.crm_sla_calcular(UUID) FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 11. `crm_caso_abrir()` — la puerta de entrada
-- ──────────────────────────────────────────────────────────────────────────────
-- La llama el bot (F9, desde `motor.ts` con la llave de servicio, cuando la
-- máquina emite `DERIVAR_AGENTE` o `AVISAR_SUPERVISOR`) y la llama la consola
-- (con el usuario de la sesión). Por eso `p_usuario` es opcional: un caso que
-- abre el bot no tiene usuario, y pedir uno obligaría a inventar una cuenta de
-- sistema.
--
-- IDEMPOTENTE Y ÚNICA POR CONVERSACIÓN: si ya hay un caso abierto sobre esa
-- conversación, lo devuelve y no crea otro. El bot deriva varias veces en una
-- misma conversación; dos casos abiertos partirían el SLA en dos.
--
-- Hereda `grupo_id`, `sede_id` y `persona_id` de la conversación, incluso si son
-- NULL: una conversación sin contrato conocido abre un caso sin contrato, que es
-- justo el que hay que identificar.
CREATE OR REPLACE FUNCTION public.crm_caso_abrir(
  p_conversacion UUID    DEFAULT NULL,
  p_asunto       TEXT    DEFAULT NULL,
  p_tipo         TEXT    DEFAULT 'OTRO',
  p_prioridad    TEXT    DEFAULT 'MEDIA',
  p_motivo       TEXT    DEFAULT NULL,
  p_descripcion  TEXT    DEFAULT NULL,
  p_usuario      UUID    DEFAULT NULL,
  p_canal        TEXT    DEFAULT 'WHATSAPP',
  p_id           UUID    DEFAULT NULL
) RETURNS crm_casos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caso    crm_casos;
  v_regla   crm_sla_reglas;
  v_sla_id  UUID;
  v_id      UUID := COALESCE(p_id, gen_random_uuid());
  v_tipo    TEXT := upper(COALESCE(NULLIF(btrim(p_tipo), ''), 'OTRO'));
  v_prio    TEXT := upper(COALESCE(NULLIF(btrim(p_prioridad), ''), 'MEDIA'));
  v_asunto  TEXT := NULLIF(btrim(COALESCE(p_asunto, '')), '');
  -- Sueltas y no un RECORD: un caso puede nacer SIN conversación (lo abre un
  -- agente por una llamada), y un RECORD sin asignar revienta al leerlo.
  v_grupo   UUID;
  v_sede    UUID;
  v_persona UUID;
  v_perfil  VARCHAR(120);
  v_visita  UUID;
BEGIN
  PERFORM public.crm_exige_gestion();
  -- Idempotencia por id explícito (un reintento del trabajador de entrada).
  SELECT * INTO v_caso FROM crm_casos WHERE id = v_id;
  IF FOUND THEN RETURN v_caso; END IF;

  -- Un caso abierto por conversación: el que ya está, gana.
  IF p_conversacion IS NOT NULL THEN
    SELECT * INTO v_caso FROM crm_casos
     WHERE conversacion_id = p_conversacion
       AND estado IN ('NUEVO','EN_TRAMITE','EN_ESPERA')
     LIMIT 1;
    IF FOUND THEN RETURN v_caso; END IF;

    SELECT c.grupo_id, c.sede_id, c.persona_id, left(c.perfil_nombre, 120), c.visita_id
      INTO v_grupo, v_sede, v_persona, v_perfil, v_visita
      FROM crm_conversaciones c WHERE c.id = p_conversacion;
    IF NOT FOUND THEN RAISE EXCEPTION 'La conversación no existe.'; END IF;
  END IF;

  IF v_asunto IS NULL THEN
    v_asunto := CASE
      WHEN p_motivo IS NOT NULL THEN 'Conversación derivada: ' || lower(replace(p_motivo, '_', ' '))
      ELSE 'Conversación derivada a un agente' END;
  END IF;

  INSERT INTO crm_casos (
    id, numero, conversacion_id, canal, tipo, prioridad, grupo_id, sede_id,
    persona_id, contacto_nombre, asunto, descripcion, visita_id,
    motivo_apertura, abierto_por_tipo, abierto_por
  ) VALUES (
    v_id,
    'CS-' || lpad(nextval('crm_caso_seq')::text, 5, '0'),
    p_conversacion, upper(COALESCE(p_canal, 'WHATSAPP')), v_tipo, v_prio,
    v_grupo, v_sede, v_persona, v_perfil,
    left(v_asunto, 200), NULLIF(btrim(COALESCE(p_descripcion, '')), ''),
    v_visita,
    left(upper(COALESCE(p_motivo, '')), 40),
    CASE WHEN p_usuario IS NOT NULL THEN 'USUARIO' ELSE 'BOT' END,
    p_usuario
  ) RETURNING * INTO v_caso;

  -- El reloj. Si no hay regla (alguien borró el default), se usa un plazo de
  -- respaldo y queda dicho en la observación del evento: es mejor un plazo
  -- visible que un caso sin reloj que nadie reclama.
  v_regla := public.crm_sla_regla(v_caso.grupo_id, v_caso.tipo, v_caso.prioridad);

  INSERT INTO crm_sla (
    caso_id, regla_id, prioridad, minutos_primera_respuesta, minutos_resolucion,
    horas_habiles, jornada_desde, jornada_hasta, zona, arranca_at
  ) VALUES (
    v_caso.id, v_regla.id, v_caso.prioridad,
    COALESCE(v_regla.minutos_primera_respuesta, 240),
    COALESCE(v_regla.minutos_resolucion, 1920),
    COALESCE(v_regla.horas_habiles, true),
    COALESCE(v_regla.jornada_desde, '08:00'::time),
    COALESCE(v_regla.jornada_hasta, '17:00'::time),
    COALESCE(v_regla.zona, 'America/Bogota'),
    v_caso.abierto_at
  ) RETURNING id INTO v_sla_id;

  PERFORM public.crm_sla_calcular(v_sla_id);

  INSERT INTO ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo,
    actor_usuario_id, actor_persona_id, canal, detalle)
  VALUES (v_caso.grupo_id, v_caso.sede_id, 'crm_casos', v_caso.id, 'CASO_ABIERTO',
          CASE WHEN p_usuario IS NOT NULL THEN 'USUARIO' ELSE 'BOT' END,
          p_usuario, v_caso.persona_id,
          CASE WHEN v_caso.canal IN ('CONSOLA') THEN 'CONSOLA'
               WHEN v_caso.canal = 'WHATSAPP' THEN 'WHATSAPP' ELSE 'SISTEMA' END,
          jsonb_build_object('numero', v_caso.numero, 'tipo', v_caso.tipo,
                             'prioridad', v_caso.prioridad, 'motivo', v_caso.motivo_apertura,
                             'regla_sla', v_regla.id, 'sla_por_defecto', v_regla.id IS NULL));

  PERFORM public.emitir_evento('CRM_CASO_ABIERTO',
    jsonb_build_object('numero', v_caso.numero, 'tipo', v_caso.tipo,
                       'prioridad', v_caso.prioridad, 'asunto', v_caso.asunto,
                       'motivo', v_caso.motivo_apertura, 'canal', v_caso.canal,
                       'enlace', '/rondas/crm/' || v_caso.id),
    'crm_casos', v_caso.id::text);

  RETURN v_caso;
END $$;
COMMENT ON FUNCTION public.crm_caso_abrir(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID) IS
  'Abre un caso sobre una conversación y le arranca el SLA. Idempotente por p_id Y por conversación: si ya hay uno abierto, lo devuelve. `p_usuario` opcional porque el bot abre casos sin usuario.';
REVOKE ALL ON FUNCTION public.crm_caso_abrir(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_caso_abrir(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 12. `crm_caso_asignar()`
-- ──────────────────────────────────────────────────────────────────────────────
-- Cierra la asignación vigente, abre la nueva y actualiza el caso, todo en una
-- transacción. `p_usuario` NULL = desasignar (vuelve a la bolsa común).
CREATE OR REPLACE FUNCTION public.crm_caso_asignar(
  p_caso        UUID,
  p_usuario     UUID DEFAULT NULL,
  p_motivo      TEXT DEFAULT NULL,
  p_asignado_por UUID DEFAULT NULL
) RETURNS crm_casos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caso   crm_casos;
  v_nombre VARCHAR(200);
  v_quien  UUID := COALESCE(p_asignado_por, auth.uid());
BEGIN
  PERFORM public.crm_exige_gestion();
  SELECT * INTO v_caso FROM crm_casos WHERE id = p_caso FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El caso no existe.'; END IF;
  IF v_caso.estado = 'CERRADO' THEN
    RAISE EXCEPTION 'El caso % está cerrado: no se puede reasignar.', v_caso.numero;
  END IF;

  IF p_usuario IS NOT NULL THEN
    SELECT u.nombre INTO v_nombre FROM usuarios u WHERE u.id = p_usuario;
    IF v_nombre IS NULL THEN RAISE EXCEPTION 'Ese usuario no existe.'; END IF;
  END IF;

  -- Reasignar al mismo no hace nada (y no ensucia el historial).
  IF v_caso.asignado_a IS NOT DISTINCT FROM p_usuario THEN RETURN v_caso; END IF;

  UPDATE crm_asignaciones SET hasta = NOW() WHERE caso_id = p_caso AND hasta IS NULL;

  IF p_usuario IS NOT NULL THEN
    INSERT INTO crm_asignaciones (caso_id, usuario_id, usuario_nombre, asignado_por, motivo)
    VALUES (p_caso, p_usuario, v_nombre, v_quien, NULLIF(btrim(COALESCE(p_motivo, '')), ''));
  END IF;

  UPDATE crm_casos SET
    asignado_a      = p_usuario,
    asignado_nombre = v_nombre,
    asignado_at     = CASE WHEN p_usuario IS NULL THEN NULL ELSE NOW() END,
    -- Asignar un caso NUEVO lo pone en trámite: alguien ya lo tiene.
    estado          = CASE WHEN v_caso.estado = 'NUEVO' AND p_usuario IS NOT NULL
                           THEN 'EN_TRAMITE' ELSE v_caso.estado END
  WHERE id = p_caso
  RETURNING * INTO v_caso;

  INSERT INTO ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo, actor_usuario_id,
    canal, detalle)
  VALUES (v_caso.grupo_id, v_caso.sede_id, 'crm_casos', v_caso.id,
          CASE WHEN p_usuario IS NULL THEN 'CASO_DESASIGNADO' ELSE 'CASO_ASIGNADO' END,
          CASE WHEN v_quien IS NULL THEN 'SISTEMA' ELSE 'USUARIO' END, v_quien, 'CONSOLA',
          jsonb_build_object('numero', v_caso.numero, 'usuario_id', p_usuario,
                             'usuario', v_nombre, 'motivo', p_motivo));

  RETURN v_caso;
END $$;
COMMENT ON FUNCTION public.crm_caso_asignar(UUID, UUID, TEXT, UUID) IS
  'Pasa un caso a un agente: cierra la asignación vigente, abre la nueva y deja el historial con el motivo. p_usuario NULL desasigna. Un caso NUEVO asignado pasa a EN_TRAMITE.';
REVOKE ALL ON FUNCTION public.crm_caso_asignar(UUID, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_caso_asignar(UUID, UUID, TEXT, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 13. `crm_caso_etiquetar()` / `crm_caso_desetiquetar()`
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crm_caso_etiquetar(
  p_caso     UUID,
  p_etiqueta UUID,
  p_origen   TEXT DEFAULT 'HUMANO',
  p_usuario  UUID DEFAULT NULL
) RETURNS crm_caso_etiquetas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fila   crm_caso_etiquetas;
  v_caso   crm_casos;
  v_etq    crm_etiquetas;
  v_origen TEXT := upper(COALESCE(p_origen, 'HUMANO'));
  v_quien  UUID := COALESCE(p_usuario, auth.uid());
BEGIN
  PERFORM public.crm_exige_gestion();
  SELECT * INTO v_caso FROM crm_casos WHERE id = p_caso;
  IF NOT FOUND THEN RAISE EXCEPTION 'El caso no existe.'; END IF;
  SELECT * INTO v_etq FROM crm_etiquetas WHERE id = p_etiqueta AND activo;
  IF NOT FOUND THEN RAISE EXCEPTION 'Esa etiqueta no existe o está inactiva.'; END IF;
  -- Una etiqueta de otro contrato no se le puede poner a este caso.
  IF v_etq.grupo_id IS NOT NULL AND v_etq.grupo_id IS DISTINCT FROM v_caso.grupo_id THEN
    RAISE EXCEPTION 'La etiqueta % es de otro contrato.', v_etq.codigo;
  END IF;
  IF v_origen = 'HUMANO' AND v_quien IS NULL THEN
    RAISE EXCEPTION 'Una etiqueta puesta por una persona tiene que decir quién.';
  END IF;

  INSERT INTO crm_caso_etiquetas (caso_id, etiqueta_id, origen, puesta_por)
  VALUES (p_caso, p_etiqueta, v_origen, CASE WHEN v_origen = 'HUMANO' THEN v_quien END)
  ON CONFLICT (caso_id, etiqueta_id) DO UPDATE
    -- Si el modelo ya la había puesto y ahora la pone una persona, gana la
    -- persona: la etiqueta deja de ser una sugerencia.
    SET origen     = CASE WHEN EXCLUDED.origen = 'HUMANO' THEN 'HUMANO' ELSE crm_caso_etiquetas.origen END,
        puesta_por = COALESCE(EXCLUDED.puesta_por, crm_caso_etiquetas.puesta_por)
  RETURNING * INTO v_fila;

  RETURN v_fila;
END $$;
COMMENT ON FUNCTION public.crm_caso_etiquetar(UUID, UUID, TEXT, UUID) IS
  'Pone una etiqueta a un caso. `origen` HUMANO exige usuario; IA y REGLA no. Si el modelo la había puesto y la confirma una persona, pasa a HUMANO: deja de ser sugerencia.';
REVOKE ALL ON FUNCTION public.crm_caso_etiquetar(UUID, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_caso_etiquetar(UUID, UUID, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_caso_desetiquetar(p_caso UUID, p_etiqueta UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.crm_exige_gestion();
  DELETE FROM crm_caso_etiquetas WHERE caso_id = p_caso AND etiqueta_id = p_etiqueta;
  RETURN FOUND;
END $$;
COMMENT ON FUNCTION public.crm_caso_desetiquetar(UUID, UUID) IS 'Quita una etiqueta de un caso.';
REVOKE ALL ON FUNCTION public.crm_caso_desetiquetar(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_caso_desetiquetar(UUID, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 14. `crm_caso_estado()` — y con él, la pausa del reloj
-- ──────────────────────────────────────────────────────────────────────────────
-- Las reglas de la pausa, que están explicadas arriba en el comentario de
-- `crm_sla`, se aplican acá y no en la pantalla:
--   · pasar a EN_ESPERA sin primera respuesta → se rechaza;
--   · pasar a EN_ESPERA → `pausado_desde = NOW()`;
--   · salir de EN_ESPERA → `pausado_min += minutos hábiles parados`, `pausas++`
--     y se recalcula el vencimiento;
--   · RESUELTO/CERRADO → se sella `resuelto_at` y se cierra cualquier pausa.
CREATE OR REPLACE FUNCTION public.crm_caso_estado(
  p_caso    UUID,
  p_estado  TEXT,
  p_motivo  TEXT DEFAULT NULL,
  p_usuario UUID DEFAULT NULL
) RETURNS crm_casos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caso    crm_casos;
  v_sla     crm_sla;
  v_nuevo   TEXT := upper(COALESCE(p_estado, ''));
  v_quien   UUID := COALESCE(p_usuario, auth.uid());
  v_parado  INT;
BEGIN
  PERFORM public.crm_exige_gestion();
  IF v_nuevo NOT IN ('NUEVO','EN_TRAMITE','EN_ESPERA','RESUELTO','CERRADO') THEN
    RAISE EXCEPTION 'Estado no válido: %', p_estado;
  END IF;

  SELECT * INTO v_caso FROM crm_casos WHERE id = p_caso FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El caso no existe.'; END IF;
  IF v_caso.estado = v_nuevo THEN RETURN v_caso; END IF;
  IF v_caso.estado = 'CERRADO' THEN
    RAISE EXCEPTION 'El caso % ya está cerrado.', v_caso.numero;
  END IF;
  IF v_nuevo = 'CERRADO' AND NULLIF(btrim(COALESCE(p_motivo, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Cerrar un caso exige decir por qué.';
  END IF;

  SELECT * INTO v_sla FROM crm_sla WHERE caso_id = p_caso FOR UPDATE;

  -- ── Entrar en espera: se para el reloj ──
  IF v_nuevo = 'EN_ESPERA' THEN
    IF v_sla.id IS NULL THEN
      RAISE EXCEPTION 'El caso % no tiene SLA: no se puede poner en espera.', v_caso.numero;
    END IF;
    IF v_sla.primera_respuesta_at IS NULL THEN
      -- La trampa que esto cierra: poner un caso «en espera» antes de
      -- contestarlo para que el reloj no corra. Para esperar algo de la otra
      -- parte hay que habérselo preguntado, y eso ya es la primera respuesta.
      RAISE EXCEPTION 'No se puede poner en espera un caso sin primera respuesta: para esperar algo de la otra parte hay que haberlo preguntado antes.';
    END IF;
    IF v_sla.pausado_desde IS NULL THEN
      UPDATE crm_sla SET pausado_desde = NOW() WHERE id = v_sla.id;
    END IF;
  END IF;

  -- ── Salir de espera: se suma lo que estuvo parado y se corre el plazo ──
  IF v_caso.estado = 'EN_ESPERA' AND v_nuevo <> 'EN_ESPERA' AND v_sla.pausado_desde IS NOT NULL THEN
    IF v_sla.horas_habiles THEN
      v_parado := public.crm_minutos_habiles(v_sla.pausado_desde, NOW(),
                    v_sla.jornada_desde, v_sla.jornada_hasta, v_sla.zona);
    ELSE
      v_parado := FLOOR(EXTRACT(EPOCH FROM (NOW() - v_sla.pausado_desde)) / 60)::int;
    END IF;
    UPDATE crm_sla SET
      pausado_min   = pausado_min + GREATEST(COALESCE(v_parado, 0), 0),
      pausas        = pausas + 1,
      pausado_desde = NULL
    WHERE id = v_sla.id;
    PERFORM public.crm_sla_calcular(v_sla.id);
  END IF;

  -- ── Resolver o cerrar ──
  IF v_nuevo IN ('RESUELTO','CERRADO') AND v_sla.id IS NOT NULL THEN
    UPDATE crm_sla SET
      resuelto_at   = COALESCE(resuelto_at, NOW()),
      pausado_desde = NULL
    WHERE id = v_sla.id;
  END IF;

  UPDATE crm_casos SET
    estado        = v_nuevo,
    resuelto_at   = CASE WHEN v_nuevo IN ('RESUELTO','CERRADO') THEN COALESCE(resuelto_at, NOW())
                         ELSE NULL END,
    cerrado_at    = CASE WHEN v_nuevo = 'CERRADO' THEN NOW() ELSE NULL END,
    cierre_motivo = CASE WHEN v_nuevo = 'CERRADO' THEN NULLIF(btrim(COALESCE(p_motivo, '')), '')
                         ELSE cierre_motivo END
  WHERE id = p_caso
  RETURNING * INTO v_caso;

  INSERT INTO ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo, actor_usuario_id,
    canal, detalle)
  VALUES (v_caso.grupo_id, v_caso.sede_id, 'crm_casos', v_caso.id, 'CASO_' || v_nuevo,
          CASE WHEN v_quien IS NULL THEN 'SISTEMA' ELSE 'USUARIO' END, v_quien, 'CONSOLA',
          jsonb_build_object('numero', v_caso.numero, 'motivo', p_motivo,
                             'minutos_parado', v_parado));

  PERFORM public.emitir_evento('CRM_CASO_ESTADO',
    jsonb_build_object('numero', v_caso.numero, 'estado', v_nuevo,
                       'asunto', v_caso.asunto, 'motivo', p_motivo,
                       'responsable', v_caso.asignado_nombre,
                       'enlace', '/rondas/crm/' || v_caso.id),
    'crm_casos', v_caso.id::text);

  RETURN v_caso;
END $$;
COMMENT ON FUNCTION public.crm_caso_estado(UUID, TEXT, TEXT, UUID) IS
  'Mueve el estado de un caso y con él el reloj: EN_ESPERA lo para (y exige primera respuesta previa, para que no se use como truco para que no venza), salir de espera suma los minutos HÁBILES parados y corre el plazo, RESUELTO/CERRADO lo sella. Cerrar exige motivo.';
REVOKE ALL ON FUNCTION public.crm_caso_estado(UUID, TEXT, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_caso_estado(UUID, TEXT, TEXT, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 15. La primera respuesta se marca sola
-- ──────────────────────────────────────────────────────────────────────────────
-- Un trigger en `crm_mensajes`, y no un `if` en la pantalla, porque la respuesta
-- puede salir por tres caminos distintos (la consola, el bot de F9, el envío de
-- F10) y los tres tienen que marcar lo mismo.
--
-- QUÉ CUENTA COMO PRIMERA RESPUESTA: un mensaje SALIENTE que de verdad SALIÓ
-- (`ENVIADO`/`ENTREGADO`/`LEIDO`/`SIMULADO`) y que lo inició una PERSONA
-- (`iniciado_por = 'AGENTE'`) o fue una respuesta a lo que la persona escribió
-- (`RESPUESTA`). Un recordatorio automático del bot (`iniciado_por = 'BOT'`) NO
-- cuenta: avisar no es atender, y si contara, el SLA se cumpliría solo.
CREATE OR REPLACE FUNCTION public.crm_marcar_primera_respuesta()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caso crm_casos;
BEGIN
  IF NEW.direccion <> 'SALIENTE' THEN RETURN NEW; END IF;
  IF NEW.estado NOT IN ('ENVIADO','ENTREGADO','LEIDO','SIMULADO') THEN RETURN NEW; END IF;
  IF COALESCE(NEW.iniciado_por, 'BOT') NOT IN ('AGENTE','RESPUESTA') THEN RETURN NEW; END IF;

  SELECT * INTO v_caso FROM crm_casos
   WHERE conversacion_id = NEW.conversacion_id
     AND estado IN ('NUEVO','EN_TRAMITE','EN_ESPERA')
   ORDER BY abierto_at LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;

  UPDATE crm_sla SET primera_respuesta_at = COALESCE(primera_respuesta_at, COALESCE(NEW.enviado_at, NOW()))
   WHERE caso_id = v_caso.id AND primera_respuesta_at IS NULL;

  RETURN NEW;
END $$;
COMMENT ON FUNCTION public.crm_marcar_primera_respuesta() IS
  'Marca crm_sla.primera_respuesta_at cuando sale de verdad un mensaje de una PERSONA (AGENTE) o una respuesta a la persona. Un recordatorio automático del bot NO cuenta: si contara, el SLA se cumpliría solo.';

DROP TRIGGER IF EXISTS tr_crm_primera_respuesta_ins ON crm_mensajes;
CREATE TRIGGER tr_crm_primera_respuesta_ins AFTER INSERT ON crm_mensajes
  FOR EACH ROW EXECUTE FUNCTION crm_marcar_primera_respuesta();
DROP TRIGGER IF EXISTS tr_crm_primera_respuesta_upd ON crm_mensajes;
CREATE TRIGGER tr_crm_primera_respuesta_upd AFTER UPDATE OF estado ON crm_mensajes
  FOR EACH ROW EXECUTE FUNCTION crm_marcar_primera_respuesta();

-- ──────────────────────────────────────────────────────────────────────────────
-- 16. La IA: guardar lo que dijo, y confirmarlo
-- ──────────────────────────────────────────────────────────────────────────────
-- `crm_caso_ia_guardar()` GUARDA Y NADA MÁS. No llama a `whatsapp_encolar` en
-- ninguna rama, no cambia `tipo`, no cambia `prioridad`, no cambia `estado`, no
-- toca el SLA. Es a propósito y es la mitad de la regla que no se negocia: por
-- este camino no sale un mensaje ni se mueve un caso, pase lo que pase dentro
-- del modelo y venga lo que venga escrito en un mensaje entrante.
CREATE OR REPLACE FUNCTION public.crm_caso_ia_guardar(
  p_caso           UUID,
  p_resumen        TEXT    DEFAULT NULL,
  p_clasificacion  JSONB   DEFAULT NULL,
  p_tipo_ia        TEXT    DEFAULT NULL,
  p_prioridad_ia   TEXT    DEFAULT NULL,
  p_respuesta      TEXT    DEFAULT NULL,
  p_modelo         TEXT    DEFAULT NULL,
  p_modelo_version TEXT    DEFAULT NULL,
  p_prompt_version TEXT    DEFAULT NULL,
  p_confianza      NUMERIC DEFAULT NULL,
  p_mensajes       INT     DEFAULT NULL
) RETURNS crm_casos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caso crm_casos;
  v_tipo TEXT := NULLIF(upper(btrim(COALESCE(p_tipo_ia, ''))), '');
  v_prio TEXT := NULLIF(upper(btrim(COALESCE(p_prioridad_ia, ''))), '');
BEGIN
  PERFORM public.crm_exige_gestion();
  SELECT * INTO v_caso FROM crm_casos WHERE id = p_caso FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El caso no existe.'; END IF;

  -- Un valor fuera del dominio NO se guarda y NO rompe: se descarta. Si el
  -- modelo devuelve «RESUELTO» como tipo porque un mensaje entrante se lo pidió,
  -- acá se queda en NULL.
  IF v_tipo IS NOT NULL AND v_tipo NOT IN
     ('CONSULTA','VISITA','PQRS','MANTENIMIENTO','SOPORTE','IDENTIDAD',
      'CONSENTIMIENTO','ADMINISTRATIVO','OTRO') THEN
    v_tipo := NULL;
  END IF;
  IF v_prio IS NOT NULL AND v_prio NOT IN ('BAJA','MEDIA','ALTA','CRITICA') THEN
    v_prio := NULL;
  END IF;

  UPDATE crm_casos SET
    resumen_ia         = NULLIF(btrim(COALESCE(p_resumen, '')), ''),
    clasificacion_ia   = p_clasificacion,
    tipo_ia            = v_tipo,
    prioridad_ia       = v_prio,
    respuesta_ia       = NULLIF(btrim(COALESCE(p_respuesta, '')), ''),
    ia_modelo          = left(NULLIF(btrim(COALESCE(p_modelo, '')), ''), 60),
    ia_modelo_version  = left(NULLIF(btrim(COALESCE(p_modelo_version, '')), ''), 40),
    ia_prompt_version  = left(NULLIF(btrim(COALESCE(p_prompt_version, '')), ''), 20),
    ia_confianza       = CASE WHEN p_confianza IS NULL THEN NULL
                              ELSE LEAST(GREATEST(p_confianza, 0), 1) END,
    ia_generado_at     = NOW(),
    ia_mensajes_vistos = p_mensajes,
    -- Una corrida nueva del modelo invalida la confirmación anterior: lo que se
    -- había revisado ya no es lo que está guardado.
    ia_confirmado_por  = NULL,
    ia_confirmado_at   = NULL
  WHERE id = p_caso
  RETURNING * INTO v_caso;

  INSERT INTO ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo, canal, detalle)
  VALUES (v_caso.grupo_id, v_caso.sede_id, 'crm_casos', v_caso.id, 'IA_SUGIRIO',
          'SISTEMA', 'SISTEMA',
          jsonb_build_object('numero', v_caso.numero, 'modelo', v_caso.ia_modelo,
                             'prompt_version', v_caso.ia_prompt_version,
                             'tipo_ia', v_caso.tipo_ia, 'prioridad_ia', v_caso.prioridad_ia,
                             'confianza', v_caso.ia_confianza,
                             'tiene_respuesta_sugerida', v_caso.respuesta_ia IS NOT NULL));

  RETURN v_caso;
END $$;
COMMENT ON FUNCTION public.crm_caso_ia_guardar(UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, INT) IS
  'Guarda lo que sugirió el modelo en las columnas _ia, con su procedencia. NO envía nada, NO cambia tipo/prioridad/estado y NO toca el SLA: por este camino no sale un mensaje pase lo que pase dentro del modelo. Un valor fuera del dominio se descarta en vez de romper.';
REVOKE ALL ON FUNCTION public.crm_caso_ia_guardar(UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_caso_ia_guardar(UUID, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, INT) TO authenticated;

-- `crm_caso_ia_confirmar()` es donde una PERSONA acepta (o no) la clasificación
-- sugerida. Es el único camino por el que `tipo_ia` llega a `tipo`, y queda con
-- nombre y hora. Si el caso cambia de prioridad, el SLA se recalcula con la
-- regla de la prioridad nueva: un caso que resulta ser CRITICA no puede seguir
-- con el plazo de uno MEDIA.
CREATE OR REPLACE FUNCTION public.crm_caso_ia_confirmar(
  p_caso           UUID,
  p_tipo           TEXT    DEFAULT NULL,
  p_prioridad      TEXT    DEFAULT NULL,
  p_usuario        UUID    DEFAULT NULL,
  p_aplicar_resumen BOOLEAN DEFAULT false
) RETURNS crm_casos
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caso  crm_casos;
  v_sla   crm_sla;
  v_regla crm_sla_reglas;
  v_quien UUID := COALESCE(p_usuario, auth.uid());
  v_tipo  TEXT;
  v_prio  TEXT;
BEGIN
  PERFORM public.crm_exige_gestion();
  IF v_quien IS NULL THEN
    RAISE EXCEPTION 'Confirmar lo que sugirió la IA exige una persona: nada se da por cierto sin confirmación.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = v_quien) THEN
    RAISE EXCEPTION 'Quien confirma tiene que ser un usuario de la plataforma.';
  END IF;

  SELECT * INTO v_caso FROM crm_casos WHERE id = p_caso FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El caso no existe.'; END IF;
  IF v_caso.ia_generado_at IS NULL THEN
    RAISE EXCEPTION 'No hay nada del modelo que confirmar en el caso %.', v_caso.numero;
  END IF;

  v_tipo := COALESCE(NULLIF(upper(btrim(COALESCE(p_tipo, ''))), ''), v_caso.tipo_ia, v_caso.tipo);
  v_prio := COALESCE(NULLIF(upper(btrim(COALESCE(p_prioridad, ''))), ''), v_caso.prioridad_ia, v_caso.prioridad);

  UPDATE crm_casos SET
    tipo              = v_tipo,
    prioridad         = v_prio,
    descripcion       = CASE WHEN p_aplicar_resumen AND resumen_ia IS NOT NULL
                             THEN resumen_ia ELSE descripcion END,
    ia_confirmado_por = v_quien,
    ia_confirmado_at  = NOW()
  WHERE id = p_caso
  RETURNING * INTO v_caso;

  -- ¿Cambió la prioridad? Entonces el plazo es otro.
  SELECT * INTO v_sla FROM crm_sla WHERE caso_id = p_caso FOR UPDATE;
  IF v_sla.id IS NOT NULL AND v_sla.prioridad <> v_caso.prioridad THEN
    v_regla := public.crm_sla_regla(v_caso.grupo_id, v_caso.tipo, v_caso.prioridad);
    UPDATE crm_sla SET
      regla_id                  = COALESCE(v_regla.id, regla_id),
      prioridad                 = v_caso.prioridad,
      minutos_primera_respuesta = COALESCE(v_regla.minutos_primera_respuesta, minutos_primera_respuesta),
      minutos_resolucion        = COALESCE(v_regla.minutos_resolucion, minutos_resolucion),
      horas_habiles             = COALESCE(v_regla.horas_habiles, horas_habiles),
      jornada_desde             = COALESCE(v_regla.jornada_desde, jornada_desde),
      jornada_hasta             = COALESCE(v_regla.jornada_hasta, jornada_hasta)
    WHERE id = v_sla.id;
    PERFORM public.crm_sla_calcular(v_sla.id);
  END IF;

  INSERT INTO ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo, actor_usuario_id,
    canal, detalle)
  VALUES (v_caso.grupo_id, v_caso.sede_id, 'crm_casos', v_caso.id, 'IA_CONFIRMADA',
          'USUARIO', v_quien, 'CONSOLA',
          jsonb_build_object('numero', v_caso.numero, 'tipo', v_caso.tipo,
                             'prioridad', v_caso.prioridad,
                             'tipo_sugerido', v_caso.tipo_ia,
                             'prioridad_sugerida', v_caso.prioridad_ia,
                             'corrigio', (v_caso.tipo IS DISTINCT FROM v_caso.tipo_ia)
                                      OR (v_caso.prioridad IS DISTINCT FROM v_caso.prioridad_ia)));

  RETURN v_caso;
END $$;
COMMENT ON FUNCTION public.crm_caso_ia_confirmar(UUID, TEXT, TEXT, UUID, BOOLEAN) IS
  'Una PERSONA confirma (o corrige) la clasificación sugerida: es el único camino por el que tipo_ia llega a tipo, y queda con nombre y hora. El evento guarda si corrigió al modelo, que es la métrica de si el modelo sirve. Si cambia la prioridad, recalcula el SLA.';
REVOKE ALL ON FUNCTION public.crm_caso_ia_confirmar(UUID, TEXT, TEXT, UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_caso_ia_confirmar(UUID, TEXT, TEXT, UUID, BOOLEAN) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 17. `crm_respuesta_aprobar()` — LA ÚNICA PUERTA
-- ──────────────────────────────────────────────────────────────────────────────
-- Es la única función de este archivo que encola un mensaje, y para hacerlo
-- EXIGE:
--   · `p_aprobado_por` NO NULO y que exista en `usuarios`. Un NULL no pasa, y
--     la llave de servicio no puede fabricar una aprobación sin poner el nombre
--     de una persona de verdad.
--   · un texto no vacío.
--   · que el caso no esté cerrado.
--
-- Y cuando encola, lo hace con `p_iniciado_por => 'AGENTE'`, nunca 'BOT': el
-- criterio de aceptación de la §4 del documento 00 dice literalmente que la
-- respuesta confirmada queda con `autor_tipo = 'AGENTE'`, no BOT.
--
-- Sigue pasando por `whatsapp_encolar()`, o sea por el portero de F9: si está
-- fuera de la ventana de 24 h, fuera de jornada o sin consentimiento, el mensaje
-- nace `OMITIDO_*` y NO sale. Aprobar no se salta el portero.
CREATE OR REPLACE FUNCTION public.crm_respuesta_aprobar(
  p_caso          UUID,
  p_texto         TEXT,
  p_aprobado_por  UUID,
  p_prioridad     INT  DEFAULT 3,
  p_id            UUID DEFAULT NULL
) RETURNS crm_mensajes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caso  crm_casos;
  v_msg   crm_mensajes;
  v_texto TEXT := NULLIF(btrim(COALESCE(p_texto, '')), '');
  v_quien UUID := COALESCE(p_aprobado_por, auth.uid());
BEGIN
  PERFORM public.crm_exige_gestion();
  -- ── El candado. Las tres condiciones, antes de cualquier otra cosa. ──
  IF v_quien IS NULL THEN
    RAISE EXCEPTION 'Una respuesta sugerida por la IA no se envía sola: tiene que aprobarla una persona.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = v_quien) THEN
    RAISE EXCEPTION 'Quien aprueba la respuesta tiene que ser un usuario de la plataforma.';
  END IF;
  -- Nadie aprueba en nombre de otro. Si hay sesión, quien aprueba es quien está
  -- conectado: pasar el id de un compañero dejaría su nombre en una aprobación
  -- que no dio.
  IF (SELECT auth.uid()) IS NOT NULL AND v_quien <> (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'Una respuesta se aprueba en nombre propio, no de otra persona.';
  END IF;
  IF v_texto IS NULL THEN
    RAISE EXCEPTION 'No hay texto que enviar.';
  END IF;

  SELECT * INTO v_caso FROM crm_casos WHERE id = p_caso FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El caso no existe.'; END IF;
  IF v_caso.estado = 'CERRADO' THEN
    RAISE EXCEPTION 'El caso % está cerrado: no se le puede responder.', v_caso.numero;
  END IF;
  IF v_caso.conversacion_id IS NULL THEN
    RAISE EXCEPTION 'El caso % no tiene conversación: no hay a dónde responder.', v_caso.numero;
  END IF;

  -- La salida sigue siendo la de F9, con el portero y todo.
  v_msg := public.whatsapp_encolar(
    p_conversacion => v_caso.conversacion_id,
    p_tipo         => 'TEXTO',
    p_texto        => v_texto,
    p_payload      => jsonb_build_object('tipo', 'TEXTO', 'texto', v_texto,
                                         'caso', v_caso.numero),
    p_iniciado_por => 'AGENTE',
    p_prioridad    => COALESCE(p_prioridad, 3),
    p_id           => p_id);

  UPDATE crm_casos SET
    respuesta_aprobada_por   = v_quien,
    respuesta_aprobada_at    = NOW(),
    respuesta_aprobada_texto = v_texto,
    -- ¿Lo mandó tal cual o lo reescribió? Es la métrica de la §4.1 del ADR-02.
    respuesta_editada        = (respuesta_ia IS NULL) OR (btrim(respuesta_ia) <> v_texto),
    respuesta_mensaje_id     = v_msg.id,
    estado                   = CASE WHEN estado = 'NUEVO' THEN 'EN_TRAMITE' ELSE estado END
  WHERE id = p_caso
  RETURNING * INTO v_caso;

  INSERT INTO ronda_eventos (
    grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo, actor_usuario_id,
    actor_persona_id, canal, detalle)
  VALUES (v_caso.grupo_id, v_caso.sede_id, 'crm_casos', v_caso.id,
          'RESPUESTA_APROBADA', 'USUARIO', v_quien, v_caso.persona_id, 'WHATSAPP',
          jsonb_build_object('numero', v_caso.numero, 'mensaje_id', v_msg.id,
                             'estado_mensaje', v_msg.estado,
                             'editada', v_caso.respuesta_editada,
                             'venia_de_ia', v_caso.respuesta_ia IS NOT NULL));

  RETURN v_msg;
END $$;
COMMENT ON FUNCTION public.crm_respuesta_aprobar(UUID, TEXT, UUID, INT, UUID) IS
  'LA ÚNICA puerta por la que sale una respuesta de un caso. Exige p_aprobado_por no nulo y existente en usuarios: una respuesta sugerida por la IA NUNCA se envía sola. Encola con iniciado_por = AGENTE (no BOT) y sigue pasando por el portero de F9, así que aprobar no se salta la ventana, la jornada ni el consentimiento.';
REVOKE ALL ON FUNCTION public.crm_respuesta_aprobar(UUID, TEXT, UUID, INT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_respuesta_aprobar(UUID, TEXT, UUID, INT, UUID) TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 18. `crm_sla_barrer()` — quién venció
-- ──────────────────────────────────────────────────────────────────────────────
-- La llama un cron. Marca `incumplido` y dispara el evento de notificación, una
-- sola vez por caso (`incumplido = false` en el WHERE), y RESPETA LA PAUSA: un
-- reloj parado no puede vencer.
CREATE OR REPLACE FUNCTION public.crm_sla_barrer(p_limite INT DEFAULT 200)
RETURNS TABLE (caso_id UUID, numero TEXT, que TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fila RECORD;
BEGIN
  FOR v_fila IN
    SELECT s.id AS sla_id, c.id AS caso, c.numero, c.asunto, c.prioridad,
           c.grupo_id, c.sede_id, c.asignado_nombre,
           (s.primera_respuesta_at IS NULL AND s.vence_primera_at    IS NOT NULL
              AND s.vence_primera_at    <= NOW()) AS fallo_primera,
           (s.resuelto_at          IS NULL AND s.vence_resolucion_at IS NOT NULL
              AND s.vence_resolucion_at <= NOW()) AS fallo_resolucion
      FROM crm_sla s
      JOIN crm_casos c ON c.id = s.caso_id
     WHERE s.incumplido = false
       -- El reloj parado NO vence. Es la mitad que se olvida de «se puede
       -- pausar»: si venciera igual, la pausa no serviría de nada.
       AND s.pausado_desde IS NULL
       AND c.estado IN ('NUEVO','EN_TRAMITE')
     ORDER BY LEAST(COALESCE(s.vence_primera_at, 'infinity'::timestamptz),
                    COALESCE(s.vence_resolucion_at, 'infinity'::timestamptz))
     LIMIT GREATEST(COALESCE(p_limite, 200), 1)
  LOOP
    CONTINUE WHEN NOT (v_fila.fallo_primera OR v_fila.fallo_resolucion);

    UPDATE crm_sla SET
      incumplido     = true,
      incumplido_que = CASE WHEN v_fila.fallo_primera AND v_fila.fallo_resolucion THEN 'AMBOS'
                            WHEN v_fila.fallo_primera THEN 'PRIMERA' ELSE 'RESOLUCION' END,
      incumplido_at  = NOW()
    WHERE id = v_fila.sla_id;

    INSERT INTO ronda_eventos (
      grupo_id, sede_id, entidad, entidad_id, accion, actor_tipo, canal, detalle)
    VALUES (v_fila.grupo_id, v_fila.sede_id, 'crm_casos', v_fila.caso,
            'SLA_INCUMPLIDO', 'SISTEMA', 'SISTEMA',
            jsonb_build_object('numero', v_fila.numero,
                               'que', CASE WHEN v_fila.fallo_primera AND v_fila.fallo_resolucion THEN 'AMBOS'
                                           WHEN v_fila.fallo_primera THEN 'PRIMERA' ELSE 'RESOLUCION' END));

    PERFORM public.emitir_evento('CRM_SLA_INCUMPLIDO',
      jsonb_build_object('numero', v_fila.numero, 'asunto', v_fila.asunto,
                         'prioridad', v_fila.prioridad,
                         'responsable', COALESCE(v_fila.asignado_nombre, 'Sin asignar'),
                         'que', CASE WHEN v_fila.fallo_primera AND v_fila.fallo_resolucion THEN 'AMBOS'
                                     WHEN v_fila.fallo_primera THEN 'PRIMERA' ELSE 'RESOLUCION' END,
                         'enlace', '/rondas/crm/' || v_fila.caso),
      'crm_casos', v_fila.caso::text);

    RETURN QUERY SELECT v_fila.caso, v_fila.numero::text,
      (CASE WHEN v_fila.fallo_primera AND v_fila.fallo_resolucion THEN 'AMBOS'
            WHEN v_fila.fallo_primera THEN 'PRIMERA' ELSE 'RESOLUCION' END)::text;
  END LOOP;
END $$;
COMMENT ON FUNCTION public.crm_sla_barrer(INT) IS
  'Marca los SLA vencidos y dispara CRM_SLA_INCUMPLIDO, una sola vez por caso. RESPETA LA PAUSA: un reloj parado no vence, porque si venciera igual la pausa no serviría de nada.';
REVOKE ALL ON FUNCTION public.crm_sla_barrer(INT) FROM PUBLIC;

-- ──────────────────────────────────────────────────────────────────────────────
-- 19. Vistas de la bandeja — contar en SQL, nunca traer filas
-- ──────────────────────────────────────────────────────────────────────────────
-- Supabase corta a los 8 segundos y la bandeja es justo donde eso muerde: es la
-- pantalla que alguien deja abierta todo el día con todos los casos del mes.
CREATE OR REPLACE VIEW crm_resumen_bandeja AS
SELECT
  c.grupo_id,
  COUNT(*)                                                          AS casos,
  COUNT(*) FILTER (WHERE c.estado = 'NUEVO')                        AS nuevos,
  COUNT(*) FILTER (WHERE c.estado = 'EN_TRAMITE')                   AS en_tramite,
  COUNT(*) FILTER (WHERE c.estado = 'EN_ESPERA')                    AS en_espera,
  COUNT(*) FILTER (WHERE c.estado = 'RESUELTO')                     AS resueltos,
  COUNT(*) FILTER (WHERE c.estado = 'CERRADO')                      AS cerrados,
  COUNT(*) FILTER (WHERE c.estado IN ('NUEVO','EN_TRAMITE','EN_ESPERA')
                     AND c.asignado_a IS NULL)                      AS sin_asignar,
  COUNT(*) FILTER (WHERE c.grupo_id IS NULL)                        AS sin_contrato,
  COUNT(*) FILTER (WHERE s.incumplido)                              AS incumplidos,
  COUNT(*) FILTER (WHERE s.pausado_desde IS NOT NULL)               AS en_pausa,
  -- Lo que vence hoy y todavía no se contestó: es la cola real del día.
  COUNT(*) FILTER (WHERE s.primera_respuesta_at IS NULL
                     AND s.incumplido = false
                     AND s.pausado_desde IS NULL
                     AND s.vence_primera_at <= NOW() + interval '8 hours') AS vencen_pronto,
  -- Sugerencias de la IA esperando que alguien las apruebe o las descarte.
  COUNT(*) FILTER (WHERE c.respuesta_ia IS NOT NULL
                     AND c.respuesta_aprobada_at IS NULL
                     AND c.estado <> 'CERRADO')                     AS sugerencias_por_revisar
FROM crm_casos c
LEFT JOIN crm_sla s ON s.caso_id = c.id
GROUP BY c.grupo_id;

COMMENT ON VIEW crm_resumen_bandeja IS
  'Totales de la bandeja por contrato, contados en SQL. Supabase corta a los 8 segundos: una bandeja que trae las filas para contarlas en JavaScript es una bandeja que un día deja de cargar.';

-- La fila de la bandeja, ya resuelta: el caso, su conversación, su reloj y las
-- etiquetas agregadas en SQL (un array, no una consulta por fila).
-- Se suelta antes de recrearla: `CREATE OR REPLACE VIEW` no admite agregar
-- una columna en medio de la lista, y esta vista ya se publicó con menos.
DROP VIEW IF EXISTS crm_bandeja;
CREATE OR REPLACE VIEW crm_bandeja AS
SELECT
  c.id, c.numero, c.conversacion_id, c.canal, c.tipo, c.estado, c.prioridad,
  c.grupo_id, c.sede_id, c.persona_id, c.contacto_nombre, c.asunto,
  c.asignado_a, c.asignado_nombre, c.abierto_at, c.resuelto_at, c.cerrado_at,
  c.updated_at,
  c.resumen_ia, c.tipo_ia, c.prioridad_ia, c.ia_confianza, c.ia_generado_at,
  c.ia_confirmado_at,
  (c.respuesta_ia IS NOT NULL)                       AS tiene_sugerencia,
  (c.respuesta_ia IS NOT NULL
     AND c.respuesta_aprobada_at IS NULL)            AS sugerencia_por_aprobar,
  c.respuesta_aprobada_at,
  g.codigo       AS contrato_codigo,
  g.nombre       AS contrato_nombre,
  sd.nombre      AS sede_nombre,
  cv.wa_id, cv.perfil_nombre, cv.estado AS conversacion_estado,
  cv.ultimo_entrante_at, cv.ventana_vence_at, cv.mensajes_entrantes,
  s.prioridad AS sla_prioridad, s.minutos_primera_respuesta, s.minutos_resolucion,
  s.horas_habiles, s.vence_primera_at, s.vence_resolucion_at,
  s.primera_respuesta_at, s.pausado_min, s.pausado_desde, s.pausas,
  s.incumplido, s.incumplido_que, s.incumplido_at,
  -- La franja y el arranque van en la vista para que la PANTALLA pueda decir
  -- «te quedan 3 horas hábiles» con la misma aritmética que calculó el plazo
  -- (lib/crm/sla.ts). Sin esto, la lista solo podría mostrar reloj de pared, y
  -- «143 h» para un plazo de «4 días hábiles» confunde más de lo que informa.
  s.arranca_at AS sla_arranca_at, s.jornada_desde, s.jornada_hasta, s.zona AS sla_zona,
  (s.pausado_desde IS NOT NULL)                      AS reloj_en_pausa,
  -- Minutos de RELOJ DE PARED que faltan. Se dejan porque sirven para ordenar
  -- y para filtrar en SQL; lo que se MUESTRA se calcula en hábiles.
  CASE WHEN s.primera_respuesta_at IS NULL AND s.vence_primera_at IS NOT NULL
       THEN FLOOR(EXTRACT(EPOCH FROM (s.vence_primera_at - NOW())) / 60)::int END AS min_para_primera,
  CASE WHEN s.resuelto_at IS NULL AND s.vence_resolucion_at IS NOT NULL
       THEN FLOOR(EXTRACT(EPOCH FROM (s.vence_resolucion_at - NOW())) / 60)::int END AS min_para_resolucion,
  COALESCE(e.etiquetas, '[]'::jsonb)                 AS etiquetas
FROM crm_casos c
LEFT JOIN crm_sla s           ON s.caso_id = c.id
LEFT JOIN crm_conversaciones cv ON cv.id = c.conversacion_id
LEFT JOIN grupos_contrato g   ON g.id = c.grupo_id
LEFT JOIN sedes sd            ON sd.id = c.sede_id
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object('codigo', et.codigo, 'nombre', et.nombre,
                                      'color', et.color, 'origen', ce.origen)
                   ORDER BY et.codigo) AS etiquetas
    FROM crm_caso_etiquetas ce
    JOIN crm_etiquetas et ON et.id = ce.etiqueta_id
   WHERE ce.caso_id = c.id
) e ON true;

COMMENT ON VIEW crm_bandeja IS
  'La fila de la bandeja ya resuelta: caso + conversación + contrato + reloj + etiquetas agregadas en SQL. Hereda la RLS de crm_casos.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 20. RLS
-- ──────────────────────────────────────────────────────────────────────────────
-- `auth_permiso()` TAMBIÉN en las lecturas, que es la regla del repositorio, y
-- las llamadas ENVUELTAS en `(SELECT …)` para que se evalúen una vez por
-- consulta y no una por fila (migración 20261028000001; `scripts/
-- generar-rls-envuelta.mjs` lo comprueba y hoy reporta 0 pendientes).
--
-- Las ESCRITURAS de casos, asignaciones y SLA NO tienen política: entran por las
-- funciones SECURITY DEFINER de arriba. Es lo que garantiza que no haya una
-- segunda puerta para enviar una respuesta ni para mover un reloj.
--
-- El catálogo (etiquetas y reglas de SLA) SÍ se escribe por RLS, con
-- `parametrizar_crm`: es parametrización, no operación, y no hay máquina de
-- estados que proteger.
--
-- Un caso sin contrato conocido lo ve solo quien gestiona, igual que una
-- conversación sin contrato en F9: no hay alcance con el que filtrarlo.
ALTER TABLE crm_etiquetas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sla_reglas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_casos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_caso_etiquetas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_asignaciones    ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sla             ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_etiquetas_read ON crm_etiquetas;
CREATE POLICY crm_etiquetas_read ON crm_etiquetas
  FOR SELECT TO authenticated
  USING ((SELECT public.crm_acceso())
         AND (grupo_id IS NULL OR (SELECT public.auth_ve_grupo(crm_etiquetas.grupo_id))));
DROP POLICY IF EXISTS crm_etiquetas_write ON crm_etiquetas;
CREATE POLICY crm_etiquetas_write ON crm_etiquetas
  FOR ALL TO authenticated
  USING ((SELECT public.crm_parametriza()))
  WITH CHECK ((SELECT public.crm_parametriza())
              AND (grupo_id IS NULL OR (SELECT public.auth_ve_grupo(crm_etiquetas.grupo_id))));

DROP POLICY IF EXISTS crm_sla_reglas_read ON crm_sla_reglas;
CREATE POLICY crm_sla_reglas_read ON crm_sla_reglas
  FOR SELECT TO authenticated
  USING ((SELECT public.crm_acceso())
         AND (grupo_id IS NULL OR (SELECT public.auth_ve_grupo(crm_sla_reglas.grupo_id))));
DROP POLICY IF EXISTS crm_sla_reglas_write ON crm_sla_reglas;
CREATE POLICY crm_sla_reglas_write ON crm_sla_reglas
  FOR ALL TO authenticated
  USING ((SELECT public.crm_parametriza()))
  WITH CHECK ((SELECT public.crm_parametriza())
              AND (grupo_id IS NULL OR (SELECT public.auth_ve_grupo(crm_sla_reglas.grupo_id))));

DROP POLICY IF EXISTS crm_casos_read ON crm_casos;
CREATE POLICY crm_casos_read ON crm_casos
  FOR SELECT TO authenticated
  USING ((SELECT public.crm_acceso())
         AND (CASE WHEN grupo_id IS NULL THEN (SELECT public.crm_gestiona())
                   ELSE (SELECT public.auth_ve_grupo(crm_casos.grupo_id)) END));

DROP POLICY IF EXISTS crm_caso_etiquetas_read ON crm_caso_etiquetas;
CREATE POLICY crm_caso_etiquetas_read ON crm_caso_etiquetas
  FOR SELECT TO authenticated
  USING ((SELECT public.crm_acceso()) AND EXISTS (
    SELECT 1 FROM public.crm_casos c
     WHERE c.id = crm_caso_etiquetas.caso_id
       AND (CASE WHEN c.grupo_id IS NULL THEN (SELECT public.crm_gestiona())
                 ELSE (SELECT public.auth_ve_grupo(c.grupo_id)) END)));

DROP POLICY IF EXISTS crm_asignaciones_read ON crm_asignaciones;
CREATE POLICY crm_asignaciones_read ON crm_asignaciones
  FOR SELECT TO authenticated
  USING ((SELECT public.crm_acceso()) AND EXISTS (
    SELECT 1 FROM public.crm_casos c
     WHERE c.id = crm_asignaciones.caso_id
       AND (CASE WHEN c.grupo_id IS NULL THEN (SELECT public.crm_gestiona())
                 ELSE (SELECT public.auth_ve_grupo(c.grupo_id)) END)));

DROP POLICY IF EXISTS crm_sla_read ON crm_sla;
CREATE POLICY crm_sla_read ON crm_sla
  FOR SELECT TO authenticated
  USING ((SELECT public.crm_acceso()) AND EXISTS (
    SELECT 1 FROM public.crm_casos c
     WHERE c.id = crm_sla.caso_id
       AND (CASE WHEN c.grupo_id IS NULL THEN (SELECT public.crm_gestiona())
                 ELSE (SELECT public.auth_ve_grupo(c.grupo_id)) END)));

-- Las vistas heredan la RLS de sus tablas, pero hay que poder leerlas.
GRANT SELECT ON crm_resumen_bandeja TO authenticated;
GRANT SELECT ON crm_bandeja         TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────────
-- 21. Realtime: la bandeja ve llegar un caso sin recargar
-- ──────────────────────────────────────────────────────────────────────────────
-- Solo las dos tablas que la pantalla ESCUCHA de verdad. La migración
-- 20261028000020 sacó de la publicación las tablas que nadie escuchaba: una
-- tabla publicada sin suscriptor solo cuesta en cada escritura.
ALTER TABLE crm_casos REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE crm_casos;
EXCEPTION WHEN duplicate_object THEN null; WHEN undefined_object THEN null; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE crm_mensajes;
EXCEPTION WHEN duplicate_object THEN null; WHEN undefined_object THEN null; END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- 22. Eventos del catálogo de notificaciones
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO eventos_notificacion (codigo, nombre, descripcion, modulo, variables) VALUES
  ('CRM_CASO_ABIERTO', 'Caso del CRM abierto',
   'Se abrió un caso sobre una conversación: el bot derivó a un agente, avisó al supervisor, o alguien lo abrió desde la consola.',
   'CRM',
   '[{"clave":"numero","descripcion":"Número del caso (CS-…)"},{"clave":"tipo","descripcion":"CONSULTA / VISITA / PQRS / MANTENIMIENTO / SOPORTE / IDENTIDAD / CONSENTIMIENTO / ADMINISTRATIVO / OTRO"},{"clave":"prioridad","descripcion":"BAJA / MEDIA / ALTA / CRITICA"},{"clave":"asunto","descripcion":"Asunto"},{"clave":"motivo","descripcion":"Por qué se abrió"},{"clave":"canal","descripcion":"Por dónde llegó"},{"clave":"enlace","descripcion":"Ruta del caso"}]'),
  ('CRM_CASO_ESTADO', 'Cambio en un caso del CRM',
   'Un caso cambió de estado: entró en trámite, quedó en espera, se resolvió o se cerró.',
   'CRM',
   '[{"clave":"numero","descripcion":"Número del caso"},{"clave":"estado","descripcion":"Estado nuevo"},{"clave":"asunto","descripcion":"Asunto"},{"clave":"motivo","descripcion":"Motivo del cambio"},{"clave":"responsable","descripcion":"Quién lo atiende"},{"clave":"enlace","descripcion":"Ruta del caso"}]'),
  ('CRM_SLA_INCUMPLIDO', 'SLA de un caso incumplido',
   'Un caso pasó su tope de primera respuesta o de resolución sin cumplirlo. No se dispara si el reloj estaba en pausa.',
   'CRM',
   '[{"clave":"numero","descripcion":"Número del caso"},{"clave":"asunto","descripcion":"Asunto"},{"clave":"prioridad","descripcion":"Prioridad del caso"},{"clave":"responsable","descripcion":"Quién lo atiende (o «Sin asignar»)"},{"clave":"que","descripcion":"PRIMERA / RESOLUCION / AMBOS"},{"clave":"enlace","descripcion":"Ruta del caso"}]')
ON CONFLICT (codigo) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- 23. Permisos en los roles
-- ──────────────────────────────────────────────────────────────────────────────
-- `defaults || permisos`: lo que ya esté puesto gana, así que re-aplicar la
-- migración no revive un permiso que un administrador haya apagado a mano.
UPDATE public.roles
   SET permisos = jsonb_build_object('ver_crm', true, 'gestionar_crm', true) || permisos
 WHERE nombre IN ('Administrador', 'Gerencia', 'Supervisor de Conserjería');

-- `parametrizar_crm` solo a quien define el contrato: un tope de SLA cambia el
-- plazo de todo lo que se abra después.
UPDATE public.roles
   SET permisos = jsonb_build_object('parametrizar_crm', true) || permisos
 WHERE nombre IN ('Administrador', 'Gerencia');

-- Auditor: lee y no toca, el mismo criterio de PQRS, del catálogo de rondas y
-- de WhatsApp.
UPDATE public.roles
   SET permisos = permisos || '{"ver_crm": true}'::jsonb
 WHERE nombre = 'Auditor';

-- ──────────────────────────────────────────────────────────────────────────────
-- 24. Semillas: etiquetas y las reglas de SLA por defecto
-- ──────────────────────────────────────────────────────────────────────────────
-- Etiquetas generales (`grupo_id` NULL = aplican a todos los contratos). Son
-- las que la operación necesita el primer día; cada contrato puede agregar las
-- suyas desde la pantalla.
INSERT INTO crm_etiquetas (codigo, nombre, color, descripcion) VALUES
  ('URGENTE',        'Urgente',             '#DC2626', 'Hay que atenderlo hoy.'),
  ('SIN_IDENTIFICAR','Sin identificar',     '#D97706', 'No se sabe todavía quién escribe ni de qué contrato es.'),
  ('REINCIDENTE',    'Reincidente',         '#7C3AED', 'Ya había escrito por lo mismo.'),
  ('ESPERA_CLIENTE', 'Esperando al cliente','#0891B2', 'El reloj está parado esperando algo de la otra parte.'),
  ('ESCALADO',       'Escalado',            '#BE123C', 'Pasó a un nivel superior.'),
  ('CAPACITACION',   'Capacitación',        '#059669', 'Se resuelve explicando, no arreglando.'),
  ('FUERA_DE_ALCANCE','Fuera de alcance',   '#64748B', 'No es algo que cubra el contrato.')
ON CONFLICT DO NOTHING;

-- Las reglas por defecto (`grupo_id` NULL, `tipo` NULL): una por prioridad.
-- Los minutos están en HÁBILES, con la franja 08:00–17:00 de lunes a viernes,
-- que son 540 minutos por día hábil. O sea:
--   CRITICA  — 30 min para contestar,  1 día hábil para resolver
--   ALTA     —  2 h  para contestar,   2 días hábiles
--   MEDIA    —  4 h  para contestar,   4 días hábiles (el de PQRS, a escala)
--   BAJA     —  1 día hábil,           8 días hábiles
--
-- Son un punto de partida, NO una decisión de negocio: quien tenga el contrato
-- en la mano los ajusta desde /rondas/crm. Queda anotado en el informe.
INSERT INTO crm_sla_reglas (grupo_id, tipo, prioridad, minutos_primera_respuesta,
                            minutos_resolucion, horas_habiles, observacion) VALUES
  (NULL, NULL, 'CRITICA',  30,  540, true, 'Por defecto: 30 minutos para contestar, 1 día hábil para resolver.'),
  (NULL, NULL, 'ALTA',    120, 1080, true, 'Por defecto: 2 horas hábiles para contestar, 2 días hábiles para resolver.'),
  (NULL, NULL, 'MEDIA',   240, 2160, true, 'Por defecto: 4 horas hábiles para contestar, 4 días hábiles para resolver.'),
  (NULL, NULL, 'BAJA',    540, 4320, true, 'Por defecto: 1 día hábil para contestar, 8 días hábiles para resolver.')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- Fin de F11.
-- =============================================================================
