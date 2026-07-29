-- Estos ALTER TYPE deben correr en una transacción separada antes de que
-- la migración principal pueda usar los nuevos valores.
-- PostgreSQL no permite usar un valor nuevo de enum en la misma transacción
-- donde fue agregado (error 55P04).

ALTER TYPE rol_usuario            ADD VALUE IF NOT EXISTS 'CONDUCTOR';
ALTER TYPE estado_orden_insumo    ADD VALUE IF NOT EXISTS 'EN_RUTA'    AFTER 'DESPACHADO';
ALTER TYPE estado_orden_insumo    ADD VALUE IF NOT EXISTS 'ENTREGADO'  AFTER 'EN_RUTA';
