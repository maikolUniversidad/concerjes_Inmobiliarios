// Compila el APK de Android de punta a punta, en un solo comando.
//
// Uso:
//   node scripts/android.mjs            → APK de depuración (sin firma de release)
//   node scripts/android.mjs release    → APK firmado        (necesita .keystore.properties)
//   node scripts/android.mjs bundle     → AAB firmado        (para subir a Play Store)
//   node scripts/android.mjs instalar   → instala el APK de depuración por USB
//   node scripts/android.mjs limpiar    → borra android/build y android/app/build
//
// Lo que hace, en orden:
//   1) Verifica que exista dist/ (el bundle web ya construido).
//   2) Crea android/ con `cap add android` si falta (está en .gitignore, así que
//      un clon nuevo no la trae) y corre `cap sync android` para copiar dist/.
//   3) Elige un JDK 17–20: el Gradle 8.2.1 que genera Capacitor 6 no soporta
//      Java 21, y el JBR que trae Android Studio hoy ya va en 21.
//   4) Escribe android/local.properties (sdk.dir) y un bloque propio en
//      android/gradle.properties con el JDK y el truststore del TLS corporativo.
//   5) Apunta el wrapper a un Gradle ya descargado si lo hay: la red corporativa
//      corta la descarga de services.gradle.org a medio camino.
//   6) Corre gradlew y dice dónde quedó el archivo.
//
// Nada de lo que escribe se publica: android/ entera está en .gitignore.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import os from 'node:os'

const HOME = os.homedir()
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, 'AppData', 'Local')
const RAIZ = resolve(import.meta.dirname, '..')
const ANDROID = join(RAIZ, 'android')
// Gradle lee los .properties como ISO-8859-1, así que este bloque va en ASCII puro.
const MARCA_INI = '# >>> generado por scripts/android.mjs - no editar a mano'
const MARCA_FIN = '# <<< fin del bloque de scripts/android.mjs'
// Para borrar el bloque anterior se busca solo por los delimitadores, sin el texto
// que va en medio: así se limpia igual aunque el mensaje cambie entre versiones.
const RE_BLOQUE = /^# >>> generado por scripts\/android\.mjs[\s\S]*?^# <<< fin del bloque de scripts\/android\.mjs[^\n]*\r?\n?/gm

const objetivo = (process.argv[2] || 'debug').toLowerCase()
const TAREAS = { debug: 'assembleDebug', release: 'assembleRelease', bundle: 'bundleRelease' }
if (!TAREAS[objetivo] && !['instalar', 'limpiar'].includes(objetivo)) {
  console.error(`✗ Objetivo desconocido: "${objetivo}". Usa debug, release, bundle, instalar o limpiar.`)
  process.exit(1)
}

// Los .bat no son ejecutables para execFileSync: van por cmd.exe /c, sin shell:true
// (que concatena los argumentos sin escaparlos).
const corre = (cmd, args, cwd = RAIZ, env = process.env) =>
  cmd.endsWith('.bat')
    ? execFileSync(process.env.COMSPEC || 'cmd.exe', ['/d', '/s', '/c', cmd, ...args], { cwd, stdio: 'inherit', env })
    : execFileSync(cmd, args, { cwd, stdio: 'inherit', env })

// ── Atajos que no compilan nada ───────────────────────────────────────────────
if (objetivo === 'limpiar') {
  for (const d of ['build', 'app/build']) rmSync(join(ANDROID, d), { recursive: true, force: true })
  console.log('✅ Borrado android/build y android/app/build.')
  process.exit(0)
}

if (objetivo === 'instalar') {
  const apk = join(ANDROID, 'app/build/outputs/apk/debug/app-debug.apk')
  if (!existsSync(apk)) {
    console.error('✗ No hay APK de depuración. Corre primero:  npm run android:apk')
    process.exit(1)
  }
  const sdkDir = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(LOCALAPPDATA, 'Android/Sdk')]
    .filter(Boolean)
    .find((p) => existsSync(join(p, 'platform-tools')))
  if (!sdkDir) {
    console.error('✗ No encontré el Android SDK (hace falta adb).')
    process.exit(1)
  }
  const adb = join(sdkDir, 'platform-tools', 'adb.exe')
  console.log('› Celulares conectados:')
  corre(adb, ['devices'], RAIZ)
  try {
    corre(adb, ['install', '-r', apk], RAIZ)
  } catch {
    console.error(
      '\n✗ adb no pudo instalar el APK. Lo habitual:\n' +
        '  · el celular no está conectado por USB, o\n' +
        '  · le falta activar "Depuración por USB" en Opciones de desarrollador, o\n' +
        '  · no se aceptó en el teléfono el aviso de "¿Permitir depuración?".\n' +
        '  Si la lista de arriba salió vacía, es una de esas tres.\n',
    )
    process.exit(1)
  }
  console.log('\n✅ Instalado. Busca "Conserjes Inventario" en el teléfono.')
  process.exit(0)
}

// La firma se valida antes de compilar: si falta, mejor saberlo ya y no después
// de dos minutos de Gradle.
const propsFirma = join(RAIZ, '.keystore.properties')
if (objetivo !== 'debug' && !existsSync(propsFirma)) {
  console.error(
    '\n✗ Falta apps/movil/.keystore.properties (NO va al repositorio).\n' +
      '  Créalo con estas cuatro líneas, apuntando a tu keystore:\n\n' +
      '    storeFile=C:/ruta/absoluta/conserjes.keystore\n' +
      '    storePassword=...\n' +
      '    keyAlias=conserjes\n' +
      '    keyPassword=...\n\n' +
      '  El keystore se genera una sola vez (ver README, sección "APK firmado").\n',
  )
  process.exit(1)
}

// ── 1) El bundle web ───────────────────────────────────────────────────────────
if (!existsSync(join(RAIZ, 'dist', 'index.html'))) {
  console.error('✗ Falta dist/. Corre primero:  npm run build')
  process.exit(1)
}

// ── 2) Proyecto nativo ────────────────────────────────────────────────────────
// Se llama al CLI de Capacitor por su archivo, no por `npx`: en Windows `npx` es
// un .cmd y execFileSync no lo resuelve sin shell.
const cap = createRequire(import.meta.url).resolve('@capacitor/cli/bin/capacitor')
// NODE_OPTIONS=--use-system-ca para que el TLS corporativo no corte al CLI.
const envCap = { ...process.env, NODE_OPTIONS: '--use-system-ca' }
// android/ puede existir vacía si un `cap add` anterior se quedó a medias; lo que
// manda es si está el wrapper de Gradle.
if (!existsSync(join(ANDROID, 'gradlew'))) {
  if (existsSync(ANDROID)) {
    console.log('› android/ existe pero está incompleta → la rehago')
    rmSync(ANDROID, { recursive: true, force: true })
  }
  console.log('› Genero el proyecto nativo con cap add android')
  corre(process.execPath, [cap, 'add', 'android'], RAIZ, envCap)
} else {
  console.log('› android/ ya existe → cap sync android')
  corre(process.execPath, [cap, 'sync', 'android'], RAIZ, envCap)
}

// ── 3) JDK ────────────────────────────────────────────────────────────────────
/** Lee el major de Java del archivo `release` del JDK (17.0.20.1 → 17). */
function majorDeJdk(dir) {
  try {
    const rel = readFileSync(join(dir, 'release'), 'utf8')
    const m = rel.match(/^JAVA_VERSION="?([0-9]+)/m)
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

function candidatosJdk() {
  const dirs = [process.env.JAVA_HOME]
  // JDKs que Gradle se bajó solo como toolchain (~/.gradle/jdks/*).
  for (const base of [join(HOME, '.gradle', 'jdks'), join(HOME, '.jdks')]) {
    try {
      for (const d of readdirSync(base)) dirs.push(join(base, d))
    } catch {}
  }
  // Instalaciones típicas en Windows.
  for (const base of ['C:/Program Files/Eclipse Adoptium', 'C:/Program Files/Java', 'C:/Program Files/Microsoft']) {
    try {
      for (const d of readdirSync(base)) dirs.push(join(base, d))
    } catch {}
  }
  // El JBR de Android Studio va al final: hoy es Java 21 y no nos sirve.
  dirs.push('C:/Program Files/Android/Android Studio/jbr', join(LOCALAPPDATA, 'Programs/Android Studio/jbr'))
  return dirs.filter(Boolean).filter((d) => existsSync(join(d, 'bin', 'java.exe')) || existsSync(join(d, 'bin', 'java')))
}

const conVersion = candidatosJdk().map((d) => ({ dir: d, major: majorDeJdk(d) }))
// Gradle 8.2.1 soporta hasta Java 20; AGP 8.2.1 pide 17 como mínimo.
const jdk = conVersion.find((j) => j.major >= 17 && j.major <= 20)
if (!jdk) {
  const vistos = conVersion.map((j) => `${j.dir} (Java ${j.major ?? '?'})`).join('\n    ') || '(ninguno)'
  console.error(
    '\n✗ No encontré un JDK 17–20, que es lo que necesita este proyecto.\n' +
      '  Gradle 8.2.1 (el que genera Capacitor 6) no corre sobre Java 21.\n' +
      '  Instala Temurin 17:  winget install EclipseAdoptium.Temurin.17.JDK\n\n' +
      '  JDKs que vi en esta máquina:\n    ' + vistos + '\n',
  )
  process.exit(1)
}
console.log(`› JDK: ${jdk.dir} (Java ${jdk.major})`)

// ── 3b) SDK de Android ────────────────────────────────────────────────────────
const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(LOCALAPPDATA, 'Android/Sdk')]
  .filter(Boolean)
  .find((p) => existsSync(join(p, 'platform-tools')))
if (!sdk) {
  console.error(
    '\n✗ No encontré el Android SDK.\n' +
      '  Instálalo con Android Studio, o deja ANDROID_HOME apuntando a su carpeta.\n',
  )
  process.exit(1)
}
console.log(`› Android SDK: ${sdk}`)

// ── 4) local.properties + gradle.properties ───────────────────────────────────
const sdkEscapado = sdk.replace(/\\/g, '\\\\').replace(/^([A-Za-z]):/, '$1\\:')
writeFileSync(join(ANDROID, 'local.properties'), `## Generado por scripts/android.mjs\nsdk.dir=${sdkEscapado}\n`)

// El truststore mezcla los CA de Windows (incluido el del proxy) con los del JDK.
const truststore = join(HOME, '.gradle', 'ci-cacerts.jks')
if (!existsSync(truststore)) {
  console.log('› Falta el truststore del TLS corporativo → lo construyo')
  corre(process.execPath, [join(RAIZ, 'scripts', 'setup-android-certs.mjs')], RAIZ)
}

const gpPath = join(ANDROID, 'gradle.properties')
let gp = existsSync(gpPath) ? readFileSync(gpPath, 'utf8') : ''
// Quita el bloque anterior (y las líneas que escribía la versión vieja del script).
gp = gp.replace(RE_BLOQUE, '')
gp = gp.replace(/^# TLS corporativo.*\r?\n(systemProp\.javax\.net\.ssl\.\S+\r?\n)+/gm, '')
const bloque = [
  MARCA_INI,
  '# JDK 17 a 20: Gradle 8.2.1 no soporta Java 21 (el JBR de Android Studio ya va en 21).',
  `org.gradle.java.home=${jdk.dir.replace(/\\/g, '/')}`,
  '# TLS corporativo: CA de Windows mas los del JDK, para que Gradle pueda descargar.',
  `systemProp.javax.net.ssl.trustStore=${truststore.replace(/\\/g, '/')}`,
  'systemProp.javax.net.ssl.trustStorePassword=changeit',
  MARCA_FIN,
  '',
].join('\n')
writeFileSync(gpPath, gp.trimEnd() + '\n\n' + bloque)

// ── 5) Wrapper de Gradle ──────────────────────────────────────────────────────
// Si el zip ya está en ~/.gradle, apunta ahí: la red corporativa suele cortar la
// descarga desde services.gradle.org y dejar un .part inservible.
const wrapperProps = join(ANDROID, 'gradle', 'wrapper', 'gradle-wrapper.properties')
const wp = readFileSync(wrapperProps, 'utf8')
const version = wp.match(/gradle-([0-9.]+)-(bin|all)\.zip/)?.[1]
const zipLocal = ['bin', 'all']
  .map((t) => join(HOME, '.gradle', `gradle-${version}-${t}.zip`))
  .find((p) => existsSync(p))
// Se reescribe la URL siempre según lo que haya ahora: si el zip local se borró,
// hay que volver a la URL oficial o el wrapper apuntaría a un archivo inexistente.
const urlDeseada = zipLocal
  ? 'file\\:///' + zipLocal.replace(/\\/g, '/')
  : `https\\://services.gradle.org/distributions/gradle-${version}-all.zip`
if (!wp.includes(`distributionUrl=${urlDeseada}`)) {
  writeFileSync(wrapperProps, wp.replace(/^distributionUrl=.*$/m, `distributionUrl=${urlDeseada}`))
}
if (zipLocal) {
  console.log(`› Wrapper apuntado al Gradle local: ${zipLocal}`)
} else {
  console.log(`› Gradle ${version} se descargará de services.gradle.org (~130 MB).`)
  console.log('  Si la descarga se corta, baja el zip a mano a ~/.gradle/ y repite.')
}

// ── 5b) Firma, solo para release/bundle ───────────────────────────────────────
if (objetivo !== 'debug') {
  const buildGradle = join(ANDROID, 'app', 'build.gradle')
  let bg = readFileSync(buildGradle, 'utf8')
  if (!bg.includes('// >>> firma de release')) {
    bg +=
      '\n// >>> firma de release (generado por scripts/android.mjs)\n' +
      'android {\n' +
      '    signingConfigs {\n' +
      '        release {\n' +
      '            def p = new Properties()\n' +
      `            file('${propsFirma.replace(/\\/g, '/')}').withInputStream { p.load(it) }\n` +
      "            storeFile file(p['storeFile'])\n" +
      "            storePassword p['storePassword']\n" +
      "            keyAlias p['keyAlias']\n" +
      "            keyPassword p['keyPassword']\n" +
      '        }\n' +
      '    }\n' +
      '    buildTypes { release { signingConfig signingConfigs.release } }\n' +
      '}\n' +
      '// <<< firma de release\n'
    writeFileSync(buildGradle, bg)
    console.log('› Configuración de firma añadida a android/app/build.gradle')
  }
}

// ── 6) Gradle ─────────────────────────────────────────────────────────────────
const tarea = TAREAS[objetivo]
console.log(`\n› gradlew ${tarea}\n`)
corre(join(ANDROID, 'gradlew.bat'), [tarea], ANDROID, { ...process.env, JAVA_HOME: jdk.dir })

const salidas = {
  debug: 'android/app/build/outputs/apk/debug/app-debug.apk',
  release: 'android/app/build/outputs/apk/release/app-release.apk',
  bundle: 'android/app/build/outputs/bundle/release/app-release.aab',
}
const archivo = join(RAIZ, salidas[objetivo])
if (existsSync(archivo)) {
  const mb = (readFileSync(archivo).length / 1024 / 1024).toFixed(1)
  console.log(`\n✅ Listo: ${archivo}  (${mb} MB)`)
  if (objetivo === 'debug') console.log('   Instalar en un celular conectado:  npm run android:install')
} else {
  console.log(`\n⚠  Gradle terminó pero no encontré ${salidas[objetivo]}. Revisa la salida de arriba.`)
}
