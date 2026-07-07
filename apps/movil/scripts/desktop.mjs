// Empaqueta la app de escritorio con @electron/packager.
// Usa un directorio "desktop-stage" SIN dependencias (todo va bundleado en dist),
// evitando así la firma de código de electron-builder (que en Windows requiere
// privilegios de symlink). Genera dist-desktop/Conserjes Inventario-win32-x64/.
import { cpSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'

const ELECTRON = '31.7.7'
const env = { ...process.env, NODE_OPTIONS: '--use-system-ca' }

console.log('› Copiando dist → desktop-stage/dist')
rmSync('desktop-stage/dist', { recursive: true, force: true })
cpSync('dist', 'desktop-stage/dist', { recursive: true })

console.log('› Empaquetando con @electron/packager (electron ' + ELECTRON + ')')
execSync(
  `npx --yes @electron/packager ./desktop-stage "Conserjes Inventario" ` +
  `--platform=win32 --arch=x64 --out=dist-desktop --overwrite ` +
  `--electron-version=${ELECTRON} --app-copyright="Conserjes Inmobiliarios Ltda"`,
  { stdio: 'inherit', env },
)
console.log('\n✅ Listo: dist-desktop/Conserjes Inventario-win32-x64/Conserjes Inventario.exe')
