// Utilidades para el árbol de tipos documentales.

export interface TipoDoc {
  id: string
  parent_id: string | null
  nombre: string
  descripcion: string | null
  orden: number
}

export interface TipoNode extends TipoDoc {
  hijos: TipoNode[]
  profundidad: number
}

/** Construye el árbol jerárquico a partir de la lista plana. */
export function construirArbol(tipos: TipoDoc[]): TipoNode[] {
  const map = new Map<string, TipoNode>()
  tipos.forEach((t) => map.set(t.id, { ...t, hijos: [], profundidad: 0 }))
  const raices: TipoNode[] = []
  for (const node of map.values()) {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.hijos.push(node)
    } else {
      raices.push(node)
    }
  }
  const ordenar = (nodes: TipoNode[], prof: number) => {
    nodes.sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
    for (const n of nodes) {
      n.profundidad = prof
      ordenar(n.hijos, prof + 1)
    }
  }
  ordenar(raices, 0)
  return raices
}

/** Devuelve la ruta legible de un tipo (ej. "Afiliaciones / EPS"). */
export function rutaTipo(id: string | null, tipos: TipoDoc[]): string {
  if (!id) return ''
  const byId = new Map(tipos.map((t) => [t.id, t]))
  const partes: string[] = []
  let cur = byId.get(id)
  let guard = 0
  while (cur && guard++ < 20) {
    partes.unshift(cur.nombre)
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
  }
  return partes.join(' / ')
}

/** Lista plana ordenada por ruta, con la profundidad, para selects. */
export function tiposParaSelect(tipos: TipoDoc[]): { id: string; label: string }[] {
  return tipos
    .map((t) => ({ id: t.id, label: rutaTipo(t.id, tipos) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
