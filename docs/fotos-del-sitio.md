# Fotos del sitio — dónde va cada una

**Estado: 20 fotos colocadas, más los iconos de aplicación. Ningún bloque del
sitio queda sin imagen.**

Los originales (PNG grandes, entre 2 y 10 MB cada uno) se conservan en
`fotos-originales/`, fuera del control de versiones y fuera de `public/` para que
no se publiquen. Las versiones del sitio se generaron con sharp: JPG progresivo,
calidad 80, mozjpeg; 2400 px de ancho para las portadas, 1800 px para las
secundarias y 1200 px para las tarjetas.

Si se reemplaza alguna, basta con dejar el JPG con el mismo nombre en la misma
ruta. Mientras un archivo no exista se ve un degradado de marca de respaldo
(`components/ui/FotoFondo.tsx`) y la página no se rompe.

`tests/web/fotos.test.ts` recorre todo el código del sitio y falla si alguna
ruta `/images/…` o `/logo…` escrita en un componente no tiene archivo detrás, o
si falta alguno de los iconos de aplicación.

## Mapa de colocación

### Tanda 1 — 13 fotos (agosto 2026)

| Foto | Archivo | Dónde se ve |
|---|---|---|
| Edificio de concreto al atardecer con conserje en la entrada | `images/hero-bg.jpg` | Portada del sitio (`/`) |
| Mesero de guantes blancos sirviendo a una familia | `images/servicios-hogar/hero.jpg` | Portada de Servicios del Hogar · hero de la tienda |
| Trapeando el piso de una sala luminosa | `images/servicios-hogar/aseo-regular.jpg` | Tarjeta "Aseo Regular" · tarjeta "Aseo y Limpieza" |
| Guantes azules limpiando la puerta grasosa del horno | `images/servicios-hogar/limpieza-profunda.jpg` | Tarjeta "Limpieza Profunda" · banda de Hogar en la portada |
| Apartamento en obra gris siendo limpiado | `images/servicios-hogar/post-obra.jpg` | Tarjeta "Post-Obra" · tarjeta "Servicios Especiales" |
| Sirviendo vino en comedor con velas y flores | `images/servicios-hogar/eventos.jpg` | Tarjeta "Atención en Eventos" |
| Emplatando pollo, arroz y ensalada | `images/servicios-hogar/cocina.jpg` | Tarjeta "Servicio de Cocina" |
| Regando plantas en la terraza con vista a la ciudad | `images/servicios-hogar/jardin.jpg` | Tarjeta "Jardín y Exteriores" · tarjeta "Jardinería" |
| Foto grupal contra el muro de ladrillo | `images/nosotros/equipo.jpg` | Portada de `/nosotros` · sección Nosotros de la portada |
| Inventario en la bodega de insumos | `images/servicios/operacion.jpg` | Portada de `/servicios` · fondo de la banda de cifras |
| Capacitación en sala con tablero de seguridad | `images/seguridad-salud/capacitacion.jpg` | Portada de `/seguridad-salud` |
| Restregando la plancha de acero con vapor | `images/servicios/cafeteria.jpg` | Tarjeta "Cafetería" |
| Logo sobre fondo azul | `images/og-image.jpg` | Miniatura al compartir el enlace (OG y Twitter) |

### Tanda 2 — 7 fotos (28 de agosto de 2026)

Cubren los bloques que habían quedado sin imagen propia o con una foto prestada
que no correspondía al tema.

| Foto | Archivo | Dónde se ve | Qué reemplaza |
|---|---|---|---|
| Operarios con arnés lavando una fachada de vidrio | `images/servicios/alturas.jpg` | Tarjeta "Limpieza en Alturas" y su bloque en `/servicios` | Antes mostraba la foto del salón de capacitación |
| Conserje en la recepción de un edificio | `images/servicios/conserjeria.jpg` | Tarjeta "Conserjería" y su bloque en `/servicios` | Antes repetía la foto de la portada |
| Asesora con diadema atendiendo en oficina | `images/contacto/asesora.jpg` | Portada de `/contacto` | Antes era un degradado verde plano |
| Dos colaboradores ajustándose los EPP | `images/seguridad-salud/epp.jpg` | Banner de `/seguridad-salud` | Antes mostraba una limpieza post-obra |
| Bienvenida a un aspirante en recepción | `images/nosotros/trabaja-con-nosotros.jpg` | Primer paso de `/registro-vacantes` | El registro no tenía ninguna imagen |
| Equipo de seis caminando por un lobby de vidrio | `images/cta-equipo.jpg` | Bloque de cierre (CTA) de `/`, `/servicios`, `/nosotros`, `/seguridad-salud` | Antes era un degradado verde plano |
| Lobby desenfocado con plantas | `images/ingresar-fondo.jpg` | `/ingresar` y `/portal/ingresar` | Antes eran fondos de color plano |

### Iconos de aplicación

El sitio no tenía favicon: la pestaña del navegador mostraba el icono genérico.
Se generaron desde el isotipo de `public/logo.png` (la gota, sin el texto, que a
16 px no se lee) sobre fondo blanco.

| Archivo | Tamaño | Para qué |
|---|---|---|
| `app/icon.png` | 512×512 | Favicon de la pestaña |
| `app/apple-icon.png` | 180×180 | Icono al guardar en la pantalla de inicio en iOS |
| `app/favicon.ico` | 32×32 | Para quien pide `/favicon.ico` directamente |

Next.js los detecta por convención de nombre y emite los `<link>` solo.

## Lo que sigue sin foto real

Dos cosas quedan pendientes y no se resuelven con archivos en `public/`:

- **Retratos de los concerjes** (`/servicios-hogar/tienda`). Hoy los cuatro
  concerjes de la base muestran un avatar con la inicial sobre un degradado
  verde. Necesitan retrato cuadrado (600×600), fondo neutro, uniforme, cargado
  desde `/gestion-hogar` → pestaña *Concerjes*. Es lo que más sube la conversión
  en la tienda, y no se debe rellenar con fotos de otras personas.
- **Logos de clientes** (`ClientsSection`). Se muestran solo los sectores
  atendidos hasta que estén las autorizaciones de uso de marca. Es una decisión,
  no un olvido.

La galería de `/servicios-hogar` y el carrusel de la tienda sí tienen contenido:
seis fotos cargadas en el bucket `servicios-hogar/galeria` de Supabase, una por
tipo de servicio.

## Advertencia sobre el texto dentro de las imágenes

Tres fotos de la primera tanda tienen **texto ilegible o deformado** cuando se
ven en grande:

- **Capacitación:** lo escrito en el tablero no es español real
  ("Ensemo el sesemo se complonentn…"), y es el punto focal de la foto.
- **Foto grupal:** el logo bordado aparece deformado y con distintas grafías
  entre uniformes ("conserjas", "consorjes").
- **Bodega:** las etiquetas de las cajas y los rótulos son ilegibles.

En las tres el velo oscuro de la portada atenúa bastante el problema, y por eso
quedaron en portadas y no en tarjetas, donde se verían nítidas y de cerca. Si
aparecen fotos reales de una capacitación o de la bodega, esas tres son las
primeras que vale la pena reemplazar.

## Estas no son archivos: se cargan desde la administración

- **Galería y videos** → `/gestion-hogar`, pestaña *Galería*.
- **Foto de cada concerje** → `/gestion-hogar`, pestaña *Concerjes*.
