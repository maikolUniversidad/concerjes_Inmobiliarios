-- =============================================================================
-- F8 · Ubicación — reparto del permiso del recorrido entre los roles
-- =============================================================================
-- PROPUESTA. El razonamiento rol por rol está en
-- docs/puntos-qr-whatsapp/F8-propuesta-permisos.md, que es lo que hay que leer
-- antes de aplicar esto.
--
-- La migración 20261028000800 dejó cinco claves en el catálogo y repartió
-- cuatro. A propósito NO sembró `ver_recorrido_personas` en ningún rol:
-- reproducir por dónde anduvo una persona es tratamiento de datos de desempeño
-- (§10.3) y tenía que ser una decisión consciente de quien administra, no algo
-- que viniera encendido de fábrica. Esta migración es esa decisión.
--
--   ver_recorrido_personas   reproduce el recorrido de un turno pasado: la
--                            lista de coordenadas con horas, precisión,
--                            velocidad y metros, más el selector de turnos con
--                            nombre, entrada y salida de la persona. Y, por el
--                            `OR` de `ronda_mapa_acceso()`, también la posición
--                            en vivo.
--   gestionar_accesos_campo  emite el enlace de un uso y el PIN de cualquier
--                            persona de la nómina, registra consentimientos por
--                            cuenta de otro y ESCRIBE `persona_canales` sin
--                            alcance por contrato.
--
-- REPARTO QUE PROPONE ESTE ARCHIVO
--   Supervisor de Conserjería   ver_recorrido_personas
--   Coordinador                 ver_recorrido_personas
--   todos los demás             nada
--   gestionar_accesos_campo     NINGÚN ROL todavía (ver el punto 3)
--
-- Por qué esos dos y no más: son los dos únicos roles que ya tienen
-- `ver_mapa_operativo` y `gestionar_rutas_ronda`, es decir los que coordinan la
-- operación del contrato y responden ante el cliente. El Auditor NO entra: la
-- prueba de que la ronda se hizo es la coordenada de la visita en
-- `ronda_visitas` (12 meses, y ya la ve con `ver_visitas_rondas`); el rastro
-- continuo es otra cosa. El Conserje y el Técnico tampoco: son el sujeto del
-- dato, y su propio rastro ya lo ven sin permiso por la cláusula «lo propio
-- siempre se ve» de las políticas.
--
-- Gerencia, Administrador y Super Administrador NO se siembran: `auth_permiso()`
-- le da paso libre a los roles base ADMIN y SUPER_ADMIN. O sea que hoy ya
-- pueden reproducir un recorrido; lo que se decide aquí es si alguien SIN rol
-- base de administración puede.
--
-- `defaults || permisos` y no al revés (mismo idioma que 20261028000601): lo que
-- ya esté puesto en el rol gana, así que re-aplicar esta migración no revive un
-- permiso que alguien haya apagado a mano en /roles.
--
-- Idempotente. No crea ni altera ninguna tabla, función o política: solo mueve
-- `roles.permisos`.
-- =============================================================================

-- ── 1. Quien coordina la operación del contrato y responde ante el cliente ───
-- Ya tienen el mapa en vivo y arman las rutas. El replay es la misma tarea un
-- día después: contestar «por dónde pasó» cuando hay una queja o un reclamo.
UPDATE public.roles
   SET permisos = jsonb_build_object(
         'ver_recorrido_personas', true
       ) || permisos
 WHERE nombre IN ('Supervisor de Conserjería', 'Coordinador');

-- ── 2. Nadie más ─────────────────────────────────────────────────────────────
-- No hay un UPDATE por rol que NO lo recibe, claro; queda escrito aquí para que
-- el que lea el archivo no tenga que deducirlo:
--   Auditor                    no (la prueba es la visita, no el rastro)
--   Jefe de Mantenimiento      no (una OT se verifica con su evidencia)
--   Operador de Sede           no (la clave es por contrato, no por sede)
--   Conserje                   no (es el sujeto del dato; lo propio ya lo ve)
--   Técnico de Mantenimiento   no (idem)
--   Empleado                   no (son 853 cuentas: sería abrir el rastro de
--                                  los compañeros a casi toda la nómina)
--   Bodeguero                  no
--   Conductor                  no
--   Coordinador de Compras     no

-- ── 3. `gestionar_accesos_campo`: a nadie todavía ───────────────────────────
-- Esta clave de F4 no tiene NI UNA pantalla ni un `server action` que la exija:
-- toda su fuerza está en la base. Darla hoy no compra nada visible en el panel
-- y sí estrena tres cosas sin alcance por contrato:
--   · emitir enlace y PIN de cualquiera de las personas activas de la nómina,
--     buscándola por documento;
--   · registrar un consentimiento por cuenta de otra persona (incluido el de
--     SEGUIMIENTO);
--   · escritura `FOR ALL` sobre `persona_canales` — y desde que F9 está en
--     producción esa tabla es el mapa de identidad del bot de WhatsApp
--     (`ronda_whatsapp_conversacion_abrir()` resuelve quién escribe por su
--     `wa_id` o su número verificado). Las dos primeras juntas con esta son,
--     en la práctica, suplantación.
--
-- Propuesta: acotar primero (`persona_canales` por contrato, y sacar la
-- escritura del canal de esta clave hacia `gestionar_personas`), construir la
-- pantalla de entrega asistida, y entonces darla. Mientras eso no exista, la
-- entrega asistida la hace una cuenta de administración, que es lo que pasa hoy
-- y alcanza para el volumen actual.
--
-- Si la decisión es darla ya, son estas dos líneas. Los dos roles de abajo son
-- los correctos: ya tienen `ver_personas`, así que no estrenan datos personales.
--
-- UPDATE public.roles
--    SET permisos = jsonb_build_object('gestionar_accesos_campo', true) || permisos
--  WHERE nombre IN ('Supervisor de Conserjería', 'Coordinador');

-- ── 4. Comprobación de coherencia ───────────────────────────────────────────
-- Dos combinaciones que no deben quedar, y que esta migración no crea pero sí
-- detecta si alguien las dejó a mano en /roles.
DO $$
DECLARE incoherentes TEXT;
BEGIN
  -- 4.1 Recorrido sin mapa. La pantalla /rondas/mapa y su ítem del menú exigen
  -- `ver_mapa_operativo`; `cargarRecorrido()` exige además la del recorrido. Un
  -- rol con el recorrido y sin el mapa tendría la capacidad en la base (las RPC
  -- y la RLS del historial lo dejarían pasar) y la pantalla cerrada en la cara.
  SELECT string_agg(nombre, ', ' ORDER BY nombre) INTO incoherentes
    FROM public.roles
   WHERE COALESCE((permisos->>'ver_recorrido_personas')::boolean, false)
     AND COALESCE((permisos->>'ver_mapa_operativo')::boolean, false) IS NOT TRUE;
  IF incoherentes IS NOT NULL THEN
    RAISE EXCEPTION 'Roles que reproducen el recorrido sin poder ver el mapa operativo: %', incoherentes;
  END IF;

  -- 4.2 Accesos de campo sin poder ver a la persona. `gestionar_accesos_campo`
  -- escribe `persona_canales` y registra consentimientos por cuenta de otro; la
  -- ficha de la persona la abre `ver_personas`. Escribir el canal de alguien
  -- cuya ficha no se puede abrir es justo la combinación que no queremos.
  SELECT string_agg(nombre, ', ' ORDER BY nombre) INTO incoherentes
    FROM public.roles
   WHERE COALESCE((permisos->>'gestionar_accesos_campo')::boolean, false)
     AND COALESCE((permisos->>'ver_personas')::boolean, false) IS NOT TRUE;
  IF incoherentes IS NOT NULL THEN
    RAISE EXCEPTION 'Roles que gestionan accesos de campo sin poder ver a las personas: %', incoherentes;
  END IF;
END $$;

-- =============================================================================
-- FIN
-- =============================================================================
