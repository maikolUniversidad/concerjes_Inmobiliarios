'use client'

import { useInView } from 'react-intersection-observer'
import { useEffect, useState } from 'react'

const stats = [
  { value: 36, suffix: '+', label: 'Años de experiencia', description: 'Fundados el 6 de abril de 1990' },
  { value: 1069, suffix: '', label: 'Colaboradores activos', description: 'Talento humano capacitado' },
  { value: 500, suffix: '+', label: 'Clientes satisfechos', description: 'Empresas en todo el país' },
  { value: 100, suffix: '%', label: 'Compromiso SST', description: 'Seguridad y salud en el trabajo' },
]

function Counter({ value, suffix, inView }: { value: number; suffix: string; inView: boolean }) {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!inView) return
    const duration = 2000
    const steps = 60
    const increment = value / steps
    let current = 0
    const timer = setInterval(() => {
      current += increment
      if (current >= value) {
        setCount(value)
        clearInterval(timer)
      } else {
        setCount(Math.floor(current))
      }
    }, duration / steps)
    return () => clearInterval(timer)
  }, [inView, value])

  return (
    <span>
      {count.toLocaleString('es-CO')}
      {suffix}
    </span>
  )
}

export function StatsSection() {
  const { ref, inView } = useInView({ triggerOnce: true, threshold: 0.3 })

  return (
    <section className="py-20 gradient-brand relative overflow-hidden">
      {/* Decorative circles */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />

      <div ref={ref} className="container-max px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {stats.map((stat, i) => (
            <div key={i} className="text-center text-white">
              <p className="font-heading font-bold text-5xl sm:text-6xl mb-2 text-white">
                <Counter value={stat.value} suffix={stat.suffix} inView={inView} />
              </p>
              <p className="font-heading font-semibold text-lg text-green-200 mb-1">
                {stat.label}
              </p>
              <p className="font-body text-sm text-green-300">
                {stat.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
