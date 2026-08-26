-- Colombia Compra Eficiente — REPARAMETRIZACION
-- Fuente: "INVENTARIO JULIO 2026 COLOMBIA COMPRA.xlsx" (hoja "Hoja1")
-- Generado por: scripts/generar-cce-julio-2026.mjs
--
-- Reemplaza POR COMPLETO la parametrizacion anterior (catalogo de 418 bienes +
-- auto-emparejamiento por similitud de nombre de 20260814000000) por la relacion
-- oficial del archivo: 416 bienes numerados que se enlazan a los productos
-- por numero de item  ->  productos.codigo = colombia_compra_eficiente.item
--
-- Idempotente: puede re-aplicarse sin romper nada.

-- ─── 1. ESTRUCTURA ──────────────────────────────────────────────────────────
-- El item numerico pasa a ser la clave del catalogo: los nombres de bien se
-- repiten (p. ej. "Panela pulverizada" son 6 bienes con especificaciones
-- distintas), asi que el indice unico sobre "bien" deja de ser valido.
ALTER TABLE colombia_compra_eficiente ADD COLUMN IF NOT EXISTS item INTEGER;
DROP INDEX IF EXISTS uq_cce_bien;

-- El archivo nuevo no trae cantidad mensual ni precio piso.
ALTER TABLE colombia_compra_eficiente DROP COLUMN IF EXISTS cantidad_mensual;
ALTER TABLE colombia_compra_eficiente DROP COLUMN IF EXISTS precio_piso;

-- ─── 2. ELIMINAR LA PARAMETRIZACION ANTERIOR ────────────────────────────────
UPDATE productos SET cce_bien_id = NULL WHERE cce_bien_id IS NOT NULL;
DELETE FROM colombia_compra_eficiente;

-- ─── 3. CATALOGO NUEVO (416 bienes) ──────────────────────────────────────────
INSERT INTO colombia_compra_eficiente (item, bien, especificacion, presentacion)
VALUES
  (1, 'Café Social 1', '- Diferentes tostiones
- Orgánico y/o artesanal
- Empacada en bolsa de polipropileno aluminizada resistente a la humedad y al oxígeno. 
- Debe cumplir con las Resoluciones 333 de 2011 y 2674 de 2013 hasta la entrada en vigencia de la Resolución 810 de 2021 y aquellas que la modifiquen, adicionen o deroguen', 'Bolsa de mínimo 500 g'),
  (2, 'Café Social 2', '- 100% café tostado y molido.
- Puntaje de taza mayor a 80 según la clasificación SCA y/o Denominación de Origen
- Empacada en bolsa de polipropileno aluminizada resistente a la humedad y al oxígeno. 
- Debe cumplir con las Resoluciones 333 de 2011 y 2674 de 2013 hasta la entrada en vigencia de la Resolución 810 de 2021 y aquellas que la modifiquen, adicionen o deroguen', 'Bolsa de mínimo 500 g'),
  (3, 'Jabón para loza 1', '- Con agente(s) tensoactivo(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 8%.
- Disponible en mínimo (2) dos fragancias
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (4, 'Jabón para loza 2', '- Con agente(s) tensoactivo(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 8%.
- Disponible en mínimo (2) dos fragancias
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en recipiente plástico de mínimo 500 ml'),
  (5, 'Jabón para loza 3', '- Con agente(s) tensoactivo(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 15%.
 - Disponible en mínimo (2) dos fragancias
- El envase debe estar correctamente etiquetados bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Crema, en recipiente plástico de mínimo 850 g'),
  (6, 'Jabón para loza 4', '- Con agente(s) tensoactivo(s) con efecto limpiador y desengrasante. 
- Disponible en múltiples fragancias. 
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Elaborado en material reciclable
- Con etiqueta de amigable con el ambiente
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Crema, en recipiente plástico de mínimo 1000 g'),
  (7, 'Jabón en barra', '-Composición de ácidos grasos de mínimo 50%.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Barra, unidad con peso mínimo de 250 g en
envoltura individual'),
  (8, 'Jabón en barra azul', '- Todo tipo de uso
- Biodegradable
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Barra, unidad con peso mínimo de 250 g en
envoltura individual'),
  (9, 'Jabón abrasivo', '-Con agente(s) tensoactivo(s) pincipal(es) con efecto limpiador, pulidor y desengrasante
- Con agente activo mínimo del 5%
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'En polvo, en tarro de mínimo 500 g'),
  (10, 'Jabón de tocador 1', '- Elaborado con grasas vegetales
 - Con agente humectante
 - pH modificar entre PH 5,5 a 7
 - Disponible en mínimo (2) dos fragancias
 - Debe estar correctamente etiquetados bajo los parámetros indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Barra, unidad con peso mínimo de 125 g en envoltura individual'),
  (11, 'Jabón de tocador 2', '- Jabón de tocador para manos en espuma
- Líquido para manos en bolsa para dispensador spray y con boquilla especial de dispensador
- Tapa tipo válvula, para dispensador, antibacterial y antiséptico 
- Con agente limpiador en una concentración mínima del 6%
- Con agente humectante en una concentración mínima del 3%
- Disponible en múltiples fragancias
- Producto biodegradable basado en ingredientes orgánicos
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Elaborado en material reciclable
- No debe contener PVC, Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en bolsa con capacidad mínima de 800 ml'),
  (12, 'Jabón de dispensador para manos 1', '- Con agente limpiador en una concentración mínima del 6%
- Con agente humectante en una concentración mínima del 3%
- pH entre 5,5 a 7
- Disponible en mínimo (2) dos fragancias
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en recipiente plástico con dispensador y capacidad mínima de 500 ml'),
  (13, 'Jabón de dispensador para manos 2', '- Con agente limpiador en una concentración mínima del 6%
- Con agente humectante en una concentración mínima del 3%
- pH entre 5,5 a 7
- Disponible en mínimo (2) dos fragancias
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (14, 'Jabón de dispensador para manos 3', '- Con agente limpiador en una concentración mínima del 6%.
- Con agente antibacterial en una concentración mínima del 0,2%
- Con agente humectante en una concentración mínima del 3%
- pH entre 5,5 a 7
- Disponible en mínimo (2) dos fragancias
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (15, 'Gel antibacterial para manos', '- Con agente antibacterial en una concentración mínima del 0,2%
- Con agente humectante
- pH entre 5, 5 a 7
- Con fragancia', 'Gel, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (16, 'Dispensador de gel antibacterial para manos', '- Material: Plástico
- Tipo de instalación: De pared
- Incluye Chazos y tornillos
- Con visor para determinar el nivel del líquido
- Con ventanilla en la parte superior para añadir el gel 
- Funcionamiento: Manual', 'Recipiente con capacidad mínima de 500 ml (Unidad)'),
  (17, 'Limpiador multiusos 1', '- Con agente(s) tensoactivo(s) principal(es) con efecto limpiador en una concentración mínima del 8%
- Disponible en mínimo (2) dos fragancias
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (18, 'Limpiador multiusos 2', '- Con agente(s) tensoactivo(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 8%
- Disponible en mínimo (2) dos fragancias
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 500 ml, con
atomizador de pistola.'),
  (19, 'Limpiador multiusos 3', '- Con agente(s) tensoactivo(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 8%
- Disponible en mínimo (2) dos fragancias
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico de repuesto con capacidad mínima de 500 ml'),
  (20, 'Limpiador desinfectante para pisos', '- Apariencia: Líquido transparente
- Color y olor: De acuerdo a la fragancia
- Producto biodegradable que no afectas la capa de ozono
- Solubilidad: Total en agua
- PH: 7.5 - 8.5
- Composición: Tensoactivos, espesante, coadyuvante, colorante 
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Elaborado en material reciclable
- No debe contener PVC, poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Líquido, en garrafa con capacidad mínima de 3.785 ml'),
  (21, 'Líquido desengrasante', '- Con agente(s) tensoactivo(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 10%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (22, 'Crema desengrasante', '- Disponible en múltiples fragancias 
- Limpia y desengrasa todos los metales, plásticos, gomas, vidrio, cerámica y madera 
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Elaborado en material reciclable o biodegradable
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Crema, en recipiente reciclable o biodegadable con capacidad mínima de 500 g'),
  (23, 'Detergente biodegradable multiusos en polvo', '- Con agente tensoactivo de mínimo 60% de biodegradabilidad
 -Con efecto limpiador de mínimo 9%.
 - El envase del producto deberá estar correctamente etiquetado bajo los parámetros: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Polvo, en bolsa plástica o recipiente plástico
con un peso de 1.000 g'),
  (24, 'Limpiador desinfectante para uso general 1', '- Con agente(s) tensoactivo(s) con efecto antibacterial en una concentración mínima del 0,2%
- Con agente(s) tensoactivo(s) con efecto limpiador y desengrasante en una concentración mínima del 1,5%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (25, 'Limpiador desinfectante para uso general 2', '- Con agente(s) tensoactivo(s) con efecto antibacterial en una concentración mínima del 0,2%
- Con agente(s) tensoactivo(s) con efecto limpiador y desengrasante en una concentración mínima del 1,5%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 500 ml, con atomizador de pistola.'),
  (26, 'Limpiador desinfectante para uso general 3', '- Con agente(s) tensoactivo(s) con efecto antibacterial en una concentración mínima del 0,2%
- Con agente(s) tensoactivo(s) con efecto limpiador y desengrasante en una concentración mínima del 1,5%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 500 ml'),
  (27, 'Desinfectante de alto nivel de desinfección para uso
hospitalario', '- Con agentes bactericidas, fungicidas, tubercolicidas, esporicidas y virucidas.
 - Sin fragacia
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad
mínima de 3.785 ml'),
  (28, 'Pastilla desinfectante para sanitario', '- Con agentes bactericidas, fungicidas y virucidas.', 'Unidad con peso mínimo de 45 g'),
  (29, 'Líquido para limpiar vidrios 1', '- Con agente(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 4%
- Disponible mínimo en dos (2) fragancias
 - El envase debe estar correctamente etiquetados bajo los parámetros establecidos en el sistema globalmente armonizado indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (30, 'Líquido para limpiar vidrios 2', '- Con agente(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 4%
- Disponible mínimo en dos (2) fragancias
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 500 ml, con
atomizador de pistola.'),
  (31, 'Líquido para limpiar vidrios 3', '- Con agente(s) principal(es) con efecto limpiador y desengrasante en una concentración mínima del 4%
- Disponible mínimo en dos (2) fragancias
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico de repuesto con capacidad mínima
de 500 ml'),
  (32, 'Blanqueador o hipoclorito 1', '- Solución con una concentración mínima del 5%
 - El envase del producto deberá estar correctamente etiquetado, indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad
mínima de 3.785 ml'),
  (33, 'Blanqueador o hipoclorito 2', '- Solución con una concentración mínima del 5%
 - El envase del producto deberá estar correctamente etiquetado, indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad
mínima de 1.000 ml'),
  (34, 'Blanqueador o hipoclorito 3', '- Granulado con una concentración mínima del 90%
 - El envase del producto deberá estar correctamente etiquetado, indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'ganulado, en bolsa plástica de mínimo
1.000 g'),
  (35, 'Alcohol industrial 1', '- Solución acuosa de alcohol etílico desnaturalizado con una concentración mínima de 70%
 - Desnaturalizado', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (36, 'Alcohol industrial 2', '- Solución acuosa de alcohol etílico desnaturalizado con una concentración mínima de 70%
- Desnaturalizado', 'Líquido, en recipiente plástico con capacidad mínima de 1000ml'),
  (37, 'Creolina 1', '- Solución con una concentración mínima de fenoles de 4%', 'Líquido, en recipiente
plástico con capacidad mínima de 500 ml'),
  (38, 'Creolina 2', '- Solución con una concentración mínima de fenoles de 4%', 'Líquido, en recipiente plástico con capacidad
mínima de 3.785 ml'),
  (39, 'Líquido para limpiar equipos de oficina 1', '- Con agente(s) principal(es) con efecto limpiador, desengrasante y desinfectante en una concentración mínima del 4%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 500 ml con
atomizador'),
  (40, 'Líquido para limpiar equipos de oficina 2', '- Con agente(s) principal(es) con efecto limpiador, desengrasante y desinfectante en una concentración mínima del 4%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad
mínima de 500 ml'),
  (41, 'Champú para alfombras y tapizados 1', '- Con agente(s) principal(es) con efecto limpiador en una concentración mínima del 8%
 - El envase debe estar correctamente etiquetado: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso', 'Líquido, en recipiente plástico con capacidad
mínima de 3.785 ml'),
  (42, 'Champú para alfombras y tapizados 2', '- Con agente(s) principal(es) con efecto limpiador en una concentración mínima del 8%
- Con agente espumante para la generación de espuma seca
 - El envase debe estar correctamente etiquetados: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (43, 'Lustrador de muebles', '- Con agentes limpiadores y abrillantadores en una concentración mínima del 5%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 200 ml'),
  (44, 'Líquido cubre rasguños para madera', '- Con agentes limpiadores y abrillantadores en una concentración mínima del 5%
- De color oscuro para coayudar a cubrir rasguños en maderas oscuras', 'En recipiente plástico
con capacidad mínima de 200 ml'),
  (45, 'Crema para cuero', '- Con agentes limpiadores y abrillantadores en una concentración mínima del 5%', 'Crema, en recipiente plástico con capacidad
mínima de 200 ml'),
  (46, 'Cera polimérica', '- Polimérica autobrillante.
- Con polímeros acrílicos, nivelantes y plastificantes.
- Neutra (para pisos de todos los colores)
- Contenido mínimo de sólidos del 10%', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (47, 'Cera emulsionada Neutra', '- Emulsionada
- Neutra (para pisos de todos los colores)
- Contenido mínimo de sólidos del 5%', 'Líquido, en recipiente plástico con capacidad
mínima de 3.785 ml'),
  (48, 'Cera emulsionada roja', '- Emulsionada
- Roja
- Contenido mínimo de sólidos del 5%
- Antideslizante', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (49, 'Cera solvente', '- Solvente
- Contenido mínimo de sólidos del 10%', 'Líquido, en recipiente plástico con capacidad
mínima de 3.785 ml'),
  (50, 'Sellante para pisos', '- Polimérico autobrillante.
- Con polímeros acrílicos, nivelantes y plastificantes.
- Contenido mínimo de sólidos del 20%
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (51, 'Mantenedor de pisos', '- Polimérico autobrillante.
- Con polímeros acrílicos, nivelantes y plastificantes.
- Contenido mínimo de sólidos del 8%', 'Líquido, en recipiente
plástico con capacidad mínima de 3.785 ml'),
  (52, 'Removedor de cera', '- Con agente activo alcalino en una concentración mínima del 9%
- pH entre 11 y 14', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (53, 'Abrillantador para piso laminado', '- Con agente(s) con efecto limpiador y brillador.', 'Líquido, en recipiente
plástico con capacidad mínima de 3.785 ml'),
  (54, 'Jabón neutro para pisos 1', '- Jabón multiusos
 - PH Neutro, 
 - No corrosivo ni tóxico
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en recipiente
plástico con capacidad mínima de 3.785 ml'),
  (55, 'Jabón neutro para pisos 2', '- Jabón neutro biodegradable multiusos
- PH Neutro
- No es corrosivo ni tóxico
- Color: Azul claro 
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.
- Elaborado en material reciclable, no debe contener PVC, Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.
- Debe contener concentraciones de fósforo iguales o inferiores a 0.65% de fósforo (Resolución 0689 de 2016)', 'Líquido, en cuñete con capacidad de 20 L'),
  (56, 'Varsol ecológico 1', '- Solución con agentes desinfectantes, desmanchadores y desengrasantes en concentración mínima del 15%.
- Biodegradable mínimo en un 95%', 'Líquido, en recipiente plástico con capacidad mínima de 1000 ml'),
  (57, 'Varsol ecológico 2', '- Solución con agentes desinfectantes, desmanchadores y desengrasantes en concentración mínima del 15%.
- Biodegradable mínimo en un 95%', 'Líquido, en recipiente plástico con capacidad mínima de 3.785 ml'),
  (58, 'Desmanchador multiusos', '- Con agente(s) tensoactivo(s) con efecto limpiador y desengrasante
- Para superficies de todo tipo.', 'Crema, en bolsa plástica de mínimo 500 g'),
  (59, 'Brillametal en crema', '- Con agentes con efecto limpiador, pulidor y brillador.
- Para todo tipo de metales
 - El envase del producto deberá estar correctamente etiquetado, indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso', 'En crema de mínimo 70 g'),
  (60, 'Brillametal líquido', '- Con agentes con efecto limpiador, pulidor y brillador.
- Para todo tipo de metales', 'Líquido , en recipiente plástico con capacidad mínima de 200 ml'),
  (61, 'Betún', '- Contenido mínimo de sólidos del 30%
- Color negro
- No debe contener ningún material que sea cancerígeno ( Clasificación 1 y 2a por la IARC), Mutagénico, Tóxico, Contaminante peligroso del aire o que sea agotador de la capa de ozono 
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Tarro de mínimo 100 g'),
  (62, 'Ambientador 1', '- Solución con alcohol etílico y solventes.
- Con fragancia en una concentración del 1,5%
- En múltiples fragancias (Mínimo 5 tipos de fragancias)
- El envase debe estar correctamente etiquetado bajo los parámetros establecidos en el sistema globalmente armonizado (Decreto 1496 de 2018) indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos si aplica e instrucciones de uso de acuerdo con los tiempos de transición descritos en el artículo 24 de la Resolución 773 de 2021.', 'Líquido, en recipiente plástico con capacidad
mínima de 3.785 ml'),
  (63, 'Ambientador 2', '- Solución con alcohol etílico y solventes.
- Con fragancia en una concentración del 1,5%
- En múltiples fragancias
- libre de CFC
 - Envase correctamente etiquetado bajo los parámetros establecidos indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso.
- Elaborado en material reciclable', 'Líquido, en aerosol seguro para la capa de ozono con capacidad mínima de 360 ml'),
  (64, 'Insecticida 1', '- Para eliminar insectos rastreros.
- Con acción residual hasta por 4 semanas o de larga duración
- Sin fuertes olores químicos
- Libre de CFC
 - El envase del producto deberá estar correctamente etiquetado, indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso', 'Líquido, en aerosol seguro para la capa de ozono con capacidad
mínima de 350 ml'),
  (65, 'Insecticida 2', '- Para eliminar insectos voladores
- Con acción residual hasta por 4 semanas o de larga duración
- Sin fuertes olores químicos
- Libre de CFC
 - El envase del producto deberá estar correctamente etiquetado, indicando: nombre comercial del producto, pictogramas de los compuestos peligrosos e instrucciones de uso', 'Líquido, en aerosol seguro para la capa de ozono con capacidad
mínima de 350 ml'),
  (66, 'Limpiones 1', '- En tela de toalla fileteada
- Color blanco sin estampado
- Tamaño mínimo de 45cm de largo por 45cm de ancho.', 'Unidad'),
  (67, 'Limpiones 2', '- En tela de toalla fileteada
- Color blanco sin estampado
-Tamaño mínimo de 100 cm de largo por 70 cm de ancho', 'Unidad'),
  (68, 'Limpiones 3', '- En tela fileteada
- Color blanco sin estampado
- Tamaño mínimo de 45 cm de largo por 45 cm de ancho', 'Unidad'),
  (69, 'Limpiones 4', '- En tela fileteada
- Color blanco sin estampado
-Tamaño mínimo de 100 cm de largo por 70 cm de ancho', 'Unidad'),
  (70, 'Limpiones 5', '- En tela tipo galleta fileteada
- Color blanco o beige sin estampado
-Tamaño mínimo de 100 cm de largo por 70 cm de ancho', 'Unidad'),
  (71, 'Bayetilla 1', '- En tela fileteada
 - 100% algodón y fibra natural 
- Color blanco sin estampado
-Tamaño mínimo de 100 cm de largo por 70 cm de ancho', 'Unidad'),
  (72, 'Bayetilla 2', '- En tela fileteada
 - 100% algodón y fibra natural 
 - Color rojo sin estampado
 -Tamaño mínimo de 100 cm de largo por 70 cm de ancho', 'Unidad'),
  (73, 'Toalla en tela blanca para pisos por metro (repuesto de haraganes)', '- Elaborado en microfibras
 - Color blanco
 - Tamaño mínimo de 100 cm de largo por 70 cm de ancho', 'Unidad'),
  (74, 'Paño absorbente multiusos 1', '- Retira el polvo sin dejar residuos ni pelusas
- Antibacterial reutilizable
- Tela con microporos
- Tamaño mínimo de 58 cm de largo por 33 cm de ancho', NULL),
  (75, 'Paño absorbente multiusos 2', '- Retira el polvo sin dejar residuos ni pelusas
- Antibacterial reutilizable
- Tela con microporos
- Tamaño mínimo de 58 cm de largo por 33 cm de ancho', NULL),
  (76, 'Paño absorbente multiusos 3', '- Retira el polvo sin dejar residuos ni pelusas
- Antibacterial reutilizable
- Tela con microporos
- Tamaño mínimo de 20 cm de largo por 45 cm de ancho', 'Rollo X 40 unidades'),
  (77, 'Paño absorbente multiusos 4', '- Retira el polvo sin dejar residuos ni pelusas
- Antibacterial reutilizable
- Tela con microporos
- Tamaño mínimo de 20 cm de largo por 45 cm de ancho', 'Unidad'),
  (78, 'Estopa', '- Hecha 100% de hilos de algodón blanco peinado.
-Suave al tacto, para lustrar
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Bolsa de mínimo 400 g'),
  (79, 'Esponjilla 1', '- Espuma enmallada
- Tamaño mínimo de 7 cm de largo por 10 cm de ancho', 'Unidad'),
  (80, 'Esponjilla 2', '- Doble uso (material de esponjilla blanda y abrasiva)
- Tamaño mínimo de 7 cm de largo por 10 cm de ancho
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje', 'Unidad'),
  (81, 'Esponjilla 3', '- Abrasiva
- Tamaño mínimo de 9 cm de largo por 12 cm de', 'Unidad'),
  (82, 'Esponjilla 4', '- Elaborada con fibra de acero inoxidable para dar brillo
- Tamaño mínimo de 5 cm de largo por 5 cm de ancho', 'Paquete X 6 unidades'),
  (83, 'Esponjilla 5', '- Elaborada con alambre de acero inoxidable
- Tamaño mínimo de 7 cm de largo por 10 cm de ancho', 'Unidad'),
  (84, 'Esponjilla 6', '- Espuma enmallada
- Tamaño mínimo de 7 cm de largo por 10 cm de ancho
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad'),
  (85, 'Esponjilla 7', '- Abrasiva
- Tamaño mínimo de 9 cm de largo por 12 cm de ancho
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad'),
  (86, 'Escoba 1', '- Cerdas suaves elaboradas con PET calibre entre 0,3 y 0,4 mm.
- Área de barrido mínima de 25 cm de largo por 8 cm de ancho por 10 cm de alto
- Material de base en plástico con acople tipo rosca', 'Unidad'),
  (87, 'Escoba 2', '- Cerdas duras elaboradas con PET calibre entre 0,4 y 0,6 mm.
- Área de barrido mínima de 25 cm de largo por 8 cm de ancho por 10 cm de alto
- Material de base en plástico con acople tipo rosca', 'Unidad'),
  (88, 'Escoba 3', '- Cerdas suaves elaboradas con PET calibre entre 0,3 y 0,4 mm.
- Área de barrido mínima de 35 cm de largo por 8 cm de ancho por 10 cm de alto
- Material de base en plástico con acople tipo rosca', 'Unidad'),
  (89, 'Escoba 4', '- Cerdas duras elaboradas con PET calibre entre 0,4 y 0,6 mm.
- Área de barrido mínima de 35 cm de largo por 8 cm de ancho por 10 cm de alto
- Material de base en plástico con acople tipo rosca', 'Unidad'),
  (90, 'Escoba 5', '- Cerdas suaves elaboradas con PET calibre entre 0,3 y 0,4 mm.
- Área de barrido mínima de 35 cm de largo por 8 cm de ancho por 10 cm de alto
- Mango de madera proveniente de explotación forestal sostenible certificada ( FSC, PEFC o equivalentes) y/o Mango y Fibra de plástico (reciclado o nuevo) de polipropileno (PP) o polietileno (PE) y/o cabo metálico que no contenga material plastificado
- No debe contener PVC u otros plásticos con cloro. 
- Cabo de madera 140cm elaborada con fibra natural, con soporte para colgar, con capucha plástica protectora que evita que se desprendan las fibras o se deformen', 'Unidad'),
  (91, 'Mango metálico escoba 1', '- Extensión mínima de 140 cm
 -Acople plástico o rosca para palos de escoba', 'Unidad'),
  (92, 'Mango madera escoba 1', '- Extensión mínima de 140 cm
 -Acople plástico o rosca para palos de escoba', 'Unidad'),
  (93, 'Cepillos 1', '- Tipo plancha, con mango de plástico
- Cuerpo elaborado en plástico
- Cerdas duras en fibra plástica
- Tamaño mínimo de 15 cm de largo por 5cm de ancho por 6 cm de alto.', 'Unidad'),
  (94, 'Cepillos 2', '- Para pisos
- Cuerpo elaborado en plástico
- Cerdas duras en fibra plástica
- Tamaño mínimo de 23 cm de largo por 6 cm de ancho por 7 cm de alto.
- Mango metálico con una extensión mínima de
140 cm', 'Unidad'),
  (95, 'Cepillos 3', '- Para pisos
- Cuerpo elaborado en plástico
- Cerdas duras en fibra plástica
- Tamaño mínimo de 35 cm de largo por 6 cm de ancho por 7 cm de alto.
- Mango metálico con una extensión mínima de
140 cm', 'Unidad'),
  (96, 'Trapero 1', '- Elaborado con hilaza de algodón natural
 - Mecha con peso mínimo 250 gr y extensión mínima de 32 cm de largo
 - Material de base en plástico con acople tipo rosca', 'Unidad'),
  (97, 'Trapero 2', '- Elaborado con hilaza de algodón natural
- Mecha con peso mínimo de 350 gr y extensión mínima de 32 cm de largo
- Material de base en plástico con acople tipo rosca', 'Unidad'),
  (98, 'Trapero 3', '- Elaborado con hilaza de algodón natural
- Mecha con peso mínimo de 435 gr y extensión mínima de 32 cm de largo
- Material de base en plástico con acople tipo rosca', 'Unidad'),
  (99, 'Trapero 4', '- Trapero con cabo en madera 
- Mecha con peso mínimo de 400 gr y extensión mínima de 1.40 cm de largo
- Mango de madera proveniente de explotación forestal sostenible certificada ( FSC, PEFC o equivalentes) y/o cabo metálico que no contenga material plastificado
- Fibras en tela , algodón o pabilo de fibra de Rayón. 
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad'),
  (100, 'Mango metálico trapero', '- Extensión mínima de 140 cm
- Acople plástico o rosca para palos de escoba', 'Unidad'),
  (101, 'Mango madera trapero', '- Extensión mínima de 140 cm
- Acople plástico o rosca para palos de escoba', 'Unidad'),
  (102, 'Cepillo para sanitario (churrusco)', '- Cerdas duras elaboradas en fibras plásticas
- Extensión mínima de las cerdas es de 2,5 cm
- Base y mango elaborados en plástico
- Mango con longitud mínima de 33 cm (incluida la medida del cepillo)', 'Unidad'),
  (103, 'Pads 1', '- Para brillo
- Diámetro mínimo de 16 pulgadas
- Rojo o blanco', 'Unidad'),
  (104, 'Pads 2', '- Para remoción
- Diámetro mínimo de 16 pulgadas
- Café o negro', 'Unidad'),
  (105, 'Pads 3', '- Para brillo
- Diámetro mínimo de 20 pulgadas
- Rojo o blanco', 'Unidad'),
  (106, 'Pads 4', '- Para remoción
- Diámetro mínimo de 20 pulgadas
- Café o negro', 'Unidad'),
  (107, 'Pads 5', '- Pad de fibras para máquinas de baja densidad para lavado suave de mantención, remueve marcas, suciedad y derrames. 
- Diámetro: 17" 
- Color: blanco. 
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad'),
  (108, 'Boneth 1', '- Diámetro mínimo de 16 pulgadas
- Elaborado en hilaza de algodón', 'Unidad'),
  (109, 'Boneth 2', '- Diámetro mínimo de 20 pulgadas
- Elaborado en hilaza de algodón', 'Unidad'),
  (110, 'Bolsas plásticas 1', '- Elaborada en polietileno de baja densidad
- De color negro
- Calibre de mínimo 1
- Tamaño de 40 cm de ancho por 55 cm de largo', 'Paquete de mínimo 6'),
  (111, 'Bolsas plásticas 2', '- Elaborada en polietileno de baja densidad
- De color verde
- Calibre de mínimo 1
- Tamaño de 40 cm de ancho por 55 cm de largo', 'Paquete de mínimo 6'),
  (112, 'Bolsas plásticas 3', '- Elaborada en polietileno de baja densidad
- De color blanco
- Calibre de mínimo 1
- Tamaño de 40 cm de ancho por 55 cm de largo', 'Paquete de mínimo 6'),
  (113, 'Bolsas plásticas 4', '- Elaborada en polietileno de baja densidad
- De color rojo
- Calibre de mínimo 1
- Tamaño de 40 cm de ancho por 55 cm de largo
 - Con impresión de aviso de riesgo biológico', 'Paquete de mínimo 6'),
  (114, 'Bolsas plásticas 8', '- Elaborada en polietileno de baja densidad
- De color negro
-Calibre de mínimo 2
- Tamaño de 60 cm de ancho por 70 cm de largo', 'Paquete de mínimo 6'),
  (115, 'Bolsas plásticas 9', '- Elaborada en polietileno de baja densidad
- De color verde
- Calibre de mínimo 2
- Tamaño de 60 cm de ancho por 70 cm de largo', 'Paquete de mínimo 6'),
  (116, 'Bolsas plásticas 10', '- Elaborada en polietileno de baja densidad
- De color blanco
- Calibre de mínimo 2
- Tamaño de 60 cm de ancho por 70 cm de largo', 'Paquete de mínimo 6'),
  (117, 'Bolsas plásticas 11', '- Elaborada en polietileno de baja densidad
- De color rojo
- Calibre de mínimo 2
- Tamaño de 60 cm de ancho por 70 cm de largo
- Con impresión de aviso de riesgo biológico', 'Paquete de mínimo 6'),
  (118, 'Bolsas plásticas 15', '- Elaborada en polietileno de baja densidad
- De color negro
- Calibre de mínimo 2
- Tamaño de 70 cm de ancho por 90 cm de largo', 'Paquete de mínimo 6'),
  (119, 'Bolsas plásticas 16', '- Elaborada en polietileno de baja densidad
- De color verde
- Calibre de mínimo 2
- Tamaño de 70 cm de ancho por 90 cm de largo', 'Paquete de mínimo 6'),
  (120, 'Bolsas plásticas 17', '- Elaborada en polietileno de baja densidad
- De color blanco
- Calibre de mínimo 2
- Tamaño de 70 cm de ancho por 90 cm de largo', 'Paquete de mínimo 6'),
  (121, 'Bolsas plásticas 18', '- Elaborada en polietileno de baja densidad
- De color rojo
- Calibre de mínimo 2
- Tamaño de 70 cm de ancho por 90 cm de largo
- Con impresión de aviso de riesgo biológico', 'Paquete de mínimo 6'),
  (122, 'Bolsas plásticas 21', '- Elaborada en polietileno de baja densidad
- De color negro
- Calibre de mínimo 3
- Tamaño de 80 cm de ancho por 110 cm de largo', 'Paquete de mínimo 6'),
  (123, 'Bolsas plásticas 22', '- Elaborada en polietileno de baja densidad
- De color verde
- Calibre de mínimo 3
- Tamaño de 80 cm de ancho por 110 cm de largo', 'Paquete de mínimo 6'),
  (124, 'Bolsas plásticas 23', '- Elaborada en polietileno de baja densidad
- De color blanco
-Calibre de mínimo 3
- Tamaño de 80 cm de ancho por 110 cm de largo', 'Paquete de mínimo 6'),
  (125, 'Bolsas plásticas 24', '- Elaborada en polietileno de baja densidad
- De color rojo
-Calibre de mínimo 3
- Tamaño de 80 cm de ancho por 110 cm de largo
- Con impresión de aviso de riesgo biológico', 'Paquete de mínimo 6'),
  (126, 'Guantes 1', '- Tipo doméstico
- Elaborados en látex
- Calibre mínimo de 18
- Tallas 7 a 9 o S a XL
- Color amarillo', 'Par'),
  (127, 'Guantes 2', '- Tipo doméstico
- Elaborados en látex
- Calibre mínimo de 18
- Tallas 7 a 9 o S a XL
- Color negro', 'Par'),
  (128, 'Guantes 3', '- Tipo doméstico
- Elaborados en látex
- Calibre mínimo de 25
- Tallas 7 a 9 o S a XL
- Color negro', 'Par'),
  (129, 'Guantes 4', '- Tipo doméstico
- Elaborados en látex
- Calibre mínimo de 25
- Tallas 7 a 9 o S a XL
- Color rojo', 'Par'),
  (130, 'Guantes 5', '- Tipo industrial
- Elaborados en látex
- Calibre mínimo de 35
- Tallas 7 a 9 o S a XL
- Color negro', 'Par'),
  (131, 'Guantes 6', '- Elaborados en látex desechable (tipo cirugía)
- Empovaldos
- Tallas XS a XXL', 'Caja de mínimo 100 unidades'),
  (132, 'Guantes 7', '- Elaborados en carnaza
- Tallas 7 a 9 o S a XL', 'Par'),
  (133, 'Guantes 8', '- Tipo mosquetero
- Calibre mínimo de 40
- Tallas 7 a 9 o S a XL
- Color negro', 'Par'),
  (134, 'Guantes 9', '- Elaborados en hilaza
- Tallas 7 a 9 o S a XL', 'Par'),
  (135, 'Tapabocas 1', '- Elaborado en tela no tejida
- Desechable
- Con tiras elásticas', 'Caja de mínimo 50 unidades'),
  (136, 'Tapabocas Industrial', '- Material no tejido suave con filtro
- Color blanco y negro
- Uso civil o medico
- Clip nasal ajustable', 'Caja de mínimo 50 unidades'),
  (137, 'Papel higiénico 1', '- Rollo con longitud mínima de 20 metros
 - Doble hoja blanca
 - Sin fragancia', 'Rollo'),
  (138, 'Papel higiénico 2', '- Rollo con longitud mínima de 250 metros
- Doble hoja de color natural
- Sin fragancia', 'Rollo'),
  (139, 'Papel higiénico 3', '- Rollo con longitud mínima de 250 metros
- Doble hoja de color natural
- Sin fragancia', 'Paca X 4 rollos'),
  (140, 'Papel higiénico 4', '- Rollo con longitud mínima de 250 metros
- Doble hoja blanca
- Sin fragancia', 'Rollo'),
  (141, 'Papel higiénico 5', '- Rollo con longitud mínima de 250 metros
- Doble hoja blanca
- Sin fragancia', 'Paca X 4 rollos'),
  (142, 'Papel higiénico 6', '- Rollo con longitud mínima de 400 metros
- Hoja sencilla de color natural
- Sinfragancia', 'Rollo'),
  (143, 'Papel higiénico 7', '- Rollo con longitud mínima de 400 metros
- Hoja sencilla de color natural
- Sinfragancia', 'Paca X 4 rollos'),
  (144, 'Papel higiénico 8', '- Rollo con longitud mínima de 400 metros
 - Hoja sencilla de color blanco
 - Sin fragancia', 'Rollo'),
  (145, 'Papel higiénico 9', '- Rollo con longitud mínima de 400 metros
 - Hoja sencilla de color blanco
 - Sin fragancia', 'Paca X 4 rollos'),
  (146, 'Toallas para manos 1', '- Rollo con longitud mínima de 100 metros
- Doble hoja con un tamaño mínimo 15 cm de ancho
- Disponibles en color blanco', 'Rollo'),
  (147, 'Toallas para manos 2', '- Rollo con longitud mínima de 100 metros
- Doble hoja con un tamaño mínimo 15 cm de ancho
- Disponibles en color natural', 'Rollo'),
  (148, 'Toallas para manos 3', '- Rollo con longitud mínima de 150 metros
 - Doble hoja con un tamaño mínimo 15 cm de ancho
 - Disponibles en color blanco
 - Sin olor o fragancia', 'Rollo'),
  (149, 'Toallas para manos 4', '- Rollo con longitud mínima de 150 metros
 - Doble hoja con un tamaño mínimo 15 cm de ancho
 - Disponibles en color natural
 - Sin fragancia', 'Rollo'),
  (150, 'Toallas para manos 5', '- Toallas interdobladas, paquete con mínimo 150 unidades
- Doble hoja con un tamaño mínimo de 20 cm de largo por 15 cm de ancho
 - Hoja color natural', 'Unidad'),
  (151, 'Toallas para manos 6', '- Toallas interdobladas, paquete con mínimo 150 unidades
- Doble hoja con un tamaño mínimo de 20 cm de largo por 15 cm de ancho
 - Hoja color blanco', 'Unidad'),
  (152, 'Toallas para manos 7', '- Toallas con precorte
- Rollo con longitud mínima de 100 metros
- Doble hoja con tamaño mínimo de 15 cms de ancho
- Color Blanco
- Sin fragancia', 'Unidad'),
  (153, 'Toallas para manos 8', '- Toallas con precorte
- Rollo con longitud mínima de 100 metros
- Doble hoja con tamaño mínimo de 15 cms de ancho
- Color Natural
- Sin fragancia', 'Unidad'),
  (154, 'Pañuelos', '- Doble hoja
- Color blanco', 'Caja de mínimo 50 unidades'),
  (155, 'Vasos biodegradables 1', '- Elaborado en cartón 97% biodegradable
- Capacidad mínima de 4 oz', 'Paquete de mínimo 50 unidades'),
  (156, 'Vasos biodegradables 2', '- Elaborado en cartón 97% biodegradable
 - Capacidad mínima de 6 oz', 'Paquete de mínimo 50'),
  (157, 'Vasos biodegradables 3', '- Elaborado en cartón 97% biodegradable
- Capacidad mínima de 9 oz', 'Paquete de mínimo 40 unidades'),
  (158, 'Vasos biodegradables 4', '- Capacidad mínima de 9 onzas 
- Sin tapa 
- Liso
- Biodegradable y compostable.
- Elaborado en polyboard (cartón) y/ocon la fibra de caña de azúcar o almidón de maíz', 'Paquete de mínimo 50 unidades'),
  (159, 'Mezclador 1', '- Mezcladores elaborados en madera y/o apartir de recursos renovables como la caña de azucar y/o almidón de maíz
- Longitud mínima de 11 cm', 'Paquete de mínimo 500'),
  (160, 'Servilleta papel', '- Tipo cafetería
 - Dobe hoja
- Color blanco
- Dimensiones mínimas de 20 cm de largo y 12 cm de ancho
- 100% Biodegradable 
- Elaborado a base de papel reciclado no clorado
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Paquete de mínimo 100 unidades'),
  (161, 'Filtro para greca 1', '- Elaborada en tela
- Para greca
- Capacidad de media libra
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje', 'Unidad'),
  (162, 'Filtro para greca 2', '- Elaborada en tela
- Para greca
- Capacidad de una 1 libra
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad'),
  (163, 'Filtro para greca 3', '- Elaborada en tela
- Para greca
- Capacidad de dos 2 libras
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad'),
  (164, 'Churrusco para tubos de greca', '- Cepillo para lavado y fregado de grecas. 
- No debe contener PVC, Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.
- Base y mango elaborados en alambre', 'Unidad'),
  (165, 'Papel Aluminio 1', '- Longitud mínima del rollo de 40 metros
- Ancho mínimo del rollo de 27 cm', 'Caja de carton con un 1 rollo de mínimo 40 metros de largo y 27
cm de ancho'),
  (166, 'Papel Aluminio 2', '- Longitud mínima del rollo de 100 metros
- Ancho mínimo del rollo de 27 cm', 'Caja de carton con un 1 rollo de mínimo 100 metros de largo y 27
cm de ancho'),
  (167, 'Película transparente para alimentos', '- Longitud mínima del rollo de 50 metros
- Ancho mínimo del rollo de 27 cm', 'Caja de carton con un 1 rollo'),
  (168, 'Termo para café 1', '- Elaborado en plástico
- Capacidad mínima de 1 litro', 'Unidad'),
  (169, 'Termo para café 2', '- Térmico, con bomba tipo dispensador. Portatil. 
 - Bomba manual para dispensar la bebida. 
 - Acero inoxidable y plastico. 
 - Agarradera plastica, tapa con empaque, bomba manual. 
 - Capacidad mínima de 3 litros', 'Unidad'),
  (170, 'Café 1', '- 100% café tostado y molido. 
- Tostión media. 
- Denominación de Origen (Anexo 6)
- Empacada en bolsa de polipropileno aluminizada resistente a la humedad y al oxígeno. 
- Debe cumplir con las Resoluciones 333 de 2011 y 2674 de 2013 hasta la entrada en vigencia de la Resolución 810 de 2021 y aquellas que la modifiquen, adicionen o deroguen.', 'Libra'),
  (171, 'Café 2', '- Tostión media
- Descafeinado
- Empacado en bolsa de polipropileno aluminizada resistente a la humedad y al oxigeno
- Debe cumplir con las Resoluciones 333 de 2011 y 2674 de 2013 y aquellas que la modifiquen, adicionen o deroguen.', 'Libra'),
  (172, 'Café 3', '- Instantáneo, para máquinas automáticas
- Tostión media
- Empacada en bolsa de polipropileno aluminizada resistente a la humedad y al oxígeno. 
- Debe cumplir con las Resoluciones 333 de 2011 y 2674 de 2013 hasta la entrada en vigencia de la Resolución 810 de 2021 y aquellas que la modifiquen, adicionen o deroguen.', 'Bolsa de mínimo 500 g'),
  (173, 'Crema para café', '- No láctea
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Bolsas de mínimo 100 sobres de mínimo 4 g'),
  (174, 'Azúcar 1', '- Blanca
- Empaque elaborado en materiales atóxicos
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Bolsa de mínimo 200 sobres o tubipacks de 5 g'),
  (175, 'Azúcar 2', '- Blanca
- Empaque elaborado en materiales atóxicos
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Bolsa de mínimo 200 sobres o tubipacks de 3,5 g'),
  (176, 'Azúcar 3', '- Blanca
- Empaque elaborado en materiales atóxicos
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Libra'),
  (177, 'Azúcar 4', '- Morena
- Empaque elaborado en materiales atóxicos
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Libra'),
  (178, 'Endulzante', '- Sin calorías
- Empaque elaborado en materiales atóxicos
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Caja de mínimo 100 sobres'),
  (179, 'Panela', '- Panela instantánes pulverizada, deshidratada
- Debe cumplir con la NTC 1311 sobreo productos agrícolas
- Empaque elaborado en materiales atóxicos
- Debe cumplir con la Resolucion 779 de 2006
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Bolsa de mínimo 100 sobres de mínimo 5 g'),
  (180, 'Panela pulverizada', '- Panela instantánea, deshidratada
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 24 meses de vida útil desde la fecha de fabricación', 'Bolsa de mínimo 500g'),
  (181, 'Panela pulverizada', '- Panela instantánea, deshidratada
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 24 meses de vida útil desde la fecha de fabricación', 'Bolsa de mínimo 10 Kg'),
  (182, 'Panela pulverizada', '- Panela instantánea, deshidratada
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 24 meses de vida útil desde la fecha de fabricación', 'Bolsa de mínimo 25 Kg'),
  (183, 'Panela pulverizada', '- Contiene sachets de mínimo 6g
- Panela instantánea, deshidratada
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 24 meses de vida útil desde la fecha de fabricación', 'Bolsa de mínimo 10 unidades'),
  (184, 'Panela pulverizada', '- Contiene sachets de mínimo 6g
- Panela instantánea, deshidratada
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 24 meses de vida útil desde la fecha de fabricación', 'Bolsa de mínimo 15 unidades'),
  (185, 'Panela pulverizada', '- Contiene sachets de mínimo 6g
- Panela instantánea, deshidratada
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 24 meses de vida útil desde la fecha de fabricación', 'Bolsa de mínimo 100 unidades'),
  (186, 'Panela saborizada', '- Contiene sachets de 6g
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 6 meses de vida útil desde la fecha de fabricación
- Sabores: Naranja, Jengibre, Papayuela, Frutos rojos, Maracuyá, Limoncillo', 'Bolsa de 100 unidades'),
  (187, 'Panela saborizada', '- Contiene cubos de 6g
- Debe cumplir con la Resolución 779 de 2006
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 6 meses de vida útil desde la fecha de fabricación
- Sabores: Naranja, Jengibre, Papayuela, Frutos rojos, Maracuyá, Limoncillo', 'Caja de 48'),
  (188, 'Sal 1', '- Refinada, con un 99,9% de pureza
- Con adiciones de yodo y flúor
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Libra (500 g)'),
  (189, 'Sal 2', '- Refinada, con un 99,9% de pureza
- Con adiciones de yodo y flúor
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', '1 kg (1.000 g)'),
  (190, 'Sal 3', '- Refinada, con un 99,9% de pureza
- Con adiciones de yodo y flúor
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen', 'Salero de mínimo 130 g'),
  (191, 'Aromática con panela', '- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Debe cumplir con la Resolución 779 de 2006
- Mínimo 12 meses de vida útil desde la fecha de fabricación
- Sabores: Naranja, Jengibre, Papayuela, Frutos rojos, Maracuyá, Limoncillo (Entrega mínima de 3 sabores)
- 100% natural', 'Bolsa de 1000g'),
  (192, 'Aromática con panela', '- Contiene sobres de mínimo 6g
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Debe cumplir con la Resolución 779 de 2006
- Mínimo 12 meses de vida útil desde la fecha de fabricación
- Sabores: Naranja, Jengibre, Papayuela, Frutos rojos, Maracuyá, Limoncillo (Entrega mínima de 3 sabores)
- 100% natural', 'Caja de 20 unidades'),
  (193, 'Aromática con panela', '- Contiene sobres de mínimo 6g
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Debe cumplir con la Resolución 779 de 2006
- Mínimo 12 meses de vida útil desde la fecha de fabricación
- Sabores: Naranja, Jengibre, Papayuela, Frutos rojos, Maracuyá, Limoncillo (Entrega mínima de 3 sabores)
- 100% natural', 'Caja de 100 unidades'),
  (194, 'Aromática de fruta', '- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 12 meses de vida útil desde la fecha de fabricación
- Sabores: Papayuela, Mora, Maracuya, Uchuva, Uva, Fresa, Piña, Durazno, Naranja, Manzana y Arandano (Entrega mínima de 3 sabores)
- 100% natural', 'Bolsa de 1000g'),
  (195, 'Aromática de fruta', '- Contiene sobres de mínimo 6g
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 12 meses de vida útil desde la fecha de fabricación
- Sabores: Papayuela, Mora, Maracuya, Uchuva, Uva, Fresa, Piña, Durazno, Naranja, Manzana y Arandano (Entrega mínima de 3 sabores)
- 100% natural', 'Caja de 20 unidades'),
  (196, 'Aromática de fruta', '- Contiene sobres de mínimo 6g
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 12 meses de vida útil desde la fecha de fabricación
- Sabores: Papayuela, Mora, Maracuya, Uchuva, Uva, Fresa, Piña, Durazno, Naranja, Manzana y Arandano (Entrega mínima de 3 sabores)
- 100% natural', 'Caja de 100 unidades'),
  (197, 'Aromática de panela', '- Para infusión
- Cajas disponbiles en sabor limón, yerbabuena, canela y naranja
- Panela 100% natural y ecológica
- Embalaje en cartón corrugado 
- Debe cumplir con la NTC 1311 sobre productos agrícolas 
- Empaque elaborado en materiales atóxicos 
- Debe cumplir con la Resolucion 779 de 2006 
- Debe cumplir con Resolución 333 de 2011 sobre rotulado y etiquetado nutricional y las normas que la modifiquen. 
- Uso: Panela instantánea soluble al agua 
- Azúcares reductores expresados en glucosa, mínimo 5,74%; azúcares no reductores expresados en sacarosa, máximo 90%; proteínas, mínimo 0,2%; cenizas, mínimo 1%; humedad, máximo 5%; plomo expresado como As en mg/kg, máximo 0,1;
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Cajas de mínimo 20 en sobres.'),
  (198, 'Bebida de frutas', '- Contiene sobres de mínimo 1,4g, para diluir
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Mínimo 12 meses de vida útil desde la fecha de fabricación
- Sabores: Papayuela, Mora, Maracuya, Uchuva, Uva, Fresa, Piña, Durazno, Naranja, Manzana y Arandano', 'Caja de mínimo 20 sobres'),
  (199, 'Bebida de panela', '- Contiene sobres de mínimo 1,4g, para diluir
- Debe cumplir con Resolución 2492 de 2022 sobre rotulado y etiquetado nutricional y las normas que la modifiquen
- Debe cumplir con la Resolución 779 de 2006
- Mínimo 12 meses de vida útil desde la fecha de fabricación
- Sabores: Naranja, Jengibre, Papayuela, Frutos rojos, Maracuyá, Limoncillo', 'Caja de mínimo 20 sobres'),
  (200, 'Té', '- Para infusión
- Cajas disponbiles en mínimo tres (3) sabores
- 100% naturales', 'Caja x 20 mínimo sobres'),
  (201, 'Agua potable 1', '- Agua potable purificada sin gas', 'Botella plástica de
mínimo 300 ml'),
  (202, 'Agua potable 2', '- Agua potable purificada sin gas', 'Botella plástica de
mínimo 600 ml'),
  (203, 'Agua potable 3', '- Agua potable purificada
- Con gas', 'Botella plástica de
mínimo 600 ml'),
  (204, 'Agua potable 4', '- Agua potable potable purificada', 'Botellón de mínimo 18.9 L'),
  (205, 'Válvula dispensadora para botellón de agua', '-Válvula en material plástico con boquilla ajustable a los diferentes tipos de botellones', 'Unidad'),
  (206, 'Servilleta de tela', '- Elaborada en tela
- Color blanco
- Dimensiones mínimas de 40 cm de largo y 40 cm de ancho.', 'Unidad'),
  (207, 'Cepillo para paredes y techos', '- Cuerpo elaborado en plástico
 - Cerdas duras en fibra plástica
 - Largo mínimo de 140 cm', 'Unidad'),
  (208, 'Brillador 1', '- Mopa elaborada en algodón
- Área de barrido mínima de 90 cm de largo por 16cm de ancho
- Armazón y mango metálico', 'Unidad'),
  (209, 'Brillador 2', '- Mopa elaborada en algodón
- Área de barrido mínima de 60 cm de largo por 16cm de ancho
- Armazón y mango metálico', 'Unidad'),
  (210, 'Repuestos brillador 1', '- Mopa elaborada en algodón
- Área de barrido mínima de 90 cm de largo por 16 cm de ancho', 'Unidad'),
  (211, 'Repuestos brillador 2', '- Mopa elaborada en algodón
- Área de barrido mínima de 60 cm de largo por 16 cm de ancho', 'Unidad'),
  (212, 'Destapador para sanitario (chupa)', '- Tipo campana
- Chupa elaborada en caucho
- Diámetro mínimo de 12 cm
- Mango elaborado en madera
- Mango con longitud mínima de 33 cm', 'Unidad'),
  (213, 'Plumero o limpia polvo', '- Fibras sintéticas
- Mango de plástico
- Largo total mínimo de 65 cm
- Electrostático', 'Unidad'),
  (214, 'Rastrillo 1', '- Barra dentada plástica con mínimo 18 dientes
- Mango metálico plastificado con longitud mínima de 120 cm', 'Unidad'),
  (215, 'Rastrillo 2', '- Barra dentada metálica con mínimo 18 dientes
- Mango metálico plastificado con longitud mínima de 120 cm', 'Unidad'),
  (216, 'Recogedor de basura 1', '- Elaborado en plástico
- Con banda de goma y dientas barrescobas
- Mango con longitud mínima de 70 cm', 'Unidad'),
  (217, 'Recogedor de basura 2', '- Elaborado en plástico
 - Plegable, con tapa que abre y cierra', 'Unidad'),
  (218, 'Atomizadores', '- Elaborado en plástico
- Reutilizable
- Capacidad mínima de 500 cc
- con pistola', 'Unidad'),
  (219, 'Caneca para almacenar ropa sucia', '- Elaborado en plástico
- Dimensiones mínimas de 50 cm de alto por 30 cm de ancho
- Incluye tapa
- En colores variados', 'Unidad'),
  (220, 'Vasos 1', '- Elaborado en vidrio
- Cilíndrico
- Capacidad mínima de 9 oz', 'Unidad'),
  (221, 'Vasos 1', '- Elaborado en vidrio
- Cilíndrico
- Capacidad mínima de 9 oz', 'Unidad'),
  (222, 'Vasos 2', '- Elaborado en vidrio
- Cilíndrico
- Capacidad mínima de 12 oz', 'Unidad'),
  (223, 'Vasos 2', '- Elaborado en vidrio
- Cilíndrico
- Capacidad mínima de 12 oz', 'Unidad'),
  (224, 'Cuchara', '- Elaboradas en acero inoxidable
- Longitud total mínima de 17 cm', 'Unidad'),
  (225, 'Tenedor', '- Elaborados en acero inoxidable
- lisos
- Longitud total mínima de 17 cm', 'Unidad'),
  (226, 'Cuchillo', '- Elaborados en acero inoxidable
- lisos
- Longitud total mínima de 20 cm', 'Unidad'),
  (227, 'Cuchara pequeña', '- Elaborados en acero inoxidable
- lisos
- Longitud total mínima de 12 cm', 'Unidad'),
  (228, 'Platos 1', '- Elaborados en porcelana blanca
- Llanos
- Color blanco sin diseño
- Diámetro mínimo de 26 cm
- Apto para uso en horno microondas', 'Unidad'),
  (229, 'Platos 1', '- Elaborados en porcelana blanca
- Llanos
- Color blanco sin diseño
- Diámetro mínimo de 26 cm
- Apto para uso en horno microondas', 'Unidad'),
  (230, 'Platos 2', '- Elaborados en porcelana blanca
- Llanos
- Color blanco sin diseño
- Diámetro mínimo de 22 cm
- Apto para uso en horno microondas', 'Unidad'),
  (231, 'Platos 2', '- Elaborados en porcelana blanca
- Llanos
- Color blanco sin diseño
- Diámetro mínimo de 22 cm
- Apto para uso en horno microondas', 'Unidad'),
  (232, 'Platos 3', '- Elaborados en porcelana blanca
- Llanos
- Color blanco sin diseño
- Diámetro mínimo de 16 cm
- Apto para uso en horno microondas', 'Unidad'),
  (233, 'Platos 3', '- Elaborados en porcelana blanca
- Llanos
- Color blanco sin diseño
- Diámetro mínimo de 16 cm
- Apto para uso en horno microondas', 'Unidad'),
  (234, 'Platos 4', '- Elaborados en porcelana blanca
- Hondo
- Color blanco sin diseño
- Diámetro mínimo de 17 cm
- Apto para uso en horno microondas', 'Unidad'),
  (235, 'Platos 4', '- Elaborados en porcelana blanca
- Hondo
- Color blanco sin diseño
- Diámetro mínimo de 17 cm
- Apto para uso en horno microondas', 'Unidad'),
  (236, 'Platos 5', '- Elaborados en porcelana blanca
- Hondo
- Color blanco sin diseño
- Diámetro mínimo de 22 cm
- Apto para uso en horno microondas', 'Unidad'),
  (237, 'Platos 5', '- Elaborados en porcelana blanca
- Hondo
- Color blanco sin diseño
- Diámetro mínimo de 22 cm
- Apto para uso en horno microondas', 'Unidad'),
  (238, 'Pocillos', '- Elaborado en porcelana blanca para café
- Sin diseño
- De mínimo 150 cc
- No se debe rayar con el uso de cubiertos
- Debe ser apta para uso en microondas', 'Unidad'),
  (239, 'Pocillos', '- Elaborado en porcelana blanca para café
- Sin diseño
- De mínimo 150 cc
- No se debe rayar con el uso de cubiertos
- Debe ser apta para uso en microondas', 'Unidad'),
  (240, 'Juego de cubiertos', '- Elaborados en acero inoxidable
- Incluye cuchillo (longitud mínima de 20 cm), tenedor (longitud mínima de 17 cm), cuchara (longitud mínima de 17 cm), cuchara pequeña para postre (longitud mínima de 12 cm) y tenedor pequeño (longitud mínima de 12 cm).', 'Juego de 6 puestos'),
  (241, 'Terno para café', '-Pocillo y plato de porcelana blanca para café.
- Sin diseño
- Plato de mínimo 12 cm de diámetro y pocillo de mínimo 150 cc
- No se debe rayar con el uso de los cubiertos y
debe ser apta para uso en horno microondas.', 'Juego'),
  (242, 'Terno para café', '-Pocillo y plato de porcelana blanca para café.
- Sin diseño
- Plato de mínimo 12 cm de diámetro y pocillo de mínimo 150 cc
- No se debe rayar con el uso de los cubiertos y
debe ser apta para uso en horno microondas.', 'Juego'),
  (243, 'Vajilla 1', '- Elaborada en porcelana
- Sin diseño
- Compuesta de 8 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 16 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas.', 'Juego'),
  (244, 'Vajilla 1', '- Elaborada en porcelana
- Sin diseño
- Compuesta de 8 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 16 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas.', 'Juego'),
  (245, 'Vajilla 2', '- Elaborada en porcelana
- Sin diseño
- Compuesta de 4 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 16 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas.', 'Juego'),
  (246, 'Vajilla 2', '- Elaborada en porcelana
- Sin diseño
- Compuesta de 4 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 16 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas.', 'Juego'),
  (247, 'Cuchillo de cocina', '- Hoja elaborada en acero inoxidable de mínimo 20 cm de largo y 2 cm de ancho.
- Mango liso elaborado en polipropileno negro', 'Unidad'),
  (248, 'Tijeras de cocina', '- Hojas elaborada en acero inoxidable de mínimo 20 cm de largo
- Mango de plástico liso', 'Unidad'),
  (249, 'Jarra', '- Elaborada en vidrio
- Sin diseño
- Capacidad mínima de 1,5 litros', 'Unidad'),
  (250, 'Jarra', '- Elaborada en vidrio
- Sin diseño
- Capacidad mínima de 1,5 litros', 'Unidad'),
  (251, 'Combustible', '- Gasolina 
- Para cortadora de césped, sopladora de hojas y guadañas', 'Galón'),
  (252, 'Organizador porta escobas', '- Con capacidad para organizar mínimo 4 escobas de manera simultánea', 'Unidad'),
  (253, 'Espátula', '- Metálica con mango de plástico
- Con hoja de mínimo 2 pulgadas de largo', 'Unidad'),
  (254, 'Haraganes 1', '- Para limpiar vidrios
- Con banda de goma con longitud mínima de 25 cm.
- Mango con longitud mínima de 60 cm', 'Unidad'),
  (255, 'Haraganes 2', '- Para limpiar vidrios
- Con banda de goma con longitud mínima de 50 cm.
- Mango metálico extensible con longitud mínima
de 60 cm y máxima de 150 cm', 'Unidad'),
  (256, 'Haraganes 3', '- Para escurrir pisos
- Con banda de goma con longitud mínima de 35 cm
- Mango con longitud mínima de 120 cm', 'Unidad'),
  (257, 'Haraganes 4', '- Para escurrir pisos
-Con banda de goma con longitud mínima de 50 cm.
- Mango metálico extensible con longitud mínima
de 60 cm y máxima de 150 cm', 'Unidad'),
  (258, 'Haraganes 5', '- Para escurrir pisos
-Con banda de goma con longitud mínima de 80 cm.
- Mango metálico extensible con longitud mínima
de 60 cm y máxima de 150 cm', 'Unidad'),
  (259, 'Balde', '- Capacidad mínima de 10 litros
- Con manija móvil
- Con "pico" antiderrames
- Disponibles en diferentes colores
- Elaborado en material reciclable
- Marcado de acuerdo con la norma ISO 11469 y ISO 1043.', 'Unidad'),
  (260, 'Balde', '- Capacidad mínima de 10 litros
- Con manija móvil
- Con "pico" antiderrames
- Disponibles en diferentes colores
- Elaborado en material reciclable
- Marcado de acuerdo con la norma ISO 11469 y ISO 1043.', 'Unidad'),
  (261, 'Plato Biodegradable 1', '- Plato pando, circular, sin divisiones 
- Biodegradable 
-Tamaño: 15 cm
- Sin ala
- Elaborado con la fibra de caña de azúcar o almidón de maíz
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad'),
  (262, 'Plato Biodegradable 2', '- Plato pando, circular, sin divisiones 
- Biodegradable 
-Tamaño: 18 cm
- Sin ala
- Elaborado con la fibra de caña de azúcar o almidón de maíz
- No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad'),
  (263, 'Pocillos 1', '- Elaborado en porcelana blanca para café
- De mínimo 170 cc
- No se debe rayar con el uso de cubiertos
- Debe ser apta para uso en microondas', 'Unidad'),
  (264, 'Pocillos 1', '- Elaborado en porcelana blanca para café
- De mínimo 170 cc
- No se debe rayar con el uso de cubiertos
- Debe ser apta para uso en microondas', 'Unidad'),
  (265, 'Terno para café', '-Pocillo y plato de porcelana blanca para café.
- Plato de mínimo 13 cm de diámetro y pocillo de mínimo 170 cc
- No se debe rayar con el uso de los cubiertos y
debe ser apta para uso en horno microondas.', 'Juego'),
  (266, 'Terno para café', '-Pocillo y plato de porcelana blanca para café.
- Plato de mínimo 13 cm de diámetro y pocillo de mínimo 170 cc
- No se debe rayar con el uso de los cubiertos y
debe ser apta para uso en horno microondas.', 'Juego'),
  (267, 'Cafetera 1', '- Capacidad mínima de 12 tazas
 - 120 voltios
 - Potencia mínima de 900 w
 - Filtro permanente
 - Material plástico
 - Jarra de vidrio', 'Unidad'),
  (268, 'Cafetera 1', '- Capacidad mínima de 12 tazas
 - 120 voltios
 - Potencia mínima de 900 w
 - Filtro permanente
 - Material plástico
 - Jarra de vidrio', 'Unidad'),
  (269, 'Vajilla 3', '- Elaborada en porcelana
- Compuesta de 8 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 17 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas', 'Juego'),
  (270, 'Vajilla 3', '- Elaborada en porcelana
- Compuesta de 8 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 17 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas', 'Juego'),
  (271, 'Vajilla 4', '- Elaborada en porcelana
- Compuesta de 4 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 17 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas', 'Juego'),
  (272, 'Vajilla 4', '- Elaborada en porcelana
- Compuesta de 4 puestos y cuatro piezas por puesto:
- Plato para cena (diámetro mínimo de 26 cm)
- Plato hondo (diámetro mínimo de 20 cm)
- Plato auxiliar (diámetro mínimo de 17 cm)
- Taza (capacidad mínima es de 280 cc)
- Apta para uso en horno microondas', 'Juego'),
  (273, 'Portavasos', '- Elaborado en acero inoxidable
- (Redondo) Diámetro mínimo de 11 o (Cuadrado) mínimo 11 cm de largo y de ancho', 'Unidad'),
  (274, 'Portavasos', '- Elaborado en acero inoxidable
- (Redondo) Diámetro mínimo de 11 o (Cuadrado) mínimo 11 cm de largo y de ancho', 'Unidad'),
  (275, 'Bandeja 1', '- Elaborada en acero inoxidable
- Sin diseño
- Dimensiones mínimas de 37 cm de largo por 27 cm de ancho', 'Unidad'),
  (276, 'Bandeja 1', '- Elaborada en acero inoxidable
- Sin diseño
- Dimensiones mínimas de 37 cm de largo por 27 cm de ancho', 'Unidad'),
  (277, 'Bandeja 2', '- Elaborada en acero inoxidable
- Sin diseño
- Dimensiones mínimas de 50 cm de largo por 33 cm de ancho', 'Unidad'),
  (278, 'Bandeja 2', '- Elaborada en acero inoxidable
- Sin diseño
- Dimensiones mínimas de 50 cm de largo por 33 cm de ancho', 'Unidad'),
  (279, 'Bandeja 3', '- Elaborada en plástico
- Superficie antideslizante
- Diseño sencillo
- Dimensiones mínimas de 37cm de largo por 27 cm de ancho
- Color blanco o beige', 'Unidad'),
  (280, 'Bandeja 3', '- Elaborada en plástico
- Superficie antideslizante
- Diseño sencillo
- Dimensiones mínimas de 37cm de largo por 27 cm de ancho
- Color blanco o beige', 'Unidad'),
  (281, 'Bandeja 4', '- Elaborada en plástico
- Superficie antideslizante
- Diseño sencillo
- Dimensiones mínimas de 45 cm de largo por 35 cm de ancho
- Color blanco o beige', 'Unidad'),
  (282, 'Bandeja 4', '- Elaborada en plástico
- Superficie antideslizante
- Diseño sencillo
- Dimensiones mínimas de 45 cm de largo por 35 cm de ancho
- Color blanco o beige', 'Unidad'),
  (283, 'Olleta', '- Elaborada en aluminio
- Capacidad mínima de 2 litros', 'Unidad'),
  (284, 'Olleta', '- Elaborada en aluminio
- Capacidad mínima de 2 litros', 'Unidad'),
  (285, 'Olla 1', '- Elaborada en aluminio
- Con tapa en aluminio
- Capacidad mínima de 3 litros', 'Unidad'),
  (286, 'Olla 1', '- Elaborada en aluminio
- Con tapa en aluminio
- Capacidad mínima de 3 litros', 'Unidad'),
  (287, 'Olla 2', '- Elaborada en aluminio
- Con tapa en aluminio
- Capacidad mínima de 5 litros', 'Unidad'),
  (288, 'Olla 2', '- Elaborada en aluminio
- Con tapa en aluminio
- Capacidad mínima de 5 litros', 'Unidad'),
  (289, 'Escurridor para platos', '- Elaborado en plástico
- Con rejilla, portacubiertos y bandeja plástica de goteo
- Dimensiones mínimas de 40 cm de largo y 30 cm de ancho', 'Unidad'),
  (290, 'Escurridor para platos', '- Elaborado en plástico
- Con rejilla, portacubiertos y bandeja plástica de goteo
- Dimensiones mínimas de 40 cm de largo y 30 cm de ancho', 'Unidad'),
  (291, 'Soporte para Botellón de agua', '- Metálico
- Plegable', 'Unidad'),
  (292, 'Carro exprimidor de trapero 1', '- Elaborado en plástico
 - Capacidad mínima de 12 litros
 - Con cuatro ruedas y manija de escurridor', 'Unidad'),
  (293, 'Carro exprimidor de trapero 1', '- Elaborado en plástico
 - Capacidad mínima de 12 litros
 - Con cuatro ruedas y manija de escurridor', 'Unidad'),
  (294, 'Carro exprimidor de trapero 1', '- Elaborado en plástico
 - Capacidad mínima de 24 litros
 - Con cuatro ruedas y manija de escurridor', 'Unidad'),
  (295, 'Carro exprimidor de trapero 1', '- Elaborado en plástico
 - Capacidad mínima de 24 litros
 - Con cuatro ruedas y manija de escurridor', 'Unidad'),
  (296, 'Carro exprimidor de trapero 2', '- Elaborado en plástico
- Capacidad mínima de 35 litros
- Con cuatro ruedas y manija de escurridor', 'Unidad'),
  (297, 'Carro exprimidor de trapero 2', '- Elaborado en plástico
- Capacidad mínima de 35 litros
- Con cuatro ruedas y manija de escurridor', 'Unidad'),
  (298, 'Carros para limpieza', '- Tamaño mínimo de 70 cm de largo por 50 cm de ancho por 95 cm de alto
- Mínimo dos bandejas de servicio
- Con mínimo una bolsa de limpieza
- Con plataforma para balde escurridor
- Con cuatro ruedas antirayones
- Ruedas delanteras con ángulo de giro de 360 grados', 'Unidad'),
  (299, 'Carros para limpieza', '- Tamaño mínimo de 70 cm de largo por 50 cm de ancho por 95 cm de alto
- Mínimo dos bandejas de servicio
- Con mínimo una bolsa de limpieza
- Con plataforma para balde escurridor
- Con cuatro ruedas antirayones
- Ruedas delanteras con ángulo de giro de 360 grados', 'Unidad'),
  (300, 'Carro de bebidas', '- Elaborado en plástico
- Mínimo dos estantes para distribución de bebidas
- Tamaño mínimo de 80 cm de largo por 47 cm de ancho por 90 cm de alto', 'Unidad'),
  (301, 'Carro de bebidas', '- Elaborado en plástico
- Mínimo dos estantes para distribución de bebidas
- Tamaño mínimo de 80 cm de largo por 47 cm de ancho por 90 cm de alto', 'Unidad'),
  (302, 'Escalera 1', '- Cuerpo plástico
- Altura mínima de mínimo dos pasos.', 'Unidad'),
  (303, 'Escalera 1', '- Cuerpo plástico
- Altura mínima de mínimo dos pasos.', 'Unidad'),
  (304, 'Escalera 2', '- Cuerpo Metálico
- Altura mínima de mínimo dos pasos.', 'Unidad'),
  (305, 'Escalera 2', '- Cuerpo Metálico
- Altura mínima de mínimo dos pasos.', 'Unidad'),
  (306, 'Escalera 3', '- Cuerpo Metálico
- Altura mínima de mínimo cuatro pasos.', 'Unidad'),
  (307, 'Escalera 3', '- Cuerpo Metálico
- Altura mínima de mínimo cuatro pasos.', 'Unidad'),
  (308, 'Escalera 4', '- Cuerpo Metálico
- Altura mínima de mínimo seis pasos.', 'Unidad'),
  (309, 'Escalera 4', '- Cuerpo Metálico
- Altura mínima de mínimo seis pasos.', 'Unidad'),
  (310, 'Escalera de tipo industrial', 'Cuerpo en aluminio, tipo tijera
- Altura mínima de 5 escalones
- Con capacidad de resistencia a una carga concentrada en cualquier punto del escalón de 127 kg
- Con tapones de caucho antideslizantes', 'Unidad'),
  (311, 'Escalera de tipo industrial', 'Cuerpo en aluminio, tipo tijera
- Altura mínima de 5 escalones
- Con capacidad de resistencia a una carga concentrada en cualquier punto del escalón de 127 kg
- Con tapones de caucho antideslizantes', 'Unidad'),
  (312, 'Mangueras 1', '- Longitud mínima de 20 metros
 - Elaborada en PVC
 - Con terminales roscadas en ambos extremos
 - Incluye accesorios: acoples y pistola', 'Unidad'),
  (313, 'Mangueras 1', '- Longitud mínima de 20 metros
 - Elaborada en PVC
 - Con terminales roscadas en ambos extremos
 - Incluye accesorios: acoples y pistola', 'Unidad'),
  (314, 'Mangueras 2', '- Longitud mínima de 30 metros
- Elaborada en PVC
- Con terminales roscadas en ambos extremos
- Incluye accesorios: acoples y pistola', 'Unidad'),
  (315, 'Mangueras 2', '- Longitud mínima de 30 metros
- Elaborada en PVC
- Con terminales roscadas en ambos extremos
- Incluye accesorios: acoples y pistola', 'Unidad'),
  (316, 'Mangueras 3', '- Longitud mínima de 50 metros
- Elaborada en PVC
- Con terminales roscadas en ambos extremos
- Incluye accesorios: acoples y pistola', 'Unidad'),
  (317, 'Mangueras 3', '- Longitud mínima de 50 metros
- Elaborada en PVC
- Con terminales roscadas en ambos extremos
- Incluye accesorios: acoples y pistola', 'Unidad'),
  (318, 'Contenedor de basura 1', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 10 litros
- Color negro
- Impresión de la frase "Residuos no aprovechable" en la cara delantera del contenedor', 'Unidad'),
  (319, 'Contenedor de basura 2', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 10 litros
- Color blanco
- Impresión de la frase "Residuos aprovechables" en la cara delantera del contenedor', 'Unidad'),
  (320, 'Contenedor de basura 3', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 10 litros
- Color verde
- Impresión de la frase "Residuos orgánicos aprovechables" en la cara delantera del contenedor', 'Unidad'),
  (321, 'Contenedor de basura 4', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 10 litros
- Color rojo
- Impresión de las palabras "Riesgo biológico" o "Residuos peligrosos" en la cara delantera del contenedor', 'Unidad'),
  (322, 'Contenedor de basura 5', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 20 litros
- Color negro
- Impresión de la frase "Residuos no aprovechable" en la cara delantera del contenedor', 'Unidad'),
  (323, 'Contenedor de basura 6', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 20 litros
- Color blanco
- Impresión de la frase "Residuos aprovechables" en la cara delantera del contenedor', 'Unidad'),
  (324, 'Contenedor de basura 7', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 20 litros
- Color verde
- Impresión de la frase "Residuos orgánicos aprovechables" en la cara delantera del contenedor', 'Unidad'),
  (325, 'Contenedor de basura 8', '- Elaborado en plástico
- Tapa con pedal
- Capacidad mínima de 20 litros
- Color rojo
- Impresión de las palabras "Riesgo biológico" o "Residuos peligrosos" en la cara delantera del
contenedor', 'Unidad'),
  (326, 'Contenedor de basura 9', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 50 litros
- Color negro
- Impresión de la frase "Residuos no aprovechable" en la cara delantera del contenedor', 'Unidad'),
  (327, 'Contenedor de basura 10', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 50 litros
- Color blanco
- Impresión de la frase "Residuos aprovechables" en la cara delantera del contenedor', 'Unidad'),
  (328, 'Contenedor de basura 11', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 50 litros
- Color verde
- Impresión de la frase "Residuos orgánicos aprovechables" en la cara delantera del contenedor', 'Unidad'),
  (329, 'Contenedor de basura 12', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 50 litros
- Color rojo
- Impresión de las palabras "Riesgo biológico" o "Residuos peligrosos" en la cara delantera del contenedor', 'Unidad'),
  (330, 'Contenedor de basura 13', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 120 litros
- Color negro
- Impresión de la frase "Residuos no aprovechable" en la cara delantera del contenedor', 'Unidad'),
  (331, 'Contenedor de basura 14', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 120 litros
- Color blanco
- Impresión de la frase "Residuos aprovechables" en la cara delantera del contenedor', 'Unidad'),
  (332, 'Contenedor de basura 15', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 120 litros
- Color verde
- Impresión de la frase "Residuos orgánicos aprovechables" en la cara delantera del contenedor', 'Unidad'),
  (333, 'Contenedor de basura 16', '- Elaborado en plástico
- Con tapa en vaivén
- Capacidad mínima de 120 litros
- Color rojo
- Impresión de las palabras "Riesgo biológico" o
"Residuos peligrosos" en la cara delantera del contenedor', 'Unidad'),
  (334, 'Contenedor de basura 17', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 180 litros
- Color negro
- Con ruedas traseras macizas y manijas', 'Unidad'),
  (335, 'Contenedor de basura 18', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 180 litros
- Color verde
- Con ruedas traseras macizas y manijas', 'Unidad'),
  (336, 'Contenedor de basura 19', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 180 litros
- Color blanco
- Con ruedas traseras macizas y manijas', 'Unidad'),
  (337, 'Contenedor de basura 20', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 240 litros
- Color negro
- Con ruedas traseras macizas y manijas', 'Unidad'),
  (338, 'Contenedor de basura 21', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 240 litros
- Color verde
- Con ruedas traseras macizas y manijas', 'Unidad'),
  (339, 'Contenedor de basura 22', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 240 litros
- Color blanco
- Con ruedas traseras macizas y manijas', 'Unidad'),
  (340, 'Contenedor de basura 23', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 340 litros
- Color negro
- Con ruedas traseras macizas y manijas', 'Unidad'),
  (341, 'Contenedor de basura 24', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 340 litros
- Color verde
- Con ruedas traseras macizas y manijas', 'Unidad'),
  (342, 'Contenedor de basura 25', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 340 litros
- Color blanco
- Con ruedas traseras macizas y manijas', 'Unidad'),
  (343, 'Contenedor de basura 26', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 760 litros
- Color negro
- Con ruedas traseras macizas y manijas', 'Unidad'),
  (344, 'Contenedor de basura 27', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 760 litros
- Color verde
- Con ruedas traseras macizas y manijas', 'Unidad'),
  (345, 'Contenedor de basura 28', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 760 litros
- Color blanco
- Con ruedas traseras macizas y manijas', 'Unidad'),
  (346, 'Contenedor de basura 29', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 1.000 litros
- Color blanco
- Con ruedas traseras macizas y manijas', 'Unidad'),
  (347, 'Contenedor de basura 30', '- Elaborado en plástico
- Con tapa
- Capacidad mínima de 1.000 litros
- Color verde
- Con ruedas traseras macizas y manijas', 'Unidad'),
  (348, 'Punto Ecológico 1', '- Base metálica
- Mínimo tres contenedores así:
- Contenedor color verde con palabras "residuos orgánicos aprovechables: restos de comida, desechos agrícolas" en la cara frontal
- Contenedor color blanco con palabras "residuos aprovechables como plástico, vidrio, metales, multicapa, papel y cartón" en la cara frontal
- Contenedor color negro con las palabaras "residuos no aprovechables: papel higiénico, servilletas, papeles y cartones contaminados con comida, papeles metalizados" en la cara frontal
- Capacidad mínima de 20 litros para cada contenedor
- Contenedores elaborados en plástico
- Debe cumplir con lo estipualdo en el artíuculo 4° de la Resolución 2184 del 26 de diciembre de 2019', 'Unidad'),
  (349, 'Punto Ecológico 2', '- Base metálica
- Mínimo tres contenedores así:
- Contenedor color verde con palabras "residuos orgánicos aprovechables: restos de comida, desechos agrícolas" en la cara frontal
- Contenedor color blanco con palabras "residuos aprovechables como plástico, vidrio, metales, multicapa, papel y cartón" en la cara frontal
- Contenedor color negro con las palabaras "residuos no aprovechables: papel higiénico, servilletas, papeles y cartones contaminados con comida, papeles metalizados" en la cara frontal
- Capacidad mínima de 35 litros para cada contenedor
- Contenedores elaborados en plástico
- Debe cumplir con lo estipualdo en el artíuclo 4° de la Resolución 2184 del 26 de diciembre de 2019', 'Unidad'),
  (350, 'Punto Ecológico 3', '- Base metálica con techo en material metálico
- Mínimo tres contenedores así:
- Contenedor color verde con palabras "residuos orgánicos aprovechables: restos de comida, desechos agrícolas" en la cara frontal
- Contenedor color blanco con palabras "residuos aprovechables como plástico, vidrio, metales, multicapa, papel y cartón" en la cara frontal
- Contenedor color negro con las palabaras "residuos no aprovechables: papel higiénico, servilletas, papeles y cartones contaminados con comida, papeles metalizados" en la cara frontal
- Capacidad mínima de 35 litros para cada contenedor
- Contenedores elaborados en plástico
- Debe cumplir con lo estipualdo en el artíuclo 4° de la Resolución 2184 del 26 de diciembre de 2019', 'Unidad'),
  (351, 'Punto Ecológico 4', '- Base metálica
- Mínimo tres contenedores así:
- Contenedor color verde con palabras "residuos orgánicos aprovechables: restos de comida, desechos agrícolas" en la cara frontal
- Contenedor color blanco con palabras "residuos aprovechables como plástico, vidrio, metales, multicapa, papel y cartón" en la cara frontal
- Contenedor color negro con las palabaras "residuos no aprovechables: papel higiénico, servilletas, papeles y cartones contaminados con comida, papeles metalizados" en la cara frontal
- Capacidad mínima de 50 litros para cada contenedor
- Contenedores elaborados en plástico
- Debe cumplir con lo estipualdo en el artíuclo 4° de la Resolución 2184 del 26 de diciembre de 2019', 'Unidad'),
  (352, 'Punto Ecológico 5', '- Base metálica con techo en material metálico
- Mínimo tres contenedores así:
- Contenedor color verde con palabras "residuos orgánicos aprovechables: restos de comida, desechos agrícolas" en la cara frontal
- Contenedor color blanco con palabras "residuos aprovechables como plástico, vidrio, metales, multicapa, papel y cartón" en la cara frontal
- Contenedor color negro con las palabaras "residuos no aprovechables: papel higiénico, servilletas, papeles y cartones contaminados con comida, papeles metalizados" en la cara frontal
- Capacidad mínima de 50 litros para cada contenedor
- Contenedores elaborados en plástico
- Debe cumplir con lo estipualdo en el artíuclo 4° de la Resolución 2184 del 26 de diciembre de 2019', 'Unidad'),
  (353, 'Punto Ecológico 6', '- Base metálica
- Mínimo tres contenedores así:
- Contenedor color verde con palabras "residuos orgánicos aprovechables: restos de comida, desechos agrícolas" en la cara frontal
- Contenedor color blanco con palabras "residuos aprovechables como plástico, vidrio, metales, multicapa, papel y cartón" en la cara frontal
- Contenedor color negro con las palabaras "residuos no aprovechables: papel higiénico, servilletas, papeles y cartones contaminados con comida, papeles metalizados" en la cara frontal
- Capacidad mínima de 100 litros para cada contenedor
- Contenedores elaborados en plástico
- Debe cumplir con lo estipualdo en el artíuclo 4° de la Resolución 2184 del 26 de diciembre de 2019', 'Unidad'),
  (354, 'Papelera 1', '- Cuerpo metálico enmallado sin tapa
- Con capacidad mínima de 10 litros
- Diseño para oficina', 'Unidad'),
  (355, 'Papelera 2', '- Cuerpo plástico
- Con mecanismo de pedal para abrir y cerrar tapa
- Con capacidad mínima de 10 litros
- Diseño para baño', 'Unidad'),
  (356, 'Papelera 3', '- Cuerpo plástico sin tapa
- Con capacidad mínima de 10 litros
- Diseño para baño', 'Unidad'),
  (357, 'Papelera 4', '- Papelera de oficina de plástico reciclado
- Color negro
- Con capacidad de 4,5 litros
- Diámetro: 22 cm aproxi. Largo: 24 cm. 
No debe contener PVC o Poliestireno expandido u otros plásticos de un solo uso tanto en el envase como en el embalaje.', 'Unidad'),
  (358, 'Papelera residuos peligrosos 1', '- Cuerpo plástico
- Con mecanismo de pedal para abrir y cerrar tapa
- Con capacidad mínima de 10 litros
- Diseño para baño
- Color rojo
- Con las palabras "Riesgo biológico" en la cara frontal', 'Unidad'),
  (359, 'Papelera residuos peligrosos 2', '- Cuerpo plástico
- Con mecanismo de pedal para abrir y cerrar tapa
- Con capacidad mínima de 20 litros
- Diseño para baño
- Color rojo
- Con las palabras "Riesgo biológico" en la cara frontal', 'Unidad'),
  (360, 'Señales peatonales de prevención y atención 1', '- Elaborado en plástico
- Tipo tijera, plegable
- Tamaño mínimo de 25 cm de ancho por 60 cm de alto por 22 cm de largo.
- Impresión en las dos caras con las palabras "Cerrado" o "Área cerrada" o "No pasar".
- Color amarillo', 'Unidad'),
  (361, 'Señales peatonales de prevención y atención 1', '- Elaborado en plástico
- Tipo tijera, plegable
- Tamaño mínimo de 25 cm de ancho por 60 cm de alto por 22 cm de largo.
- Impresión en las dos caras con las palabras "Cerrado" o "Área cerrada" o "No pasar".
- Color amarillo', 'Unidad'),
  (362, 'Señales peatonales de prevención y atención 2', '- Elaborado en plástico
- Tipo tijera, plegable
- Tamaño mínimo de 25 cm de ancho por 60 cm de alto por 22 cm de largo.
- Impresión en las dos caras con las palabras "Cuidado".
- Color amarillo
- Acordes con la reglamentación establecida por la NTC 1461', 'Unidad'),
  (363, 'Señales peatonales de prevención y atención 2', '- Elaborado en plástico
- Tipo tijera, plegable
- Tamaño mínimo de 25 cm de ancho por 60 cm de alto por 22 cm de largo.
- Impresión en las dos caras con las palabras "Cuidado".
- Color amarillo
- Acordes con la reglamentación establecida por la NTC 1461', 'Unidad'),
  (364, 'Señales peatonales de prevención y atención 3', '- Elaborado en plástico
- Tipo tijera, plegable
- Tamaño mínimo de 25 cm de ancho por 60 cm de alto por 22 cm de largo.
- Impresión en las dos caras con las palabras "Piso húmedo o "Piso mojado"".
- Color amarillo
- Acordes con la reglamentación establecida por la NTC 1461', 'Unidad'),
  (365, 'Señales peatonales de prevención y atención 3', '- Elaborado en plástico
- Tipo tijera, plegable
- Tamaño mínimo de 25 cm de ancho por 60 cm de alto por 22 cm de largo.
- Impresión en las dos caras con las palabras "Piso húmedo o "Piso mojado"".
- Color amarillo
- Acordes con la reglamentación establecida por la NTC 1461', 'Unidad'),
  (366, 'Dispensador para papel higiénico 1', '- Elaborado en plástico ABS blanco
- Para rollo de 250 metros y 400 metros
- Con visor para ver el estado del rollo
- Con cerradura y llave
- Incluye los elementos necesarios para realizar la instalación en pared
-Incluye el costo de instalación.', 'Unidad'),
  (367, 'Dispensador para papel higiénico 2', '- Elaborado en acero inoxidable
- Para rollo de 250 metros y 400 metros
- Con visor para ver el estado del rollo
- Con cerradura y llave
- Incluye los elementos necesarios para realizar la instalación en pared
-Incluye el costo de instalación.', 'Unidad'),
  (368, 'Dispensador de toallas de manos 1', '- Elaborado en plástico ABS
- Para toallas de papel en rollo de 150 metros y 250 metros
- Con mecanismo accionador de palanca, perilla giratoria o para halar con la mano.
- Con cuchilla serrada para cortar la toalla de manos
- Con cerradura y llave
- Incluye los elementos necesarios para realizar la instalación en pared
 - Incluye el costo de instalación', 'Unidad'),
  (369, 'Dispensador de toallas de manos 2', '- Elaborado en plástico ABS
- Para toallas de papel interdobladas con capacidad mínima de 300 toallas
- Con mecanismo para halar con la mano.
- Con cerradura y llave
- Incluye los elementos necesarios para realizar la instalación en pared
-Incluye el costo de instalación', 'Unidad'),
  (370, 'Dispensador de toallas de manos 3', '- Elaborado en acero inoxidable
- Para toallas de papel interdobladas con capacidad mínima de 300 toallas
- Con mecanismo para halar con la mano.
- Con cerradura y llave
- Incluye los elementos necesarios para realizar la instalación en pared
-Incluye el costo de instalación', 'Unidad'),
  (371, 'Dispensador de jabón líquido 1', '- Elaborado en plástico ABS blanco
- Con válvula manual anticorrosiva.
- Uso habilitado para cualquier jabón líquido con capacidad mínima de 500 cc
- Incluye los elementos necesarios para realizar la instalación en pared
-Incluye el costo de instalación', 'Unidad'),
  (372, 'Dispensador de jabón líquido 2', '- Elaborado en plástico ABS blanco
- Con sensor para suministro de jabón
- Uso habilitado para cualquier jabón líquido con capacidad mínima de 500 ml
- Incluye los elementos necesarios para realizar la instalación en pared
 -Incluye el costo de instalación''', 'Unidad'),
  (373, 'Dispensador de jabón líquido 3', '- Elaborado en acero inoxidable
- Con válvula manual anticorrosiva.
- Uso habilitado para cualquier jabón líquido con capacidad mínima de 800 ml
- Con cerradura y llave
- Incluye los elementos necesarios para realizar la instalación en pared
 -Incluye el el costo de instalación''', 'Unidad'),
  (374, 'Dispensador de jabón líquido 4', '- Elaborado en acero inoxidable
- Con sensor para suministro de jabón
- Uso habilitado para cualquier jabón líquido con capacidad mínima de 800 ml
- Con cerradura y llave
- Incluye los elementos necesarios para realizar la instalación en pared
 -Incluye el costo de instalación''', 'Unidad'),
  (375, 'Dispensador para ambientador', '- Elaborado en plástico ABS blanco
 - Con dispersión programable de líquido ambientador
 - Capacidad mínima de 250 ml
- Incluye los elementos necesarios para realizar la instalación en pared
-Incluye el costo de instalación', 'Unidad'),
  (376, 'Dispensador para ambientador', '- Elaborado en plástico ABS blanco
 - Con dispersión programable de líquido ambientador
 - Capacidad mínima de 250 ml
- Incluye los elementos necesarios para realizar la instalación en pared
-Incluye el costo de instalación', 'Unidad'),
  (377, 'Recarga: Dispensador para ambientador', 'Recarga mensual del dispensador para ambientador', 'Mensual'),
  (378, 'Dispensador goteo por gravedad y recarga', '- Elaborado en PVC blanco
- Goteo programable para desodorizar sanitarios y orinales
- Incluye manguera plástica de goteo
- Incluye los elementos necesarios para realizar la instalación en pared', 'Unidad'),
  (379, 'Dispensador goteo por gravedad', '- Elaborado en PVC blanco
- Goteo programable para desodorizar sanitarios y orinales
- Incluye manguera plástica de goteo
- Incluye los elementos necesarios para realizar la instalación en pared', 'Unidad'),
  (380, 'Recarga: Dispensador goteo por gravedad', 'Recarga mensual del dispensador goteo para gravedad con líquido con agentes tensoactivos.', 'Mensual'),
  (381, 'Dispensador de agua', '- Dispensador de agua fría y caliente
- Sistema de filtración multinivel
- Uso de gas refrigerante seguro para la capa de ozono', 'Unidad'),
  (382, 'Dispensador de agua', '- Dispensador de agua fría y caliente
- Sistema de filtración multinivel
- Uso de gas refrigerante seguro para la capa de ozono', 'Unidad'),
  (383, 'Dispensador de agua con botellón', '- Dispensador de agua fría y caliente
- Uso de gas refrigerante seguro para la capa de ozono', 'Unidad'),
  (384, 'Dispensador de agua con botellón', '- Dispensador de agua fría y caliente
- Uso de gas refrigerante seguro para la capa de ozono', 'Unidad'),
  (385, 'Greca para tintos 1', '- Eléctrica de 110 v
- Cuerpo elaborada en lámina de acero inoxidable de calibre 24 como mínimo
- Resistencias elaboradas en cobre
- Terminales elaboradas en cobre remplazables con soldadura
- Mínimo dos servicios
- Con su respectivo filtro y aro
 - Con capacidad para 30 tintos', 'Unidad'),
  (386, 'Greca para tintos 2', '- Eléctrica de 110 v
- Cuerpo elaborada en lámina de acero inoxidable de calibre 24 como mínimo, grado alimento
- Resistencias elaboradas en cobre
- Terminales elaboradas en cobre remplazables sin soldadura
- Mínimo 2 servicios
 -Con su respectivo filtro y aro
- Con capacidad para 60 tintos', 'Unidad'),
  (387, 'Greca para tintos 3', '- Eléctrica de 110 v
- Cuerpo elaborada en lámina de acero inoxidable de calibre 24 como mínimo, grado alimento
- Resistencias elaboradas en cobre
- Terminales elaboradas en cobre remplazables sin soldadura
- Mínimo dos servicios
 -Con su respectivo filtro y aro
 - Con capacidad para 120 tintos', 'Unidad'),
  (388, 'Máquina de filtrado para café', '- Cafetera de método filtrado de café por goteo con conexión directamente a la red de agua o con opción de usarse completamente portátil sin requerir conexión directa a la red de agua
- Grifo para dispensar agua caliente
- Capacidad para termos de 1.9 a 3L, capacidad de 14 litros hora
- Incluye termo con capacidad de mantener la bebida caliente, conservando la calidad de la taza de café durante mínimo 3 horas
- Revestimiento de acero inoxidable con bomba tipo dispensador 
- Capacidad de 2,5 0 3,0 litros.', 'Unidad'),
  (389, 'Horno microondas', '- Potencia mínima de 900 w
- Tamaño mínimo de 30 cm de ancho por 25 cm de alto por 35 cm de profundidad.
- Con bandera giratoria de cristal templado
- Con programas automáticos', 'Unidad'),
  (390, 'Horno microondas de tipo industrial', '- Potencia mínima de 1000 w
- Tamaño mínimo de 30 cm de ancho por 30 cm de alto por 40 cm de profundidad.
- Descongelamiento automático
- Con programas automáticos', 'Unidad'),
  (391, 'Estufa 1', '- De dos puestos
- Lámina esmaltada
- Eléctrica
- Con perilla para graduar mínimo 3 niveles de calor', 'Unidad'),
  (392, 'Estufa 1', '- De dos puestos
- Lámina esmaltada
- Eléctrica
- Con perilla para graduar mínimo 3 niveles de calor', 'Unidad'),
  (393, 'Estufa 2', '- De dos puestos
- Lámina esmaltada- A gas
- Con perilla y quemador para graduar la llama
- Con parrilla', 'Unidad'),
  (394, 'Estufa 2', '- De dos puestos
- Lámina esmaltada
- A gas
- Con perilla y quemador para graduar la llama
- Con parrilla', 'Unidad'),
  (395, 'Extensión eléctrica 1', '- De mínimo 25 metros de longitud 
- Tipo industrial
- Recubierta en plástico PVC
- Con clavijas
- Calibre 12', 'Unidad'),
  (396, 'Extensión eléctrica 1', '- De mínimo 25 metros de longitud 
- Tipo industrial
- Recubierta en plástico PVC
- Con clavijas
- Calibre 12', 'Unidad'),
  (397, 'Extensión eléctrica 2', '- De mínimo 30 metros de longitud
- Recubierta en plástico PVC
- Con clavijas
- Tipo industrial
- Calibre 12', 'Unidad'),
  (398, 'Extensión eléctrica 2', '- De mínimo 30 metros de longitud
- Recubierta en plástico PVC
- Con clavijas
- Tipo industrial
- Calibre 12', 'Unidad'),
  (399, 'Aspiradora 1', '- De uso industrial para aspirado en seco y húmedo
- Motor con potencia 1200 w y 1400 w
- Capacidad entre 15 y 20 litros
- Cable de potencia con longitud mínima de 5m
- Accesorios mínimos: manguera puntera, 2 tubos para extensión, cepillos para tapizados', 'Unidad'),
  (400, 'Aspiradora 2', '- De uso industrial para aspirado en seco y húmedo
- Motor con potencia entre 1200 w y 1400 w
- Capacidad entre 45 y 55 litros
- Cable de potencia con longitud mínima de 5m
- Accesorios mínimos: manguera puntera, 2 tubos para extensión, cepillos para tapizados', 'Unidad'),
  (401, 'Lavabrilladora de pisos 1', '- De uso industrial
- Motores con potencia mínima de 1,5 hp y velocidad mínima de 175 rpm.
- Con manijas dobles
- Con interruptor de apagado de seguridad
- Diámetro mínimo de 16"
- Cable de potencia con longitud mínima de 8m
- Accesorios mínimos portapad, cepillo suave y duro', 'Unidad'),
  (402, 'Lavabrilladora de pisos 2', '- De uso industrial
- Motores con potencia mínima de 1,5 hp y velocidad mínima de 175 rpm.
- Con manijas dobles
- Con interruptor de apagado de seguridad
- Diámetro mínimo de 20"
- Cable de potencia con longitud mínima de 8m
- Accesorios mínimos portapad, cepillo suave y duro', 'Unidad'),
  (403, 'Brilladora de alta revolución', '- De uso industrial
- Motores con potencia mínima de 1,5 hp y velocidad mínima de 1500 rpm.
- Con manijas dobles
- Con interruptor de apagado de seguridad
- Diámetro mínimo de 20"
- Cable de potencia con longitud mínima de 8m
- Accesorios mínimos - portapad', 'Unidad'),
  (404, 'Lavadora de alfombras y tapetes 1', '- Motor con potencia de mínimo 1100 w y velocidad mínima de 175 revoluciones por minuto.
- Capacidad mínima de 5 litros
- Cable de potencia con longitud mínima de 8m
- Para lavar en seco o a vapor
- Diámetro mínimo de 16"', 'Unidad'),
  (405, 'Lavadora de alfombras y tapetes 2', '- Motor con potencia de mínimo 1100 w y velocidad mínima de 175 revoluciones por minuto.
- Capacidad mínima de 5 litros
- Cable de potencia con longitud mínima de 8m
- Para lavar en seco o a vapor
- Diámetro mínimo de 20"', 'Unidad'),
  (406, 'Hidrolavadora Industrial', '- Motor eléctrico y potencia de mínimo 1.5 Kw - 1.450 RPM y entre 2.5 HP y 3.5 HP.
 - Presión de salida de agua entre 900 psi y 1900 psi.
 - Con ruedas', 'Unidad'),
  (407, 'Sopladora de hojas', '- Potenciado por motor a gasolina o eléctrico inalámbrico
 - Caudal mínimo de 380 cfm / 645m3/h
 - Autonomía mínima de 30 minutos
 - Intensidad máxima de sonido de 100dB
 - Incluye combustible para su funcionamiento (Máximo 3 galones)', 'Unidad'),
  (408, 'Sonda para inodoro', '-Sonda de mínimo 3''''
-Cubierta de vinilo para proteger la porcelana.
- Cable de 1/2" (12,7 mm) con núcleo interno recubierto por compresión, resistente al retorcimiento.
-Mangos grandes y de diseño ergonómico.
-Funcional en inodoros ahorradores de agua
-Peso entre 1,9 kg y 2,5 kg', 'Unidad'),
  (410, 'Girador Manual', '-Para destapar desagües entre 1/2" a 1 1/2".
-Collar antideslizante que agarra y suelta el cable
-Cable de núcleo hueco de mpinimo 5/16" × 25 pies (7,6 m) con barrena de cabeza de bulbo.
-Tambor rotativo de plástico moldeado
-Diseño de tambor abierto que permite el acceso al cable', 'Unidad'),
  (411, 'Girador Manual', '-Para destapar desagües entre 1/2" a 1 1/2".
-Collar antideslizante que agarra y suelta el cable
-Cable de núcleo hueco de mpinimo 5/16" × 25 pies (7,6 m) con barrena de cabeza de bulbo.
-Tambor rotativo de plástico moldeado
-Diseño de tambor abierto que permite el acceso al cable', 'Unidad'),
  (412, 'Sonda para fregaderos', 'Sonda Eléctrica para desagües de 3/4” (20 mm) a 2-1/2” (64 mm)
-El equipo propulsor de velocidad variable gira el cable a 0-600 RPM.
-Capacidad del tambor: 50 pies (15 m) de 5⁄16" (8 mm) o 35 pies (11 m) de 3⁄8" (10 mm).
-El núcleo interior revestido de vinilo impide que se oxide por contacto con el resorte.', 'Unidad'),
  (413, 'Sonda para fregaderos', 'Sonda Eléctrica para desagües de 3/4” (20 mm) a 2-1/2” (64 mm)
-El equipo propulsor de velocidad variable gira el cable a 0-600 RPM.
-Capacidad del tambor: 50 pies (15 m) de 5⁄16" (8 mm) o 35 pies (11 m) de 3⁄8" (10 mm).
-El núcleo interior revestido de vinilo impide que se oxide por contacto con el resorte.', 'Unidad'),
  (414, 'Cortadora de cesped', '-Cuenta con una cuchilla de 32 a 38 cm.
-Chasis de acero con recolector o salida lateral.
-Ruedas de 135 mm
-Con potencia entre 5 hp a 25 hp
-Ancho de corte de 18 a 183 cm.
-Peso entre 10 kg y 13,5 kg
-Tiene manilla de seguridad
-Incluye combustible para su funcionamiento (Máximo 3 galones)', 'Unidad'),
  (415, 'Cortadora de cesped', '-Cuenta con una cuchilla de 32 a 38 cm.
-Chasis de acero con recolector o salida lateral.
-Ruedas de 135 mm
-Con potencia entre 5 hp a 25 hp
-Ancho de corte de 18 a 183 cm.
-Peso entre 10 kg y 13,5 kg
-Tiene manilla de seguridad', 'Unidad'),
  (416, 'Guadañas', '-Guadaña de Eje Rígido
 - Viene cilindrada con apróximadamente 30 a 51,6 cm3.
-Peso promedio entre 6,5 Kg y 7,7 Kg.
-Cuchilla de 80 puntas
-Capacidad del tanque de combustible entre 0,65 Lt y 1 Lt.
-Cuenta con un sistema de arranque manual.
-Cuenta con un sistema de ignición electrónico
 - Incluye el combustible para su funcioamiento (Máximo 3 galones)', 'Unidad'),
  (417, 'Motobombas', '-Motobomba eléctrica
-Fabricada en Hierro
-Cuenta con una potencia de 2 hp a 111 hp
-Velocidades desde 1800 RPM a 3450 RPM.
-Peso promedio de 30 Kg.
-Las medidas de succión por descarga van de 2 x 2 pulgadas a 12 x 12 pulgadas.', 'Unidad');

CREATE UNIQUE INDEX IF NOT EXISTS uq_cce_item ON colombia_compra_eficiente (item);
ALTER TABLE colombia_compra_eficiente ALTER COLUMN item SET NOT NULL;

-- ─── 4. RELACION CON PRODUCTOS (por codigo) ─────────────────────────────────
UPDATE productos p
SET cce_bien_id = c.id
FROM colombia_compra_eficiente c
WHERE p.codigo = c.item;
