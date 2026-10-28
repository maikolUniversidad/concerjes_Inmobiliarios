/**
 * Pantalla de carga de la app: una escobilla de goma (squeegee) barre el vidrio
 * empañado y va dejando limpio lo que ya pasó.
 *
 * Por qué existe: 60 páginas del dashboard son `force-dynamic`, así que al
 * hacer clic en el menú Next se queda esperando al servidor. Sin un
 * `loading.tsx` no pasaba NADA en pantalla y la app se sentía congelada.
 *
 * Decisiones que conviene no deshacer:
 * - Los keyframes viven en el `<style>` de aquí abajo, no en `globals.css`:
 *   este componente es autocontenido y no hay dependencias nuevas.
 * - Todo lo visible entra con 150 ms de retardo (`cl-aparecer`), así una
 *   navegación de 100 ms no alcanza a dibujar nada y no parpadea.
 * - Detrás del vaho se ve el esqueleto (KPIs + tabla) con la misma caja que
 *   usan las páginas reales (`p-4 sm:p-6`), para que al desaparecer no haya
 *   salto de layout.
 * - El barrido es una máscara CSS que se desplaza; la escobilla va pegada al
 *   borde de esa máscara porque ambas animaciones comparten duración, retardo
 *   y curva. Si cambias una, cambia la otra.
 */

export function PantallaLimpiando() {
  return (
    // `h-full` + `overflow-hidden`: el esqueleto nunca empuja una barra de
    // scroll que luego desaparecería al llegar el contenido real.
    <div className="cl-raiz relative isolate h-full min-h-[32rem] overflow-hidden p-4 sm:p-6">
      <style>{CSS_LIMPIEZA}</style>

      {/* ── ESQUELETO ──
          Reserva el alto de la cabecera, de la fila de KPIs y de la tabla. */}
      <div className="space-y-6" aria-hidden="true">
        {/* Cabecera */}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="cl-bloque h-6 w-44 sm:w-60 rounded-lg" />
            <div className="cl-bloque h-3.5 w-28 sm:w-40 rounded-md" />
          </div>
          <div className="cl-bloque hidden h-9 w-32 rounded-xl sm:block" />
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              // En móvil la rejilla es de 2 columnas: el quinto KPI sobraría y
              // dejaría una fila huérfana.
              className={`cl-tarjeta h-24 rounded-2xl p-4 ${i === 4 ? 'hidden md:block' : ''}`}
            >
              <div className="cl-bloque h-3 w-16 rounded" />
              <div className="cl-bloque mt-3 h-6 w-12 rounded-md" />
            </div>
          ))}
        </div>

        {/* Tabla */}
        <div className="cl-tarjeta overflow-hidden rounded-2xl">
          {/* Barra de filtros */}
          <div className="flex items-center gap-3 border-b border-gray-100 p-4 dark:border-white/10">
            <div className="cl-bloque h-9 flex-1 rounded-xl" />
            <div className="cl-bloque hidden h-9 w-28 rounded-xl sm:block" />
          </div>
          {/* Filas */}
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-gray-100 px-4 py-3.5 last:border-0 dark:border-white/10"
            >
              <div className="cl-bloque h-4 w-4 shrink-0 rounded" />
              <div className="cl-bloque h-4 flex-1 rounded" />
              <div className="cl-bloque hidden h-4 w-24 rounded sm:block" />
              <div className="cl-bloque h-4 w-14 shrink-0 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* ── VIDRIO EMPAÑADO + BARRIDO ──
          `cl-capa` se desvanece al final del ciclo para que la máscara pueda
          volver a su sitio sin que se vea el vaho "regresando". */}
      <div className="cl-capa pointer-events-none absolute inset-0 z-10" aria-hidden="true">
        {/* El vaho. La máscara lo va borrando de izquierda a derecha. */}
        <div className="cl-vaho absolute inset-0" />

        {/* La escobilla, centrada en el borde de la máscara. */}
        <div className="cl-carro absolute inset-y-0 left-0 w-full">
          <div className="cl-escobilla absolute inset-y-0 left-0">
            {/* Agua y espuma empujadas por el caucho */}
            <div className="cl-espuma">
              {/* Burbujas: el reparto es fijo a propósito, para que no haya
                  dos renders distintos del mismo frame. */}
              {BURBUJAS.map((b, i) => (
                <span
                  key={i}
                  className="cl-gota"
                  style={{
                    width: b.d,
                    height: b.d,
                    left: b.x,
                    top: `${b.y}%`,
                    animationDelay: `${b.t}ms`,
                  }}
                />
              ))}
            </div>
            {/* Rastro húmedo que queda detrás, ya limpio */}
            <div className="cl-brillo" />
            {/* Perfil de la herramienta: caucho + canal metálico */}
            <div className="cl-caucho" />
            <div className="cl-canal" />
            {/* Mango */}
            <svg
              className="cl-mango"
              viewBox="0 0 64 120"
              width="40"
              height="76"
              fill="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="clMetal" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#f8fafc" />
                  <stop offset="0.35" stopColor="#cbd5e1" />
                  <stop offset="0.6" stopColor="#94a3b8" />
                  <stop offset="1" stopColor="#64748b" />
                </linearGradient>
                <linearGradient id="clCuello" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#cbd5e1" />
                  <stop offset="0.5" stopColor="#94a3b8" />
                  <stop offset="1" stopColor="#64748b" />
                </linearGradient>
                <linearGradient id="clGrip" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="#334155" />
                  <stop offset="0.45" stopColor="#1e293b" />
                  <stop offset="1" stopColor="#0f172a" />
                </linearGradient>
              </defs>
              {/* Cuello que une el canal con el mango */}
              <path d="M0 46h16v28H0z" fill="url(#clMetal)" />
              <path d="M12 50c10-5 16-5 24 0v20c-8 5-14 5-24 0z" fill="url(#clCuello)" />
              <path d="M12 50c10-5 16-5 24 0v20c-8 5-14 5-24 0z" stroke="#475569" strokeWidth="1.5" opacity="0.5" />
              {/* Mango con agarre */}
              <rect x="30" y="18" width="26" height="84" rx="13" fill="url(#clGrip)" />
              <rect x="34" y="24" width="7" height="72" rx="3.5" fill="#ffffff" opacity="0.14" />
              <g opacity="0.22" fill="#ffffff">
                <rect x="30" y="38" width="26" height="3" rx="1.5" />
                <rect x="30" y="52" width="26" height="3" rx="1.5" />
                <rect x="30" y="66" width="26" height="3" rx="1.5" />
                <rect x="30" y="80" width="26" height="3" rx="1.5" />
              </g>
            </svg>
          </div>
        </div>
      </div>

      {/* ── AVISO ──
          El texto visible ES el texto accesible: la decoración va con
          aria-hidden para que el lector de pantalla no lo lea dos veces. */}
      <div
        role="status"
        aria-live="polite"
        className="cl-aviso pointer-events-none absolute inset-0 z-20 flex items-center justify-center px-4"
      >
        <p className="cl-pastilla flex items-center gap-2.5 rounded-full px-4 py-2.5 sm:px-5">
          <span className="cl-burbujas" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="font-heading text-[13px] font-semibold tracking-tight sm:text-sm">
            Limpiando la pantalla
            <span className="cl-puntos" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </span>
        </p>
      </div>
    </div>
  )
}

/** Reparto fijo de las burbujas: d = diámetro, x = px desde el caucho,
 *  y = % de alto, t = desfase de la animación. */
const BURBUJAS = [
  { d: 9, x: 8, y: 9, t: 0 },
  { d: 5, x: 26, y: 18, t: 260 },
  { d: 12, x: 13, y: 29, t: 520 },
  { d: 6, x: 38, y: 37, t: 140 },
  { d: 8, x: 21, y: 48, t: 700 },
  { d: 4, x: 46, y: 56, t: 380 },
  { d: 11, x: 11, y: 64, t: 900 },
  { d: 6, x: 31, y: 74, t: 180 },
  { d: 9, x: 18, y: 85, t: 600 },
  { d: 5, x: 41, y: 94, t: 320 },
]

/* El CSS va en una constante para que el JSX de arriba se lea de corrido.
   Todas las clases llevan el prefijo `cl-` para no chocar con nada. */
const CSS_LIMPIEZA = `
.cl-raiz {
  --cl-ms: 2600ms;              /* duración del ciclo */
  --cl-espera: 150ms;           /* retardo anti-parpadeo */
  --cl-curva: cubic-bezier(.4,.02,.56,1);
  --cl-vidrio: 248 250 252;     /* color del vaho (claro) */
  --cl-hueso: 229 231 235;      /* bloques del esqueleto */
  --cl-tarjeta: 255 255 255;
  --cl-texto: 27 94 32;         /* brand-green-dark */
  --cl-pastilla: 255 255 255;
}
.dark .cl-raiz {
  /* En oscuro el vaho tiene que ser MÁS claro que el fondo, si no el barrido
     no se distingue. */
  --cl-vidrio: 71 85 105;
  --cl-hueso: 55 65 81;
  --cl-tarjeta: 24 31 46;
  --cl-texto: 209 250 229;
  --cl-pastilla: 24 31 46;
}

/* Nada se ve durante los primeros 150 ms: una carga corta no alcanza a
   dibujar nada y la navegación no parpadea. */
.cl-raiz > * {
  animation: cl-aparecer 220ms ease-out var(--cl-espera) both;
}
@keyframes cl-aparecer {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* ── Esqueleto ── */
.cl-bloque {
  background: rgb(var(--cl-hueso) / 0.85);
}
.cl-tarjeta {
  background: rgb(var(--cl-tarjeta));
  border: 1px solid rgb(var(--cl-hueso) / 0.6);
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.04);
}

/* ── Vidrio empañado ──
   La máscara es un degradado del doble de ancho: a la izquierda transparente
   (ya limpio) y a la derecha opaco (todavía con vaho). Al desplazarla de
   100% a 0% el borde cruza la pantalla de izquierda a derecha. */
.cl-vaho {
  background:
    radial-gradient(130% 90% at 18% 12%, rgb(var(--cl-vidrio) / 0.34) 0%, rgb(var(--cl-vidrio) / 0.6) 55%, rgb(var(--cl-vidrio) / 0.7) 100%);
  backdrop-filter: blur(6px) saturate(0.85);
  -webkit-backdrop-filter: blur(6px) saturate(0.85);
  -webkit-mask-image: linear-gradient(90deg,
      rgb(0 0 0 / 0) 0%, rgb(0 0 0 / 0) 47.5%,
      rgb(0 0 0 / 0.45) 49.4%, rgb(0 0 0 / 1) 51%, rgb(0 0 0 / 1) 100%);
  mask-image: linear-gradient(90deg,
      rgb(0 0 0 / 0) 0%, rgb(0 0 0 / 0) 47.5%,
      rgb(0 0 0 / 0.45) 49.4%, rgb(0 0 0 / 1) 51%, rgb(0 0 0 / 1) 100%);
  -webkit-mask-size: 200% 100%;
  mask-size: 200% 100%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: 100% 0;
  mask-position: 100% 0;
  animation: cl-borrar var(--cl-ms) var(--cl-curva) var(--cl-espera) infinite;
}
@keyframes cl-borrar {
  0%   { -webkit-mask-position: 100% 0; mask-position: 100% 0; }
  70%  { -webkit-mask-position: 0% 0;   mask-position: 0% 0; }
  86%  { -webkit-mask-position: 0% 0;   mask-position: 0% 0; }
  94%  { -webkit-mask-position: 100% 0; mask-position: 100% 0; }
  100% { -webkit-mask-position: 100% 0; mask-position: 100% 0; }
}

/* La capa entera se apaga mientras la máscara vuelve a su sitio. */
.cl-capa {
  animation:
    cl-aparecer 220ms ease-out var(--cl-espera) both,
    cl-ciclo var(--cl-ms) linear var(--cl-espera) infinite;
}
@keyframes cl-ciclo {
  0%, 84% { opacity: 1; }
  91%     { opacity: 0; }
  96%     { opacity: 0; }
  100%    { opacity: 1; }
}

/* ── Escobilla ──
   El carro recorre todo el ancho; la escobilla queda centrada en el borde de
   la máscara. Comparte duración, retardo y curva con \`cl-borrar\`. */
.cl-carro {
  animation: cl-barrer var(--cl-ms) var(--cl-curva) var(--cl-espera) infinite;
  will-change: transform;
}
@keyframes cl-barrer {
  0%        { transform: translateX(0); }
  70%, 100% { transform: translateX(100%); }
}
.cl-escobilla {
  width: 1px;
  animation: cl-asomar var(--cl-ms) linear var(--cl-espera) infinite;
}
@keyframes cl-asomar {
  0%       { opacity: 0; }
  5%, 66%  { opacity: 1; }
  76%, 100%{ opacity: 0; }
}

/* Caucho: la lámina que raspa el vidrio. */
.cl-caucho {
  position: absolute;
  inset-block: 0;
  left: -3px;
  width: 6px;
  border-radius: 3px;
  background: linear-gradient(90deg, #64748b 0%, #334155 28%, #0f172a 60%, #1e293b 100%);
  box-shadow: -1px 0 0 rgb(255 255 255 / 0.55), 0 0 12px rgb(15 23 42 / 0.3);
}
/* Canal metálico, justo detrás del caucho. */
.cl-canal {
  position: absolute;
  inset-block: 3px;
  left: 3px;
  width: 13px;
  border-radius: 0 4px 4px 0;
  background: linear-gradient(90deg, #f1f5f9 0%, #cbd5e1 35%, #94a3b8 70%, #475569 100%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.85), 1px 0 0 rgb(71 85 105 / 0.5), 0 2px 8px rgb(15 23 42 / 0.22);
}
.cl-mango {
  position: absolute;
  top: 50%;
  left: 14px;
  transform: translateY(-50%);
  filter: drop-shadow(0 3px 6px rgb(15 23 42 / 0.28));
}
/* Sobre fondo oscuro el mango se perdía: hay que subirle el brillo. */
.dark .cl-mango {
  filter: brightness(1.75) drop-shadow(0 0 4px rgb(226 232 240 / 0.3));
}

/* Agua con espuma: por delante del caucho, que es lo que todavía está sucio. */
.cl-espuma {
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 96px;
  background: linear-gradient(90deg,
    rgb(255 255 255 / 0.85) 0%,
    rgb(255 255 255 / 0.45) 32%,
    rgb(255 255 255 / 0.14) 66%,
    rgb(255 255 255 / 0) 100%);
}
.dark .cl-espuma {
  background: linear-gradient(90deg,
    rgb(226 232 240 / 0.3) 0%,
    rgb(226 232 240 / 0.16) 38%,
    rgb(226 232 240 / 0) 100%);
}
/* Rastro húmedo detrás del caucho: ya limpio, pero brillante. */
.cl-brillo {
  position: absolute;
  inset-block: 0;
  right: 2px;
  width: 120px;
  background: linear-gradient(270deg, rgb(255 255 255 / 0.5) 0%, rgb(255 255 255 / 0.12) 45%, rgb(255 255 255 / 0) 100%);
  filter: blur(2px);
}
.dark .cl-brillo,
.dark .cl-espuma {
  mix-blend-mode: screen;
  opacity: 0.55;
}

/* Burbujas de espuma, por delante del caucho. */
.cl-gota {
  position: absolute;
  border-radius: 999px;
  background:
    radial-gradient(circle at 34% 28%, rgb(255 255 255 / 0.95) 0%, rgb(236 253 245 / 0.5) 48%, rgb(165 214 167 / 0.12) 100%);
  border: 1px solid rgb(129 170 131 / 0.6);
  box-shadow: inset -1px -1px 2px rgb(129 170 131 / 0.25), 0 1px 2px rgb(15 23 42 / 0.08);
  animation: cl-flotar 1600ms ease-in-out infinite;
}
.dark .cl-gota {
  background: radial-gradient(circle at 34% 28%, rgb(255 255 255 / 0.55) 0%, rgb(165 214 167 / 0.18) 55%, rgb(165 214 167 / 0) 100%);
  border-color: rgb(165 214 167 / 0.5);
  box-shadow: none;
}
@keyframes cl-flotar {
  0%, 100% { transform: translate(0, 0) scale(1);        opacity: 0.9; }
  50%      { transform: translate(6px, -5px) scale(1.18); opacity: 0.35; }
}

/* ── Aviso ── */
.cl-aviso {
  animation: cl-aparecer 260ms ease-out calc(var(--cl-espera) + 60ms) both;
}
.cl-pastilla {
  color: rgb(var(--cl-texto));
  background: rgb(var(--cl-pastilla) / 0.86);
  border: 1px solid rgb(var(--cl-hueso) / 0.7);
  box-shadow: 0 6px 20px rgb(15 23 42 / 0.1);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.cl-puntos span {
  animation: cl-latir 1400ms ease-in-out infinite;
  opacity: 0.25;
}
.cl-puntos span:nth-child(2) { animation-delay: 200ms; }
.cl-puntos span:nth-child(3) { animation-delay: 400ms; }
@keyframes cl-latir {
  0%, 100% { opacity: 0.25; }
  40%      { opacity: 1; }
}

/* Tres burbujas de espuma junto al texto. */
.cl-burbujas {
  position: relative;
  display: block;
  width: 18px;
  height: 18px;
  flex: none;
}
.cl-burbujas span {
  position: absolute;
  border-radius: 999px;
  border: 1.5px solid currentColor;
  opacity: 0.55;
  animation: cl-subir 2000ms ease-in-out infinite;
}
.cl-burbujas span:nth-child(1) { width: 9px;  height: 9px;  left: 0;   bottom: 0; }
.cl-burbujas span:nth-child(2) { width: 6px;  height: 6px;  left: 8px; bottom: 4px; animation-delay: 320ms; }
.cl-burbujas span:nth-child(3) { width: 4px;  height: 4px;  left: 3px; bottom: 9px; animation-delay: 640ms; }
@keyframes cl-subir {
  0%, 100% { transform: translateY(0) scale(1);    opacity: 0.55; }
  50%      { transform: translateY(-4px) scale(1.1); opacity: 0.95; }
}

/* ── Movimiento reducido ──
   Sin barrido y sin latidos: el vaho se queda quieto y medio transparente, y
   el aviso explica qué está pasando. */
@media (prefers-reduced-motion: reduce) {
  .cl-raiz > *,
  .cl-capa,
  .cl-vaho,
  .cl-carro,
  .cl-escobilla,
  .cl-gota,
  .cl-puntos span,
  .cl-burbujas span,
  .cl-aviso {
    animation: none !important;
  }
  .cl-capa { opacity: 1; }
  .cl-vaho {
    -webkit-mask-image: none;
    mask-image: none;
    opacity: 0.6;
  }
  .cl-carro { transform: translateX(100%); }
  .cl-escobilla { opacity: 0; }
  .cl-puntos span, .cl-burbujas span { opacity: 1; }
}
`
