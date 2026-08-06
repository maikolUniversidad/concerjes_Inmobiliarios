-- =============================================================================
-- CONTRATOS CON CÓDIGO LIBRE
-- =============================================================================
-- Hasta ahora `grupos_contrato.codigo` era el enum `grupo_contrato` con solo 5
-- valores fijos (CA, MO, MB, PB, AD) y UNIQUE, así que no se podían crear más de
-- 5 contratos ni códigos nuevos. Se convierte a texto libre para permitir dar de
-- alta cualquier contrato desde la aplicación. La restricción UNIQUE se conserva.
-- Idempotente: si ya es varchar, el ALTER TYPE es inofensivo.
-- =============================================================================

ALTER TABLE grupos_contrato
  ALTER COLUMN codigo TYPE varchar(20) USING codigo::text;

ALTER TABLE grupos_contrato
  ALTER COLUMN codigo SET NOT NULL;

-- (El tipo enum `grupo_contrato` queda definido pero sin uso; no se elimina para
--  no afectar despliegues o funciones que aún pudieran referenciarlo.)
