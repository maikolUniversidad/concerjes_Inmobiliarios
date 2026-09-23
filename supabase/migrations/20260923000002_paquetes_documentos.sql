-- =============================================================================
-- Paquete de contratación: en qué orden se descargan los documentos del
-- candidato en un solo PDF (formatos generados, documentos subidos y
-- resultados de las pruebas). RRHH guarda varios órdenes y uno queda como
-- predeterminado. Se usa en el expediente, etapa Contratación.
-- =============================================================================

CREATE TABLE IF NOT EXISTS paquetes_documentos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre         VARCHAR(150) NOT NULL,
  descripcion    TEXT,
  -- [{"tipo":"plantilla","codigo":"HOJA_VIDA"},{"tipo":"documento","codigo":"CEDULA"},{"tipo":"prueba","codigo":"APTITUD"}]
  items          JSONB NOT NULL DEFAULT '[]',
  predeterminado BOOLEAN NOT NULL DEFAULT false,
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_por     UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT paquetes_items_arreglo CHECK (jsonb_typeof(items) = 'array')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_paquetes_nombre ON paquetes_documentos (lower(nombre));
CREATE UNIQUE INDEX IF NOT EXISTS uq_paquetes_predeterminado ON paquetes_documentos (predeterminado) WHERE predeterminado;

DROP TRIGGER IF EXISTS tr_paquetes_upd ON paquetes_documentos;
CREATE TRIGGER tr_paquetes_upd BEFORE UPDATE ON paquetes_documentos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Solo uno es el predeterminado: al marcar uno se desmarca el anterior.
CREATE OR REPLACE FUNCTION public.paquetes_un_predeterminado() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE paquetes_documentos SET predeterminado = false WHERE predeterminado AND id <> NEW.id;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS tr_paquetes_predeterminado ON paquetes_documentos;
CREATE TRIGGER tr_paquetes_predeterminado BEFORE INSERT OR UPDATE OF predeterminado ON paquetes_documentos
  FOR EACH ROW WHEN (NEW.predeterminado) EXECUTE FUNCTION public.paquetes_un_predeterminado();

ALTER TABLE paquetes_documentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS paquetes_read ON paquetes_documentos;
CREATE POLICY paquetes_read ON paquetes_documentos FOR SELECT TO authenticated
  USING (public.auth_permiso_any(ARRAY['ver_postulaciones', 'gestionar_postulaciones']));
DROP POLICY IF EXISTS paquetes_write ON paquetes_documentos;
CREATE POLICY paquetes_write ON paquetes_documentos FOR ALL TO authenticated
  USING (public.auth_permiso('gestionar_postulaciones'))
  WITH CHECK (public.auth_permiso('gestionar_postulaciones'));

-- Órdenes de partida: la carpeta física completa y lo que necesita nómina.
INSERT INTO paquetes_documentos (nombre, descripcion, predeterminado, items) VALUES
('Carpeta completa de contratación', 'Todo el expediente en el orden de la carpeta física: hoja de vida, soportes, autorizaciones, pruebas, exámenes, contrato, formatos de ingreso y afiliaciones.', true, '[
  {"tipo":"plantilla","codigo":"LISTA_CHEQUEO_DOCUMENTOS"},
  {"tipo":"plantilla","codigo":"HOJA_VIDA"},
  {"tipo":"documento","codigo":"CEDULA"},
  {"tipo":"documento","codigo":"LIBRETA_MILITAR"},
  {"tipo":"documento","codigo":"PPT_PEP"},
  {"tipo":"documento","codigo":"HOJA_VIDA"},
  {"tipo":"documento","codigo":"DIPLOMA"},
  {"tipo":"documento","codigo":"CURSOS"},
  {"tipo":"documento","codigo":"CERT_ALIMENTOS"},
  {"tipo":"documento","codigo":"CERT_ALTURAS"},
  {"tipo":"documento","codigo":"CERT_GRECAS"},
  {"tipo":"documento","codigo":"CERT_LABORALES"},
  {"tipo":"documento","codigo":"REF_LABORALES"},
  {"tipo":"documento","codigo":"REF_PERSONALES"},
  {"tipo":"documento","codigo":"REF_FAMILIARES"},
  {"tipo":"documento","codigo":"ANT_POLICIA"},
  {"tipo":"documento","codigo":"ANT_PROCURADURIA"},
  {"tipo":"documento","codigo":"ANT_CONTRALORIA"},
  {"tipo":"documento","codigo":"ANT_RNMC"},
  {"tipo":"documento","codigo":"ANT_PERSONERIA"},
  {"tipo":"plantilla","codigo":"AUTORIZACION_DATOS_PERSONALES"},
  {"tipo":"plantilla","codigo":"AUTORIZACION_INFORMACION_PERSONAL"},
  {"tipo":"plantilla","codigo":"AUTORIZACION_CONSERJES"},
  {"tipo":"plantilla","codigo":"AUTORIZACION_IMAGEN_HISTORIA_CLINICA"},
  {"tipo":"prueba","codigo":"APTITUD"},
  {"tipo":"prueba","codigo":"CONOCIMIENTOS"},
  {"tipo":"plantilla","codigo":"FORMATO_ENTREVISTA"},
  {"tipo":"documento","codigo":"CONCEPTO_APTITUD"},
  {"tipo":"plantilla","codigo":"ACTUALIZACION_DATOS"},
  {"tipo":"plantilla","codigo":"CONSOLIDACION_DATOS"},
  {"tipo":"plantilla","codigo":"INFORMACION_CONTACTO"},
  {"tipo":"plantilla","codigo":"CONTRATO_OBRA_LABOR"},
  {"tipo":"plantilla","codigo":"CARTA_CONOCIMIENTO_FUNCIONES"},
  {"tipo":"plantilla","codigo":"CONSTANCIA_POLITICAS_RIT"},
  {"tipo":"plantilla","codigo":"CONSTANCIA_CONDICIONES_SALARIALES"},
  {"tipo":"plantilla","codigo":"CONSTANCIA_AFILIACION_FAMILIAR"},
  {"tipo":"plantilla","codigo":"SOLICITUD_PLAZO_DOCUMENTOS"},
  {"tipo":"plantilla","codigo":"PAGARE_AUTORIZACION_DESCUENTO"},
  {"tipo":"documento","codigo":"AFIL_EPS"},
  {"tipo":"documento","codigo":"AFIL_AFP"},
  {"tipo":"documento","codigo":"AFIL_CCF"},
  {"tipo":"documento","codigo":"AFIL_ARL"},
  {"tipo":"documento","codigo":"CERT_BANCARIA"},
  {"tipo":"documento","codigo":"DOC_BENEF"},
  {"tipo":"documento","codigo":"PLAN_EXEQUIAL"}
]'::jsonb),
('Documentos para nómina', 'Lo que necesita nómina para afiliar y cargar en WO.', false, '[
  {"tipo":"plantilla","codigo":"CONSOLIDACION_DATOS"},
  {"tipo":"plantilla","codigo":"ACTUALIZACION_DATOS"},
  {"tipo":"documento","codigo":"CEDULA"},
  {"tipo":"plantilla","codigo":"CONTRATO_OBRA_LABOR"},
  {"tipo":"plantilla","codigo":"CONSTANCIA_CONDICIONES_SALARIALES"},
  {"tipo":"documento","codigo":"CONCEPTO_APTITUD"},
  {"tipo":"documento","codigo":"AFIL_EPS"},
  {"tipo":"documento","codigo":"AFIL_AFP"},
  {"tipo":"documento","codigo":"AFIL_CCF"},
  {"tipo":"documento","codigo":"AFIL_ARL"},
  {"tipo":"documento","codigo":"CERT_BANCARIA"},
  {"tipo":"documento","codigo":"DOC_BENEF"}
]'::jsonb)
ON CONFLICT DO NOTHING;
