'use client'
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useFormStatus } from 'react-dom'

interface Props {
  /** Server action que recibe un FormData con el campo `id`. */
  action: (formData: FormData) => void | Promise<void>
  id: string
  mensaje?: string
  className?: string
  children: React.ReactNode
}

function Inner({ className, children }: { className?: string; children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : children}
    </button>
  )
}

/** Botón de borrado que confirma antes de ejecutar la server action. */
export function DeleteButton({ action, id, mensaje = '¿Seguro que deseas eliminar este elemento?', className, children }: Props) {
  const [confirmed, setConfirmed] = useState(false)
  return (
    <form
      action={action}
      onSubmit={e => {
        if (!confirmed && !window.confirm(mensaje)) {
          e.preventDefault()
          return
        }
        setConfirmed(false)
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Inner className={className}>{children}</Inner>
    </form>
  )
}
