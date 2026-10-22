// Núcleo de ejecución de una visita de ronda. SIN React, sin Next, sin
// Capacitor y sin Supabase: lo comparten la PWA de `apps/inventario` (React 19)
// y el módulo de `apps/movil` (React 18), que es la decisión §1.1 del
// complemento 2 — lo que las dos apps tienen que hacer igual no puede vivir en
// una de las dos.
//
// Qué hay aquí y qué no:
//   · `codigo`   — forma del token del QR y del código manual (la firma HMAC se
//                  verifica en el servidor, que es el que tiene la llave);
//   · `pasos`    — contrato de `config` de cada tipo de paso y validación de lo
//                  que se contesta, espejo de los CHECK de la base;
//   · `geocerca` — distancia contra el radio, con la precisión incluida;
//   · `reloj`    — hora del dispositivo, desfase y demora de sincronización;
//   · `maquina`  — abrir, responder, adjuntar, firmar, validar y cerrar;
//   · `intents`  — payload de cada RPC y el ORDEN en que la cola los manda.
//
// La cámara, el mapa, los formularios y la cola son de cada app.
export * from './codigo'
export * from './pasos'
export * from './geocerca'
export * from './reloj'
export * from './maquina'
export * from './intents'
