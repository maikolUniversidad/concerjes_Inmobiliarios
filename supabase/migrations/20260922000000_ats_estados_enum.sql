-- =============================================================================
-- ATS · Estados del candidato: tres fases que faltaban frente al proceso real
-- =============================================================================
-- El proceso que corre hoy la empresa (levantado el 2026-09-22 desde
-- conserjesats.com) tiene fases que el enum no representaba:
--
--   EN_PRUEBAS   → el candidato está presentando la prueba de aptitud y la de
--                  conocimientos (entre Postulación y Revisión documental).
--   ENTREVISTA   → fase psicológica / entrevista con el formato de entrevista.
--   SEGURIDAD    → estudio de seguridad AAA (nivel de riesgo + reseña).
--
-- Va en una migración aparte a propósito: `ALTER TYPE … ADD VALUE` se puede
-- ejecutar dentro de una transacción, pero el valor nuevo NO se puede usar
-- hasta que esa transacción haga commit. La migración siguiente ya los usa.
-- =============================================================================

ALTER TYPE estado_candidato ADD VALUE IF NOT EXISTS 'EN_PRUEBAS' AFTER 'POSTULADO';
ALTER TYPE estado_candidato ADD VALUE IF NOT EXISTS 'ENTREVISTA' AFTER 'EN_VERIFICACION';
ALTER TYPE estado_candidato ADD VALUE IF NOT EXISTS 'SEGURIDAD'  AFTER 'ENTREVISTA';
