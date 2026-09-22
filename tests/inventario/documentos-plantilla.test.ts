import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  renderizarPlantilla, extraerVariables, variablesVacias, marcadoresReservados, numeroEnLetras, edadDesde,
} from '@/lib/documentos/plantilla'
import { limpiarHtml, resolverMarcadores } from '@/lib/documentos/html'
import { contextoDeEjemplo, agregarFormato, RUTAS_CONOCIDAS } from '@/lib/documentos/variables'
import { tiempoEntre, textoPeriodoPrueba } from '@/lib/documentos/contexto'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('motor de plantillas', () => {
  it('reemplaza variables y escapa el HTML de los datos', () => {
    const html = renderizarPlantilla('<p>{{a.b}}</p>', { a: { b: '<script>x</script> & "y"' } })
    expect(html).toBe('<p>&lt;script&gt;x&lt;/script&gt; &amp; &quot;y&quot;</p>')
  })

  it('con triple llave no escapa', () => {
    expect(renderizarPlantilla('{{{x}}}', { x: '<b>ok</b>' })).toBe('<b>ok</b>')
  })

  it('aplica filtros encadenados', () => {
    const ctx = { f: '2026-06-13', n: 1423500, t: 'maría paola', v: '' }
    expect(renderizarPlantilla('{{f | fecha}}', ctx)).toBe('13/06/2026')
    expect(renderizarPlantilla('{{f | fecha_larga}}', ctx)).toBe('13 de junio de 2026')
    expect(renderizarPlantilla('{{n | moneda}}', ctx)).toBe('$ 1.423.500')
    expect(renderizarPlantilla('{{t | mayusculas}}', ctx)).toBe('MARÍA PAOLA')
    expect(renderizarPlantilla('{{v | defecto:"—"}}', ctx)).toBe('—')
    expect(renderizarPlantilla('{{t | capitalizar}}', ctx)).toBe('María Paola')
  })

  it('marca casillas con igual / contiene + x', () => {
    const ctx = { tipo: 'CC', turnos: ['8HD_LV', 'ROTATIVO_8H'] }
    expect(renderizarPlantilla('[{{tipo | igual:"CC" | x}}][{{tipo | igual:"CE" | x}}]', ctx)).toBe('[X][]')
    expect(renderizarPlantilla('[{{turnos | contiene:"8HD_LV" | x}}][{{turnos | contiene:"4HD_LV" | x}}]', ctx)).toBe('[X][]')
  })

  it('soporta #if / else y #each con @numero', () => {
    const ctx = { ok: true, no: false, lista: [{ n: 'A' }, { n: 'B' }] }
    expect(renderizarPlantilla('{{#if ok}}sí{{else}}no{{/if}}', ctx)).toBe('sí')
    expect(renderizarPlantilla('{{#if no}}sí{{else}}no{{/if}}', ctx)).toBe('no')
    expect(renderizarPlantilla('{{#each lista}}{{@numero}}.{{this.n}} {{/each}}', ctx)).toBe('1.A 2.B ')
  })

  it('deja intactos los marcadores de firma, huella y foto', () => {
    const html = renderizarPlantilla('{{FIRMA_TRABAJADOR}}|{{HUELLA}}|{{FOTO_CARNET}}', {})
    expect(html).toBe('{{FIRMA_TRABAJADOR}}|{{HUELLA}}|{{FOTO_CARNET}}')
    expect(marcadoresReservados(html).sort()).toEqual(['FIRMA_TRABAJADOR', 'FOTO_CARNET', 'HUELLA'])
  })

  it('lista las variables usadas y las que quedarían vacías (solo en la rama que se pinta)', () => {
    const tpl = '{{a.x}} {{#if k}}{{a.y}}{{else}}{{a.z}}{{/if}} {{a.w | defecto:"-"}}'
    expect(extraerVariables(tpl)).toEqual(['a.w', 'a.x', 'a.y', 'a.z', 'k'])
    expect(variablesVacias(tpl, { a: { x: '' }, k: true })).toEqual(['a.x', 'a.y'])
  })

  it('números en letras y edad', () => {
    expect(numeroEnLetras(1)).toBe('uno')
    expect(numeroEnLetras(8)).toBe('ocho')
    expect(numeroEnLetras(21)).toBe('veintiún')
    expect(numeroEnLetras(60)).toBe('sesenta')
    expect(numeroEnLetras(1423500)).toBe('un millón cuatrocientos veintitrés mil quinientos')
    expect(edadDesde('1989-02-02', new Date(2026, 5, 11))).toBe(37)
    expect(edadDesde('1989-06-12', new Date(2026, 5, 11))).toBe(36)
  })

  it('textos del contrato: periodo de prueba y tiempo laborado', () => {
    expect(textoPeriodoPrueba(60)).toBe('los primeros dos (2) meses calendario de labores')
    expect(textoPeriodoPrueba(30)).toBe('el primer (1) mes calendario de labores')
    expect(tiempoEntre('2023-08-01', '2024-08-02')).toBe('1 año')
    expect(tiempoEntre('2024-10-03', '2026-06-12')).toBe('1 año y 8 meses')
  })
})

describe('limpieza del HTML de las plantillas', () => {
  it('quita scripts, manejadores de eventos y javascript:', () => {
    const sucio = '<p onclick="x()">hola</p><script>alert(1)</script><a href="javascript:alert(1)">a</a><iframe src="x"></iframe>'
    const limpio = limpiarHtml(sucio)
    expect(limpio).not.toMatch(/script|onclick|javascript:|iframe/i)
    expect(limpio).toContain('<p>hola</p>')
  })

  it('conserva imágenes de firma en data URL PNG', () => {
    const html = '<img class="firma-img" src="data:image/png;base64,AAAA" />'
    expect(limpiarHtml(html)).toBe(html)
  })

  it('las firmas sin estampar quedan como línea para firmar en papel', () => {
    const r = resolverMarcadores('{{FIRMA_TRABAJADOR}} {{HUELLA}}')
    expect(r).toContain('linea-firma')
    expect(r).toContain('huella')
    expect(r).not.toContain('{{')
  })
})

describe('plantillas digitalizadas (supabase/plantillas-documento)', () => {
  const dir = join(raiz, 'supabase', 'plantillas-documento')
  const archivos = readdirSync(dir).filter((f) => f.endsWith('.html'))
  const ctx = contextoDeEjemplo()
  const ctxReq = agregarFormato({
    empresa: ctx.empresa, hoy: ctx.hoy,
    requisicion: {
      numero: 'REQ-2026-0001', solicitante_nombre: 'X', proceso: 'OPERACIONES', fecha_solicitud: '2026-09-03', cliente_nombre: 'TRANSMILENIO',
      sede: 'TRANSMILENIO', centro_costo: 'TRANSMILENIO 2026-BOGOTA', fecha_inicio: '', fecha_inicio_texto: 'LO MÁS PRONTO POSIBLE',
      cantidad: 1, motivo: 'REEMPLAZO', motivo_detalle: '', tipo_cargo: 'OPERATIVO', cargo: 'OPERARIO ASEO', perfil_cargo: '',
      competencias_tecnicas: '', requiere_curso_alturas: false, requiere_curso_alimentos: true, requiere_examen_conduccion: false,
      salario_basico: 1623500, turnos: ['8HD_LS'], turno_otro: '', edad_requerida: '', sexo_requerido: 'MASCULINO', nivel_academico: '',
      experiencia_anios: 0, experiencia_meses: 0, modalidad_nombre: 'Obra o labor', funciones: '', fecha_limite: '2026-09-10',
      aprobada_lider: true, aprobada_th: false,
    },
  })

  it('hay 18 formatos con metadatos válidos', () => {
    expect(archivos.length).toBeGreaterThanOrEqual(18)
    for (const f of archivos) {
      const txt = readFileSync(join(dir, f), 'utf8')
      const m = /^\s*<!--\s*plantilla:\s*(\{[\s\S]*?\})\s*-->/.exec(txt)
      expect(m, f).not.toBeNull()
      const meta = JSON.parse(m![1])
      expect(typeof meta.nombre, f).toBe('string')
    }
  })

  for (const f of archivos) {
    it(`${f} se llena sin dejar llaves sueltas`, () => {
      const cuerpo = readFileSync(join(dir, f), 'utf8').replace(/^\s*<!--[\s\S]*?-->\s*/, '')
      const contexto = f.startsWith('REQUISICION') ? ctxReq : ctx
      const html = resolverMarcadores(limpiarHtml(renderizarPlantilla(cuerpo, contexto)))
      expect(html).not.toMatch(/\{\{|\}\}/)
      expect(html.length).toBeGreaterThan(300)
      // Toda variable usada debe existir en el catálogo que ve RRHH.
      if (!f.startsWith('REQUISICION')) {
        const desconocidas = extraerVariables(cuerpo).filter((v) => !RUTAS_CONOCIDAS.has(v)
          && !/^(candidato|contrato|cargo|entrevista)\.[a-z_]+\.[a-z_]+$/.test(v))
        expect(desconocidas, f).toEqual([])
      }
    })
  }

  it('la actualización de datos sale con los datos del candidato', () => {
    const cuerpo = readFileSync(join(dir, 'ACTUALIZACION_DATOS.html'), 'utf8')
    const html = renderizarPlantilla(cuerpo, ctx)
    expect(html).toContain('RÍOS')
    expect(html).toContain('1000123456')
    expect(html).toContain('ANA LUCÍA RÍOS PEÑA')
    expect(html).toContain('LIMPIEZA INTEGRAL DE EJEMPLO LTDA')
  })

  it('el contrato imprime el periodo de prueba y las cláusulas adicionales', () => {
    const cuerpo = readFileSync(join(dir, 'CONTRATO_OBRA_LABOR.html'), 'utf8')
    const html = renderizarPlantilla(cuerpo, ctx)
    expect(html).toContain('los primeros dos (2) meses calendario de labores')
    expect(html).toContain('CONS20260613-001')
    expect(html).toContain('usuario solicite su cambio')
  })
})
