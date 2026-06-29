'use client'

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChartRenderer } from './ChartRenderer'
import { isChartSpec, type ChartSpec } from '@/lib/ia/types'

/** Extrae el texto plano de los hijos de un nodo de código. */
function nodeText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(nodeText).join('')
  if (children && typeof children === 'object' && 'props' in children) {
    // @ts-expect-error acceso dinámico a props.children
    return nodeText(children.props?.children)
  }
  return ''
}

function tryParseChart(raw: string): ChartSpec | null {
  try {
    const parsed = JSON.parse(raw.trim())
    return isChartSpec(parsed) ? parsed : null
  } catch {
    return null
  }
}

const components: Components = {
  // Intercepta ```chart … ``` y lo renderiza como gráfica.
  code(props) {
    const { className, children } = props as { className?: string; children?: React.ReactNode }
    const isChart = /\blanguage-chart\b/.test(className ?? '')
    if (isChart) {
      const spec = tryParseChart(nodeText(children))
      if (spec) return <ChartRenderer spec={spec} />
      // Si aún se está transmitiendo y el JSON no cierra, no mostrar nada feo.
      return <span className="text-xs text-gray-400">Generando gráfica…</span>
    }
    // Código normal (inline o bloque) — el bloque lo envuelve <pre>.
    return (
      <code className={className ?? 'rounded bg-gray-100 px-1.5 py-0.5 text-[0.85em] text-brand-green'}>
        {children}
      </code>
    )
  },
  a(props) {
    return <a {...props} target="_blank" rel="noopener noreferrer" className="text-brand-green underline" />
  },
  table(props) {
    return (
      <div className="not-prose my-3 overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm" {...props} />
      </div>
    )
  },
  th(props) {
    return <th className="bg-gray-50 px-3 py-2 text-left font-semibold text-gray-600 text-xs uppercase tracking-wide border-b border-gray-200" {...props} />
  },
  td(props) {
    return <td className="px-3 py-2 border-b border-gray-50 text-gray-700" {...props} />
  },
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none prose-headings:font-heading prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-li:text-gray-700 prose-a:text-brand-green">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
