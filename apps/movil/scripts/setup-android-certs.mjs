// Construye el truststore que necesita Gradle en una red con proxy/TLS corporativo.
//
// El problema: el proxy de la empresa reemplaza los certificados, y el JDK no
// conoce su CA raíz, así que Gradle falla con "unable to find valid certification
// path to requested target" al bajar dependencias.
//
// La solución: un truststore propio = los cacerts del JDK + todos los CA raíz e
// intermedios que Windows ya tiene instalados (entre ellos el del proxy).
// Queda en ~/.gradle/ci-cacerts.jks y scripts/android.mjs lo deja apuntado en
// android/gradle.properties.
//
// Normalmente no hace falta llamarlo a mano: scripts/android.mjs lo corre solo
// la primera vez. Para reconstruirlo (por ejemplo si cambió el CA del proxy):
//   cd apps/movil && node scripts/setup-android-certs.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'

const HOME = os.homedir()
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, 'AppData', 'Local')

// Cualquier JDK sirve para esto: solo se usan su keytool y sus cacerts.
const candidatos = [
  process.env.JAVA_HOME,
  'C:/Program Files/Android/Android Studio/jbr',
  join(LOCALAPPDATA, 'Programs/Android Studio/jbr'),
]
for (const base of [join(HOME, '.gradle', 'jdks'), join(HOME, '.jdks'), 'C:/Program Files/Eclipse Adoptium']) {
  try {
    const { readdirSync } = await import('node:fs')
    for (const d of readdirSync(base)) candidatos.push(join(base, d))
  } catch {}
}
const jdk = candidatos.filter(Boolean).find((p) => existsSync(join(p, 'bin', 'keytool.exe')))
if (!jdk) {
  console.error('✗ No encontré ningún JDK (necesito su keytool). Instala Temurin 17 o Android Studio.')
  process.exit(1)
}

const keytool = join(jdk, 'bin', 'keytool.exe')
const cacerts = join(jdk, 'lib', 'security', 'cacerts')
console.log('› JDK:', jdk)

const gradleHome = join(HOME, '.gradle')
mkdirSync(gradleHome, { recursive: true })
const truststore = join(gradleHome, 'ci-cacerts.jks')
copyFileSync(cacerts, truststore)

// Exporta a DER los CA que tiene Windows y los importa al truststore.
const ps = `
$stores=@('Cert:\\LocalMachine\\Root','Cert:\\CurrentUser\\Root','Cert:\\LocalMachine\\CA','Cert:\\CurrentUser\\CA')
$tmp=Join-Path $env:TEMP ('winroots_'+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Force $tmp | Out-Null
$i=0
foreach($s in $stores){ try{$cs=Get-ChildItem $s -ErrorAction Stop}catch{continue}
  foreach($c in $cs){ $i++; [IO.File]::WriteAllBytes((Join-Path $tmp "c$i.cer"),$c.RawData)
    $null = & '${keytool.replace(/\\/g, '\\\\')}' -importcert -noprompt -trustcacerts -keystore '${truststore.replace(/\\/g, '\\\\')}' -storepass changeit -alias "winca$i" -file (Join-Path $tmp "c$i.cer") 2>&1 } }
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
Write-Output "CA de Windows importados: $i"
`
const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' })
console.log('› ' + out.trim())
console.log('✅ Truststore listo:', truststore)
