import { NextRequest, NextResponse } from 'next/server'
import { getAdmin, uidDesdeToken } from '@/lib/supabase/admin'

// Reporta un pago del CLIENTE sobre una de sus cuentas de cobro.
// Se valida en el servidor: propiedad del cobro, estado, saldo disponible y las
// exigencias del método de pago (referencia / comprobante).
export async function POST(req: NextRequest) {
  try {
    const uid = await uidDesdeToken(req.headers.get('authorization'))
    if (!uid) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

    const { cobro_id, metodo_id, monto, referencia, comprobante_path } = await req.json()
    const valor = Number(monto)
    if (!cobro_id || !metodo_id || !valor || valor <= 0) {
      return NextResponse.json({ error: 'Datos incompletos.' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getAdmin() as any

    const { data: cobro } = await sb
      .from('cobros_servicio_hogar')
      .select('id, cliente_id, estado, saldo, numero')
      .eq('id', cobro_id)
      .maybeSingle()

    if (!cobro || cobro.cliente_id !== uid) {
      return NextResponse.json({ error: 'Cuenta de cobro no encontrada.' }, { status: 404 })
    }
    if (!['EMITIDO', 'PARCIAL'].includes(cobro.estado)) {
      return NextResponse.json({ error: 'Esta cuenta de cobro no admite pagos.' }, { status: 409 })
    }
    if (valor > Number(cobro.saldo)) {
      return NextResponse.json({ error: 'El valor supera el saldo pendiente.' }, { status: 400 })
    }

    const { data: metodo } = await sb
      .from('metodos_pago_hogar')
      .select('id, nombre, tipo, activo, visible_cliente, requiere_comprobante, requiere_referencia')
      .eq('id', metodo_id)
      .maybeSingle()

    if (!metodo || !metodo.activo || !metodo.visible_cliente) {
      return NextResponse.json({ error: 'Forma de pago no disponible.' }, { status: 400 })
    }
    if (metodo.requiere_referencia && !referencia) {
      return NextResponse.json({ error: 'Falta el número de referencia.' }, { status: 400 })
    }
    if (metodo.requiere_comprobante && !comprobante_path) {
      return NextResponse.json({ error: 'Falta adjuntar el comprobante.' }, { status: 400 })
    }
    // El comprobante debe vivir en la carpeta del propio cliente.
    if (comprobante_path && !String(comprobante_path).startsWith(`${uid}/`)) {
      return NextResponse.json({ error: 'Comprobante inválido.' }, { status: 400 })
    }

    const { data: pago, error } = await sb
      .from('pagos_hogar')
      .insert({
        cobro_id,
        cliente_id: uid,
        metodo_id,
        metodo_nombre: metodo.nombre,
        monto: valor,
        referencia: referencia || null,
        comprobante_path: comprobante_path || null,
        origen: 'CLIENTE',
        estado: 'REPORTADO',
      })
      .select('id')
      .single()

    if (error) {
      console.error('[portal/pagos]', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, id: pago.id })
  } catch (e: unknown) {
    console.error('[portal/pagos] unexpected:', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno.' }, { status: 500 })
  }
}
