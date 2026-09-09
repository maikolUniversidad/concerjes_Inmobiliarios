-- =============================================================================
-- DURACIÓN DEL VIDEO DE DESPACHO
-- =============================================================================
-- El video de despacho es la evidencia de que el pedido salió, y hasta ahora la
-- aplicación aceptaba cualquier archivo sin mirarlo. Resultado: de 132 videos
-- grabados, 100 pesaban menos de 50 KB y dos eran 110 bytes — la pura cabecera,
-- sin un solo fotograma. En pantalla se veían como un rectángulo negro.
--
-- La causa estaba en la pantalla de grabación (un mismo botón abría la cámara y
-- arrancaba la grabación, y el segundo clic impaciente la detenía en el acto),
-- pero el agujero de fondo es que nadie validaba el resultado. Guardar la
-- duración permite: (1) rechazar de entrada un video que no alcanza a probar
-- nada, y (2) señalar los que ya quedaron mal en vez de mostrar un negro mudo.
--
-- IDEMPOTENTE: se puede repetir sin efecto.
-- =============================================================================

SET search_path TO public;

ALTER TABLE ordenes_insumo
  ADD COLUMN IF NOT EXISTS video_duracion_s NUMERIC(8,2);

COMMENT ON COLUMN ordenes_insumo.video_duracion_s IS
  'Duración del video de despacho en segundos. NULL = grabado antes de que se midiera, o no se pudo leer. Por debajo de VIDEO_MIN_SEGUNDOS el video no prueba nada.';

-- Órdenes despachadas cuyo video no sirve como evidencia.
--
-- El filtro va por `despachado_at`, NO por `estado = 'DESPACHADO'`: una orden
-- que ya siguió su curso (en ruta, entregada, recibida) cambió de estado pero
-- su video sigue siendo la evidencia de que salió. Filtrar por el estado actual
-- dejaba fuera a once de ellas.
--
-- El criterio principal es la duración medida; el peso solo se usa como
-- respaldo para un video que todavía no se haya medido.
DROP VIEW IF EXISTS vw_despachos_sin_evidencia;
CREATE VIEW vw_despachos_sin_evidencia AS
SELECT
  o.id,
  o.numero,
  o.estado,
  o.despachado_at,
  o.despachado_por,
  u.nombre                      AS despachado_por_nombre,
  s.nombre                      AS sede,
  o.video_path,
  o.video_duracion_s,
  (obj.metadata ->> 'size')::BIGINT AS bytes,
  CASE
    WHEN o.video_path IS NULL          THEN 'SIN_VIDEO'
    WHEN obj.id IS NULL                THEN 'ARCHIVO_PERDIDO'
    WHEN o.video_duracion_s = 0        THEN 'VIDEO_VACIO'
    WHEN o.video_duracion_s < 3        THEN 'VIDEO_MUY_CORTO'
    ELSE 'VIDEO_SIN_MEDIR_Y_LIVIANO'
  END AS motivo
FROM ordenes_insumo o
LEFT JOIN usuarios u ON u.id = o.despachado_por
LEFT JOIN sedes    s ON s.id = o.sede_id
LEFT JOIN storage.objects obj
       ON obj.bucket_id = 'ordenes-insumo' AND obj.name = o.video_path
WHERE o.despachado_at IS NOT NULL
  AND (
    o.video_path IS NULL
    OR obj.id IS NULL
    OR o.video_duracion_s < 3
    OR (o.video_duracion_s IS NULL AND (obj.metadata ->> 'size')::BIGINT < 51200)
  );

GRANT SELECT ON vw_despachos_sin_evidencia TO authenticated, service_role;
