# Notificaciones: correo parametrizable, plantillas y flujos

Tres piezas que se encadenan:

1. **Cuenta de correo** — cómo sale el correo (SMTP con contraseña, u OAuth de Google/Microsoft).
2. **Plantillas** — qué dice el correo, con variables.
3. **Eventos y flujos** — cuándo se envía, a quién, y qué pasa si la situación no se resuelve.

Migración: `supabase/migrations/20260829000000_notificaciones_workflow.sql`.

---

## 1. Cuenta de correo

`/integraciones/correo` · permiso `gestionar_integraciones`.

### Opción A — contraseña de aplicación

La de siempre: servidor SMTP, puerto, usuario y contraseña de aplicación. Funciona con Gmail,
Outlook, Zoho o un dominio propio. Los presets de la pantalla rellenan servidor y puerto.

### Opción B — OAuth 2.0 (Google / Microsoft)

No se guarda ninguna contraseña: se autoriza la cuenta una vez y la plataforma renueva el acceso
con un *refresh token*. El envío sigue siendo SMTP, pero autenticado con XOAUTH2.

Pasos:

1. En la consola del proveedor, crear una aplicación OAuth de tipo *aplicación web*:
   - **Google** — [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials),
     habilitando la API de Gmail. Scope: `https://mail.google.com/`.
   - **Microsoft** — [portal.azure.com](https://portal.azure.com) → Entra ID → registro de aplicaciones.
     Permisos delegados: `SMTP.Send`, `IMAP.AccessAsUser.All`, `offline_access`.
2. Registrar como **URL de redirección autorizada** la que muestra la propia pantalla:
   `https://<dominio>/api/integraciones/correo/oauth/callback` (sale de `APP_BASE_URL`).
3. Pegar Client ID y Client Secret en la pantalla, **guardar**, y pulsar «Conectar».
4. Tras el consentimiento se guardan `oauth_refresh_token`, servidores SMTP/IMAP del proveedor y la
   cuenta autorizada. «Probar conexión» confirma el envío.

Si el proveedor no devuelve *refresh token* (suele pasar cuando la cuenta ya autorizó antes la
misma app), hay que revocar el acceso en la cuenta del proveedor y volver a conectar.

El código vive en `lib/email/oauth.ts` (URLs y canje de tokens) y `lib/email/transport.ts`
(construcción del transporte y renovación del access token, con 2 minutos de margen).

---

## 2. Plantillas de correo

`/notificaciones/plantillas` · permiso `gestionar_plantillas_correo`.

- Asunto y cuerpo HTML con variables `{{clave}}`. Las variables sin valor se sustituyen por vacío:
  nunca sale un correo con `{{algo}}` a la vista.
- **Subir HTML**: carga un archivo `.html` diseñado aparte (máx. 512 KB). Al guardar se eliminan
  `<script>`, `<iframe>`, `<object>` y los atributos `on*`; el resto del diseño se conserva.
- Previsualización con valores de ejemplo y envío de prueba a cualquier dirección.
- El texto plano se genera del HTML si no se escribe uno.
- Las plantillas del sistema (`es_sistema`) se pueden desactivar pero no borrar. Vienen dos:
  `aviso_generico` y `escalamiento`.

Render y saneado: `lib/email/plantillas.ts` (sin dependencias, se usa igual en servidor y navegador).

---

## 3. Eventos y flujos

`/notificaciones/flujos` y `/notificaciones/eventos` · permisos `ver_flujos_notificacion` y
`gestionar_flujos_notificacion`.

### Catálogo de eventos

`eventos_notificacion` lista todo lo que puede disparar una notificación, con su descripción y los
datos que entrega. Los nueve primeros coinciden con los códigos de `reglas_alerta`, así que **toda
alerta que ya emitía la plataforma alimenta el motor sin trabajo extra**: `emitir_notificacion()`
llama a `emitir_evento()` al final.

Para un evento nuevo del negocio, se crea en el catálogo y se emite desde el código:

```ts
import { emitirEvento } from '@/lib/notificaciones/eventos'

await emitirEvento(supabase, {
  codigo: 'ORDEN_INSUMO_APROBADA',
  payload: { orden_id: orden.id, numero: orden.numero, sede: sede.nombre },
  entidad: 'OrdenInsumo',
  entidadId: orden.id,
})
```

`emitirEvento` nunca lanza: si algo falla al notificar, la operación principal sigue.

### Flujos

Un flujo es: **evento → condiciones → pasos**.

- **Condiciones** sobre el payload (`estado = PENDIENTE`, `valor > 100000`, `correo existe`…), en
  modo «se cumplen todas» u «se cumple alguna». Sin condiciones, el flujo corre siempre.
- **Pasos**, en orden, cada uno con su demora:
  - `EMAIL` — plantilla (o mensaje escrito en el paso) a roles, personas, correos fijos o a un
    correo que venga en el payload (p. ej. `cliente_email`). Se encola en `correo_saliente`.
  - `APP` — notificación en la bandeja de los usuarios destino.
  - `ESPERA` — solo marca tiempo.
  - `WEBHOOK` — POST con el payload a una URL externa.

### El escalamiento: «si a las 24 h sigue pasando»

Cada paso puede llevar una **verificación**: antes de ejecutarse se relee el registro en la base de
datos y solo continúa si la condición se mantiene.

> Ejemplo — orden de insumo sin aprobar:
> 1. Paso 1 (inmediato): correo al coordinador.
> 2. Paso 2 (24 horas después): verificación `ordenes_insumo.estado = PENDIENTE`, campo del evento
>    `orden_id`. Si sigue pendiente, correo al gerente con la plantilla *escalamiento*. Si ya se
>    aprobó, el paso se omite y —si está marcado «cancelar los pasos siguientes»— el flujo entero
>    se cancela.

Con «Probar flujo» se dispara el evento con el payload de ejemplo del catálogo, sin esperar a que
ocurra en la operación real. El historial de la pantalla muestra cada ejecución, sus pasos, cuándo
están programados y qué resultó.

---

## Cómo corre el motor

| Pieza | Dónde | Cuándo |
|---|---|---|
| `emitir_evento()` (SQL) | Base de datos | Al ocurrir el evento: evalúa condiciones y **programa** los pasos |
| `/api/cron/flujos` | Vercel cron, cada 5 min | Ejecuta los pasos vencidos y despacha lo que encolaron |
| `/api/cron/correo` | Vercel cron, cada 5 min | Envía el buzón `correo_saliente` |
| Botón «Ejecutar pasos pendientes» | `/notificaciones/flujos` | Lo mismo, a mano |

Ambos cron exigen `Authorization: Bearer $CRON_SECRET` si la variable está definida (Vercel lo
envía solo). Los pasos que fallan se reintentan hasta 3 veces; los correos, hasta 5.

## Permisos

| Clave | Para qué |
|---|---|
| `gestionar_integraciones` | Configurar la cuenta de correo y conectar OAuth |
| `gestionar_plantillas_correo` | Crear y editar plantillas |
| `ver_flujos_notificacion` | Ver eventos, flujos y su historial |
| `gestionar_flujos_notificacion` | Crear y editar eventos y flujos, disparar pruebas |

Las políticas RLS de las tablas nuevas usan `auth_permiso()` / `auth_permiso_any()`, así que basta
con otorgar el permiso desde `/roles` (SUPER_ADMIN y ADMIN lo tienen implícito).
