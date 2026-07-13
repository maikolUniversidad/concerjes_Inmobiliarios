// Layout mínimo para vistas imprimibles (sin el shell del dashboard).
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-100 text-gray-900 print:bg-white">{children}</div>
}
