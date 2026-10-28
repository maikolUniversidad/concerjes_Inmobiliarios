/**
 * Pantalla de carga de la app de campo (`(campo)`).
 *
 * Aquí NO va el barrido de limpieza de la consola. Esto lo abre un conserje
 * con el celular, de noche, muchas veces con guantes y con mala señal: lo que
 * sirve es un esqueleto quieto, de mucho contraste, con la misma forma que la
 * pantalla que viene, y UNA barra que diga «sigue vivo». Una animación grande
 * en una pantalla de 5" con poca luz estorba y, en un celular de gama baja,
 * compite por CPU con lo que de verdad importa.
 *
 * Igual que en la consola: componente de servidor, cero imports, cero
 * JavaScript de cliente, y los keyframes en un `<style>` propio para no tocar
 * `globals.css`.
 *
 * El grupo `(campo)` se dibuja siempre en claro (su layout fija
 * `bg-gray-50 text-gray-900`), así que esto no lleva variante oscura.
 */

export function PantallaCargandoCampo() {
  return (
    <div className="cm-raiz px-4 py-6">
      <style>{CSS_CAMPO}</style>

      {/* Esqueleto con la forma de las pantallas de campo: saludo, botón
          grande de acción y una tarjeta con un campo. */}
      <div aria-hidden="true">
        <div className="cm-bloque h-4 w-16 rounded" />
        <div className="cm-bloque mt-2 h-7 w-52 rounded-lg" />
        <div className="cm-bloque mt-2 h-3 w-36 rounded" />

        {/* El botón primario mide h-16 en toda la app de campo. */}
        <div className="cm-bloque mt-6 h-16 w-full rounded-2xl" />

        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4">
          <div className="cm-bloque h-4 w-40 rounded" />
          <div className="cm-bloque mt-3 h-14 w-full rounded-xl" />
          <div className="cm-bloque mt-3 h-14 w-full rounded-xl" />
        </div>
      </div>

      {/* Aviso: el texto visible es el que lee el lector de pantalla. */}
      <div role="status" aria-live="polite" className="cm-aviso mt-8">
        <div className="cm-pista" aria-hidden="true">
          <div className="cm-barra" />
        </div>
        <p className="mt-3 text-center font-heading text-base font-bold text-gray-900">
          Cargando…
        </p>
        {/* Solo aparece si de verdad está tardando (3 s). */}
        <p className="cm-lenta mt-1 text-center text-sm text-gray-600">
          Si la señal está lenta puede tardar un poco.
        </p>
      </div>
    </div>
  )
}

const CSS_CAMPO = `
.cm-raiz {
  --cm-espera: 120ms;
}
/* Nada se dibuja los primeros 120 ms: una navegación corta no parpadea. */
.cm-raiz > * {
  animation: cm-aparecer 200ms ease-out var(--cm-espera) both;
}
@keyframes cm-aparecer {
  from { opacity: 0; }
  to   { opacity: 1; }
}

.cm-bloque {
  background: #e5e7eb;
}

/* Barra indeterminada: alto contraste y poco movimiento. */
.cm-pista {
  position: relative;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: #d1d5db;
}
.cm-barra {
  position: absolute;
  inset-block: 0;
  width: 42%;
  border-radius: 999px;
  background: linear-gradient(90deg, #2E7D32, #4CAF50);
  animation: cm-correr 1400ms cubic-bezier(.45,.05,.55,.95) var(--cm-espera) infinite;
}
@keyframes cm-correr {
  0%   { left: -45%; }
  100% { left: 100%; }
}

/* El aviso de señal lenta entra a los 3 s, no antes. */
.cm-lenta {
  animation: cm-aparecer 400ms ease-out 3s both;
}

@media (prefers-reduced-motion: reduce) {
  .cm-raiz > *,
  .cm-barra,
  .cm-lenta {
    animation: none !important;
  }
  /* Sin movimiento la barra se queda como una marca fija a la izquierda. */
  .cm-barra { left: 0; width: 35%; }
  .cm-lenta { opacity: 1; }
}
`
