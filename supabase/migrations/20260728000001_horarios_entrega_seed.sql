-- Horarios de entrega Colombia Compra Bogota - seed desde Excel
-- Busca cada sede por nombre aproximado (ILIKE). Si no hay match la fila se omite.
DO $$
DECLARE v_sede UUID;
BEGIN

  -- 9: FONDO DESARROLLO LOCAL DE SANTA FE
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%FONDO DESARROLLO LOCAL DE SANTA FE%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '12:00', '14:00', '15:00', 'MARIO JIMENEZ', '313 7480810')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='12:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='MARIO JIMENEZ', supervisor_contacto='313 7480810', updated_at=NOW();
  END IF;

  -- 31: FONDO NACIONAL DE ESTUPEFACIENTES
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%FONDO NACIONAL DE ESTUPEFACIENTES%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '09:00', '11:00', '14:00', '16:00', 'Cristhian Sierra', '312 4435825')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='09:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='16:00',
      supervisor_nombre='Cristhian Sierra', supervisor_contacto='312 4435825', updated_at=NOW();
  END IF;

  -- 37: AGENCIA NACIONAL MINERIA
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%AGENCIA NACIONAL MINERIA%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'KATERINE DAZA', '319 7349171')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='KATERINE DAZA', supervisor_contacto='319 7349171', updated_at=NOW();
  END IF;

  -- 45: EMPRESA NACIONAL PROMOTORA DEL DESARROLLO TERRIOTIAL-ENTERRITORIO
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%EMPRESA NACIONAL PROMOTORA DEL DESARROLL%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'ORLANDO HERRERA', '315 8808883')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='ORLANDO HERRERA', supervisor_contacto='315 8808883', updated_at=NOW();
  END IF;

  -- 46: MINISTERIO DE JUSTICIA Y DEL DERECHO
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%MINISTERIO DE JUSTICIA Y DEL DERECHO%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'CARLOS BENAVIDES', '3219762006')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='CARLOS BENAVIDES', supervisor_contacto='3219762006', updated_at=NOW();
  END IF;

  -- 47: ALCALDIA LOCAL DE CIUDAD BOLIVAR
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%ALCALDIA LOCAL DE CIUDAD BOLIVAR%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'DIEGO ARLEY ARENAS MANRIQUE', '3164934171')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='DIEGO ARLEY ARENAS MANRIQUE', supervisor_contacto='3164934171', updated_at=NOW();
  END IF;

  -- 51: ALCALDIA LOCAL TEUSAQUILLO
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%ALCALDIA LOCAL TEUSAQUILLO%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'ANDRES VEGA', '317 6466602')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='ANDRES VEGA', supervisor_contacto='317 6466602', updated_at=NOW();
  END IF;

  -- 52: FIDUPREVISORA SA
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%FIDUPREVISORA SA%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'Guarin Lopez Juan Andres', '3508224778')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='Guarin Lopez Juan Andres', supervisor_contacto='3508224778', updated_at=NOW();
  END IF;

  -- 56: UAE-CONTADURIA GENERAL DE LA NACION
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%CONTADURIA GENERAL DE LA NACION%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '09:00', '11:00', '14:00', '15:00', 'ELIANA HERNANDEZ', '320 2977772')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='09:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='ELIANA HERNANDEZ', supervisor_contacto='320 2977772', updated_at=NOW();
  END IF;

  -- 57: EMPRESA INDUSTRIAL Y COMERCIAL-COLJUEGOS
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%COLJUEGOS%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'Jennifer Gomez', '314 3250737')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='Jennifer Gomez', supervisor_contacto='314 3250737', updated_at=NOW();
  END IF;

  -- 58: MINISTERIO DE DEFENSA NACIONAL-DIRECCION GENERAL MARITIMA
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%MINISTERIO DE DEFENSA NACIONAL-DIRECCION%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'ALEJANDRA', '313 4568840')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='ALEJANDRA', supervisor_contacto='313 4568840', updated_at=NOW();
  END IF;

  -- 59: UAE-AGENCIA DEL ESPECTOR GENERAL DE TRIBUTOS-RENTAS Y CONTRIBUCIONES PARAFISCALES
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%AGENCIA DEL ESPECTOR GENERAL DE TRIBUTOS%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'CARLOS GONZALEZ', '311 4756633')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='CARLOS GONZALEZ', supervisor_contacto='311 4756633', updated_at=NOW();
  END IF;

  -- 61: DEPARTAMENTO ADMINISTRIVO SERVICIO CIVIL DISTRITAL
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%DEPARTAMENTO ADMINISTRIVO SERVICIO CIVIL%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'PEDRO CAMPOS', '301 3206493')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='PEDRO CAMPOS', supervisor_contacto='301 3206493', updated_at=NOW();
  END IF;

  -- 62: UAE-DIRECCION NACIONAL DE BOMBEROS
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%DIRECCION NACIONAL DE BOMBEROS%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '09:00', '10:00', NULL, NULL, 'JUAN LOSADA', '321 2409300')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='09:00', ventana_am_fin='10:00',
      ventana_pm_inicio=NULL, ventana_pm_fin=NULL,
      supervisor_nombre='JUAN LOSADA', supervisor_contacto='321 2409300', updated_at=NOW();
  END IF;

  -- 68: SENA-SERVICIO NACIONAL DE APRENDIZAJE SENA REGIONAL
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%SENA-SERVICIO NACIONAL DE APRENDIZAJE SE%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', NULL, NULL, 'CARLOS MENDEZ', '3118843564')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio=NULL, ventana_pm_fin=NULL,
      supervisor_nombre='CARLOS MENDEZ', supervisor_contacto='3118843564', updated_at=NOW();
  END IF;

  -- 72: SUPERINTENDENCIA DE TRANSPORTE
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%SUPERINTENDENCIA DE TRANSPORTE%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '09:00', '11:00', NULL, NULL, 'MARIANA BELTRAN', '313 8722044')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='09:00', ventana_am_fin='11:00',
      ventana_pm_inicio=NULL, ventana_pm_fin=NULL,
      supervisor_nombre='MARIANA BELTRAN', supervisor_contacto='313 8722044', updated_at=NOW();
  END IF;

  -- 74: BOGOTA-D.C-ALCALDIA LOCAL DE BARRIOS UNIDOS
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%ALCALDIA LOCAL DE BARRIOS UNIDOS%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'SANDRA SILVA', '320 4926413')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='SANDRA SILVA', supervisor_contacto='320 4926413', updated_at=NOW();
  END IF;

  -- 75: BOGOTA D.C-ALCALDIA LOCAL DE ENGANTIVA
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%ALCALDIA LOCAL DE ENGANTIVA%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'JOHN BECERRA', '313 8277309')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='JOHN BECERRA', supervisor_contacto='313 8277309', updated_at=NOW();
  END IF;

  -- 76: DEPARTAMENTO ADMINISTRATIVO DE LA DEFENSORIA DEL ESPACIO PUBLICO
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%DEPARTAMENTO ADMINISTRATIVO DE LA DEFENS%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'CLAUDIA SUNA', '3102422502')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='CLAUDIA SUNA', supervisor_contacto='3102422502', updated_at=NOW();
  END IF;

  -- 77: SECRETARIA DISTRITAL DEL HABITAT
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%SECRETARIA DISTRITAL DEL HABITAT%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'YUDY ALVAREZ', '310 4968854')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='YUDY ALVAREZ', supervisor_contacto='310 4968854', updated_at=NOW();
  END IF;

  -- 78: FONDECUN
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%FONDECUN%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '15:00', 'LEIDY RUEDA', '3115523553')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='15:00',
      supervisor_nombre='LEIDY RUEDA', supervisor_contacto='3115523553', updated_at=NOW();
  END IF;

  -- 87: DIRECCION DE TRANSITO Y TRANSPORTE DE LA POLICIA NACIONAL
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%DIRECCION DE TRANSITO Y TRANSPORTE DE LA%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '16:00', 'JENNIFER MOGOLLO', '320 3340441')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='16:00',
      supervisor_nombre='JENNIFER MOGOLLO', supervisor_contacto='320 3340441', updated_at=NOW();
  END IF;

  -- 93: DIRECCION ANTISECUESTRO Y ESTORSION
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%DIRECCION ANTISECUESTRO Y ESTORSION%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '16:00', 'OSCAR MURCIA', '313 2841466')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='16:00',
      supervisor_nombre='OSCAR MURCIA', supervisor_contacto='313 2841466', updated_at=NOW();
  END IF;

  -- 99: RADIO TELEVISION NACIONAL DE COLOMBIA
  SELECT id INTO v_sede FROM sedes WHERE upper(nombre) ILIKE upper('%RADIO TELEVISION NACIONAL DE COLOMBIA%') LIMIT 1;
  IF v_sede IS NOT NULL THEN
    INSERT INTO sede_horario_entrega (sede_id, ventana_am_inicio, ventana_am_fin, ventana_pm_inicio, ventana_pm_fin, supervisor_nombre, supervisor_contacto)
    VALUES (v_sede, '08:00', '11:00', '14:00', '16:00', 'Diego Giraldo', '322 4326778')
    ON CONFLICT (sede_id) DO UPDATE SET
      ventana_am_inicio='08:00', ventana_am_fin='11:00',
      ventana_pm_inicio='14:00', ventana_pm_fin='16:00',
      supervisor_nombre='Diego Giraldo', supervisor_contacto='322 4326778', updated_at=NOW();
  END IF;
END $$;