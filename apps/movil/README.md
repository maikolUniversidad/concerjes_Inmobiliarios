# Conserjes Inventario — App nativa offline-first

App cliente (Vite + React + Tailwind) que trabaja **sin internet** usando una base
local (Dexie/IndexedDB) y sincroniza con Supabase mediante el motor `@conserjes/offline`.
Se empaqueta como **Android** (Capacitor) y **escritorio Windows** (Electron).

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
(valores públicos; ver `.env.example`). Ese archivo **no va al repositorio**.

## Build web (el bundle que empaqueta Capacitor/Electron)
```bash
npm run build               # genera dist/
```

---

# Android (APK)

## Qué hay que tener instalado

La decisión, para no dar vueltas: **Android Studio completo + Temurin JDK 17.**
Studio porque esta app es una webview y tarde o temprano hay que mirarle el `logcat`
y probarla en el emulador; el SDK Manager además mantiene al día la plataforma y las
build-tools. (Las *command line tools* sueltas bastan en un servidor de compilación,
pero ahí hay que ir instalando cada paquete a mano con `sdkmanager`.)

**El JDK 17 es obligatorio, y no es un detalle:** Capacitor 6 genera un proyecto con
Gradle 8.2.1, que **no corre sobre Java 21**, y el JBR que viene dentro de Android
Studio hoy ya es Java 21. Si solo está ese JBR, la compilación falla. Por eso hace
falta un JDK 17 aparte.

```powershell
winget install EclipseAdoptium.Temurin.17.JDK
winget install Google.AndroidStudio
```

Dentro de Android Studio → **SDK Manager**, deja instalados:

| Componente | Versión | Por qué |
|---|---|---|
| Android SDK Platform | **34** | `compileSdk` y `targetSdk` del proyecto (`android/variables.gradle`) |
| Android SDK Build-Tools | **34.0.0** | la que pide AGP 8.2.1 |
| Android SDK Platform-Tools | la última | trae `adb`, para instalar el APK por USB |

Gradle **no** hay que instalarlo: el proyecto trae su propio wrapper (`gradlew`).

### Variables de entorno

| Variable | Valor | Para qué |
|---|---|---|
| `JAVA_HOME` | `C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot` | que Gradle use Java 17 y no el 21 del JBR |
| `ANDROID_HOME` | `C:\Users\<usuario>\AppData\Local\Android\Sdk` | que Gradle encuentre el SDK |
| `PATH` | agregar `%ANDROID_HOME%\platform-tools` | tener `adb` a mano |

En PowerShell, de forma permanente:
```powershell
[Environment]::SetEnvironmentVariable('JAVA_HOME','C:\Program Files\Eclipse Adoptium\jdk-17.0.20.1-hotspot','User')
[Environment]::SetEnvironmentVariable('ANDROID_HOME',"$env:LOCALAPPDATA\Android\Sdk",'User')
```
Si no las dejas puestas igual funciona: `scripts/android.mjs` busca el JDK 17 y el
SDK en las rutas habituales de Windows. Las variables solo ahorran esa búsqueda.

## APK de depuración — un comando

```bash
cd apps/movil
npm run android:apk
```

Queda en `android/app/build/outputs/apk/debug/app-debug.apk` y se puede instalar en
cualquier celular (viene firmado con la llave de depuración que genera el SDK solo).

Para instalarlo por USB, con el teléfono en modo **Depuración por USB**:
```bash
npm run android:install
```

Ese comando hace, en orden: build web → `cap add android` si la carpeta no existe →
`cap sync android` → resuelve JDK y SDK → escribe `local.properties` y el truststore
del TLS corporativo en `gradle.properties` → `gradlew assembleDebug`.

> `android/` está en `.gitignore` a propósito: es código generado. En un clon nuevo
> no existe, y `npm run android:apk` la crea solo. No hay que correr `cap add` a mano.

## APK firmado (release)

### 1. Crear el keystore (una sola vez, y guardarlo bien)

```bash
keytool -genkey -v -keystore conserjes.keystore -alias conserjes -keyalg RSA -keysize 2048 -validity 10000
```

> **El keystore y su contraseña NO van al repositorio.** Este repo es público.
> `.gitignore` ya bloquea `*.keystore`, `*.jks` y `.keystore.properties`, pero el
> archivo conviene guardarlo **fuera** de la carpeta del proyecto (y con copia de
> respaldo): si se pierde, no se puede volver a publicar una actualización de la
> misma app en Play Store — hay que cambiar el `appId` y los usuarios la ven como
> una app distinta.

### 2. Decirle al build dónde está

Crea `apps/movil/.keystore.properties` (gitignored) con estas cuatro líneas:

```properties
storeFile=C:/ruta/absoluta/fuera/del/repo/conserjes.keystore
storePassword=...
keyAlias=conserjes
keyPassword=...
```

### 3. Compilar

```bash
npm run android:apk:release     # APK firmado → android/app/build/outputs/apk/release/
npm run android:bundle          # AAB firmado → android/app/build/outputs/bundle/release/
```
Para Play Store se sube el **.aab**; el **.apk** sirve para repartir el archivo
directo (por WhatsApp, correo o un enlace de descarga).

## Qué revisar en capacitor.config.ts antes de compilar

| Campo | Valor actual | Cuidado |
|---|---|---|
| `appId` | `com.conserjesinmobiliarios.inventario` | Es la identidad de la app en el teléfono y en Play Store. **Cambiarlo después de publicar crea una app nueva**, no una actualización. Si se cambia, hay que borrar `android/` y volver a generarla. |
| `appName` | `Conserjes Inventario` | El nombre bajo el icono. Al cambiarlo, `cap sync` **no** actualiza `android/app/src/main/res/values/strings.xml`: hay que editarlo o rehacer `android/`. |
| `webDir` | `dist` | Tiene que coincidir con la salida de Vite. Si no, el APK compila pero abre en blanco. |
| `server.androidScheme` | `https` | **No cambiarlo a `http`.** El PIN local hashea con `crypto.subtle`, que solo existe en contexto seguro. Con `https` la webview sirve desde `https://localhost` y hay contexto seguro; con `http` el PIN se rompe en el celular (en el navegador de escritorio seguiría andando, así que el error no se ve en desarrollo). |
| `versionCode` / `versionName` | en `android/app/build.gradle` | Play Store rechaza subir dos veces el mismo `versionCode`. Como `android/` es generada, al rehacerla vuelve a `1`: para publicar en serio conviene fijarlos antes de cada subida. |

Y en `.env.local`: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` quedan **horneadas
dentro del APK** en tiempo de build (Vite las reemplaza en el bundle). Si compilas con
un `.env.local` apuntando a otro proyecto Supabase, el APK se conecta allá. Vale
confirmarlo antes de repartir el archivo.

## Pendiente: el icono sigue siendo el de Capacitor

El APK compila y funciona, pero el icono del lanzador y la pantalla de arranque son
**los que trae Capacitor por defecto** (verificado comparándolos con la plantilla del
CLI: son byte por byte los mismos). Antes de repartir la app conviene cambiarlos.

Lo más corto es `@capacitor/assets`: se le dan dos imágenes y genera todas las
densidades, incluido el icono adaptativo de Android.
```bash
# en apps/movil, con un logo de 1024x1024 y un fondo de 2732x2732 en assets/
mkdir assets   # luego: assets/icon.png y assets/splash.png
npx @capacitor/assets generate --android
npm run android:apk
```
Ojo: escribe dentro de `android/`, que es carpeta generada. Si algún día se rehace
`android/` hay que volver a correrlo, así que las dos imágenes fuente sí deben quedar
versionadas en `apps/movil/assets/`.

## Si la red corporativa corta las descargas

El proxy de la empresa reemplaza los certificados TLS y Gradle falla con
`unable to find valid certification path to requested target`. Ya está resuelto:
`scripts/setup-android-certs.mjs` arma un truststore (`~/.gradle/ci-cacerts.jks`) con
los CA raíz de Windows más los del JDK, y `scripts/android.mjs` lo deja apuntado en
`android/gradle.properties`. Se corre solo la primera vez.

Lo que ese truststore **no** arregla es la descarga del propio Gradle desde
`services.gradle.org`, que suele cortarse a mitad y dejar un `.zip.part` inservible.
Si pasa: baja `gradle-8.2.1-bin.zip` a mano (desde un equipo sin proxy o con el
navegador) y déjalo en `~/.gradle/`. `scripts/android.mjs` detecta el zip local y
apunta el wrapper ahí, así que la próxima compilación ya no intenta descargarlo.

## Otros comandos

```bash
npm run android:clean       # borra android/build y android/app/build
npm run open:android        # abre el proyecto en Android Studio (logcat, emulador)
npm run build:android       # solo build web + cap sync, sin compilar el APK
```

Para ver los errores de JavaScript del celular: conecta el teléfono por USB, abre
`chrome://inspect` en Chrome del PC y la webview aparece en la lista.

---

# iOS — requiere macOS + Xcode

No se puede desde Windows.
```bash
npx cap add ios
npm run build && npx cap sync ios
npx cap open ios            # Xcode → firmar y archivar
```

# Escritorio (Windows .exe) — Electron

Solo necesita Node (sin Rust). Genera la app portable de escritorio:
```bash
npm run desktop:build       # build web + @electron/packager
```
Salida: `dist-desktop/Conserjes Inventario-win32-x64/Conserjes Inventario.exe`
(carpeta portable, se puede comprimir y distribuir). Para desarrollo: `npm run electron`.

> Nota: se usa `@electron/packager` (no `electron-builder`) porque el instalador
> firmado de electron-builder requiere privilegios de symlink en Windows
> (Modo Desarrollador/admin). Para un instalador `.msi/NSIS` firmado, usar
> electron-builder en una máquina con Modo Desarrollador activado.

## Estado
- ✅ Fase 2: shell nativo, login + caché de sesión, sync (pull/push), Dexie, Productos offline.
- ✅ Fase 3: Stock, Movimientos (RPC por outbox), Bodegas, Arqueo + navegación por pestañas.
- ✅ Fase 4: PIN local + permisos por rol offline (gating de pestañas y acciones).
- 🔹 Fase 5 (empaquetado), casi cerrada:
  - ✅ Escritorio Windows empaquetado (Electron).
  - ✅ **APK de Android compilado** con `npm run android:apk`; firma de release
    documentada arriba y automatizada, pendiente de usarse con un keystore real.
  - ⬜ Íconos y splash: siguen los de Capacitor por defecto (ver sección de arriba).
  - ⬜ iOS: requiere macOS + Xcode, no se puede desde Windows.
- ⬜ Fase 6: endurecer sync (conflictos, reintentos, borrados, fotos offline).

Plan completo en `docs/offline-native.md`. Ojo que ese documento todavía nombra
**Tauri** para el escritorio: al final se usó Electron, por lo que explica la sección
de escritorio de este README.
