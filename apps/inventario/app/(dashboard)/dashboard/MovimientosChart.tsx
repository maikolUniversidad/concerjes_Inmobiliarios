'use client'
import { BarChart3 } from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'

export interface ChartPoint {
  dia: string
  entradas: number
  salidas: number
}

export function MovimientosChart({ data }: { data: ChartPoint[] }) {
  const hayDatos = data.some(d => d.entradas > 0 || d.salidas > 0)

  if (!hayDatos) {
    return (
      <div className="h-56 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center">
        <BarChart3 className="w-10 h-10 text-gray-300 mb-2" />
        <p className="font-body text-sm text-gray-400">Sin movimientos registrados en el período</p>
      </div>
    )
  }

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
          <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #f0f0f0', fontSize: 12 }}
            cursor={{ fill: '#f9fafb' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="entradas" name="Entradas" fill="#16a34a" radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="salidas" name="Salidas" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
