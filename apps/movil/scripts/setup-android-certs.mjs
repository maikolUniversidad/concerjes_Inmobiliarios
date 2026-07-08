// Prepara el entorno Android en Windows con proxy/TLS corporativo.
//
// Qué hace:
//  1) Localiza el JDK (JBR de Android Studio) y el Android SDK.
//  2) Construye un truststore propio = cacerts del JBR + los CA raíz de Windows
//     (incluye el CA del proxy corporativo) en ~/.gradle/ci-cacerts.jks.
//  3) Escribe android/local.properties (sdk.dir) y añade a android/gradle.properties
//     los systemProp del truststore para que Gradle descargue sin errores de
//     "unable to find valid certification path".
//
// Uso:  cd apps/movil && node scripts/setup-android-certs.mjs
// Luego: npm run build:android && cd android && ./gradlew assembleDebug
import { execFileSync } from 'node:child_process'
import { existsSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const HOME = os.homedir()
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, 'AppData', 'Local')

// 1) JDK (JBR) y SDK
const jbrCandidates = [
  'C:/Program Files/Android/Android Studio/jbr',
  join(LOCALAPPDATA, 'Programs/Android Studio/jbr'),
  process.env.JAVA_HOME,
].filter(Boolean)
const jbr = jbrCandidates.find((p) => p && existsSync(join(p, 'bin', 'keytool.exe')))
if (!jbr) throw new Error('No encontré el JDK de Android Studio (JBR). Instala Android Studio.')

const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  join(LOCALAPPDATA, 'Android/Sdk'),
].filter(Boolean)
const sdk = sdkCandidates.find((p) => p && existsSync(p))
if (!sdk) throw new Error('No encontré el Android SDK. Ábrelo una vez en Android Studio para instalarlo.')

const keytool = join(jbr, 'bin', 'keytool.exe')
const cacerts = join(jbr, 'lib', 'security', 'cacerts')
console.log('› JDK (JBR):', jbr)
console.log('› Android SDK:', sdk)

// 2) Truststore = cacerts + CA de Windows
const gradleHome = join(HOME, '.gradle')
mkdirSync(gradleHome, { recursive: true })
const truststore = join(gradleHome, 'ci-cacerts.jks')
copyFileSync(cacerts, truststore)

// Exporta los CA raíz/intermedios de Windows a DER e impórtalos al truststore.
const ps = `
$stores=@('Cert:\\LocalMachine\\Root','Cert:\\CurrentUser\\Root','Cert:\\LocalMachine\\CA','Cert:\\CurrentUser\\CA')
$tmp=Join-Path $env:TEMP ('winroots_'+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Force $tmp | Out-Null
$i=0
foreach($s in $stores){ try{$cs=Get-ChildItem $s -ErrorAction Stop}catch{continue}
  foreach($c in $cs){ $i++; [IO.File]::WriteAllBytes((Join-Path $tmp "c$i.cer"),$c.RawData)
    $null = & '${keytool.replace(/\\/g, '\\\\')}' -importcert -noprompt -trustcacerts -keystore '${truststore.replace(/\\/g, '\\\\')}' -storepass changeit -alias "winca$i" -file (Join-Path $tmp "c$i.cer") 2>&1 } }
Write-Output "CA de Windows importados: $i"
`
const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' })
console.log('› ' + out.trim())
console.log('› Truststore:', truststore)

// 3) local.properties + gradle.properties del proyecto android/
const androidDir = join(process.cwd(), 'android')
if (!existsSync(androidDir)) {
  console.log('\n⚠  No existe android/. Corre primero:  npm run build && npx cap add android')
  process.exit(0)
}
const sdkForProps = sdk.replace(/\\/g, '\\\\').replace(/^([A-Za-z]):/, '$1\\:')
writeFileSync(join(androidDir, 'local.properties'),
  `## Generado por setup-android-certs.mjs\nsdk.dir=${sdkForProps}\n`)

const gpPath = join(androidDir, 'gradle.properties')
let gp = existsSync(gpPath) ? readFileSync(gpPath, 'utf8') : ''
const tsForProps = truststore.replace(/\\/g, '/')
if (!gp.includes('javax.net.ssl.trustStore')) {
  gp += `\n# TLS corporativo (setup-android-certs.mjs)\nsystemProp.javax.net.ssl.trustStore=${tsForProps}\nsystemProp.javax.net.ssl.trustStorePassword=changeit\n`
  writeFileSync(gpPath, gp)
}
console.log('\n✅ Listo. Ahora:  npm run build:android  &&  cd android && ./gradlew assembleDebug')
