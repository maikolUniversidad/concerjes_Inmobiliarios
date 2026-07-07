import { createContext, useContext, useEffect, useState } from 'react'
import { cargarPermisos, tiene, SIN_GATING, type PermisosState } from '../lib/permisos'
import { EVENTO_SYNC } from '../lib/eventos'

interface Ctx extends PermisosState { tiene: (k: string) => boolean }
const PermisosCtx = createContext<Ctx>({ ...SIN_GATING, tiene: () => true })

// eslint-disable-next-line react-refresh/only-export-components
export const usePermisos = () => useContext(PermisosCtx)

export function PermisosProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [state, setState] = useState<PermisosState>(SIN_GATING)

  useEffect(() => {
    let vivo = true
    const cargar = () => { cargarPermisos(userId).then(s => { if (vivo) setState(s) }) }
    cargar()
    window.addEventListener(EVENTO_SYNC, cargar)
    return () => { vivo = false; window.removeEventListener(EVENTO_SYNC, cargar) }
  }, [userId])

  return (
    <PermisosCtx.Provider value={{ ...state, tiene: (k) => tiene(state, k) }}>
      {children}
    </PermisosCtx.Provider>
  )
}
