-- =============================================================================
-- PUNTOS QR — F3: LA LLAVE FORÁNEA DE LAS ASIGNACIONES AL PUNTO
-- =============================================================================
-- Migración de COSTURA entre F2 y F3, aparte y a propósito.
--
-- `ronda_asignaciones.punto_id` apunta a `ronda_puntos`, que es de F2 y se
-- escribió en otra rama. En la rama de F3 esa tabla no existe, así que declarar
-- la restricción en 20261019000030 habría dejado una migración que no corre.
-- Esto se aplica DESPUÉS de las dos (de ahí el número) y solo agrega la
-- restricción; si por lo que sea `ronda_puntos` todavía no está, no falla: avisa
-- y se vuelve a correr cuando F2 esté.
--
-- Qué NO hace: no comprueba que `grupo_id` y `sede_id` de la asignación
-- coincidan con los del punto. Son columnas desnormalizadas por decisión de
-- §2.4 del complemento 2 y cuadrarlas pide una llave foránea compuesta contra
-- un índice único de `ronda_puntos(id, grupo_id, sede_id)` que esta migración no
-- puede dar por hecho. Queda anotado para F4, que es quien lee las dos cosas a
-- la vez al abrir una visita.
--
-- IDEMPOTENTE: se puede repetir sin efecto.
-- =============================================================================

SET search_path TO public;

DO $$
BEGIN
  IF to_regclass('public.ronda_puntos') IS NULL THEN
    RAISE NOTICE 'ronda_puntos todavía no existe (falta aplicar F2): la llave foránea de ronda_asignaciones.punto_id queda pendiente. Vuelve a correr esta migración después de F2.';
    RETURN;
  END IF;

  IF to_regclass('public.ronda_asignaciones') IS NULL THEN
    RAISE NOTICE 'ronda_asignaciones todavía no existe (falta aplicar F3): nada que hacer.';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_ronda_asignaciones_punto'
       AND conrelid = 'public.ronda_asignaciones'::regclass
  ) THEN
    RETURN;                                   -- ya está
  END IF;

  -- ON DELETE CASCADE: si se retira un punto de control, sus asignaciones ya no
  -- significan nada. El histórico de lo ejecutado no vive aquí sino en las
  -- visitas de F4, que guardan la plantilla y el punto por su cuenta.
  ALTER TABLE public.ronda_asignaciones
    ADD CONSTRAINT fk_ronda_asignaciones_punto
    FOREIGN KEY (punto_id) REFERENCES public.ronda_puntos(id) ON DELETE CASCADE;

  RAISE NOTICE 'Agregada fk_ronda_asignaciones_punto (ronda_asignaciones.punto_id → ronda_puntos.id).';
END $$;
