import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { construirContexto } from '@/lib/documentos/contexto'
import { extraerVariables, renderizarPlantilla, variablesVacias } from '@/lib/documentos/plantilla'
import { incrustarFoto, limpiarHtml } from '@/lib/documentos/html'
import { fotoPerfilDataUrl } from '@/lib/documentos/foto-perfil'
import { emitirEvento } from '@/lib/notificaciones/eventos'

export const runtime = 'nodejs'
export const maxDuration = 60

/* eslint-disable @typescript-eslint/no-explicit-any */

// Genera los documentos de contratación de un candidato con sus datos.
//
// POST { candidato_id, codigos?, contrato_id?, extras?, regenerar?, vista_previa?, plantilla_html? }
//  · vista_previa + plantilla_html → devuelve el HTML de esa plantilla llenado
//    con el candidato (lo usa el editor de plantillas para probar), sin guardar.
//  · vista_previa sin plantilla_html → devuelve lo que se generaría y qué
//    variables quedarían vacías, sin guardar.
//  · normal → guarda cada documento en `documentos_generados` (pendiente de
//    firma si el formato lo exige) y avisa al candidato.
export async function POST(req: NextRequest) {
  try {
    const permisos = await getPermisosUsuario()
    const body = await req.json().catch(() => ({}))
    const {
      candidato_id, codigos, contrato_id, extras, regenerar, vista_previa, plantilla_html,
    } = body as {
      candidato_id?: string; codigos?: string[]; contrato_id?: string | null; extras?: Record<string, string>
      regenerar?: boolean; vista_previa?: boolean; plantilla_html?: string
    }
    if (!candidato_id) return NextResponse.json({ error: 'Falta el candidato.' }, { status: 400 })
    const puedeVer = permisos.puede('ver_plantillas_documento') || permisos.puede('gestionar_postulaciones')
    if (vista_previa ? !puedeVer : !permisos.puede('gestionar_postulaciones')) {
      return NextResponse.json({ error: 'No tienes permiso para generar documentos.' }, { status: 403 })
    }

    const sb = (await createClient()) as any
    const ctx = await construirContexto(sb, candidato_id, { contratoId: contrato_id ?? null, extras: extras ?? {} })

    // La foto de perfil va incrustada en los formatos que la llevan: sale al
    // imprimir y queda dentro de lo que se firma. Se descarga una sola vez.
    let foto: string | null | undefined
    const conFoto = async (html: string) => {
      if (!html.includes('{{FOTO_CARNET}}')) return html
      if (foto === undefined) foto = await fotoPerfilDataUrl(sb, candidato_id)
      return incrustarFoto(html, foto)
    }

    // Prueba de una plantilla en edición (no se guarda nada).
    if (vista_previa && typeof plantilla_html === 'string') {
      const html = await conFoto(limpiarHtml(renderizarPlantilla(plantilla_html, ctx)))
      return NextResponse.json({ html, vacias: variablesVacias(plantilla_html, ctx) })
    }

    let q = sb.from('plantillas_documento')
      .select('id, codigo, nombre, momento, orden, activa, requiere_firma_trabajador, requiere_contrato, aplica_cargos, visible_candidato, permite_firma_electronica, version_vigente')
      .eq('activa', true).neq('momento', 'INTERNO').order('orden')
    if (Array.isArray(codigos) && codigos.length) q = q.in('codigo', codigos)
    const { data: plantillas, error: ePl } = await q
    if (ePl) return NextResponse.json({ error: ePl.message }, { status: 500 })
    if (!plantillas?.length) return NextResponse.json({ error: 'No hay plantillas activas para generar.' }, { status: 400 })

    const ids = plantillas.map((p: any) => p.id)
    const { data: versiones } = await sb.from('plantilla_versiones')
      .select('id, plantilla_id, version, cuerpo_html').in('plantilla_id', ids)
    const vigente = new Map<string, any>()
    for (const p of plantillas) {
      const v = (versiones ?? []).find((x: any) => x.plantilla_id === p.id && x.version === p.version_vigente)
      if (v) vigente.set(p.id, v)
    }

    const contrato = ctx.contrato as { existe?: boolean }
    const cargoId = (await sb.from('candidatos').select('cargo_postulacion_id').eq('id', candidato_id).maybeSingle()).data?.cargo_postulacion_id

    const resultado: { codigo: string; nombre: string; estado: string; motivo?: string; vacias?: string[]; id?: string }[] = []
    const aGuardar: any[] = []

    const { data: existentes } = await sb.from('documentos_generados')
      .select('id, plantilla_id, estado').eq('candidato_id', candidato_id).neq('estado', 'ANULADO')

    for (const p of plantillas) {
      const v = vigente.get(p.id)
      if (!v) { resultado.push({ codigo: p.codigo, nombre: p.nombre, estado: 'OMITIDO', motivo: 'Sin versión publicada.' }); continue }
      if (p.requiere_contrato && !contrato?.existe) {
        resultado.push({ codigo: p.codigo, nombre: p.nombre, estado: 'OMITIDO', motivo: 'Necesita el contrato: guárdelo primero.' }); continue
      }
      if (Array.isArray(p.aplica_cargos) && p.aplica_cargos.length && !p.aplica_cargos.includes(cargoId)) {
        resultado.push({ codigo: p.codigo, nombre: p.nombre, estado: 'OMITIDO', motivo: 'No aplica para el cargo.' }); continue
      }
      const previo = (existentes ?? []).filter((e: any) => e.plantilla_id === p.id)
      if (previo.some((e: any) => e.estado === 'FIRMADO') && !regenerar) {
        resultado.push({ codigo: p.codigo, nombre: p.nombre, estado: 'OMITIDO', motivo: 'Ya está firmado.' }); continue
      }
      const vacias = variablesVacias(v.cuerpo_html, ctx)
      if (vista_previa) { resultado.push({ codigo: p.codigo, nombre: p.nombre, estado: 'LISTO', vacias }); continue }
      const html = await conFoto(limpiarHtml(renderizarPlantilla(v.cuerpo_html, ctx)))

      // Foto de las variables usadas (evidencia de con qué datos se generó).
      const datos: Record<string, unknown> = {}
      for (const ruta of extraerVariables(v.cuerpo_html)) {
        let cur: any = ctx
        for (const s of ruta.split('.')) cur = cur?.[s]
        if (cur !== undefined && typeof cur !== 'object') datos[ruta] = cur
      }
      aGuardar.push({
        plantilla: p, previo, vacias,
        fila: {
          candidato_id, contrato_id: (ctx.contrato as any)?.existe ? (contrato_id ?? null) : null,
          plantilla_id: p.id, version_id: v.id, codigo_plantilla: p.codigo, nombre: p.nombre,
          datos, html_render: html,
          estado: p.requiere_firma_trabajador ? 'PENDIENTE_FIRMA' : 'GENERADO',
          visible_candidato: p.visible_candidato, permite_firma_electronica: p.permite_firma_electronica,
          sha256: createHash('sha256').update(html).digest('hex'),
        },
      })
    }

    if (vista_previa) return NextResponse.json({ documentos: resultado })

    // Contrato: si no vino explícito, se amarra al vigente del candidato.
    if (!contrato_id && (ctx.contrato as any)?.existe) {
      const { data: k } = await sb.from('contratos').select('id').eq('candidato_id', candidato_id).neq('estado', 'ANULADO')
        .order('generado_at', { ascending: false }).limit(1).maybeSingle()
      for (const g of aGuardar) g.fila.contrato_id = k?.id ?? null
    }

    const { data: { user } } = await sb.auth.getUser()
    const { data: yo } = user ? await sb.from('usuarios').select('nombre, email').eq('id', user.id).maybeSingle() : { data: null }
    const autor = yo?.nombre ?? yo?.email ?? null

    let porFirmar = 0
    for (const g of aGuardar) {
      // Lo anterior que no esté firmado (o todo, si se pidió regenerar) queda anulado.
      const anular = g.previo.filter((e: any) => regenerar || e.estado !== 'FIRMADO').map((e: any) => e.id)
      if (anular.length) {
        await sb.from('documentos_generados').update({
          estado: 'ANULADO', anulado_at: new Date().toISOString(), anulado_motivo: 'Reemplazado por una generación nueva',
        }).in('id', anular)
      }
      const { data: nuevo, error } = await sb.from('documentos_generados')
        .insert({ ...g.fila, generado_por: user?.id ?? null, generado_por_nombre: autor }).select('id').single()
      if (error) { resultado.push({ codigo: g.plantilla.codigo, nombre: g.plantilla.nombre, estado: 'ERROR', motivo: error.message }); continue }
      if (g.fila.estado === 'PENDIENTE_FIRMA' && g.fila.visible_candidato) porFirmar++
      resultado.push({ codigo: g.plantilla.codigo, nombre: g.plantilla.nombre, estado: g.fila.estado, vacias: g.vacias, id: nuevo.id })
    }

    const generados = resultado.filter((r) => r.id).length
    if (generados) {
      await sb.from('candidato_eventos').insert({
        candidato_id, tipo: 'DOCUMENTO', motivo: `${generados} documento(s) generado(s)`,
        detalle: { codigos: resultado.filter((r) => r.id).map((r) => r.codigo) }, actor: user?.id ?? null, actor_nombre: autor,
      })
    }
    if (porFirmar) {
      const cand = ctx.candidato as any
      const base = process.env.APP_BASE_URL ?? req.nextUrl.origin
      await emitirEvento(sb, {
        codigo: 'ATS_DOCUMENTO_PARA_FIRMA',
        payload: {
          candidato_id, candidato_email: cand.email, candidato_nombre: cand.nombre_completo,
          documento_nombre: `${porFirmar} documento(s) de contratación`, enlace: `${base}/registro-vacantes/mi-proceso`,
        },
        entidad: 'candidatos', entidadId: candidato_id,
      })
    }
    return NextResponse.json({ documentos: resultado, generados, por_firmar: porFirmar })
  } catch (e) {
    console.error('documentos/generar error:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudieron generar los documentos.' }, { status: 500 })
  }
}
