# Conserjes Inmobiliarios — Plan Offline-First Nativo (APK / iOS / Escritorio)

## Por qué es una reconstrucción y no un ajuste

La app actual (`apps/inventario`) es **Next.js App Router server-first**:
- 31 Server Components consultan Supabase en cada request.
- 10 módulos de Server Actions ejecutan escrituras en Node.
- Datos, Auth, RLS, Realtime y Storage viven **remotos** en Supabase.

Los Server Components y Server Actions **no pueden ejecutarse dentro de un APK/IPA/.exe offline** (necesitan un servidor Node). Para "funcionar sin internet" hace falta:
1. Una **base de datos local** en el dispositivo (IndexedDB/SQLite).
2. Un **motor de sincronización** bidireccional con Supabase.
3. **Auth y permisos** evaluables sin conexión (sesión cacheada + permisos locales).
4. Empaquetado nativo: **Capacitor** (Android/iOS) y **Tauri** (escritorio).

> La app web actual (Vercel + Supabase SSR) **se mantiene** como versión web/admin. El cliente nativo es un frontend nuevo que comparte el mismo backend Supabase.

## Arquitectura objetivo

```
┌───────────────────────────────────────────────┐
│  App nativa (Capacitor webview / Tauri)        │
│  ┌──────────────┐   lee/escribe   ┌──────────┐ │
│  │  UI React SPA │ ───────────────▶│  Dexie   │ │  ← IndexedDB local (offline)
│  │  (Vite)       │ ◀─────────────── │ (local) │ │
│  └──────────────┘                  └────┬─────┘ │
│                                         │ sync   │
└─────────────────────────────────────────┼───────┘
                                          ▼ (cuando hay internet)
                                    ┌──────────────┐
                                    │  Supabase     │  ← Postgres + Auth + Storage
                                    │  (nube)       │
                                    └──────────────┘
```

- **Lecturas**: siempre desde Dexie (instantáneas, offline).
- **Escrituras**: a Dexie + a un **outbox** (cola de intents pendientes) con UUID cliente.
- **Sync**:
  - **PULL**: por cada tabla, trae filas con `updated_at > watermark`, hace upsert local, avanza el watermark.
  - **PUSH**: reproduce el outbox contra Supabase. Las escrituras con efectos de servidor (movimientos, arqueos) se mapean a sus **RPC** (`registrar_movimiento`, `cerrar_arqueo`) para conservar invariantes.
  - **Conflictos**: last-write-wins por `updated_at` (servidor gana en empate).
- **Auth offline**: sesión Supabase cacheada; si expira sin conexión, acceso local de solo-lectura + PIN opcional; re-login al reconectar.
- **IA y Realtime**: quedan detrás de un check de conexión (requieren internet por naturaleza).

## Stack

| Pieza | Elección | Motivo |
|---|---|---|
| UI shell | **Vite + React + TS + Tailwind** | SPA estática, Capacitor-friendly, build rápido; reusa marca/estilos |
| DB local | **Dexie (IndexedDB)** | Funciona en webview y escritorio, sin servicio externo, control total |
| Sync | **Motor propio** (`packages/offline`) | Sin dependencia de PowerSync/Electric; directo contra Supabase |
| Móvil | **Capacitor** | Android + iOS desde el mismo bundle web |
| Escritorio | **Tauri** | .exe/.dmg livianos |
| Backend | **Supabase** (el mismo) | Reusa esquema, RLS, Storage |

## Fases

- **Fase 1 — Fundación (EN CURSO):** `packages/offline` — esquema de tablas a sincronizar, adaptador de almacenamiento (in-memory + Dexie), motor PULL/PUSH + outbox de intents. Probado contra Supabase real.
- **Fase 2 — Shell nativo:** `apps/movil` (Vite+React+TS+Tailwind+Capacitor) que consume el motor. Login (online) + cache de sesión. Pantalla de estado de sync.
- **Fase 3 — Portar módulos (por prioridad):** Productos, Stock, Movimientos (RPC), Bodegas/Ubicaciones, Arqueo, Proveedores/OC. Cada uno lee de Dexie y escribe vía outbox.
- **Fase 4 — Auth/permisos offline:** permisos por rol evaluados localmente; PIN local; re-login.
- **Fase 5 — Empaquetado:** Capacitor Android (APK) + iOS (requiere macOS/Xcode) + Tauri escritorio. Íconos, splash, firma.
- **Fase 6 — Endurecer sync:** conflictos, reintentos, borrados, fotos offline (cola de subida a Storage), pruebas de campo.

## Notas honestas
- **iOS** requiere macOS + Xcode para compilar/firmar (no se puede desde Windows). Android y escritorio sí desde aquí (con Android Studio para el APK final).
- **IA / Realtime / subida de fotos** no funcionan offline; se encolan o se deshabilitan sin conexión.
- Es un esfuerzo grande; avanzamos y verificamos fase por fase.
