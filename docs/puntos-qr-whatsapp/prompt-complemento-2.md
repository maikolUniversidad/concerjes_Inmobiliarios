# Prompt complementario 2 — Contratos, mantenimiento, mapa operativo, mensajería masiva individual, informes de eficiencia y PQRS por QR

> Documento del usuario, transcrito tal cual. Complementa al prompt maestro
> ("Módulo Puntos QR, Tareas y Bot de WhatsApp") y al complemento 1
> ("Instalación del QR con referencia 360°"). **Donde haya conflicto, manda este
> documento.** Las referencias "M§n" apuntan al prompt maestro y "C1§n" al
> complemento 1.
>
> **Pendiente:** el complemento 1 no ha llegado todavía. Este documento se
> apoya en C1§1 paso 3 (foto de instalación), C1§3 y C1§3.3 (reto aleatorio y
> niveles de rigor antifraude). Esas referencias quedan marcadas como huecos:
> no se inventa qué decían.

## 0. Qué se agrega

Todo gira alrededor del contrato. Cada punto, QR, tarea, persona, visita, orden
de mantenimiento, PQRS, mensaje e informe pertenece a un contrato de la empresa
y respeta sus reglas.

- **Módulo de mantenimiento:** activos, planes preventivos, órdenes de trabajo
  correctivas y preventivas, técnicos, materiales, costos y firmas, usando el
  mismo motor de QR, plantillas y evidencia.
- **Mapa operativo:** vista general por contrato con sedes, QR, indicadores,
  recorridos de cada persona, ubicación en vivo cuando existe y último registro
  cuando no.
- **WhatsApp como canal de mando 1 a 1:** mensajes masivos enviados de forma
  individual, menú de acciones, tareas asignadas y navegación a la próxima
  ubicación con nombre, foto y mapa.
- **Informes de eficiencia** individuales, por equipo, por sede y por contrato.
- **PQRS por QR** (opcional por cliente): cualquier usuario de la zona escanea el
  mismo QR y deja una petición, queja, reclamo o sugerencia sobre aseo y
  limpieza, con atención por la plataforma y por correo.

Antes de implementar, revisa qué existe ya en la plataforma sobre contratos,
workflows por contrato, levantamiento 2D/3D de sedes, tickets, inventario,
correo y mapas. Reutiliza y parametriza; no dupliques.

## 1. El contrato como eje

### 1.1 Qué define un contrato (reutilizar la entidad existente; agregar lo que falte)

- Cliente, número, vigencia (inicio, fin, prórrogas) y estado.
- Servicios contratados: aseo, conserjería, mantenimiento, seguridad u otros,
  cada uno activable por separado.
- Sedes y zonas incluidas (del levantamiento), con horarios de operación.
- Personal asignado por rol y turno; supervisores y coordinadores responsables.
- ANS / SLA por tipo de servicio: frecuencias mínimas, tiempos de respuesta,
  tiempos de solución, porcentaje de cumplimiento exigido y penalidades si
  aplican.
- Catálogo propio: tipos de actividad, plantillas, activos y planes de
  mantenimiento heredados del catálogo general y ajustables por contrato.
- Reglas operativas: nivel de rigor antifraude (C1§3.3), si se permite WhatsApp,
  si se activa PQRS público, si se comparte el seguimiento en vivo, ventanas de
  mensajería, idioma de los reportes.
- Presupuesto de materiales y repuestos, si aplica.
- Entregables: qué informes recibe el cliente, cada cuánto y a qué correos.
- Arte para las placas QR y reportes (logo y colores del cliente o de la
  empresa).

### 1.2 Reglas que se cumplen en todo el sistema

- Ningún registro queda sin contrato. Si un QR, activo o persona no tiene
  contrato vigente, no opera y se alerta.
- Permisos por contrato: cada usuario ve y actúa solo en los contratos
  asignados. El cliente final, si tiene acceso, solo ve el suyo.
- Al vencer o suspenderse un contrato, sus QR pasan a inactivos, el bot deja de
  asignar tareas de ese contrato y las órdenes abiertas se marcan para cierre o
  traslado.
- Al renovar, se conservan histórico, QR y referencias 360°; se versionan las
  condiciones nuevas.
- Toda métrica e informe se puede filtrar y agrupar por contrato.
- Una persona puede estar en varios contratos; cada visita, orden o mensaje
  queda en el contrato correspondiente.

## 2. Módulo de mantenimiento

### 2.1 Activos

- Activo (equipo o elemento a mantener): extintor, bomba, ascensor, planta
  eléctrica, tablero, luminaria, puerta automática, grifería, aire
  acondicionado, cámara, cerradura, etc.
- Datos: contrato, sede, zona, punto, tipo, marca, modelo, serial, fecha de
  instalación, garantía, proveedor, criticidad, estado, fotos, manuales y fichas
  técnicas, medidores (horas, ciclos, lecturas), activo padre/hijo.
- QR por activo con el mismo motor de M§4 (tipo de QR = activo); un punto puede
  tener su QR de punto y varios QR de activos. También se puede asociar un
  activo a un QR de punto existente.
- Hoja de vida del activo: todas sus órdenes, lecturas, fallas, repuestos usados
  y costos.
- Importación masiva desde Excel/CSV y desde el levantamiento.

### 2.2 Planes preventivos

- Plan por tipo de activo o por activo: tareas (plantillas del mismo motor de
  M§3), frecuencia por calendario (cada N días/semanas/meses) o por uso (cada N
  horas o ciclos de medidor), tolerancia, técnico o rol, duración estimada,
  materiales esperados.
- Generación automática de órdenes con anticipación configurable y calendario de
  mantenimiento por contrato.
- Normativas o rutinas obligatorias marcadas como tales (p. ej. recarga anual de
  extintores), con alerta de vencimiento.

### 2.3 Órdenes de trabajo (OT)

- Tipos: preventiva, correctiva, mejora, inspección, emergencia.
- Orígenes: plan preventivo, novedad de una visita (M§3), ticket, PQRS (§6),
  solicitud del cliente, mensaje al bot, alerta de IoT o de video analítica si la
  plataforma la tiene.
- Flujo: creada → asignada → aceptada → en camino → en sitio → en ejecución →
  pausada (espera repuesto/cliente) → terminada → aprobada por el cliente →
  cerrada, con motivo en cada pausa o rechazo.
- Ejecución en campo con el mismo flujo de la app o WhatsApp: escanear QR del
  activo o del punto, validar ubicación, foto antes, pasos de la plantilla, foto
  después, materiales usados, tiempo, reto aleatorio (C1§3), firma del técnico y
  firma o aprobación del cliente (en pantalla, por enlace o por WhatsApp).
- Prioridad y SLA del contrato con cronómetro de respuesta y de solución;
  escalamiento automático al vencer.
- Materiales y repuestos: catálogo, consumo por OT, conexión con inventario si
  existe, costo de mano de obra y materiales por OT.
- Proveedores externos: OT asignable a un tercero con acceso limitado a esa
  orden.

### 2.4 Indicadores de mantenimiento

Disponibles en informes (§5): MTTR (tiempo medio de reparación), MTBF (tiempo
medio entre fallas) por activo y tipo, % preventivo vs. correctivo, cumplimiento
del plan preventivo, backlog (órdenes pendientes y su antigüedad), cumplimiento
de SLA de respuesta y solución, reaperturas, costo por activo, por sede y por
contrato, activos más fallados.

## 3. Mapa operativo y vista general

### 3.1 Qué muestra

- Selector de contrato (y de varios contratos para la gerencia). El mapa se
  centra en sus sedes.
- Sedes como polígonos tomados del levantamiento; planos por piso superpuestos
  cuando existan (levantamiento 2D/3D), con selector de nivel.
- Marcadores de QR (puntos y activos) con color por estado:
  - verde: al día;
  - ámbar: por vencer en su ventana;
  - rojo: vencido o sin visita;
  - morado: con novedad, OT o PQRS abierta;
  - gris: inactivo o pendiente de instalación.
- Al tocar un marcador: nombre, foto, tareas del punto, última visita (quién,
  cuándo, puntaje), próxima visita, OT y PQRS abiertas, anclas del 360° con su
  salud.
- Personas:
  - en vivo si comparten ubicación desde la app abierta o la app nativa durante
    el turno;
  - si no, último registro conocido (último escaneo, última ubicación enviada
    por WhatsApp, último evento), con la hora y la fuente bien visibles
    ("hace 12 min · WhatsApp").
- Recorrido del día de cada persona: línea entre sus eventos en orden, con
  reproductor de línea de tiempo (avanzar, pausar, velocidad).
- Mapa de calor de visitas y de novedades por zona y franja horaria.
- Capas que se pueden prender y apagar: puntos, activos, personas, recorridos,
  OT, PQRS, cámaras e IoT si la plataforma los tiene.
- Panel de indicadores al lado del mapa: personas en turno y en línea, visitas a
  tiempo hoy, puntos vencidos, OT abiertas por prioridad, PQRS abiertas, puntaje
  antifraude promedio.
- Alertas en vivo: punto crítico vencido, persona sin actividad por N minutos en
  su turno, OT con SLA por vencer, visita con puntaje bajo, PQRS nueva.

### 3.2 Ubicación en tiempo real: qué es posible y cómo

- App/PWA: el navegador solo entrega ubicación mientras la app está abierta y en
  primer plano. Enviar posición periódica (p. ej. cada 60 s o al moverse más de
  20 m) mientras esté abierta.
- Seguimiento continuo en segundo plano requiere app nativa (Android con
  servicio en primer plano y notificación visible; iOS con permiso "Siempre").
  Dejarlo como opción por contrato, solo dentro del turno, con consentimiento
  explícito y un indicador visible para el trabajador de que está compartiendo
  ubicación.
- WhatsApp: la API no recibe ubicación en tiempo real; solo la ubicación puntual
  que la persona comparte. El bot la pide al iniciar y cerrar cada punto (M§6.3)
  y cuando el supervisor lo solicite.
- Sin ubicación reciente, el mapa usa el último evento válido y lo indica con su
  antigüedad. Nunca mostrar una posición vieja como si fuera actual.
- Fuera del turno no se registra ni se muestra la ubicación de nadie (Ley 1581
  de 2012 y criterio de proporcionalidad de la Corte Constitucional).

### 3.3 Vista del conserje

- En la app: mi mapa con mis puntos del turno, en orden de ruta sugerida, con su
  estado y mi posición; cómo llegar al siguiente.
- Mis tareas de hoy, mis OT asignadas, mis pendientes y mis indicadores
  personales básicos (cumplimiento del día y de la semana).

## 4. WhatsApp: mensajería masiva individual, menú y navegación

### 4.1 Mensajes masivos enviados uno a uno

- Desde la consola, el supervisor crea un envío a una audiencia: un contrato, una
  sede, un turno, un rol, una lista o personas sueltas.
- El sistema envía un mensaje individual a cada persona (nunca un grupo) y
  registra entrega, lectura y respuesta por persona.
- Tipos de envío: indicación general, cambio de turno, tarea extra, recordatorio,
  capacitación (con video o PDF), encuesta corta, alerta de emergencia.
- Reglas de la API oficial que se deben cumplir:
  - Fuera de la ventana de 24 h desde el último mensaje de la persona, solo se
    pueden enviar plantillas aprobadas por Meta. Crear y gestionar las plantillas
    desde la consola (categoría utility para indicaciones operativas; marketing
    no se usa para personal).
  - Respetar los límites de envío del número (escalonados según calidad) y el
    rendimiento de ~20 mensajes por segundo en coexistencia: encolar y
    escalonar.
  - Opt-in registrado de cada trabajador para recibir mensajes operativos.
  - Mostrar en la consola el costo estimado del envío antes de confirmarlo.
- Si la persona responde, la respuesta entra al caso o conversación
  correspondiente del CRM (M§8).
- Programación: enviar ahora, a una hora o recurrente. Bloqueo automático fuera
  de la jornada (Ley 2191 de 2022), salvo emergencias marcadas como tales.

### 4.2 Menú de acciones

Palabra MENÚ (o un botón fijo al final de cada respuesta) abre una lista
interactiva con hasta 10 opciones, configurable por contrato y rol. Ejemplo:

1. Mis tareas de hoy
2. Iniciar en un punto
3. Próxima ubicación
4. Mis órdenes de mantenimiento
5. Reportar novedad
6. Pedir insumos
7. Ver mi mapa
8. Mis indicadores
9. Hablar con mi supervisor
10. Ayuda

Cada opción lleva a un subflujo con botones de respuesta (máx. 3 por mensaje) o
listas. Para formularios más largos se puede usar WhatsApp Flows si el proveedor
lo permite.

### 4.3 Próxima ubicación

El bot calcula el siguiente punto u OT según la ruta del turno, la prioridad y la
cercanía. Envía:

- nombre del punto y referencia escrita del levantamiento ("Baño mujeres, junto
  al ascensor norte");
- foto del lugar (la de instalación, C1§1 paso 3);
- mensaje de ubicación nativo de WhatsApp con el pin, que abre el mapa del
  celular;
- botón con enlace a "Ver mi mapa" (página propia, autenticada con enlace
  firmado de corta duración) donde ve su ruta y sus puntos;
- tareas que debe hacer allí y su ventana horaria.

Todos estos datos salen del levantamiento de la sede; si falta la foto o la
referencia, el bot usa lo que haya y la consola marca el punto como incompleto.

### 4.4 Tareas y OT asignadas por WhatsApp

- Cuando el supervisor asigna una OT o una tarea extra, la persona recibe el
  aviso con botones Aceptar / No puedo (con motivo).
- "Aceptar" la deja en aceptada; "En camino" y "En sitio" se marcan con botones o
  al escanear el QR.
- El supervisor ve en el mapa y en el CRM el estado de cada asignación en tiempo
  real.

## 5. Informes de eficiencia

### 5.1 Niveles

- Individual (conserje o técnico)
- Equipo o turno
- Sede
- Contrato
- Cliente (todos sus contratos)
- Empresa (todos los contratos)

Cada informe con periodo seleccionable (día, semana, mes, rango) y comparación
contra el periodo anterior y contra la meta del contrato.

### 5.2 Indicadores

**Operación de aseo y rondas**

- Cumplimiento de visitas: programadas vs. realizadas, a tiempo, tarde,
  incompletas, no realizadas.
- Cumplimiento por punto, zona y franja horaria.
- Tiempo promedio por tarea frente al tiempo estándar de la plantilla.
- Tiempo efectivo en puntos vs. tiempo de turno.
- Puntaje antifraude promedio y visitas en revisión.
- Resultado de retos aleatorios (C1§3).
- Novedades reportadas y su resolución.
- Uso de canal: app vs. WhatsApp.

**Mantenimiento (§2.4)**

MTTR, MTBF, % preventivo, cumplimiento del plan, backlog, SLA, reaperturas y
costos.

**PQRS (§6)**

Cantidad por tipo y zona, tiempo de primera respuesta, tiempo de cierre,
reincidencia en la misma zona, satisfacción.

**Contrato**

Cumplimiento de cada ANS con semáforo, penalidades potenciales, consumo de
materiales vs. presupuesto, horas de servicio, tendencias.

### 5.3 Formatos y entrega

- Tableros interactivos en la consola con filtros y descarga.
- Informes en PDF con el arte del contrato y en Excel con los datos.
- Envío programado por correo a los destinatarios del contrato (§1.1,
  entregables).
- Narrativa automática por IA: resumen de lo que mejoró, lo que empeoró y
  recomendaciones, marcada como generada por IA y revisable antes de enviar al
  cliente.

### 5.4 Uso responsable

- Los indicadores individuales son para seguimiento y mejora. Mostrar siempre el
  contexto (puntos asignados, novedades, permisos, incapacidades) para no
  comparar personas con cargas distintas.
- Acceso a informes individuales restringido a supervisores y talento humano.

## 6. PQRS por el mismo QR (opcional por contrato)

### 6.1 Cómo funciona

- Si el contrato tiene PQRS activo, quien escanee el QR sin ser personal
  autenticado (residente, visitante, empleado del cliente) ve una página pública
  del punto: nombre del lugar y un botón "Reportar algo sobre el aseo de esta
  zona".
- El personal autenticado sigue entrando al flujo de tareas (M§5); la misma URL
  decide qué mostrar según la sesión.
- La placa QR puede incluir una línea opcional: "¿Algo no está bien? Escanea y
  cuéntanos".

### 6.2 Formulario público

- Tipo: petición, queja, reclamo, sugerencia o felicitación.
- Categoría parametrizable por contrato: limpieza, insumos faltantes, malos
  olores, basuras, daño, otro.
- Descripción, foto opcional (cámara o galería), y datos de contacto opcionales
  (nombre, correo, celular) para recibir respuesta; también puede ser anónima.
- Aviso de privacidad y autorización de datos (Ley 1581) cuando deja contacto.
- Antispam: límite por dispositivo y por punto, verificación ligera (desafío tipo
  captcha), filtro de contenido ofensivo.
- Al enviar: número de radicado y, si dejó correo, confirmación por correo con
  enlace para ver el estado.

### 6.3 Atención y trazabilidad

- Cada PQRS crea un caso en la plataforma, vinculado al contrato, sede, zona y
  punto.
- Clasificación y prioridad sugeridas por IA; asignación al supervisor del
  contrato.
- Si requiere acción en campo, se convierte en tarea urgente para el conserje del
  turno (aviso por app o WhatsApp) o en OT de mantenimiento.
- Respuesta al ciudadano o usuario por correo desde la plataforma (con
  plantillas), y por WhatsApp solo si él inició contacto por ese canal. Las
  respuestas por correo que lleguen se asocian al mismo caso (hilo por número de
  radicado).
- Estados: radicada → en revisión → en atención → respondida → cerrada, con
  tiempos de SLA configurables por contrato y alertas al vencer.
- Encuesta corta de satisfacción al cerrar.
- Trazabilidad interna completa: quién vio, respondió, reasignó y cerró, con
  todas las evidencias.
- Visibilidad para el cliente (si el contrato lo permite): tablero con sus PQRS y
  tiempos de respuesta.

## 7. Modelo de datos adicional (ajustar a lo existente)

- `contrato` (reutilizar) + `contrato_servicio`, `contrato_sla`,
  `contrato_regla`, `contrato_entregable`, `contrato_destinatario`.
- `activo`, `tipo_activo`, `medidor_activo`, `lectura_medidor`,
  `plan_mantenimiento`, `orden_trabajo`, `ot_evento`, `ot_material`, `ot_costo`,
  `proveedor`.
- `ubicacion_persona` (posición, precisión, fuente: app_vivo, app_nativa,
  whatsapp, escaneo, evento; hora; turno), con retención configurable.
- `ruta_turno` (orden sugerido de puntos y OT por persona y turno).
- `envio_masivo`, `envio_destinatario` (estado por persona: encolado, enviado,
  entregado, leído, respondido, fallido; costo), `plantilla_whatsapp` (nombre,
  categoría, idioma, estado de aprobación en Meta, variables).
- `menu_bot` (opciones por contrato y rol, orden, acción).
- `pqrs` (radicado, tipo, categoría, punto, descripción, fotos, contacto
  opcional, anónima, estado, SLA, satisfacción), `pqrs_mensaje` (canal:
  plataforma, correo, whatsapp; dirección; contenido; adjuntos).
- `informe_programado` (tipo, nivel, filtros, periodicidad, destinatarios,
  formato).

Todo con `contrato_id` obligatorio salvo catálogos generales.

## 8. Integraciones

- Correo: envío (SMTP o proveedor transaccional) y recepción (buzón dedicado o
  webhook de correo entrante) para PQRS e informes; firmas SPF/DKIM del dominio;
  seguimiento de entrega.
- Mapas: capa base libre (OpenStreetMap/MapLibre) o proveedor ya usado por la
  plataforma; planos del levantamiento como capas propias.
- Inventario existente para materiales y repuestos.
- Módulos existentes: workflows por contrato, matriz de riesgo, IoT/domótica y
  video analítica como fuentes de OT y alertas cuando estén disponibles.

## 9. Permisos

| Rol | Puede |
|---|---|
| Conserje | Sus tareas, su mapa, sus visitas, sus OT, sus indicadores básicos |
| Técnico de mantenimiento | Sus OT, activos de sus contratos, consumo de materiales |
| Supervisor | Su(s) contrato(s): mapa, personas, asignaciones, envíos masivos, PQRS, informes individuales y de equipo |
| Coordinador / gerente | Varios contratos, informes comparativos, configuración de SLA |
| Cliente (opcional) | Solo su contrato: mapa sin ubicación de personas (salvo que el contrato lo permita), informes acordados, sus PQRS y OT |
| Proveedor externo | Solo las OT que se le asignen |
| Público | Formulario PQRS del punto, si está activo |

## 10. Pruebas y criterios de aceptación

- Un contrato vencido deja sus QR inactivos, el bot no asigna tareas de ese
  contrato y el informe lo refleja.
- Un plan preventivo mensual genera sus OT, un técnico la ejecuta por la app con
  foto antes y después, materiales y firma del cliente, y el MTTR y el
  cumplimiento del plan se actualizan.
- Una novedad de una visita y una PQRS se convierten en OT y quedan enlazadas en
  la hoja de vida del activo.
- El mapa del contrato muestra QR con su color de estado, personas en vivo desde
  la app abierta y el último registro de quien usa WhatsApp con su hora y fuente,
  y reproduce el recorrido del día de una persona.
- Un envío masivo a 50 personas sale como 50 mensajes individuales con plantilla
  aprobada, respeta los límites, muestra su costo estimado y registra entrega y
  lectura por persona.
- El menú del bot lleva a "Próxima ubicación" y la persona recibe nombre, foto,
  pin de ubicación y enlace a su mapa.
- Los informes individual, de equipo, de sede y de contrato coinciden entre sí al
  sumar y se envían por correo en PDF y Excel según la programación.
- Una persona sin sesión escanea un QR con PQRS activo, deja una queja anónima
  con foto, recibe radicado; el supervisor responde por correo a otra PQRS con
  contacto y la respuesta del usuario entra al mismo caso.
- Fuera del turno no se registra ubicación ni se envían mensajes que no sean de
  emergencia.

**Empieza proponiendo cómo encaja esto en el plan y el modelo de datos ya
aprobados, qué reutilizas de lo existente y en qué fases lo ubicas.**
