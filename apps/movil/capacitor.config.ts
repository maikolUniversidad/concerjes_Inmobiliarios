import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.conserjesinmobiliarios.inventario',
  appName: 'Conserjes Inventario',
  webDir: 'dist',
  // La app carga desde los archivos empaquetados (offline). No apunta a una URL remota.
  server: {
    // No cambiar a 'http': el PIN local usa crypto.subtle para el SHA-256, y esa
    // API solo existe en contexto seguro. Con 'https' la webview sirve desde
    // https://localhost y el contexto es seguro; con 'http' el PIN dejaría de
    // funcionar en el celular (en el navegador de escritorio sí anda).
    androidScheme: 'https',
  },
}

export default config
