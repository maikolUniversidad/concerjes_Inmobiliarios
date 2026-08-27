'use client'

import { motion, useReducedMotion, type Variants } from 'framer-motion'

type Direccion = 'arriba' | 'abajo' | 'izquierda' | 'derecha' | 'escala'

const DESPLAZAMIENTO: Record<Direccion, { x?: number; y?: number; scale?: number }> = {
  arriba:     { y: 24 },
  abajo:      { y: -24 },
  izquierda:  { x: 24 },
  derecha:    { x: -24 },
  escala:     { scale: 0.96 },
}

/**
 * Aparición al entrar en pantalla. Una sola vez, con una curva suave y corta:
 * el movimiento debe acompañar la lectura, no hacerse notar.
 *
 * Respeta `prefers-reduced-motion`: si el sistema pide menos movimiento, el
 * contenido aparece sin desplazamiento (no se queda invisible).
 */
export function Reveal({
  children,
  direccion = 'arriba',
  retraso = 0,
  duracion = 0.5,
  className,
}: {
  children: React.ReactNode
  direccion?: Direccion
  retraso?: number
  duracion?: number
  className?: string
}) {
  const menosMovimiento = useReducedMotion()

  const variantes: Variants = {
    oculto: menosMovimiento ? { opacity: 0 } : { opacity: 0, ...DESPLAZAMIENTO[direccion] },
    visible: {
      opacity: 1, x: 0, y: 0, scale: 1,
      transition: { duration: menosMovimiento ? 0.2 : duracion, delay: retraso, ease: [0.22, 1, 0.36, 1] },
    },
  }

  return (
    <motion.div
      className={className}
      variants={variantes}
      initial="oculto"
      whileInView="visible"
      viewport={{ once: true, amount: 0.2 }}
    >
      {children}
    </motion.div>
  )
}

/**
 * Contenedor que escalona la aparición de sus hijos `<RevealItem>`.
 * Útil para rejillas de tarjetas: entran en cascada en lugar de todas a la vez.
 */
export function RevealGrupo({
  children,
  escalon = 0.08,
  className,
}: {
  children: React.ReactNode
  escalon?: number
  className?: string
}) {
  const menosMovimiento = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial="oculto"
      whileInView="visible"
      viewport={{ once: true, amount: 0.15 }}
      variants={{ visible: { transition: { staggerChildren: menosMovimiento ? 0 : escalon } } }}
    >
      {children}
    </motion.div>
  )
}

export function RevealItem({ children, className }: { children: React.ReactNode; className?: string }) {
  const menosMovimiento = useReducedMotion()
  return (
    <motion.div
      className={className}
      variants={{
        oculto: menosMovimiento ? { opacity: 0 } : { opacity: 0, y: 20 },
        visible: { opacity: 1, y: 0, transition: { duration: menosMovimiento ? 0.2 : 0.5, ease: [0.22, 1, 0.36, 1] } },
      }}
    >
      {children}
    </motion.div>
  )
}
