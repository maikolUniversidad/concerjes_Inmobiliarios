-- =============================================================================
-- Foto de perfil / tipo carnet del candidato
-- =============================================================================
-- Guarda la selfie capturada con la cámara para (a) usarla como foto de perfil
-- y del carnet, y (b) poder PROCESARLA DESPUÉS (generar el embedding facial)
-- cuando el motor de comparación esté disponible.
--
-- Nota legal: la foto tipo carnet tiene finalidad propia (identificación) y no
-- depende del consentimiento biométrico. Ese consentimiento SOLO se requiere
-- para convertirla en un vector y hacer búsqueda 1:N — por eso el proceso
-- posterior debe filtrar por consentimientos.tipo='BIOMETRICO' AND otorgado.
-- =============================================================================

ALTER TABLE candidatos
  ADD COLUMN IF NOT EXISTS foto_perfil_path TEXT,
  ADD COLUMN IF NOT EXISTS foto_perfil_at   TIMESTAMPTZ;

-- Cola de trabajo para el procesamiento facial futuro: candidatos con foto,
-- con consentimiento biométrico vigente y sin embedding todavía.
CREATE OR REPLACE VIEW vac_fotos_por_procesar AS
SELECT c.id AS candidato_id,
       c.foto_perfil_path,
       c.foto_perfil_at
FROM candidatos c
WHERE c.foto_perfil_path IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM registros_faciales rf WHERE rf.candidato_id = c.id)
  AND EXISTS (
    SELECT 1 FROM consentimientos k
    WHERE k.candidato_id = c.id
      AND k.tipo = 'BIOMETRICO'
      AND k.otorgado
      AND k.revocado_at IS NULL
  );
