# Fotos del sitio — dónde va cada una

**Estado: las 13 fotos ya están colocadas y en producción.**

Los originales (PNG de 2752x1536, entre 5 y 10 MB cada uno) se conservan en
`fotos-originales/FotosPagina/`, fuera del control de versiones y fuera de
`public/` para que no se publiquen. Las versiones del sitio se generaron con
sharp: JPG progresivo, calidad 80, mozjpeg; 2400 px de ancho para las portadas,
1800 px para las secundarias y 1200 px para las tarjetas. El total pasó de
**108 MB a 2,1 MB**.

Si se reemplaza alguna, basta con dejar el JPG con el mismo nombre en la misma
ruta. Mientras un archivo no exista se ve un degradado de marca de respaldo
(`components/ui/FotoFondo.tsx`) y la página no se rompe.

## Mapa de colocación

Numeración según el orden en que se entregaron las 13 fotos.

| # | Foto | Archivo destino | Dónde se ve |
|---|---|---|---|
| 11 | Edificio de concreto al atardecer con conserje en la entrada | `images/hero-bg.jpg` | Portada del sitio (`/`) |
| 2 | Mesero de guantes blancos sirviendo a una familia | `images/servicios-hogar/hero.jpg` | Portada de Servicios del Hogar |
| 12 | Trapeando el piso de una sala luminosa | `images/servicios-hogar/aseo-regular.jpg` | Tarjeta "Aseo Regular" |
| 10 | Guantes azules limpiando la puerta grasosa del horno | `images/servicios-hogar/limpieza-profunda.jpg` | Tarjeta "Limpieza Profunda" |
| 9 | Apartamento en obra gris siendo limpiado | `images/servicios-hogar/post-obra.jpg` | Tarjeta "Post-Obra" |
| 8 | Sirviendo vino en comedor con velas y flores | `images/servicios-hogar/eventos.jpg` | Tarjeta "Atención en Eventos" |
| 3 | Emplatando pollo, arroz y ensalada | `images/servicios-hogar/cocina.jpg` | Tarjeta "Servicio de Cocina" |
| 7 | Regando plantas en la terraza con vista a la ciudad | `images/servicios-hogar/jardin.jpg` | Tarjeta "Jardín y Exteriores" |
| 6 | Foto grupal contra el muro de ladrillo | `images/nosotros/equipo.jpg` | Portada de `/nosotros` |
| 5 | Inventario en la bodega de insumos | `images/servicios/operacion.jpg` | Portada de `/servicios` |
| 4 | Capacitación en sala con tablero de seguridad | `images/seguridad-salud/capacitacion.jpg` | Portada de `/seguridad-salud` |
| 13 | Logo sobre fondo azul | `images/og-image.jpg` | Miniatura al compartir el enlace |
| 1 | Restregando la plancha de acero con vapor | `images/servicios-hogar/limpieza-profunda-2.jpg` | Sin usar — reserva, ver abajo |

### Rutas completas

```
apps/web/public/images/hero-bg.jpg
apps/web/public/images/og-image.jpg
apps/web/public/images/nosotros/equipo.jpg
apps/web/public/images/servicios/operacion.jpg
apps/web/public/images/seguridad-salud/capacitacion.jpg
apps/web/public/images/servicios-hogar/hero.jpg
apps/web/public/images/servicios-hogar/aseo-regular.jpg
apps/web/public/images/servicios-hogar/limpieza-profunda.jpg
apps/web/public/images/servicios-hogar/post-obra.jpg
apps/web/public/images/servicios-hogar/eventos.jpg
apps/web/public/images/servicios-hogar/cocina.jpg
apps/web/public/images/servicios-hogar/jardin.jpg
```

Formato **JPG**, calidad 80, cada archivo por debajo de 500 KB. Las seis tarjetas
de servicio se recortan a 16:9; las portadas usan todo el ancho con un velo
oscuro encima para que el texto blanco tenga contraste.

## La foto 1 (plancha de acero)

No se asignó a ninguna ranura: lee como cocina industrial y las seis tarjetas de
servicio ya quedaron cubiertas con imágenes de contexto doméstico. Dos destinos
razonables:

- Subirla a la **galería** desde `/gestion-hogar` → pestaña *Galería*, donde
  alimenta el carrusel de la landing y de la tienda.
- Guardarla como `images/servicios-hogar/limpieza-profunda-2.jpg` para rotarla
  con la #10 más adelante.

## Advertencia sobre el texto dentro de las imágenes

Tres fotos tienen **texto ilegible o deformado** cuando se ven en grande:

- **#4 (capacitación):** lo escrito en el tablero no es español real
  ("Ensemo el sesemo se complonentn…"), y es el punto focal de la foto.
- **#6 (foto grupal):** el logo bordado aparece deformado y con distintas
  grafías entre uniformes ("conserjas", "consorjes").
- **#5 (bodega):** las etiquetas de las cajas y los rótulos son ilegibles.

En las tres el velo oscuro de la portada atenúa bastante el problema, y por eso
quedaron en portadas y no en tarjetas, donde se verían nítidas y de cerca. Aun
así conviene saberlo: quien se acerque a mirar el tablero va a notar que no dice
nada. Si aparecen fotos reales de una capacitación o de la bodega, esas tres son
las primeras que vale la pena reemplazar.

## Estas no son archivos: se cargan desde la administración

- **Galería y videos** → `/gestion-hogar`, pestaña *Galería*.
- **Foto de cada conserje** → `/gestion-hogar`, pestaña *Concerjes*.
  Retrato cuadrado (600×600), fondo neutro, uniforme. Es lo que más sube la
  conversión en la tienda.
