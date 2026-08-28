-- =============================================================================
-- LÍMITE DE ENVÍOS EN EL SIMULADOR DE EMPRESAS
-- =============================================================================
-- `POST /api/empresas/cotizar` es público: cualquiera puede crear una cotización
-- sin sesión. Sin freno, un script puede llenar la tabla de basura y ahogar los
-- leads reales.
--
-- Para contar envíos por origen hace falta guardar algo del remitente. Se guarda
-- un **hash** de la IP, no la IP: alcanza para contar cuántas veces vino el
-- mismo origen en la última hora, y no deja direcciones en claro en la base
-- (dato personal bajo la Ley 1581 de 2012).
--
-- Idempotente: se puede repetir sin efecto.
-- =============================================================================

ALTER TABLE empresas_cotizacion
  ADD COLUMN IF NOT EXISTS ip_hash TEXT;

COMMENT ON COLUMN empresas_cotizacion.ip_hash IS
  'SHA-256 de la IP del remitente, con sal. Solo para limitar envíos; nunca se guarda la IP en claro.';

-- El limitador pregunta: ¿cuántas filas de este ip_hash en la última hora?
-- El índice hace que esa cuenta no recorra la tabla entera.
CREATE INDEX IF NOT EXISTS idx_empresas_cotizacion_ip_hash_fecha
  ON empresas_cotizacion (ip_hash, created_at DESC);

-- El limitador también cuenta por correo, para el caso de quien rota de IP pero
-- reenvía el mismo formulario.
CREATE INDEX IF NOT EXISTS idx_empresas_cotizacion_email_fecha
  ON empresas_cotizacion (contacto_email, created_at DESC);
