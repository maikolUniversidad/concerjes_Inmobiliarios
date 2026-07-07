// Proceso principal de Electron: abre una ventana que carga la SPA offline
// empaquetada en dist/. La app funciona igual que en móvil (Dexie local + sync
// con Supabase cuando hay internet).
const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')

function crearVentana() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    title: 'Conserjes Inventario',
    backgroundColor: '#f9fafb',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  // Los enlaces externos se abren en el navegador, no dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) { shell.openExternal(url); return { action: 'deny' } }
    return { action: 'allow' }
  })
}

app.whenReady().then(() => {
  crearVentana()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) crearVentana()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
