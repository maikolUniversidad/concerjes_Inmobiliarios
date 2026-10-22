// Llamar una RPC del módulo de rondas desde el cliente de Supabase tipado.
//
// `createClient()` devuelve un cliente con los tipos generados de `Database`, y
// esos tipos no incluyen las funciones nuevas: `sb.rpc('ronda_cerrar_visita',
// {...})` no compila hasta que alguien regenere `lib/types/database.ts`. En vez
// de sembrar `as any` en cada pantalla, el casteo vive AQUÍ, en una función con
// nombre, para que se vea de una vez qué se está saltando y por qué.
//
// Cuando los tipos se regeneren, esto se puede borrar y las llamadas quedan
// iguales.

export interface ClienteConRpc {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>
}

/** Llama una RPC por nombre y devuelve el dato, o lanza con el mensaje de la
 *  base —que en este módulo está escrito para que lo lea quien trabaja. */
export async function llamarRpc<T = unknown>(
  sb: unknown,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const cliente = sb as ClienteConRpc
  const { data, error } = await cliente.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}
