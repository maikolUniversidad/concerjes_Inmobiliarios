# Conserjes Inventario — App nativa offline-first

App cliente (Vite + React + Tailwind) que trabaja **sin internet** usando una base
local (Dexie/IndexedDB) y sincroniza con Supabase mediante el motor `@conserjes/offline`.
Se empaqueta como **Android/iOS** (Capacitor) y **escritorio** (Tauri).

## Cómo funciona
- **Login** (requiere internet la primera vez) → la sesión queda cacheada; luego abre offline.
- **PIN local** opcional (icono escudo): reabre la app sin re-login cuando está offline.
- Al abrir con conexión, **sincroniza** (baja el inventario a Dexie). Botón ↻ para sincronizar manual.
- **Lecturas** desde Dexie (instantáneas, offline). **Escrituras** (editar precio, registrar
  movimiento) se aplican local al instante y se **encolan** (outbox); se suben al reconectar.
- **Permisos por rol offline**: las pestañas y acciones se ocultan según los permisos del
  usuario (leídos de la copia local de `usuarios`/`roles`).
- Módulos: Productos, Stock, Movimientos (registro offline vía RPC), Bodegas, Arqueo (lectura).

## Desarrollo
```bash
cd apps/movil
npm run dev                 # http://localhost:5173
```
Requiere `apps/movil/.env.local` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`
(valores públicos; ver `.env.example`).

## Build web (bundle que empaqueta Capacitor/Tauri)
```bash
npm run build               # genera dist/
```

## Android (APK) — el proyecto ya está generado en `android/`
Requiere **Android Studio + SDK** (JDK 17). Ya se corrió `cap add android`.
```bash
cd apps/movil
npm run build:android       # build web + cap sync android
npm run open:android        # abre Android Studio → Run / Build APK

# o por línea de comandos (con ANDROID_HOME configurado):
cd android
./gradlew assembleDebug             # APK de prueba → app/build/outputs/apk/debug/
./gradlew assembleRelease           # APK de producción (requiere firma)
```
**Firma (release):** crea un keystore y configúralo en `android/app/build.gradle`
(`signingConfigs`), o usa Android Studio → Build → Generate Signed Bundle / APK.
```bash
keytool -genkey -v -keystore conserjes.keystore -alias conserjes -keyalg RSA -keysize 2048 -validity 10000
```

## iOS — requiere macOS + Xcode
```bash
npx cap add ios
npm run build && npx cap sync ios
npx cap open ios            # Xcode → firmar y archivar
```

## Escritorio (Tauri) — requiere Rust
```bash
cd apps/movil
npm i -D @tauri-apps/cli
npx tauri init             # webDir: dist · devUrl: http://localhost:5173
npm run build && npx tauri build   # genera .exe (Windows) / .dmg (macOS) / .AppImage (Linux)
```

## Estado
- ✅ Fase 2: shell nativo, login + caché de sesión, sync (pull/push), Dexie, Productos offline.
- ✅ Fase 3: Stock, Movimientos (RPC por outbox), Bodegas, Arqueo + navegación por pestañas.
- ✅ Fase 4: PIN local + permisos por rol offline (gating de pestañas y acciones).
- ✅ Fase 5: proyecto Android generado (`cap add android`). Falta compilar el APK en una
  máquina con Android Studio/SDK; iOS (macOS/Xcode) y Tauri (Rust) documentados arriba.

Plan completo en `docs/offline-native.md`.
