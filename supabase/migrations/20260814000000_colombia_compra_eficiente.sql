-- Colombia Compra Eficiente (CCE): catalogo oficial de bienes y servicios
-- Tabla maestra con los 418 ítems del catálogo DNP.
-- Se vincula a productos mediante cce_bien_id (FK opcional).

-- ─── 1. TABLA CCE ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS colombia_compra_eficiente (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bien            TEXT NOT NULL,
  especificacion  TEXT,
  presentacion    TEXT,
  cantidad_mensual TEXT,
  precio_piso     BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cce_bien ON colombia_compra_eficiente (bien);

-- ─── 2. SEED: 418 ítems del catálogo ────────────────────────────────────────
INSERT INTO colombia_compra_eficiente (bien, especificacion, presentacion, cantidad_mensual, precio_piso)
VALUES
  ('Jardineria mt2', 'Servicio especializado de jardinería en metros cuadrados.', 'Metros cuadrados', '0', true),
  ('Café Social 1 (Compra)', '- Diferentes tostiones
- Orgánico y/o artesanal
- Empacada en bolsa de polipropileno aluminizada resistente a la humedad y al oxígeno.  
- Debe cumplir con las Resoluciones 333 de 2011 y 2674 de 2013 hasta la entrada en vigencia de la Resolución 810 de 2021 y aquellas que la modifiquen, adicionen o deroguen', 'Bolsa de mínimo 500 g', '5', true),
  ('Café Social 2 (Compra)', '- 100% café tostado y molido.
- Puntaje de taza mayor a 80 según la clasificación SCA y/o Denominación de Origen
- Empacada en bolsa de polipropileno aluminizada resistente a la humedad y al oxígeno.  
- Debe cumplir con las Resoluciones 333 de 2011 y 2674 de 2013 hasta la entrada en vigencia de la Resolución 810 de 2021 y aquellas que la modifiquen, adicionen o deroguen', 'Bolsa de mínimo 500 g', '0', true),
  ('Jabón para loza 1 (Compra)', '- Con agente(s) tensoactivo(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 8%.
- Disponible en mínimo (2) dos fragancias
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml', '0', true),
  ('Jabón para loza 2 (Compra)', '- Con agente(s) tensoactivo(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 8%.
- Disponible en mínimo (2) dos fragancias
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en recipiente plástico de mínimo 500 ml', '0', true),
  ('Jabón para loza 3 (Compra)', '- Con agente(s) tensoactivo(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 15%.
 - Disponible en mínimo (2) dos fragancias
- El envase debe estar correctamente etiquetados bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Crema, en recipiente plástico de mínimo 850 g', '0', true),
  ('Jabón para loza 4 (Compra)', '- Con agente(s) tensoactivo(s) con efecto limpiador y desengrasante. 
- Disponible en múltiples fragancias. 
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Elaborado en material reciclable
- Con etiqueta de amigable con el ambiente
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Crema, en recipiente plástico de mínimo 1000 g', '1', true),
  ('Jabón en barra (Compra)', '-Composición de ácidos grasos de mínimo 50%.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Barra, unidad con peso mínimo de 250 g en
envoltura individual', '0', true),
  ('Jabón en barra azul (Compra)', '- Todo tipo de uso
- Biodegradable
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Barra, unidad con peso mínimo de 250 g en
envoltura individual', '0', true),
  ('Jabón abrasivo (Compra)', '-Con agente(s) tensoactivo(s) pincipal(es) con efecto limpiador, pulidor y desengrasante
- Con agente activo mínimo del 5%
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'En polvo, en tarro de mínimo 500 g', '1', true),
  ('Jabón de tocador 1 (Compra)', '- Elaborado con grasas vegetales
 - Con agente humectante
 - pH modificar entre PH 5,5 a 7
 - Disponible en mínimo (2) dos fragancias
 - Debe estar  correctamente etiquetados bajo los parámetros indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Barra, unidad con peso mínimo de 125 g en envoltura individual', '0', true),
  ('Jabón de tocador 2 (Compra)', '- Jabón de tocador para manos en espuma
- Líquido para manos en bolsa para dispensador spray y con boquilla especial de dispensador
- Tapa tipo válvula, para dispensador, antibacterial y antiséptico 
- Con agente limpiador en una concentración mínima del 6%
- Con agente humectante en una concentración mínima del 3%
- Disponible en múltiples fragancias
- Producto biodegradable basado en ingredientes orgánicos
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Elaborado en material reciclable
- No debe contener PVC, Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en bolsa  con capacidad mínima de 800 ml', '0', true),
  ('Jabón de dispensador para manos 1 (Compra)', '- Con agente limpiador en una concentración mínima del 6%
- Con agente humectante en una concentración mínima del 3%
- pH entre 5,5 a 7
- Disponible en mínimo (2) dos fragancias
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en recipiente plástico con dispensador y capacidad mínima de 500 ml', '0', true),
  ('Jabón de dispensador para manos 2 (Compra)', '- Con agente limpiador en una concentración mínima del 6%
- Con agente humectante en una concentración mínima del 3%
- pH entre 5,5 a 7
- Disponible en mínimo (2) dos fragancias
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml', '0', true),
  ('Jabón de dispensador para manos 3 (Compra)', '- Con agente limpiador en una concentración mínima del 6%.
- Con agente antibacterial en una concentración mínima del 0,2%
- Con agente humectante en una concentración mínima del 3%
- pH entre 5,5 a 7
- Disponible en mínimo (2) dos fragancias
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml', '1', true),
  ('Gel antibacterial para manos (Compra)', '- Con agente antibacterial en una concentración mínima del 0,2%
- Con agente humectante
- pH entre 5, 5 a 7
- Con fragancia', 'Gel, en recipiente plástico con capacidad mínima de 3.785 ml', '0', true),
  ('Dispensador de gel antibacterial para manos (Compra)', '- Material: Plástico
- Tipo de instalación: De pared
- Incluye Chazos y tornillos
- Con visor para determinar el nivel del líquido
- Con ventanilla en la parte superior para añadir el gel 
- Funcionamiento: Manual', 'Recipiente con capacidad mínima de 500 ml (Unidad)', '0', true),
  ('Limpiador multiusos 1 (Compra)', '- Con agente(s) tensoactivo(s) principal(es) con efecto limpiador en una concentración mínima del 8%
- Disponible en mínimo (2) dos fragancias
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml', '1', true),
  ('Limpiador multiusos 2 (Compra)', '- Con agente(s) tensoactivo(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 8%
- Disponible en mínimo (2) dos fragancias
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 500 ml, con
atomizador de pistola.', '0', true),
  ('Limpiador multiusos 3 (Compra)', '- Con agente(s) tensoactivo(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 8%
- Disponible en mínimo (2) dos fragancias
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico de repuesto  con capacidad mínima de 500 ml', '0', false),
  ('Limpiador desinfectante para pisos (Compra)', '- Apariencia: Líquido transparente
- Color y olor: De acuerdo a la fragancia
- Producto biodegradable que no afectas la capa de ozono
- Solubilidad: Total en agua
- PH: 7.5 - 8.5
- Composición: Tensoactivos, espesante, coadyuvante, colorante 
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Elaborado en material reciclable
- No debe contener PVC, poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Líquido, en garrafa  con capacidad mínima de 3.785 ml', '0', false),
  ('Líquido desengrasante (Compra)', '- Con agente(s) tensoactivo(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 10%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml', '1', true),
  ('Crema desengrasante (Compra)', '- Disponible en múltiples fragancias 
- Limpia y desengrasa todos los metales, plásticos, gomas, vidrio, cerámica y madera 
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Elaborado en material reciclable o biodegradable
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Crema, en recipiente reciclable o biodegadable con capacidad mínima de 500 g', '0', true),
  ('Detergente biodegradable multiusos en polvo (Compra)', '- Con agente tensoactivo de mínimo 60% de biodegradabilidad
  -Con efecto limpiador de mínimo 9%.
 -  El  envase del producto deberá estar correctamente etiquetado bajo los parámetros: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Polvo, en bolsa plástica o recipiente plástico
con un peso de 1.000 g', '1', true),
  ('Limpiador desinfectante para uso general 1 (Compra)', '- Con agente(s) tensoactivo(s) con efecto antibacterial en una concentración mínima del 0,2%
- Con agente(s) tensoactivo(s) con efecto limpiador y desengrasante en una concentración mínima del 1,5%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml', '1', true),
  ('Limpiador desinfectante para uso general 2 (Compra)', '- Con agente(s) tensoactivo(s) con efecto antibacterial en una concentración mínima del 0,2%
- Con agente(s) tensoactivo(s) con efecto limpiador y desengrasante en una concentración mínima del 1,5%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 500 ml, con atomizador de pistola.', '0', false),
  ('Limpiador desinfectante para uso general 3 (Compra)', '- Con agente(s) tensoactivo(s) con efecto antibacterial en una concentración mínima del 0,2%
- Con agente(s) tensoactivo(s) con efecto limpiador y desengrasante en una concentración mínima del 1,5%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 500 ml', '0', false),
  ('Desinfectante de alto nivel de desinfección para uso hospitalario (Compra)', '- Con agentes bactericidas, fungicidas, tubercolicidas, esporicidas y virucidas.
 - Sin fragacia
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad
mínima de 3.785 ml', '0', true),
  ('Pastilla desinfectante para sanitario (Compra)', '- Con agentes bactericidas, fungicidas y virucidas.', 'Unidad con peso mínimo de 45 g', '4', true),
  ('Líquido para limpiar vidrios 1 (Compra)', '- Con agente(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 4%
- Disponible mínimo en dos (2) fragancias
 - El envase debe estar  correctamente etiquetados bajo los parámetros establecidos en el sistema globalmente armonizado indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml', '1', true),
  ('Líquido para limpiar vidrios 2 (Compra)', '- Con agente(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 4%
- Disponible mínimo en dos (2) fragancias
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 500 ml, con
atomizador de pistola.', '0', true),
  ('Líquido para limpiar vidrios 3 (Compra)', '- Con agente(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 4%
- Disponible mínimo en dos (2) fragancias
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico de repuesto con capacidad mínima
de 500 ml', '0', false),
  ('Blanqueador o hipoclorito 1 (Compra)', '- Solución con una concentración mínima del 5%
 - El  envase del producto deberá estar correctamente etiquetado, indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad
mínima de 3.785 ml', '2', true),
  ('Blanqueador o hipoclorito 2 (Compra)', '- Solución con una concentración mínima del 5%
 - El  envase del producto deberá estar correctamente etiquetado, indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad
mínima de 1.000 ml', '0', true),
  ('Blanqueador o hipoclorito 3 (Compra)', '- Granulado con una concentración mínima del 90%
 - El  envase del producto deberá estar correctamente etiquetado, indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'ganulado, en bolsa plástica de mínimo
1.000 g', '0', true),
  ('Alcohol industrial 1 (Compra)', '- Solución acuosa de alcohol etílico desnaturalizado con una concentración mínima de 70%
 - Desnaturalizado', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml', '0', true),
  ('Alcohol industrial 2 (Compra)', '- Solución acuosa de alcohol etílico desnaturalizado con una concentración mínima de 70%
- Desnaturalizado', 'Líquido, en recipiente plástico con capacidad mínima de 1000ml', '0', true),
  ('Creolina 1 (Compra)', '- Solución con una concentración mínima de fenoles de 4%', 'Líquido, en recipiente
plástico con capacidad mínima de 500 ml', '0', true),
  ('Creolina 2 (Compra)', '- Solución con una concentración mínima de fenoles de 4%', 'Líquido, en recipiente plástico con capacidad
mínima de 3.785 ml', '0', true),
  ('Líquido para limpiar equipos de oficina 1 (Compra)', '- Con agente(s) principal(es) con efecto limpiador, desengrasante y desinfectante en una concentración mínima del 4%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 500 ml con
atomizador', '0', true),
  ('Líquido para limpiar equipos de oficina 2 (Compra)', '- Con agente(s) principal(es) con efecto limpiador, desengrasante y desinfectante en una concentración mínima del 4%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad
mínima de 500 ml', '0', true),
  ('Champú para alfombras y tapizados 1 (Compra)', '- Con agente(s) principal(es) con efecto limpiador en una concentración mínima del 8%
 - El envase debe estar  correctamente etiquetado: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso', 'Líquido, en recipiente plástico con capacidad
mínima de 3.785 ml', '0', true),
  ('Champú para alfombras y tapizados 2 (Compra)', '- Con agente(s) principal(es) con efecto limpiador en una concentración mínima del 8%
- Con agente espumante para la generación de espuma seca
 - El envase debe estar  correctamente etiquetados: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml', '0', true),
  ('Lustrador de muebles (Compra)', '- Con agentes limpiadores y abrillantadores en una concentración mínima del 5%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 200 ml', '0', true),
  ('Líquido cubre rasguños para madera (Compra)', '- Con agentes limpiadores y abrillantadores en una concentración mínima del 5%
- De color oscuro para coayudar a cubrir rasguños en maderas oscuras', 'En recipiente plástico
con capacidad mínima de 200 ml', '0', true),
  ('Crema para cuero (Compra)', '- Con agentes limpiadores y abrillantadores en una concentración mínima del 5%', 'Crema, en recipiente plástico con capacidad
mínima de 200 ml', '0', true),
  ('Cera polimérica (Compra)', '- Polimérica autobrillante.
- Con polímeros acrílicos, nivelantes y plastificantes.
- Neutra (para pisos de todos los colores)
- Contenido mínimo de sólidos del 10%', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml', '0', true),
  ('Cera emulsionada Neutra (Compra)', '- Emulsionada
- Neutra (para pisos de todos los colores)
- Contenido mínimo de sólidos del 5%', 'Líquido, en recipiente plástico con capacidad
mínima de 3.785 ml', '0', true),
  ('Cera emulsionada roja (Compra)', '- Emulsionada
- Roja
- Contenido mínimo de sólidos del 5%
- Antideslizante', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml', '0', true),
  ('Cera solvente (Compra)', '- Solvente
- Contenido mínimo de sólidos del 10%', 'Líquido, en recipiente plástico con capacidad
mínima de 3.785 ml', '0', false),
  ('Sellante para pisos (Compra)', '- Polimérico autobrillante.
- Con polímeros acrílicos, nivelantes y plastificantes.
- Contenido mínimo de sólidos del 20%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml', '0', true),
  ('Mantenedor de pisos (Compra)', '- Polimérico autobrillante.
- Con polímeros acrílicos, nivelantes y plastificantes.
- Contenido mínimo de sólidos del 8%', 'Líquido, en recipiente
plástico con capacidad mínima de 3.785 ml', '0', true),
  ('Removedor de cera (Compra)', '- Con agente activo alcalino en una concentración mínima del 9%
- pH entre 11 y 14', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml', '0', true),
  ('Abrillantador para piso laminado (Compra)', '- Con agente(s) con efecto limpiador y brillador.', 'Líquido, en recipiente
plástico con capacidad mínima de 3.785 ml', '0', true),
  ('Jabón neutro para pisos 1 (Compra)', '- Jabón multiusos
 - PH Neutro, 
 - No corrosivo ni tóxico
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en recipiente
plástico con capacidad mínima de 3.785 ml', '0', true),
  ('Jabón neutro para pisos 2 (Compra)', '- Jabón neutro biodegradable multiusos
- PH Neutro
- No es corrosivo ni tóxico
- Color: Azul claro 
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Elaborado en material reciclable, no debe contener PVC, Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en cuñete con capacidad de 20 L', '0', true),
  ('Varsol  ecológico 1 (Compra)', '- Solución con agentes desinfectantes, desmanchadores y desengrasantes  en concentración mínima del 15%.
- Biodegradable mínimo en un 95%', 'Líquido, en recipiente plástico con capacidad mínima de 1000 ml', '0', true),
  ('Varsol ecológico 2 (Compra)', '- Solución con agentes desinfectantes, desmanchadores y desengrasantes  en concentración mínima del 15%.
- Biodegradable mínimo en un 95%', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml', '0', true),
  ('Desmanchador multiusos (Compra)', '- Con agente(s) tensoactivo(s) con efecto limpiador y desengrasante
- Para superficies de todo tipo.', 'Crema, en bolsa plástica de mínimo 500 g', '0', true),
  ('Brillametal en crema (Compra)', '- Con agentes con efecto limpiador, pulidor y brillador.
- Para todo tipo de metales
 - El  envase del producto deberá estar correctamente etiquetado, indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso', 'En crema de mínimo 70 g', '0', true),
  ('Brillametal líquido (Compra)', '- Con agentes con efecto limpiador, pulidor y brillador.
- Para todo tipo de metales', 'Líquido , en recipiente plástico con capacidad mínima de 200 ml', '0', true),
  ('Betún (Compra)', '- Contenido mínimo de sólidos del 30%
- Color negro
- No debe contener ningún material que sea cancerígeno ( Clasificación 1 y 2a por la IARC), Mutagénico, Tóxico, Contaminante peligroso del aire o que sea agotador de la capa de ozono 
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Tarro de mínimo 100 g', '0', true),
  ('Ambientador 1 (Compra)', '- Solución con alcohol etílico y solventes.
- Con fragancia en una concentración del 1,5%
- En múltiples fragancias (Mínimo 5 tipos de fragancias)
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad
mínima de 3.785 ml', '2', true),
  ('Ambientador 2 (Compra)', '- Solución con alcohol etílico y solventes.
- Con fragancia en una concentración del 1,5%
- En múltiples fragancias
- libre de CFC
 - Envase correctamente etiquetado bajo los parámetros establecidos indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso.
- Elaborado en material reciclable', 'Líquido, en aerosol seguro para la capa de ozono con capacidad mínima de 360 ml', '0', true),
  ('Insecticida 1 (Compra)', '- Para eliminar insectos rastreros.
-  Con acción residual hasta por 4 semanas o de larga duración
- Sin fuertes olores químicos
- Libre de CFC
 - El  envase del producto deberá estar correctamente etiquetado, indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso', 'Líquido, en aerosol seguro para la capa de ozono con capacidad
mínima de 350 ml', '0', true),
  ('Insecticida 2 (Compra)', '- Para eliminar insectos voladores
-  Con acción residual hasta por 4 semanas o de larga duración
- Sin fuertes olores químicos
- Libre de CFC
 - El  envase del producto deberá estar correctamente etiquetado, indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso', 'Líquido, en aerosol seguro para la capa de ozono con capacidad
mínima de 350 ml', '0', true),
  ('Limpiones 1 (Compra)', '- En tela de toalla fileteada
- Color blanco sin estampado
- Tamaño mínimo de 45cm de largo por 45cm de ancho.', 'Unidad', '1', true),
  ('Limpiones 2 (Compra)', '- En tela de toalla fileteada
- Color blanco sin estampado
-Tamaño mínimo de 100 cm de largo por 70 cm de ancho', 'Unidad', '0', true),
  ('Limpiones 3 (Compra)', '- En tela fileteada
- Color blanco sin estampado
- Tamaño mínimo de 45 cm de largo por 45 cm de ancho', 'Unidad', '0', true),
  ('Limpiones 4 (Compra)', '- En tela fileteada
- Color blanco sin estampado
-Tamaño mínimo de 100 cm de largo por 70 cm de ancho', 'Unidad', '0', true),
  ('Limpiones 5 (Compra)', '- En tela tipo galleta fileteada
- Color blanco o beige sin estampado
-Tamaño mínimo de 100 cm de largo por 70 cm de ancho', 'Unidad', '0', false),
  ('Bayetilla 1 (Compra)', '- En tela fileteada
 -  100% algodón y fibra natural 
- Color blanco sin estampado
-Tamaño mínimo de 100 cm de largo por 70 cm de ancho', 'Unidad', '1', true),
  ('Bayetilla 2 (Compra)', '- En tela fileteada
 - 100% algodón y fibra natural 
 - Color rojo sin estampado
 -Tamaño mínimo de 100 cm de largo por 70 cm de ancho', 'Unidad', '2', true),
  ('Toalla en tela blanca para pisos por metro (repuesto de haraganes) (Compra)', '- Elaborado  en microfibras
 - Color blanco
 - Tamaño mínimo de 100 cm de largo por 70 cm de ancho', 'Unidad', '0', true),
  ('Paño absorbente multiusos 1 (Compra)', '- Retira el polvo sin dejar residuos ni pelusas
- Antibacterial reutilizable
- Tela con microporos
- Tamaño mínimo de 58 cm de largo por 33 cm de ancho', 'Paquete X 6 unidades', '1', true),
  ('Paño absorbente multiusos 2 (Compra)', '- Retira el polvo sin dejar residuos ni pelusas
- Antibacterial reutilizable
- Tela con microporos
- Tamaño mínimo de 58 cm de largo por 33 cm de ancho', 'Unidad', '0', true),
  ('Paño absorbente multiusos 3 (Compra)', '- Retira el polvo sin dejar residuos ni pelusas
- Antibacterial reutilizable
- Tela con microporos
- Tamaño mínimo de 20 cm de largo por 45 cm de ancho', 'Rollo X 40 unidades', '0', true),
  ('Paño absorbente multiusos 4 (Compra)', '- Retira el polvo sin dejar residuos ni pelusas
- Antibacterial reutilizable
- Tela con microporos
- Tamaño mínimo de 20 cm de largo por 45 cm de ancho', 'Unidad', '0', true),
  ('Estopa (Compra)', '- Hecha 100% de hilos de algodón blanco peinado.
-Suave al tacto, para lustrar
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Bolsa de mínimo 400 g', '0', true),
  ('Esponjilla 1 (Compra)', '- Espuma enmallada
- Tamaño mínimo de 7 cm de largo por 10 cm de ancho', 'Unidad', '0', true),
  ('Esponjilla 2 (Compra)', '- Doble uso (material de esponjilla blanda y abrasiva)
- Tamaño mínimo de 7 cm de largo por 10 cm de ancho
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje', 'Unidad', '3', true),
  ('Esponjilla 3 (Compra)', '- Abrasiva
- Tamaño mínimo de 9 cm de largo por 12 cm de', 'Unidad', '1', true),
  ('Esponjilla 4 (Compra)', '- Elaborada con fibra de acero inoxidable para dar brillo
- Tamaño mínimo de 5 cm de largo por 5 cm de ancho', 'Paquete X 6 unidades', '0', true),
  ('Esponjilla 5 (Compra)', '- Elaborada con alambre de acero inoxidable
- Tamaño mínimo de 7 cm de largo por 10 cm de ancho', 'Unidad', '0', true),
  ('Esponjilla 6 (Compra)', '- Espuma enmallada
- Tamaño mínimo de 7 cm de largo por 10 cm de ancho
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad', '0', true),
  ('Esponjilla 7 (Compra)', '- Abrasiva
- Tamaño mínimo de 9 cm de largo por 12 cm de ancho
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad', '0', true),
  ('Escoba 1 (Compra)', '- Cerdas suaves elaboradas con PET calibre entre 0,3 y 0,4 mm.
- Área de barrido mínima de 25 cm de largo por 8 cm de ancho por 10 cm de alto
- Material de base en plástico con acople tipo rosca', 'Unidad', '1', true),
  ('Escoba 2 (Compra)', '- Cerdas duras elaboradas con PET calibre entre 0,4 y 0,6 mm.
- Área de barrido mínima de 25 cm de largo por 8 cm de ancho por 10 cm de alto
- Material de base en plástico con acople tipo rosca', 'Unidad', '1', false),
  ('Escoba 3 (Compra)', '- Cerdas suaves elaboradas con PET calibre entre 0,3 y 0,4 mm.
- Área de barrido mínima de 35 cm de largo por 8 cm de ancho por 10 cm de alto
- Material de base en plástico con acople tipo rosca', 'Unidad', '0', true),
  ('Escoba 4 (Compra)', '- Cerdas duras elaboradas con PET calibre entre 0,4 y 0,6 mm.
- Área de barrido mínima de 35 cm de largo por 8 cm de ancho por 10 cm de alto
- Material de base en plástico con acople tipo rosca', 'Unidad', '0', true),
  ('Escoba 5 (Compra)', '- Cerdas suaves elaboradas con PET calibre entre 0,3 y 0,4 mm.
- Área de barrido mínima de 35 cm de largo por 8 cm de ancho por 10 cm de alto
- Mango de madera proveniente de explotación forestal sostenible certificada ( FSC, PEFC o equivalentes) y/o Mango y Fibra de plástico (reciclado o nuevo) de polipropileno (PP) o polietileno (PE) y/o cabo metálico que no contenga material plastificado
- No debe contener PVC u otros plásticos con cloro. 
- Cabo de madera 140cm elaborada con fibra natural, con soporte para colgar, con capucha plástica protectora que evita que se desprendan las fibras o se deformen', 'Unidad', '0', true),
  ('Mango metálico escoba 1 (Compra)', '- Extensión mínima de 140 cm
 -Acople plástico o rosca para palos de escoba', 'Unidad', '0', true),
  ('Mango madera escoba 1 (Compra)', '- Extensión mínima de 140 cm
 -Acople plástico o rosca para palos de escoba', 'Unidad', '1', true),
  ('Cepillos 1 (Compra)', '- Tipo plancha, con mango de plástico
- Cuerpo elaborado en plástico
- Cerdas duras en fibra plástica
- Tamaño mínimo de 15 cm de largo por 5cm de ancho por 6 cm de alto.', 'Unidad', '0', true),
  ('Cepillos 2 (Compra)', '- Para pisos
- Cuerpo elaborado en plástico
- Cerdas duras en fibra plástica
- Tamaño mínimo de 23 cm de largo por 6 cm de ancho por 7 cm de alto.
- Mango metálico con una extensión mínima de
140 cm', 'Unidad', '0', true),
  ('Cepillos 3 (Compra)', '- Para pisos
- Cuerpo elaborado en plástico
- Cerdas duras en fibra plástica
- Tamaño mínimo de 35 cm de largo por 6 cm de ancho por 7 cm de alto.
- Mango metálico con una extensión mínima de
140 cm', 'Unidad', '0', true),
  ('Trapero 1 (Compra)', '- Elaborado con hilaza de algodón natural
 - Mecha con peso mínimo 250 gr y extensión mínima de 32 cm de  largo
 - Material de base en plástico con acople tipo rosca', 'Unidad', '0', true),
  ('Trapero 2 (Compra)', '- Elaborado con hilaza de algodón natural
- Mecha con peso mínimo de 350 gr y extensión mínima de 32 cm de largo
- Material de base en plástico con acople tipo rosca', 'Unidad', '0', true),
  ('Trapero 3 (Compra)', '- Elaborado con hilaza de algodón natural
- Mecha con peso mínimo de 435 gr y extensión mínima de 32 cm de largo
- Material de base en plástico con acople tipo rosca', 'Unidad', '1', true),
  ('Trapero 4 (Compra)', '- Trapero con cabo en madera 
- Mecha con peso mínimo de 400 gr y extensión mínima de 1.40 cm de largo
- Mango de madera proveniente de explotación forestal sostenible certificada ( FSC, PEFC o equivalentes) y/o cabo metálico que no contenga material plastificado
- Fibras en tela , algodón o pabilo de fibra de Rayón. 
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad', '0', true),
  ('Mango metálico trapero (Compra)', '- Extensión mínima de 140 cm
- Acople plástico o rosca para palos de escoba', 'Unidad', '0', true),
  ('Mango madera trapero (Compra)', '- Extensión mínima de 140 cm
- Acople plástico o rosca para palos de escoba', 'Unidad', '1', true),
  ('Cepillo para sanitario (churrusco) (Compra)', '- Cerdas duras elaboradas en fibras plásticas
- Extensión mínima de las cerdas es de 2,5 cm
- Base y mango elaborados en plástico
- Mango con longitud mínima de 33 cm (incluida la medida del cepillo)', 'Unidad', '1', true),
  ('Pads 1 (Compra)', '- Para brillo
- Diámetro mínimo de 16 pulgadas
- Rojo o blanco', 'Unidad', '0', true),
  ('Pads 2 (Compra)', '- Para remoción
- Diámetro mínimo de 16 pulgadas
- Café o negro', 'Unidad', '0', true),
  ('Pads 3 (Compra)', '- Para brillo
- Diámetro mínimo de 20 pulgadas
- Rojo o blanco', 'Unidad', '0', true),
  ('Pads 4 (Compra)', '- Para remoción
- Diámetro mínimo de 20 pulgadas
- Café o negro', 'Unidad', '0', false),
  ('Pads 5 (Compra)', '- Pad de fibras para máquinas de baja densidad para lavado suave de mantención, remueve marcas, suciedad y derrames. 
- Diámetro: 17" 
- Color: blanco. 
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad', '0', false),
  ('Boneth 1 (Compra)', '- Diámetro mínimo de 16 pulgadas
- Elaborado en hilaza de algodón', 'Unidad', '0', true),
  ('Boneth 2 (Compra)', '- Diámetro mínimo de 20 pulgadas
- Elaborado en hilaza de algodón', 'Unidad', '0', true),
  ('Bolsas plásticas 1 (Compra)', '- Elaborada en polietileno de baja densidad
- De color negro
- Calibre de mínimo 1
- Tamaño de 40 cm de ancho por 55 cm de largo', 'Paquete de mínimo 6', '8', true),
  ('Bolsas plásticas 2 (Compra)', '- Elaborada en polietileno de baja densidad
- De color verde
- Calibre de mínimo 1
- Tamaño de 40 cm de ancho por 55 cm de largo', 'Paquete de mínimo 6', '0', true),
  ('Bolsas plásticas 3 (Compra)', '- Elaborada en polietileno de baja densidad
- De color blanco
- Calibre de mínimo 1
- Tamaño de 40 cm de ancho por 55 cm de largo', 'Paquete de mínimo 6', '0', true),
  ('Bolsas plásticas 4 (Compra)', '- Elaborada en polietileno de baja densidad
- De color rojo
- Calibre de mínimo 1
- Tamaño de 40 cm de ancho por 55 cm de largo
 - Con impresión de aviso de riesgo biológico', 'Paquete de mínimo 6', '0', false),
  ('Bolsas plásticas 8 (Compra)', '- Elaborada en polietileno de baja densidad
- De color negro
-Calibre de mínimo 2
- Tamaño de 60 cm de ancho por 70 cm de largo', 'Paquete de mínimo 6', '0', true),
  ('Bolsas plásticas 9 (Compra)', '- Elaborada en polietileno de baja densidad
- De color verde
- Calibre de mínimo 2
- Tamaño de 60 cm de ancho por 70 cm de largo', 'Paquete de mínimo 6', '0', true),
  ('Bolsas plásticas 10 (Compra)', '- Elaborada en polietileno de baja densidad
- De color blanco
- Calibre de mínimo 2
- Tamaño de 60 cm de ancho por 70 cm de largo', 'Paquete de mínimo 6', '0', true),
  ('Bolsas plásticas 11 (Compra)', '- Elaborada en polietileno de baja densidad
- De color rojo
- Calibre de mínimo 2
- Tamaño de 60 cm de ancho por 70 cm de largo
- Con impresión de aviso de riesgo biológico', 'Paquete de mínimo 6', '0', false),
  ('Bolsas plásticas 15 (Compra)', '- Elaborada en polietileno de baja densidad
- De color negro
- Calibre de mínimo 2
- Tamaño de 70 cm de ancho por 90 cm de largo', 'Paquete de mínimo 6', '0', true),
  ('Bolsas plásticas 16 (Compra)', '- Elaborada en polietileno de baja densidad
- De color verde
- Calibre de mínimo 2
- Tamaño de 70 cm de ancho por 90 cm de largo', 'Paquete de mínimo 6', '0', true),
  ('Bolsas plásticas 17 (Compra)', '- Elaborada en polietileno de baja densidad
- De color blanco
- Calibre de mínimo 2
- Tamaño de 70 cm de ancho por 90 cm de largo', 'Paquete de mínimo 6', '0', true),
  ('Bolsas plásticas 18 (Compra)', '- Elaborada en polietileno de baja densidad
- De color rojo
- Calibre de mínimo 2
- Tamaño de 70 cm de ancho por 90 cm de largo
- Con impresión de aviso de riesgo biológico', 'Paquete de mínimo 6', '0', false),
  ('Bolsas plásticas 21 (Compra)', '- Elaborada en polietileno de baja densidad
- De color negro
- Calibre de mínimo 3
- Tamaño de 80 cm de ancho por 110 cm de largo', 'Paquete de mínimo 6', '10', true),
  ('Bolsas plásticas 22 (Compra)', '- Elaborada en polietileno de baja densidad
- De color verde
- Calibre de mínimo 3
- Tamaño de 80 cm de ancho por 110 cm de largo', 'Paquete de mínimo 6', '10', true),
  ('Bolsas plásticas 23 (Compra)', '- Elaborada en polietileno de baja densidad
- De color blanco
-Calibre de mínimo 3
- Tamaño de 80 cm de ancho por 110 cm de largo', 'Paquete de mínimo 6', '10', true),
  ('Bolsas plásticas 24 (Compra)', '- Elaborada en polietileno de baja densidad
- De color rojo
-Calibre de mínimo 3
- Tamaño de 80 cm de ancho por 110 cm de largo
- Con impresión de aviso de riesgo biológico', 'Paquete de mínimo 6', '0', false),
  ('Guantes 1 (Compra)', '- Tipo doméstico
- Elaborados en látex
- Calibre mínimo de 18
- Tallas 7 a 9 o S a XL
- Color amarillo', 'Par', '1', true),
  ('Guantes 2 (Compra)', '- Tipo doméstico
- Elaborados en látex
- Calibre mínimo de 18
- Tallas 7 a 9 o S a XL
- Color negro', 'Par', '0', true),
  ('Guantes 3 (Compra)', '- Tipo doméstico
- Elaborados en látex
- Calibre mínimo de 25
- Tallas 7 a 9 o S a XL
- Color negro', 'Par', '0', true),
  ('Guantes 4 (Compra)', '- Tipo doméstico
- Elaborados en látex
- Calibre mínimo de 25
- Tallas 7 a 9 o S a XL
- Color rojo', 'Par', '1', true),
  ('Guantes 5 (Compra)', '- Tipo industrial
- Elaborados en látex
- Calibre mínimo de 35
- Tallas 7 a 9 o S a XL
- Color negro', 'Par', '1', true),
  ('Guantes 6 (Compra)', '- Elaborados en látex desechable (tipo cirugía)
- Empovaldos
- Tallas XS a XXL', 'Caja de mínimo 100 unidades', '0', false),
  ('Guantes 7 (Compra)', '- Elaborados en carnaza
- Tallas 7 a 9 o S a XL', 'Par', '0', false),
  ('Guantes 8 (Compra)', '- Tipo mosquetero
- Calibre mínimo de 40
- Tallas 7 a 9 o S a XL
- Color negro', 'Par', '0', false),
  ('Guantes 9 (Compra)', '- Elaborados en hilaza
- Tallas 7 a 9 o S a XL', 'Par', '0', false),
  ('Tapabocas Desechable (Compra)', '- Elaborado en tela no tejida
- Desechable
- Con tiras elásticas', 'Caja de mínimo 50 unidades', '0', true),
  ('Tapabocas Industrial (Compra)', '- Material no tejido suave con filtro
- Color blanco y negro
- Uso civil o medico
- Clip nasal ajustable', 'Caja de mínimo 50 unidades', '0', true),
  ('Papel higiénico 1 (Compra)', '- Rollo con longitud mínima de 20 metros
 - Doble hoja blanca
 - Sin fragancia', 'Rollo', '4', true),
  ('Papel higiénico 2 (Compra)', '- Rollo con longitud mínima de 250 metros
- Doble hoja de color natural
- Sin fragancia', 'Rollo', '0', true),
  ('Papel higiénico 3 (Compra)', '- Rollo con longitud mínima de 250 metros
- Doble hoja de color natural
- Sin fragancia', 'Paca X 4 rollos', '0', true),
  ('Papel higiénico 4 (Compra)', '- Rollo con longitud mínima de 250 metros
- Doble hoja blanca
- Sin fragancia', 'Rollo', '0', true),
  ('Papel higiénico 5 (Compra)', '- Rollo con longitud mínima de 250 metros
- Doble hoja blanca
- Sin fragancia', 'Paca X 4 rollos', '8', true),
  ('Papel higiénico 6 (Compra)', '- Rollo con longitud mínima de 400 metros
- Hoja sencilla de color natural
- Sinfragancia', 'Rollo', '0', true),
  ('Papel higiénico 7 (Compra)', '- Rollo con longitud mínima de 400 metros
- Hoja sencilla de color natural
- Sinfragancia', 'Paca X 4 rollos', '0', true),
  ('Papel higiénico 8 (Compra)', '- Rollo con longitud mínima de 400 metros
 - Hoja sencilla de color blanco
 - Sin fragancia', 'Rollo', '0', true),
  ('Papel higiénico 9 (Compra)', '- Rollo con longitud mínima de 400 metros
 - Hoja sencilla de color blanco
 - Sin fragancia', 'Paca X 4 rollos', '0', true),
  ('Toallas para manos 1 (Compra)', '- Rollo con longitud mínima de 100 metros
- Doble hoja con un tamaño mínimo 15 cm de ancho
- Disponibles en color blanco', 'Rollo', '0', false),
  ('Toallas para manos 2 (Compra)', '- Rollo con longitud mínima de 100 metros
- Doble hoja con un tamaño mínimo 15 cm de ancho
- Disponibles en color natural', 'Rollo', '0', true),
  ('Toallas para manos 3 (Compra)', '- Rollo con longitud mínima de 150 metros
 - Doble hoja con un tamaño mínimo 15 cm de ancho
 - Disponibles en color blanco
 - Sin olor o fragancia', 'Rollo', '0', true),
  ('Toallas para manos 4 (Compra)', '- Rollo con longitud mínima de 150 metros
 - Doble hoja con un tamaño mínimo 15 cm de ancho
 - Disponibles en color natural
 - Sin fragancia', 'Rollo', '9', true),
  ('Toallas para manos 5 (Compra)', '- Toallas interdobladas, paquete con mínimo 150 unidades
- Doble hoja con un tamaño mínimo de 20 cm de largo por 15 cm de ancho
 - Hoja color natural', 'Unidad', '0', true),
  ('Toallas para manos 6 (Compra)', '- Toallas interdobladas, paquete con mínimo 150 unidades
- Doble hoja con un tamaño mínimo de 20 cm de largo por 15 cm de ancho
 - Hoja color blanco', 'Unidad', '0', true),
  ('Toallas para manos 7 (Compra)', '- Toallas con precorte
- Rollo con longitud mínima de 100 metros
- Doble hoja con tamaño mínimo de 15 cms de ancho
- Color Blanco
- Sin fragancia', 'Unidad', '0', false),
  ('Toallas para manos 8 (Compra)', '- Toallas con precorte
- Rollo con longitud mínima de 100 metros
- Doble hoja con tamaño mínimo de 15 cms de ancho
- Color Natural
- Sin fragancia', 'Unidad', '0', false),
  ('Pañuelos (Compra)', '- Doble hoja
- Color blanco', 'Caja de mínimo 50 unidades', '0', false),
  ('Vasos biodegradables 1 (Compra)', '- Elaborado en cartón 97% biodegradable
- Capacidad mínima de 4 oz', 'Paquete de mínimo 50 unidades', '0', true),
  ('Vasos biodegradables 2 (Compra)', '- Elaborado en cartón 97% biodegradable
 - Capacidad mínima de 6 oz', 'Paquete de mínimo 50', '10', true),
  ('Vasos biodegradables 3 (Compra)', '- Elaborado en cartón 97% biodegradable
- Capacidad mínima de 9 oz', 'Paquete de mínimo 40 unidades', '0', true),
  ('Vasos biodegradables 4 (Compra)', '- Capacidad mínima de 9 onzas 
- Sin tapa 
- Liso
- Biodegradable y compostable.
- Elaborado en polyboard (cartón)  y/ocon la fibra de caña de azúcar o almidón de maíz', 'Paquete de mínimo 50 unidades', '0', true),
  ('Mezclador 1 (Compra)', '- Mezcladores  elaborados en madera y/o apartir de recursos renovables como la caña de azucar y/o almidón de maíz
- Longitud mínima de 11 cm', 'Paquete de mínimo 500', '2', false),
  ('Servilleta papel (Compra)', '- Tipo cafetería
 - Dobe hoja
- Color blanco
- Dimensiones mínimas de 20 cm de largo y 12 cm de ancho
- 100% Biodegradable 
- Elaborado a base de papel reciclado no clorado
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Paquete de mínimo 100 unidades', '1', true),
  ('Filtro para greca 1 (Compra)', '- Elaborada en tela
- Para greca
- Capacidad de media libra
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje', 'Unidad', '1', true),
  ('Filtro para greca 2 (Compra)', '- Elaborada en tela
- Para greca
- Capacidad de una 1 libra
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad', '0', true),
  ('Filtro para greca 3 (Compra)', '- Elaborada en tela
- Para greca
- Capacidad de dos 2 libras
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad', '0', true),
  ('Churrusco para tubos de greca (Compra)', '- Cepillo para lavado y fregado de grecas.  
- No debe contener PVC, Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.
- Base y mango elaborados en alambre', 'Unidad', '0', true),
  ('Papel Aluminio 1 (Compra)', '- Longitud mínima del rollo de 40 metros
- Ancho mínimo del rollo de 27 cm', 'Caja de carton con un 1 rollo de mínimo 40 metros de largo y 27
cm de ancho', '0', false),
  ('Papel Aluminio 2 (Compra)', '- Longitud mínima del rollo de 100 metros
- Ancho mínimo del rollo de 27 cm', 'Caja de carton con un 1 rollo de mínimo 100 metros de largo y 27
cm de ancho', '0', false),
  ('Película transparente para alimentos (Compra)', '- Longitud mínima del rollo de 50 metros
- Ancho mínimo del rollo de 27 cm', 'Caja de carton con un 1 rollo', '0', true),
  ('Termo para café 1 (Compra)', '- Elaborado en plástico
- Capacidad mínima de 1 litro', 'Unidad', '1', true),
  ('Termo para café 2 (Compra)', '- Térmico, con bomba tipo dispensador. Portatil.  
 - Bomba manual para dispensar la bebida.  
 - Acero inoxidable y plastico. 
 - Agarradera plastica, tapa con empaque, bomba manual. 
 - Capacidad mínima de 3 litros', 'Unidad', '1', true),
  ('Café 1 (Compra)', '- 100% café tostado y molido.   
- Tostión media.                                          
- Denominación de Origen (Anexo 6)
- Empacada en bolsa de polipropileno aluminizada resistente a la humedad y al oxígeno.  
- Debe cumplir con las Resoluciones 333 de 2011 y 2674 de 2013 hasta la entrada en vigencia de la Resolución 810 de 2021 y aquellas que la modifiquen, adicionen o deroguen.
- Para cambio de marca, se requiere certificar la cadena de distribución.', 'Libra', '10', true),
  ('Café 2 (Compra)', '- Tostión media
- Descafeinado
- Empacado en bolsa de polipropileno aluminizada resistente a la humedad y al oxigeno
- Debe cumplir con las Resoluciones 333 de 2011 y 2674 de 2013 y aquellas que la modifiquen, adicionen o deroguen.', 'Libra', '0', true),
  ('Café 3 (Compra)', '- Instantáneo, para máquinas automáticas
- Tostión media
- Empacada en bolsa de polipropileno aluminizada resistente a la humedad y al oxígeno.  
- Debe cumplir con las Resoluciones 333 de 2011 y 2674 de 2013 hasta la entrada en vigencia de la Resolución 810 de 2021 y aquellas que la modifiquen, adicionen o deroguen.', 'Bolsa de mínimo 500 g', '0', true),
  ('Crema para café (Compra)', '- No láctea
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Bolsas de mínimo 100 sobres de mínimo 4 g', '5', false),
  ('Azúcar 1 (Compra)', '- Blanca
- Empaque elaborado en materiales atóxicos
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Bolsa de mínimo 200 sobres o tubipacks de 5 g', '7', true),
  ('Azúcar 2 (Compra)', '- Blanca
- Empaque elaborado en materiales atóxicos
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Bolsa de mínimo 200 sobres o tubipacks de 3,5 g', '0', true),
  ('Azúcar 3 (Compra)', '- Blanca
- Empaque elaborado en materiales atóxicos
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Libra', '0', true),
  ('Azúcar 4 (Compra)', '- Morena
- Empaque elaborado en materiales atóxicos
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Libra', '0', true),
  ('Endulzante (Compra)', '- Sin calorías
- Empaque elaborado en materiales atóxicos
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Caja de mínimo 100 sobres', '0', false),
  ('Panela (Compra)', '- Panela instantánes pulverizada, deshidratada
- Debe cumplir con la NTC 1311 sobreo productos agrícolas
- Empaque elaborado en materiales atóxicos
- Debe cumplir con la Resolucion 779 de 2006
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Bolsa de mínimo 100 sobres de mínimo 5 g', '0', true),
  ('Panela pulverizada 1 (Compra)', '- Panela instantánea, deshidratada
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 12 meses de vida útil desde la fecha de fabricación', 'Bolsa de mínimo 500g', '0', true),
  ('Panela pulverizada 2 (Compra)', '- Panela instantánea, deshidratada
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 12 meses de vida útil desde la fecha de fabricación', 'Bolsa de mínimo 10 Kg', '0', true),
  ('Panela pulverizada 3 (Compra)', '- Panela instantánea, deshidratada
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 12 meses de vida útil desde la fecha de fabricación', 'Bolsa de mínimo 25 Kg', '0', true),
  ('Panela pulverizada 4 (Compra)', '- Contiene sachets de mínimo 6g
- Panela instantánea, deshidratada
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 12 meses de vida útil desde la fecha de fabricación', 'Bolsa de mínimo 10 unidades', '0', true),
  ('Panela pulverizada 5 (Compra)', '- Contiene sachets de mínimo 6g
- Panela instantánea, deshidratada
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 12 meses de vida útil desde la fecha de fabricación', 'Bolsa de mínimo 15 unidades', '0', true),
  ('Panela pulverizada 6 (Compra)', '- Contiene sachets de mínimo 6g
- Panela instantánea, deshidratada
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 12 meses de vida útil desde la fecha de fabricación', 'Bolsa de mínimo 100 unidades', '0', true),
  ('Panela saborizada 1 (Compra)', '- Contiene sachets de 6g
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 6 meses de vida útil desde la fecha de fabricación
- Sabores: Naranja, Jengibre, Papayuela, Frutos rojos, Maracuyá, Limoncillo', 'Bolsa de 100 unidades', '0', true),
  ('Panela saborizada 2 (Compra)', '- Contiene cubos de 6g
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 6 meses de vida útil desde la fecha de fabricación
- Sabores: Naranja, Jengibre, Papayuela, Frutos rojos, Maracuyá, Limoncillo', 'Caja de 48', '0', true),
  ('Sal 1 (Compra)', '- Refinada, con un 99,9% de pureza
- Con adiciones de yodo y flúor
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Libra (500 g)', '0', false),
  ('Sal 2 (Compra)', '- Refinada, con un 99,9% de pureza
- Con adiciones de yodo y flúor
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', '1 kg (1.000 g)', '0', false),
  ('Sal 3 (Compra)', '- Refinada, con un 99,9% de pureza
- Con adiciones de yodo y flúor
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Salero de mínimo 130 g', '0', false),
  ('Aromática con panela 1 (Compra)', '- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Debe cumplir con la Resolución 779 de 2006
- Mínimo 12  meses de vida útil desde la fecha de fabricación
- Sabores: Naranja, Jengibre, Papayuela, Frutos rojos, Maracuyá, Limoncillo (Entrega mínima de 3 sabores)
- 100% natural', 'Bolsa de 1000g', '0', true),
  ('Aromática con panela 2 (Compra)', '- Contiene sobres de mínimo 6g
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Debe cumplir con la Resolución 779 de 2006
- Mínimo 12  meses de vida útil desde la fecha de fabricación
- Sabores: Naranja, Jengibre, Papayuela, Frutos rojos, Maracuyá, Limoncillo (Entrega mínima de 3 sabores)
- 100% natural', 'Caja de 20 unidades', '0', true),
  ('Aromática con panela 3 (Compra)', '- Contiene sobres de mínimo 6g
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Debe cumplir con la Resolución 779 de 2006
- Mínimo 12  meses de vida útil desde la fecha de fabricación
- Sabores: Naranja, Jengibre, Papayuela, Frutos rojos, Maracuyá, Limoncillo (Entrega mínima de 3 sabores)
- 100% natural', 'Caja de 100 unidades', '0', true),
  ('Aromática de fruta 1 (Compra)', '- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 12  meses de vida útil desde la fecha de fabricación
- Sabores: Papayuela, Mora, Maracuya, Uchuva, Uva, Fresa, Piña, Durazno, Naranja, Manzana y Arandano (Entrega mínima de 3 sabores)
- 100% natural', 'Bolsa de 1000g', '0', true),
  ('Aromática de fruta 2 (Compra)', '- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 12  meses de vida útil desde la fecha de fabricación
- Sabores: Papayuela, Mora, Maracuya, Uchuva, Uva, Fresa, Piña, Durazno, Naranja, Manzana y Arandano (Entrega mínima de 3 sabores)
- 100% natural', 'Caja de 20 unidades', '10', true),
  ('Aromática de fruta 3 (Compra)', '- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 12  meses de vida útil desde la fecha de fabricación
- Sabores: Papayuela, Mora, Maracuya, Uchuva, Uva, Fresa, Piña, Durazno, Naranja, Manzana y Arandano (Entrega mínima de 3 sabores)
- 100% natural', 'Caja de 100 unidades', '0', true),
  ('Aromática de panela (Compra)', '- Para infusión
- Cajas disponbiles en sabor limón, yerbabuena, canela y naranja
- Panela 100% natural y ecológica
- Embalaje en cartón corrugado  
- Debe cumplir con la NTC 1311 sobre productos agrícolas 
- Empaque elaborado en materiales atóxicos 
- Debe cumplir con la Resolucion 779 de 2006 
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen. 
- Uso: Panela instantánea soluble al agua 
- Azúcares reductores expresados en glucosa, mínimo 5,74%; azúcares no reductores expresados en sacarosa, máximo 90%; proteínas, mínimo 0,2%; cenizas, mínimo 1%; humedad, máximo 5%; plomo expresado como As en mg/kg, máximo 0,1;
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Cajas de mínimo 20 en sobres.', '0', true),
  ('Bebida de frutas (Compra)', '- Contiene sobres de mínimo 1,4g, para diluir
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 12  meses de vida útil desde la fecha de fabricación
- Sabores: Papayuela, Mora, Maracuya, Uchuva, Uva, Fresa, Piña, Durazno, Naranja, Manzana y Arandano', 'Caja de mínimo 20 sobres', '0', true),
  ('Bebida de panela (Compra)', '- Contiene sobres de mínimo 1,4g, para diluir
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Debe cumplir con la Resolución 779 de 2006
- Mínimo 12  meses de vida útil desde la fecha de fabricación
- Sabores: Naranja, Jengibre, Papayuela, Frutos rojos, Maracuyá, Limoncillo', 'Caja de mínimo 20 sobres', '0', true),
  ('Té (Compra)', '- Para infusión
- Cajas disponbiles en mínimo tres (3) sabores
- 100% naturales', 'Caja x 20 mínimo sobres', '0', true),
  ('Agua potable 1 (Compra)', '- Agua potable purificada sin gas', 'Botella plástica de
mínimo 300 ml', '0', true),
  ('Agua potable 2 (Compra)', '- Agua potable purificada sin gas', 'Botella plástica de
mínimo 600 ml', '0', true),
  ('Agua potable 3 (Compra)', '- Agua potable purificada
-  Con gas', 'Botella plástica de
mínimo 600 ml', '0', true),
  ('Agua potable 4 (Compra)', '- Agua potable potable purificada', 'Botellón de mínimo 18.9 L', '0', true),
  ('Válvula dispensadora para botellón de agua (Compra)', '-Válvula en material plástico con boquilla ajustable a los diferentes tipos de botellones', 'Unidad', '0', true),
  ('Servilleta de tela (Compra)', '- Elaborada en tela
- Color blanco
- Dimensiones mínimas de 40 cm de largo y 40 cm de ancho.', 'Unidad', '0', false),
  ('Cepillo para paredes y techos (Compra)', '- Cuerpo elaborado en plástico
 - Cerdas duras en fibra plástica
 - Largo mínimo de 140 cm', 'Unidad', '0', true),
  ('Brillador 1 (Compra)', '- Mopa elaborada en algodón
- Área de barrido mínima de 90 cm de largo por 16cm de ancho
- Armazón y mango metálico', 'Unidad', '0', true),
  ('Brillador 2 (Compra)', '- Mopa elaborada en algodón
- Área de barrido mínima de 60 cm de largo por 16cm de ancho
- Armazón y mango metálico', 'Unidad', '0', true),
  ('Repuestos brillador 1 (Compra)', '- Mopa elaborada en algodón
- Área de barrido mínima de 90 cm de largo por 16 cm de ancho', 'Unidad', '0', true),
  ('Repuestos brillador 2 (Compra)', '- Mopa elaborada en algodón
- Área de barrido mínima de 60 cm de largo por 16 cm de ancho', 'Unidad', '0', true),
  ('Destapador para sanitario (chupa) (Compra)', '- Tipo campana
- Chupa elaborada en caucho
- Diámetro mínimo de 12 cm
- Mango elaborado en madera
- Mango con longitud mínima de 33 cm', 'Unidad', '0', true),
  ('Plumero o limpia polvo (Compra)', '- Fibras sintéticas
- Mango de plástico
- Largo total mínimo de 65 cm
- Electrostático', 'Unidad', '0', false),
  ('Rastrillo 1 (Compra)', '- Barra dentada plástica con mínimo 18 dientes
- Mango metálico  plastificado con longitud mínima de 120 cm', 'Unidad', '0', true),
  ('Rastrillo 2 (Compra)', '- Barra dentada metálica con mínimo 18 dientes
- Mango metálico plastificado con longitud mínima de 120 cm', 'Unidad', '0', true),
  ('Recogedor de basura 1 (Compra)', '- Elaborado en plástico
- Con banda de goma y dientas barrescobas
- Mango con longitud mínima de 70 cm', 'Unidad', '1', true),
  ('Recogedor de basura 2 (Compra)', '- Elaborado en plástico
 - Plegable, con tapa que abre y cierra', 'Unidad', '0', true),
  ('Atomizadores (Compra)', '- Elaborado en plástico
- Reutilizable
- Capacidad mínima de 500 cc
- con pistola', 'Unidad', '1', true),
  ('Caneca para almacenar ropa sucia  (Compra)', '- Elaborado en plástico
- Dimensiones mínimas de 50 cm de alto por 30 cm de ancho
- Incluye tapa
- En colores variados', 'Unidad', '0', false),
  ('Vasos  1 (Arrendamiento)', '- Elaborado en vidrio
- Cilíndrico
- Capacidad mínima de 9 oz', 'Unidad', '0', false),
  ('Vasos  1 (Compra)', '- Elaborado en vidrio
- Cilíndrico
- Capacidad mínima de 9 oz', 'Unidad', '0', true),
  ('Vasos  2 (Arrendamiento)', '- Elaborado en vidrio
- Cilíndrico
- Capacidad mínima de 12 oz', 'Unidad', '0', false),
  ('Vasos  2 (Compra)', '- Elaborado en vidrio
- Cilíndrico
- Capacidad mínima de 12 oz', 'Unidad', '0', true),
  ('Cuchara  (Compra)', '- Elaboradas en acero inoxidable
- Longitud total mínima de 17 cm', 'Unidad', '0', false),
  ('Tenedor  (Compra)', '- Elaborados en acero inoxidable
- lisos
- Longitud total mínima de 17 cm', 'Unidad', '0', false),
  ('Cuchillo  (Compra)', '- Elaborados en acero inoxidable
- lisos
- Longitud total mínima de 20 cm', 'Unidad', '0', false),
  ('Cuchara pequeña  (Compra)', '- Elaborados en acero inoxidable
- lisos
- Longitud total mínima de 12 cm', 'Unidad', '0', false),
  ('Platos  1 (Arrendamiento)', '- Elaborados en porcelana blanca
- Llanos
- Color blanco sin diseño
- Diámetro mínimo de 26 cm
- Apto para uso en horno microondas', 'Unidad', '0', false),
  ('Platos  1 (Compra)', '- Elaborados en porcelana blanca
- Llanos
- Color blanco sin diseño
- Diámetro mínimo de 26 cm
- Apto para uso en horno microondas', 'Unidad', '0', false),
  ('Platos  2 (Arrendamiento)', '- Elaborados en porcelana blanca
- Llanos
- Color blanco sin diseño
- Diámetro mínimo de 22 cm
- Apto para uso en horno microondas', 'Unidad', '0', false),
  ('Platos  2 (Compra)', '- Elaborados en porcelana blanca
- Llanos
- Color blanco sin diseño
- Diámetro mínimo de 22 cm
- Apto para uso en horno microondas', 'Unidad', '0', false),
  ('Platos  3 (Arrendamiento)', '- Elaborados en porcelana blanca
- Llanos
- Color blanco sin diseño
- Diámetro mínimo de 16 cm
- Apto para uso en horno microondas', 'Unidad', '0', false),
  ('Platos  3 (Compra)', '- Elaborados en porcelana blanca
- Llanos
- Color blanco sin diseño
- Diámetro mínimo de 16 cm
- Apto para uso en horno microondas', 'Unidad', '0', false),
  ('Platos  4 (Arrendamiento)', '- Elaborados en porcelana blanca
- Hondo
- Color blanco sin diseño
- Diámetro mínimo de 17 cm
- Apto para uso en horno microondas', 'Unidad', '0', false),
  ('Platos  4 (Compra)', '- Elaborados en porcelana blanca
- Hondo
- Color blanco sin diseño
- Diámetro mínimo de 17 cm
- Apto para uso en horno microondas', 'Unidad', '0', false),
  ('Platos  5 (Arrendamiento)', '- Elaborados en porcelana blanca
- Hondo
- Color blanco  sin diseño
- Diámetro mínimo de 22 cm
- Apto para uso en horno microondas', 'Unidad', '0', false),
  ('Platos  5 (Compra)', '- Elaborados en porcelana blanca
- Hondo
- Color blanco  sin diseño
- Diámetro mínimo de 22 cm
- Apto para uso en horno microondas', 'Unidad', '0', false),
  ('Pocillos  (Arrendamiento)', '- Elaborado en porcelana blanca para café
- Sin diseño
- De mínimo 150 cc
- No se debe rayar con el uso de cubiertos
- Debe ser apta para uso en microondas', 'Unidad', '0', false),
  ('Pocillos  (Compra)', '- Elaborado en porcelana blanca para café
- Sin diseño
- De mínimo 150 cc
- No se debe rayar con el uso de cubiertos
- Debe ser apta para uso en microondas', 'Unidad', '0', false),
  ('Juego de cubiertos  (Compra)', '- Elaborados en acero inoxidable
- Incluye cuchillo (longitud mínima de 20 cm), tenedor (longitud mínima de 17 cm), cuchara (longitud mínima de 17 cm), cuchara pequeña para postre (longitud mínima de 12 cm) y tenedor pequeño (longitud mínima de 12 cm).', 'Juego de 6 puestos', '0', true),
  ('Terno para café (Arrendamiento)', '-Pocillo y plato de porcelana blanca para café.
- Sin diseño
- Plato de mínimo 12 cm de diámetro y pocillo de mínimo 150 cc
- No se debe rayar con el uso de los cubiertos y
debe ser apta para uso en horno microondas.', 'Juego', '0', false),
  ('Terno para café (Compra)', '-Pocillo y plato de porcelana blanca para café.
- Sin diseño
- Plato de mínimo 12 cm de diámetro y pocillo de mínimo 150 cc
- No se debe rayar con el uso de los cubiertos y
debe ser apta para uso en horno microondas.', 'Juego', '0', false),
  ('Vajilla  1 (Arrendamiento)', '- Elaborada en porcelana
- Sin diseño
- Compuesta de 8 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 16 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas.', 'Juego', '0', false),
  ('Vajilla  1 (Compra)', '- Elaborada en porcelana
- Sin diseño
- Compuesta de 8 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 16 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas.', 'Juego', '0', false),
  ('Vajilla  2 (Arrendamiento)', '- Elaborada en porcelana
- Sin diseño
- Compuesta de 4 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 16 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas.', 'Juego', '0', false),
  ('Vajilla  2 (Compra)', '- Elaborada en porcelana
- Sin diseño
- Compuesta de 4 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 16 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas.', 'Juego', '0', false),
  ('Cuchillo de cocina  (Compra)', '- Hoja elaborada en acero inoxidable de mínimo 20 cm de largo y 2 cm de ancho.
- Mango liso elaborado en polipropileno negro', 'Unidad', '0', true),
  ('Tijeras de cocina  (Compra)', '- Hojas elaborada en acero inoxidable de mínimo 20 cm de largo
- Mango de plástico liso', 'Unidad', '0', false),
  ('Jarra  (Arrendamiento)', '- Elaborada en vidrio
- Sin diseño
- Capacidad mínima de 1,5 litros', 'Unidad', '0', true),
  ('Jarra  (Compra)', '- Elaborada en vidrio
- Sin diseño
- Capacidad mínima de 1,5 litros', 'Unidad', '1', true),
  ('Combustible  (Compra)', '- Gasolina 
- Para cortadora de césped, sopladora de hojas y guadañas', 'Galón', '0', true),
  ('Organizador  porta escobas  (Compra)', '- Con capacidad para organizar mínimo 4 escobas de manera simultánea', 'Unidad', '0', false),
  ('Espátula  (Compra)', '- Metálica con mango de plástico
- Con hoja de mínimo 2 pulgadas de largo', 'Unidad', '0', true),
  ('Haraganes 1  (Compra)', '- Para limpiar vidrios
- Con banda de goma con longitud mínima de 25 cm.
- Mango con longitud mínima de 60 cm', 'Unidad', '0', true),
  ('Haraganes 2  (Compra)', '- Para limpiar vidrios
- Con banda de goma con longitud mínima de 50 cm.
- Mango metálico extensible con longitud mínima
de 60 cm y máxima de 150 cm', 'Unidad', '0', true),
  ('Haraganes 3  (Compra)', '- Para escurrir pisos
- Con banda de goma con longitud mínima de 35 cm
- Mango con longitud mínima de 120 cm', 'Unidad', '0', true),
  ('Haraganes 4  (Compra)', '- Para escurrir pisos
-Con banda de goma con longitud mínima de 50 cm.
- Mango metálico extensible con longitud mínima
de 60 cm y máxima de 150 cm', 'Unidad', '0', true),
  ('Haraganes 5 (Compra)', '- Para escurrir pisos
-Con banda de goma con longitud mínima de 80 cm.
- Mango metálico extensible con longitud mínima
de 60 cm y máxima de 150 cm', 'Unidad', '0', true),
  ('Balde (Arrendamiento)', '- Capacidad mínima de 10 litros
- Con manija móvil
- Con "pico" antiderrames
- Disponibles en diferentes colores
- Elaborado en material reciclable
- Marcado de acuerdo con la norma ISO 11469 y ISO 1043.', 'Unidad', '0', true),
  ('Balde (Compra)', '- Capacidad mínima de 10 litros
- Con manija móvil
- Con "pico" antiderrames
- Disponibles en diferentes colores
- Elaborado en material reciclable
- Marcado de acuerdo con la norma ISO 11469 y ISO 1043.', 'Unidad', '0', true),
  ('Plato Biodegradable 1 (Compra)', '- Plato pando, circular, sin divisiones 
- Biodegradable  
-Tamaño: 15 cm
- Sin ala
- Elaborado con la fibra de caña de azúcar o almidón de maíz
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad', '0', false),
  ('Plato Biodegradable 2 (Compra)', '- Plato pando, circular, sin divisiones 
- Biodegradable  
-Tamaño: 18 cm
- Sin ala
- Elaborado con la fibra de caña de azúcar o almidón de maíz
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad', '0', false),
  ('Pocillos 1 (Arrendamiento)', '- Elaborado en porcelana blanca para café
- De mínimo 170 cc
- No se debe rayar con el uso de cubiertos
- Debe ser apta para uso en microondas', 'Unidad', '0', false),
  ('Pocillos 1 (Compra)', '- Elaborado en porcelana blanca para café
- De mínimo 170 cc
- No se debe rayar con el uso de cubiertos
- Debe ser apta para uso en microondas', 'Unidad', '0', false),
  ('Terno para café  (Arrendamiento)', '-Pocillo y plato de porcelana blanca para café.
- Plato de mínimo 13 cm de diámetro y pocillo de mínimo 170 cc
- No se debe rayar con el uso de los cubiertos y
debe ser apta para uso en horno microondas.', 'Juego', '0', true),
  ('Terno para café  (Compra)', '-Pocillo y plato de porcelana blanca para café.
- Plato de mínimo 13 cm de diámetro y pocillo de mínimo 170 cc
- No se debe rayar con el uso de los cubiertos y
debe ser apta para uso en horno microondas.', 'Juego', '0', true),
  ('Cafetera 1 (Arrendamiento)', '- Capacidad mínima de 12 tazas
 - 120 voltios
 - Potencia mínima de 900 w
 - Filtro permanente
 - Material plástico
 - Jarra de vidrio', 'Unidad', '0', true),
  ('Cafetera 1 (Compra)', '- Capacidad mínima de 12 tazas
 - 120 voltios
 - Potencia mínima de 900 w
 - Filtro permanente
 - Material plástico
 - Jarra de vidrio', 'Unidad', '0', true),
  ('Vajilla  3 (Arrendamiento)', '- Elaborada en porcelana
- Compuesta de 8 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 17 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas', 'Juego', '0', false),
  ('Vajilla  3 (Compra)', '- Elaborada en porcelana
- Compuesta de 8 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 17 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas', 'Juego', '0', false),
  ('Vajilla  4 (Arrendamiento)', '- Elaborada en porcelana
- Compuesta de 4 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 17 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas', 'Juego', '0', false),
  ('Vajilla  4 (Compra)', '- Elaborada en porcelana
- Compuesta de 4 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 17 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas', 'Juego', '0', false),
  ('Portavasos (Arrendamiento)', '- Elaborado en acero inoxidable
- (Redondo) Diámetro mínimo de 11 o (Cuadrado) mínimo 11 cm de largo y de ancho', 'Unidad', '0', false),
  ('Portavasos (Compra)', '- Elaborado en acero inoxidable
- (Redondo) Diámetro mínimo de 11 o (Cuadrado) mínimo 11 cm de largo y de ancho', 'Unidad', '0', false),
  ('Bandeja 1 (Arrendamiento)', '- Elaborada en acero inoxidable
- Sin diseño
- Dimensiones mínimas de 37 cm de largo por 27 cm de ancho', 'Unidad', '0', true),
  ('Bandeja 1 (Compra)', '- Elaborada en acero inoxidable
- Sin diseño
- Dimensiones mínimas de 37 cm de largo por 27 cm de ancho', 'Unidad', '0', true),
  ('Bandeja 2 (Arrendamiento)', '- Elaborada en acero inoxidable
- Sin diseño
- Dimensiones mínimas de 50 cm de largo por 33 cm de ancho', 'Unidad', '0', true),
  ('Bandeja 2 (Compra)', '- Elaborada en acero inoxidable
- Sin diseño
- Dimensiones mínimas de 50 cm de largo por 33 cm de ancho', 'Unidad', '0', true),
  ('Bandeja 3 (Arrendamiento)', '- Elaborada en plástico
- Superficie antideslizante
- Diseño sencillo
- Dimensiones mínimas de 37cm de largo por 27 cm de ancho
- Color blanco o beige', 'Unidad', '0', true),
  ('Bandeja 3 (Compra)', '- Elaborada en plástico
- Superficie antideslizante
- Diseño sencillo
- Dimensiones mínimas de 37cm de largo por 27 cm de ancho
- Color blanco o beige', 'Unidad', '1', true),
  ('Bandeja 4 (Arrendamiento)', '- Elaborada en plástico
- Superficie antideslizante
- Diseño sencillo
- Dimensiones mínimas de 45 cm de largo por 35 cm de ancho
- Color blanco o beige', 'Unidad', '0', false),
  ('Bandeja 4 (Compra)', '- Elaborada en plástico
- Superficie antideslizante
- Diseño sencillo
- Dimensiones mínimas de 45 cm de largo por 35 cm de ancho
- Color blanco o beige', 'Unidad', '0', false),
  ('Olleta (Arrendamiento)', '- Elaborada en aluminio
- Capacidad mínima de 2 litros', 'Unidad', '0', false),
  ('Olleta (Compra)', '- Elaborada en aluminio
- Capacidad mínima de 2 litros', 'Unidad', '0', false),
  ('Olla 1 (Arrendamiento)', '- Elaborada en aluminio
- Con tapa en aluminio
- Capacidad mínima de 3 litros', 'Unidad', '0', false),
  ('Olla 1 (Compra)', '- Elaborada en aluminio
- Con tapa en aluminio
- Capacidad mínima de 3 litros', 'Unidad', '0', false),
  ('Olla 2 (Arrendamiento)', '- Elaborada en aluminio
- Con tapa en aluminio
- Capacidad mínima de 5 litros', 'Unidad', '0', false),
  ('Olla 2 (Compra)', '- Elaborada en aluminio
- Con tapa en aluminio
- Capacidad mínima de 5 litros', 'Unidad', '0', false),
  ('Escurridor para platos (Arrendamiento)', '- Elaborado en plástico
- Con rejilla, portacubiertos y bandeja plástica de goteo
- Dimensiones mínimas de 40 cm de largo y 30 cm de ancho', 'Unidad', '0', true),
  ('Escurridor para platos (Compra)', '- Elaborado en plástico
- Con rejilla, portacubiertos y bandeja plástica de goteo
- Dimensiones mínimas de 40 cm de largo y 30 cm de ancho', 'Unidad', '0', true),
  ('Soporte para Botellón de agua (Compra)', '- Metálico
- Plegable', 'Unidad', '0', true),
  ('Carro exprimidor de trapero 1 (Arrendamiento)', '- Elaborado en plástico
 - Capacidad mínima de 12 litros
 - Con cuatro ruedas y manija de escurridor', 'Unidad', '1', true),
  ('Carro exprimidor de trapero 1 (Compra)', '- Elaborado en plástico
 - Capacidad mínima de 12 litros
 - Con cuatro ruedas y manija de escurridor', 'Unidad', '0', true),
  ('Carro exprimidor de trapero 2 (Arrendamiento)', '- Elaborado en plástico
 - Capacidad mínima de 24 litros
 - Con cuatro ruedas y manija de escurridor', 'Unidad', '0', true),
  ('Carro exprimidor de trapero 2 (Compra)', '- Elaborado en plástico
 - Capacidad mínima de 24 litros
 - Con cuatro ruedas y manija de escurridor', 'Unidad', '0', true),
  ('Carro exprimidor de trapero 3 (Arrendamiento)', '- Elaborado en plástico
- Capacidad mínima de 35 litros
- Con cuatro ruedas y manija de escurridor', 'Unidad', '0', true),
  ('Carro exprimidor de trapero 3 (Compra)', '- Elaborado en plástico
- Capacidad mínima de 35 litros
- Con cuatro ruedas y manija de escurridor', 'Unidad', '0', true),
  ('Carros para limpieza (Arrendamiento)', '- Tamaño mínimo de 70 cm de largo por 50 cm de ancho por 95 cm de alto
- Mínimo dos bandejas de servicio
- Con mínimo una bolsa de limpieza
- Con plataforma para balde escurridor
- Con cuatro ruedas antirayones
- Ruedas delanteras con ángulo de giro de 360 grados', 'Unidad', '0', true),
  ('Carros para limpieza (Compra)', '- Tamaño mínimo de 70 cm de largo por 50 cm de ancho por 95 cm de alto
- Mínimo dos bandejas de servicio
- Con mínimo una bolsa de limpieza
- Con plataforma para balde escurridor
- Con cuatro ruedas antirayones
- Ruedas delanteras con ángulo de giro de 360 grados', 'Unidad', '0', true),
  ('Carro de bebidas (Arrendamiento)', '- Elaborado en plástico
- Mínimo dos estantes para distribución de bebidas
- Tamaño mínimo de 80 cm de largo por 47 cm de ancho por 90 cm de alto', 'Unidad', '1', true),
  ('Carro de bebidas (Compra)', '- Elaborado en plástico
- Mínimo dos estantes para distribución de bebidas
- Tamaño mínimo de 80 cm de largo por 47 cm de ancho por 90 cm de alto', 'Unidad', '0', false),
  ('Escalera 1 (Arrendamiento)', '- Cuerpo plástico
- Altura mínima de mínimo dos pasos.', 'Unidad', '0', true),
  ('Escalera 1 (Compra)', '- Cuerpo plástico
- Altura mínima de mínimo dos pasos.', 'Unidad', '0', true),
  ('Escalera 2 (Arrendamiento)', '- Cuerpo Metálico
- Altura mínima de  mínimo dos pasos.', 'Unidad', '1', true),
  ('Escalera 2 (Compra)', '- Cuerpo Metálico
- Altura mínima de  mínimo dos pasos.', 'Unidad', '0', true),
  ('Escalera 3 (Arrendamiento)', '- Cuerpo Metálico
- Altura mínima de mínimo cuatro pasos.', 'Unidad', '0', true),
  ('Escalera 3 (Compra)', '- Cuerpo Metálico
- Altura mínima de mínimo cuatro pasos.', 'Unidad', '0', true),
  ('Escalera 4 (Arrendamiento)', '- Cuerpo Metálico
- Altura mínima de mínimo seis pasos.', 'Unidad', '0', true),
  ('Escalera 4 (Compra)', '- Cuerpo Metálico
- Altura mínima de mínimo seis pasos.', 'Unidad', '0', true),
  ('Escalera de tipo industrial (Arrendamiento)', 'Cuerpo en aluminio, tipo tijera
- Altura mínima de 5 escalones
- Con capacidad de resistencia a una carga concentrada en cualquier punto del escalón de 127 kg
- Con tapones de caucho antideslizantes', 'Unidad', '0', true),
  ('Escalera de tipo industrial (Compra)', 'Cuerpo en aluminio, tipo tijera
- Altura mínima de 5 escalones
- Con capacidad de resistencia a una carga concentrada en cualquier punto del escalón de 127 kg
- Con tapones de caucho antideslizantes', 'Unidad', '0', true),
  ('Mangueras 1 (Arrendamiento)', '- Longitud mínima de 20 metros
 - Elaborada en PVC
 - Con terminales roscadas en ambos extremos
 - Incluye accesorios: acoples y pistola', 'Unidad', '0', false),
  ('Mangueras 1 (Compra)', '- Longitud mínima de 20 metros
 - Elaborada en PVC
 - Con terminales roscadas en ambos extremos
 - Incluye accesorios: acoples y pistola', 'Unidad', '0', true),
  ('Mangueras 2 (Arrendamiento)', '- Longitud mínima de 30 metros
- Elaborada en PVC
- Con terminales roscadas en ambos extremos
- Incluye accesorios: acoples y pistola', 'Unidad', '0', false),
  ('Mangueras 2 (Compra)', '- Longitud mínima de 30 metros
- Elaborada en PVC
- Con terminales roscadas en ambos extremos
- Incluye accesorios: acoples y pistola', 'Unidad', '0', true),
  ('Mangueras 3 (Arrendamiento)', '- Longitud mínima de 50 metros
- Elaborada en PVC
- Con terminales roscadas en ambos extremos
- Incluye accesorios: acoples y pistola', 'Unidad', '0', true),
  ('Mangueras 3 (Compra)', '- Longitud mínima de 50 metros
- Elaborada en PVC
- Con terminales roscadas en ambos extremos
- Incluye accesorios: acoples y pistola', 'Unidad', '0', true),
  ('Contenedor de basura 1 (Compra)', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 10 litros
- Color negro
- Impresión de la frase "Residuos no aprovechable" en la cara delantera del contenedor', 'Unidad', '0', true),
  ('Contenedor de basura 2 (Compra)', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 10 litros
- Color blanco
- Impresión de la frase "Residuos aprovechables" en la cara delantera del contenedor', 'Unidad', '0', false),
  ('Contenedor de basura 3 (Compra)', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 10 litros
- Color verde
- Impresión de la frase "Residuos orgánicos aprovechables" en la cara delantera del contenedor', 'Unidad', '0', true),
  ('Contenedor de basura 4 (Compra)', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 10 litros
- Color rojo
- Impresión de las palabras "Riesgo biológico" o "Residuos peligrosos" en la cara delantera del contenedor', 'Unidad', '0', false),
  ('Contenedor de basura 5 (Compra)', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 20 litros
- Color negro
- Impresión de la frase "Residuos no aprovechable" en la cara delantera del contenedor', 'Unidad', '0', true),
  ('Contenedor de basura 6 (Compra)', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 20 litros
- Color blanco
- Impresión de la frase "Residuos aprovechables" en la cara delantera del contenedor', 'Unidad', '0', false),
  ('Contenedor de basura 7 (Compra)', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 20 litros
- Color verde
- Impresión de la frase "Residuos orgánicos aprovechables" en la cara delantera del contenedor', 'Unidad', '0', false),
  ('Contenedor de basura 8 (Compra)', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 20 litros
- Color rojo
- Impresión de las palabras "Riesgo biológico" o "Residuos peligrosos" en la cara delantera del
contenedor', 'Unidad', '0', true),
  ('Contenedor de basura 9 (Compra)', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 50 litros
- Color negro
- Impresión de la frase "Residuos no aprovechable" en la cara delantera del contenedor', 'Unidad', '0', true),
  ('Contenedor de basura 10 (Compra)', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 50 litros
- Color blanco
- Impresión de la frase "Residuos aprovechables" en la cara delantera del contenedor', 'Unidad', '0', true),
  ('Contenedor de basura 11 (Compra)', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 50 litros
- Color verde
- Impresión de la frase  "Residuos orgánicos aprovechables" en la cara delantera del contenedor', 'Unidad', '0', true),
  ('Contenedor de basura 12 (Compra)', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 50 litros
- Color rojo
- Impresión de las palabras "Riesgo biológico" o "Residuos peligrosos" en la cara delantera del contenedor', 'Unidad', '0', false),
  ('Contenedor de basura 13 (Compra)', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 120 litros
- Color negro
- Impresión de la frase "Residuos no aprovechable" en la cara delantera del contenedor', 'Unidad', '0', false),
  ('Contenedor de basura 14 (Compra)', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 120 litros
- Color blanco
- Impresión de la frase "Residuos aprovechables" en la cara delantera del contenedor', 'Unidad', '0', false),
  ('Contenedor de basura 15 (Compra)', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 120 litros
- Color verde
- Impresión de la frase  "Residuos orgánicos aprovechables" en la cara delantera del contenedor', 'Unidad', '0', false),
  ('Contenedor de basura 16 (Compra)', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 120 litros
- Color rojo
- Impresión de las palabras "Riesgo biológico" o
"Residuos peligrosos" en la cara delantera del contenedor', 'Unidad', '0', false),
  ('Contenedor de basura 17 (Compra)', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 180 litros
- Color negro
- Con ruedas traseras macizas y manijas', 'Unidad', '0', true),
  ('Contenedor de basura 18 (Compra)', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 180 litros
- Color verde
- Con ruedas traseras macizas y manijas', 'Unidad', '0', false),
  ('Contenedor de basura 19 (Compra)', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 180 litros
- Color blanco
- Con ruedas traseras macizas y manijas', 'Unidad', '0', false),
  ('Contenedor de basura 20 (Compra)', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 240 litros
- Color negro
- Con ruedas traseras macizas y manijas', 'Unidad', '0', false),
  ('Contenedor de basura 21 (Compra)', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 240 litros
- Color verde
- Con ruedas traseras macizas y manijas', 'Unidad', '0', false),
  ('Contenedor de basura 22 (Compra)', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 240 litros
- Color blanco
- Con ruedas traseras macizas y manijas', 'Unidad', '0', false),
  ('Contenedor de basura 23 (Compra)', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 340 litros
- Color negro
- Con ruedas traseras macizas y manijas', 'Unidad', '0', false),
  ('Contenedor de basura 24 (Compra)', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 340 litros
- Color verde
- Con ruedas traseras macizas y manijas', 'Unidad', '0', false),
  ('Contenedor de basura 25 (Compra)', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 340 litros
- Color blanco
- Con ruedas traseras macizas y manijas', 'Unidad', '0', false),
  ('Contenedor de basura 26 (Compra)', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 760 litros
- Color negro
- Con ruedas traseras macizas y manijas', 'Unidad', '0', false),
  ('Contenedor de basura 27 (Compra)', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 760 litros
- Color verde
- Con ruedas traseras macizas y manijas', 'Unidad', '0', false),
  ('Contenedor de basura 28 (Compra)', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 760 litros
- Color blanco
- Con ruedas traseras macizas y manijas', 'Unidad', '0', false),
  ('Contenedor de basura 29 (Compra)', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 1.000 litros
- Color blanco
- Con ruedas traseras macizas y manijas', 'Unidad', '0', false),
  ('Contenedor de basura 30 (Compra)', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 1.000 litros
- Color verde
- Con ruedas traseras macizas y manijas', 'Unidad', '0', false),
  ('Punto Ecológico 1 (Compra)', '- Base metálica
- Mínimo tres contenedores así:
- Contenedor color verde con palabras "residuos orgánicos aprovechables: restos de comida, desechos agrícolas" en la cara frontal
- Contenedor color blanco con palabras "residuos aprovechables como plástico, vidrio, metales, multicapa, papel y cartón" en la cara frontal
- Contenedor color negro con las palabaras "residuos no aprovechables: papel higiénico, servilletas, papeles y cartones contaminados con comida, papeles metalizados" en la cara frontal
- Capacidad mínima de 20 litros para cada contenedor
- Contenedores elaborados en plástico
- Debe cumplir con lo estipualdo en el artíuculo 4° de la Resolución 2184 del 26 de diciembre de 2019', 'Unidad', '0', true),
  ('Punto Ecológico 2 (Compra)', '- Base metálica
- Mínimo tres contenedores así:
- Contenedor color verde con palabras "residuos orgánicos aprovechables: restos de comida, desechos agrícolas" en la cara frontal
- Contenedor color blanco con palabras "residuos aprovechables como plástico, vidrio, metales, multicapa, papel y cartón" en la cara frontal
- Contenedor color negro con las palabaras "residuos no aprovechables: papel higiénico, servilletas, papeles y cartones contaminados con comida, papeles metalizados" en la cara frontal
- Capacidad mínima de 35 litros para cada contenedor
- Contenedores elaborados en plástico
- Debe cumplir con lo estipualdo en el artíuclo 4° de la Resolución 2184 del 26 de diciembre de 2019', 'Unidad', '0', true),
  ('Punto Ecológico 3 (Compra)', '- Base metálica con techo en material metálico
- Mínimo tres contenedores así:
- Contenedor color verde con palabras "residuos orgánicos aprovechables: restos de comida, desechos agrícolas" en la cara frontal
- Contenedor color blanco con palabras "residuos aprovechables como plástico, vidrio, metales, multicapa, papel y cartón" en la cara frontal
- Contenedor color negro con las palabaras "residuos no aprovechables: papel higiénico, servilletas, papeles y cartones contaminados con comida, papeles metalizados" en la cara frontal
- Capacidad mínima de 35 litros para cada contenedor
- Contenedores elaborados en plástico
- Debe cumplir con lo estipualdo en el artíuclo 4° de la Resolución 2184 del 26 de diciembre de 2019', 'Unidad', '0', true),
  ('Punto Ecológico 4 (Compra)', '- Base metálica
- Mínimo tres contenedores así:
- Contenedor color verde con palabras "residuos orgánicos aprovechables: restos de comida, desechos agrícolas" en la cara frontal
- Contenedor color blanco con palabras "residuos aprovechables como plástico, vidrio, metales, multicapa, papel y cartón" en la cara frontal
- Contenedor color negro con las palabaras "residuos no aprovechables: papel higiénico, servilletas, papeles y cartones contaminados con comida, papeles metalizados" en la cara frontal
- Capacidad mínima de 50 litros para cada contenedor
- Contenedores elaborados en plástico
- Debe cumplir con lo estipualdo en el artíuclo 4° de la Resolución 2184 del 26 de diciembre de 2019', 'Unidad', '0', true),
  ('Punto Ecológico 5 (Compra)', '- Base metálica con techo en material metálico
- Mínimo tres contenedores así:
- Contenedor color verde con palabras "residuos orgánicos aprovechables: restos de comida, desechos agrícolas" en la cara frontal
- Contenedor color blanco con palabras "residuos aprovechables como plástico, vidrio, metales, multicapa, papel y cartón" en la cara frontal
- Contenedor color negro con las palabaras "residuos no aprovechables: papel higiénico, servilletas, papeles y cartones contaminados con comida, papeles metalizados" en la cara frontal
- Capacidad mínima de 50 litros para cada contenedor
- Contenedores elaborados en plástico
- Debe cumplir con lo estipualdo en el artíuclo 4° de la Resolución 2184 del 26 de diciembre de 2019', 'Unidad', '0', true),
  ('Punto Ecológico 6 (Compra)', '- Base metálica
- Mínimo tres contenedores así:
- Contenedor color verde con palabras "residuos orgánicos aprovechables: restos de comida, desechos agrícolas" en la cara frontal
- Contenedor color blanco con palabras "residuos aprovechables como plástico, vidrio, metales, multicapa, papel y cartón" en la cara frontal
- Contenedor color negro con las palabaras "residuos no aprovechables: papel higiénico, servilletas, papeles y cartones contaminados con comida, papeles metalizados" en la cara frontal
- Capacidad mínima de 100 litros para cada contenedor
- Contenedores elaborados en plástico
- Debe cumplir con lo estipualdo en el artíuclo 4° de la Resolución 2184 del 26 de diciembre de 2019', 'Unidad', '0', true),
  ('Papelera 1 (Compra)', '- Cuerpo metálico enmallado sin tapa
- Con capacidad mínima de 10 litros
- Diseño para oficina', 'Unidad', '0', true),
  ('Papelera 2 (Compra)', '- Cuerpo plástico
- Con mecanismo de pedal para abrir y cerrar tapa
- Con capacidad mínima de 10 litros
- Diseño para baño', 'Unidad', '0', true),
  ('Papelera 3 (Compra)', '- Cuerpo plástico sin tapa
- Con capacidad mínima de 10 litros
- Diseño para baño', 'Unidad', '0', true),
  ('Papelera 4 (Compra)', '- Papelera de oficina de plástico reciclado
- Color negro
- Con capacidad de 4,5 litros
- Diámetro: 22 cm aproxi. Largo: 24 cm. 
No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad', '0', true),
  ('Papelera residuos peligrosos 1 (Compra)', '- Cuerpo plástico
- Con mecanismo de pedal para abrir y cerrar tapa
- Con capacidad mínima de 10 litros
- Diseño para baño
- Color rojo
- Con las palabras "Riesgo biológico" en la cara frontal', 'Unidad', '0', false),
  ('Papelera residuos peligrosos 2 (Compra)', '- Cuerpo plástico
- Con mecanismo de pedal para abrir y cerrar tapa
- Con capacidad mínima de 20 litros
- Diseño para baño
- Color rojo
- Con las palabras "Riesgo biológico" en la cara frontal', 'Unidad', '0', true),
  ('Señales peatonales de prevención y atención 1 (Compra)', '- Elaborado en plástico
- Tipo tijera, plegable
- Tamaño mínimo de 25 cm de ancho por 60 cm de alto por 22 cm de largo.
- Impresión en las dos caras con las palabras "Cerrado" o "Área cerrada" o "No pasar".
- Color amarillo', 'Unidad', '0', false),
  ('Señales peatonales de prevención y atención 1 (Arrendamiento)', '- Elaborado en plástico
- Tipo tijera, plegable
- Tamaño mínimo de 25 cm de ancho por 60 cm de alto por 22 cm de largo.
- Impresión en las dos caras con las palabras "Cerrado" o "Área cerrada" o "No pasar".
- Color amarillo', 'Unidad', '0', true),
  ('Señales peatonales de prevención y atención 2 (Compra)', '- Elaborado en plástico
- Tipo tijera, plegable
- Tamaño mínimo de 25 cm de ancho por 60 cm de alto por 22 cm de largo.
- Impresión en las dos caras con las palabras "Cuidado".
- Color amarillo
- Acordes con la reglamentación establecida por la NTC 1461', 'Unidad', '0', false),
  ('Señales peatonales de prevención y atención 2 (Arrendamiento)', '- Elaborado en plástico
- Tipo tijera, plegable
- Tamaño mínimo de 25 cm de ancho por 60 cm de alto por 22 cm de largo.
- Impresión en las dos caras con las palabras "Cuidado".
- Color amarillo
- Acordes con la reglamentación establecida por la NTC 1461', 'Unidad', '0', true),
  ('Señales peatonales de prevención y atención 3 (Compra)', '- Elaborado en plástico
- Tipo tijera, plegable
- Tamaño mínimo de 25 cm de ancho por 60 cm de alto por 22 cm de largo.
- Impresión en las dos caras con las palabras "Piso húmedo o "Piso mojado"".
- Color amarillo
- Acordes con la reglamentación establecida por la NTC 1461', 'Unidad', '0', false),
  ('Señales peatonales de prevención y atención 3 (Arrendamiento)', '- Elaborado en plástico
- Tipo tijera, plegable
- Tamaño mínimo de 25 cm de ancho por 60 cm de alto por 22 cm de largo.
- Impresión en las dos caras con las palabras "Piso húmedo o "Piso mojado"".
- Color amarillo
- Acordes con la reglamentación establecida por la NTC 1461', 'Unidad', '0', true),
  ('Dispensador para papel higiénico 1 (Compra)', '- Elaborado en plástico ABS blanco
- Para rollo de 250 metros y 400 metros
- Con visor para ver el estado del rollo
- Con cerradura y llave
- Incluye los elementos necesarios para realizar la instalación en pared
-Incluye el costo de instalación.', 'Unidad', '2', true),
  ('Dispensador para papel higiénico 2 (Compra)', '- Elaborado en acero inoxidable
- Para rollo de 250 metros y 400 metros
- Con visor para ver el estado del rollo
- Con cerradura y llave
- Incluye los elementos necesarios para realizar la instalación en pared
-Incluye el costo de instalación.', 'Unidad', '0', true),
  ('Dispensador de toallas de manos 1 (Compra)', '- Elaborado en plástico ABS
- Para toallas de papel en rollo de 150 metros y 250 metros
- Con mecanismo accionador de palanca, perilla giratoria o para halar con la mano.
- Con cuchilla serrada para cortar la toalla de manos
- Con cerradura y llave
- Incluye los elementos necesarios para realizar la instalación en pared
 - Incluye el costo de instalación', 'Unidad', '2', true),
  ('Dispensador de toallas de manos 2 (Compra)', '- Elaborado en plástico ABS
- Para toallas de papel interdobladas con capacidad mínima de 300 toallas
- Con mecanismo para halar con la mano.
- Con cerradura y llave
- Incluye los elementos necesarios para realizar la instalación en pared
-Incluye el costo de instalación', 'Unidad', '0', true),
  ('Dispensador de toallas de manos 3 (Compra)', '- Elaborado en acero inoxidable
- Para toallas de papel interdobladas con capacidad mínima de 300 toallas
- Con mecanismo para halar con la mano.
- Con cerradura y llave
- Incluye los elementos necesarios para realizar la instalación en pared
-Incluye el costo de instalación', 'Unidad', '0', true),
  ('Dispensador de jabón líquido 1 (Compra)', '- Elaborado en plástico ABS blanco
- Con válvula manual anticorrosiva.
- Uso habilitado para cualquier jabón líquido con capacidad mínima de 500 cc
- Incluye los elementos necesarios para realizar la instalación en pared
-Incluye el costo de instalación', 'Unidad', '2', true),
  ('Dispensador de jabón líquido 2 (Compra)', '- Elaborado en plástico ABS blanco
- Con sensor para suministro de jabón
- Uso habilitado para cualquier jabón líquido con capacidad mínima de 500 ml
- Incluye los elementos necesarios para realizar la instalación en pared
 -Incluye el costo de instalación''', 'Unidad', '0', false),
  ('Dispensador de jabón líquido 3 (Compra)', '- Elaborado en acero inoxidable
- Con válvula manual anticorrosiva.
- Uso habilitado para cualquier jabón líquido con capacidad mínima de 800 ml
- Con cerradura y llave
- Incluye los elementos necesarios para realizar la instalación en pared
 -Incluye el el costo de instalación''', 'Unidad', '0', false),
  ('Dispensador de jabón líquido 4 (Compra)', '- Elaborado en acero inoxidable
- Con sensor para suministro de jabón
- Uso habilitado para cualquier jabón líquido con capacidad mínima de 800 ml
- Con cerradura y llave
- Incluye los elementos necesarios para realizar la instalación en pared
 -Incluye el costo de instalación''', 'Unidad', '0', false),
  ('Dispensador para ambientador (Arrendamiento)', '- Elaborado en plástico ABS blanco
 - Con dispersión programable de líquido ambientador
 - Capacidad mínima de 250 ml
- Incluye los elementos necesarios para realizar la instalación en pared
-Incluye el costo de instalación', 'Unidad', '0', true),
  ('Dispensador para ambientador (Compra)', '- Elaborado en plástico ABS blanco
 - Con dispersión programable de líquido ambientador
 - Capacidad mínima de 250 ml
- Incluye los elementos necesarios para realizar la instalación en pared
-Incluye el costo de instalación', 'Unidad', '0', true),
  ('Recarga: Dispensador para ambientador (Compra)', 'Recarga mensual del dispensador para ambientador', 'Mensual', '0', true),
  ('Dispensador goteo por gravedad y recarga (Arrendamiento)', '- Elaborado en PVC blanco
- Goteo programable para desodorizar sanitarios y orinales
- Incluye manguera plástica de goteo
- Incluye los elementos necesarios para realizar la instalación en pared', 'Unidad', '0', true),
  ('Dispensador goteo por gravedad (Compra)', '- Elaborado en PVC blanco
- Goteo programable para desodorizar sanitarios y orinales
- Incluye manguera plástica de goteo
- Incluye los elementos necesarios para realizar la instalación en pared', 'Unidad', '0', true),
  ('Recarga: Dispensador goteo por gravedad (Compra)', 'Recarga mensual del dispensador goteo para gravedad con líquido con agentes tensoactivos.', 'Mensual', '0', true),
  ('Dispensador de agua (Arrendamiento)', '- Dispensador de agua fría y caliente
- Sistema de filtración multinivel
- Uso de gas refrigerante seguro para la capa de ozono', 'Unidad', '0', true),
  ('Dispensador de agua (Compra)', '- Dispensador de agua fría y caliente
- Sistema de filtración multinivel
- Uso de gas refrigerante seguro para la capa de ozono', 'Unidad', '1', true),
  ('Dispensador de agua con botellón (Arrendamiento)', '- Dispensador de agua fría y caliente
- Uso de gas refrigerante seguro para la capa de ozono', 'Unidad', '0', true),
  ('Dispensador de agua con botellón (Compra)', '- Dispensador de agua fría y caliente
- Uso de gas refrigerante seguro para la capa de ozono', 'Unidad', '0', true),
  ('Greca para tintos 1 (Arrendamiento)', '- Eléctrica de 110 v
- Cuerpo elaborada en lámina de acero inoxidable de calibre 24 como mínimo
- Resistencias elaboradas en cobre
- Terminales elaboradas en cobre remplazables con soldadura
- Mínimo dos servicios
- Con su respectivo filtro y aro
 - Con capacidad para 30 tintos', 'Unidad', '0', true),
  ('Greca para tintos 2 (Arrendamiento)', '- Eléctrica de 110 v
- Cuerpo elaborada en lámina de acero inoxidable de calibre 24 como mínimo, grado alimento
- Resistencias elaboradas en cobre
- Terminales elaboradas en cobre remplazables sin soldadura
- Mínimo 2 servicios
 -Con su respectivo filtro y aro
- Con capacidad para 60 tintos', 'Unidad', '1', true),
  ('Greca para tintos 3 (Arrendamiento)', '- Eléctrica de 110 v
- Cuerpo elaborada en lámina de acero inoxidable de calibre 24 como mínimo, grado alimento
- Resistencias elaboradas en cobre
- Terminales elaboradas en cobre remplazables sin soldadura
- Mínimo dos servicios
 -Con su respectivo filtro y aro
 - Con capacidad para 120 tintos', 'Unidad', '0', true),
  ('Máquina de filtrado para café (Compra)', '- Cafetera de método filtrado de café por goteo con conexión directamente a la red de agua o con opción de usarse completamente portátil sin requerir conexión directa a la red de agua
- Grifo para dispensar agua caliente
- Capacidad para termos de 1.9 a 3L, capacidad de 14 litros hora
- Incluye termo con capacidad de mantener la bebida caliente, conservando la calidad de la taza de café durante mínimo 3 horas
- Revestimiento de acero inoxidable con bomba tipo dispensador 
- Capacidad de 2,5 0 3,0 litros.', 'Unidad', '0', true),
  ('Horno microondas (Arrendamiento)', '- Potencia mínima de 900 w
- Tamaño mínimo de 30 cm de ancho por 25 cm de alto por 35 cm de profundidad.
- Con bandera giratoria de cristal templado
- Con programas automáticos', 'Unidad', '0', true),
  ('Horno microondas de tipo industrial (Arrendamiento)', '- Potencia mínima de 1000 w
- Tamaño mínimo de 30 cm de ancho por 30 cm de alto por 40 cm de profundidad.
- Descongelamiento automático
- Con programas automáticos', 'Unidad', '0', true),
  ('Estufa 1 (Arrendamiento)', '- De dos puestos
- Lámina esmaltada
- Eléctrica
- Con perilla para graduar mínimo 3 niveles de calor', 'Unidad', '0', false),
  ('Estufa 1 (Compra)', '- De dos puestos
- Lámina esmaltada
- Eléctrica
- Con perilla para graduar mínimo 3 niveles de calor', 'Unidad', '0', true),
  ('Estufa 2 (Arrendamiento)', '- De dos puestos
- Lámina esmaltada- A gas
- Con perilla y quemador para graduar la llama
- Con parrilla', 'Unidad', '0', false),
  ('Estufa 2 (Compra)', '- De dos puestos
- Lámina esmaltada
- A gas
- Con perilla y quemador para graduar la llama
- Con parrilla', 'Unidad', '0', true),
  ('Extensión eléctrica 1 (Compra)', '- De mínimo 25 metros de longitud 
- Tipo industrial
- Recubierta en plástico PVC
- Con clavijas
- Calibre 12', 'Unidad', '0', true),
  ('Extensión eléctrica 1 (Arrendamiento)', '- De mínimo 25 metros de longitud 
- Tipo industrial
- Recubierta en plástico PVC
- Con clavijas
- Calibre 12', 'Unidad', '0', true),
  ('Extensión eléctrica 2 (Compra)', '- De mínimo 30 metros de longitud
- Recubierta en plástico PVC
- Con clavijas
- Tipo industrial
- Calibre 12', 'Unidad', '0', true),
  ('Extensión eléctrica 2 (Arrendamiento)', '- De mínimo 30 metros de longitud
- Recubierta en plástico PVC
- Con clavijas
- Tipo industrial
- Calibre 12', 'Unidad', '0', true),
  ('Aspiradora 1 (Arrendamiento)', '- De uso industrial para aspirado en seco y húmedo
- Motor con potencia 1200 w y 1400 w
- Capacidad entre 15 y 20 litros
- Cable de potencia con longitud mínima de 5m
- Accesorios mínimos: manguera puntera, 2 tubos para extensión, cepillos para tapizados', 'Unidad', '0', true),
  ('Aspiradora 2 (Arrendamiento)', '- De uso industrial para aspirado en seco y húmedo
- Motor con potencia entre 1200 w y 1400 w
- Capacidad entre 45 y 55 litros
- Cable de potencia con longitud mínima de 5m
- Accesorios mínimos: manguera puntera, 2 tubos para extensión, cepillos para tapizados', 'Unidad', '0', true),
  ('Lavabrilladora de pisos 1 (Arrendamiento)', '- De uso industrial
- Motores con potencia mínima de 1,5 hp y velocidad mínima de 175 rpm.
- Con manijas dobles
- Con interruptor de apagado de seguridad
- Diámetro mínimo de 16"
- Cable de potencia con longitud mínima de 8m
- Accesorios mínimos portapad, cepillo suave y duro', 'Unidad', '0', true),
  ('Lavabrilladora de pisos 2 (Arrendamiento)', '- De uso industrial
- Motores con potencia mínima de 1,5 hp y velocidad mínima de 175 rpm.
- Con manijas dobles
- Con interruptor de apagado de seguridad
- Diámetro mínimo de 20"
- Cable de potencia con longitud mínima de 8m
- Accesorios mínimos portapad, cepillo suave y duro', 'Unidad', '0', true),
  ('Brilladora de alta revolución (Arrendamiento)', '- De uso industrial
- Motores con potencia mínima de 1,5 hp y velocidad mínima de 1500 rpm.
- Con manijas dobles
- Con interruptor de apagado de seguridad
- Diámetro mínimo de 20"
- Cable de potencia con longitud mínima de 8m
- Accesorios mínimos - portapad', 'Unidad', '0', true),
  ('Lavadora de alfombras y tapetes 1 (Arrendamiento)', '- Motor con potencia de mínimo 1100 w y velocidad mínima de 175 revoluciones por minuto.
- Capacidad mínima de 5 litros
- Cable de potencia con longitud mínima de 8m
- Para lavar en seco o a vapor
- Diámetro mínimo de 16"', 'Unidad', '0', true),
  ('Lavadora de alfombras y tapetes 2 (Arrendamiento)', '- Motor con potencia de mínimo 1100 w y velocidad mínima de 175 revoluciones por minuto.
- Capacidad mínima de 5 litros
- Cable de potencia con longitud mínima de 8m
- Para lavar en seco o a vapor
- Diámetro mínimo de 20"', 'Unidad', '0', true),
  ('Hidrolavadora Industrial (Arrendamiento)', '- Motor eléctrico y potencia de mínimo 1.5 Kw - 1.450 RPM y entre 2.5 HP y 3.5 HP.
 - Presión de salida de agua entre 900 psi y 1900 psi.
 - Con ruedas', 'Unidad', '0', true),
  ('Sopladora de hojas (Arrendamiento)', '- Potenciado por motor a gasolina o eléctrico inalámbrico
 - Caudal mínimo de 380 cfm / 645m3/h
 - Autonomía mínima de 30 minutos
 - Intensidad máxima de sonido de 100dB
 - Incluye combustible para su funcionamiento (Máximo 3 galones)', 'Unidad', '0', true),
  ('Sonda para inodoro (Arrendamiento)', '-Sonda de mínimo 3''''
-Cubierta de vinilo para proteger la porcelana.
- Cable de 1/2" (12,7 mm) con núcleo interno recubierto por compresión, resistente al retorcimiento.
-Mangos grandes y de diseño ergonómico.
-Funcional en inodoros ahorradores de agua
-Peso entre 1,9 kg y 2,5 kg', 'Unidad', '0', true),
  ('Sonda para inodoro (Compra)', '-Sonda de mínimo 3''''
-Cubierta de vinilo para proteger la porcelana.
- Cable de 1/2" (12,7 mm) con núcleo interno recubierto por compresión, resistente al retorcimiento.
-Mangos grandes y de diseño ergonómico.
-Funcional en inodoros ahorradores de agua
-Peso entre 1,9 kg y 2,5 kg', 'Unidad', '0', true),
  ('Girador Manual (Arrendamiento)', '-Para destapar desagües entre 1/2" a 1 1/2".
-Collar antideslizante que agarra y suelta el cable
-Cable de núcleo hueco de mpinimo 5/16" × 25 pies (7,6 m) con barrena de cabeza de bulbo.
-Tambor rotativo de plástico moldeado
-Diseño de tambor abierto que permite el acceso al cable', 'Unidad', '0', true),
  ('Girador Manual (Compra)', '-Para destapar desagües entre 1/2" a 1 1/2".
-Collar antideslizante que agarra y suelta el cable
-Cable de núcleo hueco de mpinimo 5/16" × 25 pies (7,6 m) con barrena de cabeza de bulbo.
-Tambor rotativo de plástico moldeado
-Diseño de tambor abierto que permite el acceso al cable', 'Unidad', '0', true),
  ('Sonda para fregaderos (Arrendamiento)', 'Sonda Eléctrica para desagües de 3/4” (20 mm) a 2-1/2” (64 mm)
-El equipo propulsor de velocidad variable gira el cable a 0-600 RPM.
-Capacidad del tambor: 50 pies (15 m) de 5⁄16" (8 mm) o 35 pies (11 m) de 3⁄8" (10 mm).
-El núcleo interior revestido de vinilo impide que se oxide por contacto con el resorte.', 'Unidad', '0', true),
  ('Sonda para fregaderos (Compra)', 'Sonda Eléctrica para desagües de 3/4” (20 mm) a 2-1/2” (64 mm)
-El equipo propulsor de velocidad variable gira el cable a 0-600 RPM.
-Capacidad del tambor: 50 pies (15 m) de 5⁄16" (8 mm) o 35 pies (11 m) de 3⁄8" (10 mm).
-El núcleo interior revestido de vinilo impide que se oxide por contacto con el resorte.', 'Unidad', '0', true),
  ('Cortadora de cesped  (Arrendamiento)', '-Cuenta con una cuchilla de 32 a 38 cm.
-Chasis de acero con recolector o salida lateral.
-Ruedas de 135 mm
-Con  potencia entre 5 hp a 25 hp
-Ancho de corte de 18 a 183 cm.
-Peso entre 10 kg y 13,5 kg
-Tiene manilla de seguridad
-Incluye combustible para su funcionamiento (Máximo 3 galones)', 'Unidad', '0', true),
  ('Cortadora de cesped  (Compra)', '-Cuenta con una cuchilla de 32 a 38 cm.
-Chasis de acero con recolector o salida lateral.
-Ruedas de 135 mm
-Con  potencia entre 5 hp a 25 hp
-Ancho de corte de 18 a 183 cm.
-Peso entre 10 kg y 13,5 kg
-Tiene manilla de seguridad', 'Unidad', '0', true),
  ('Guadañas (Arrendamiento)', '-Guadaña de Eje Rígido
 - Viene cilindrada con apróximadamente 30 a 51,6 cm3.
-Peso promedio entre 6,5 Kg y 7,7 Kg.
-Cuchilla de 80 puntas
-Capacidad del tanque de combustible entre 0,65 Lt y 1 Lt.
-Cuenta con un sistema de arranque manual.
-Cuenta con un sistema de ignición electrónico
 - Incluye el combustible para su funcioamiento (Máximo 3 galones)', 'Unidad', '0', true),
  ('Motobombas (Arrendamiento)', '-Motobomba eléctrica
-Fabricada en Hierro
-Cuenta con una potencia de 2 hp a 111 hp
-Velocidades desde 1800 RPM a 3450 RPM.
-Peso promedio de 30 Kg.
-Las medidas de succión por descarga van de 2 x 2 pulgadas a 12 x 12 pulgadas.', 'Unidad', '0', true)
ON CONFLICT (bien) DO NOTHING;

-- ─── 3. ENLACE EN PRODUCTOS ─────────────────────────────────────────────────
ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS cce_bien_id UUID REFERENCES colombia_compra_eficiente(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_productos_cce ON productos(cce_bien_id);

-- ─── 4. AUTO-EMPAREJAMIENTO por similitud de nombre ─────────────────────────
-- Requiere la extensión pg_trgm (disponible en Supabase por defecto)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Actualiza cce_bien_id con el ítem CCE más similar al nombre_estandar del producto
-- Solo asigna si la similitud supera 0.15 (umbral permisivo para coincidencias parciales)
UPDATE productos p
SET cce_bien_id = (
  SELECT c.id
  FROM colombia_compra_eficiente c
  ORDER BY similarity(
    lower(regexp_replace(p.nombre_estandar, '\s+', ' ', 'g')),
    lower(regexp_replace(c.bien, '\(Compra\)|\(Arrendamiento\)', '', 'g'))
  ) DESC
  LIMIT 1
)
WHERE cce_bien_id IS NULL
  AND EXISTS (
    SELECT 1 FROM colombia_compra_eficiente c
    WHERE similarity(
      lower(regexp_replace(p.nombre_estandar, '\s+', ' ', 'g')),
      lower(regexp_replace(c.bien, '\(Compra\)|\(Arrendamiento\)', '', 'g'))
    ) > 0.15
  );

-- ─── 5. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE colombia_compra_eficiente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cce_read_all ON colombia_compra_eficiente;
CREATE POLICY cce_read_all ON colombia_compra_eficiente
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cce_write_admin ON colombia_compra_eficiente;
CREATE POLICY cce_write_admin ON colombia_compra_eficiente
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'role' IN ('admin', 'superadmin'))
  WITH CHECK (auth.jwt() ->> 'role' IN ('admin', 'superadmin'));
