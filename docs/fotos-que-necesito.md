# Fotos que hacen falta para el sitio

Estado actual: **`public/` sólo tiene los tres logos**. Ninguna foto existe todavía
—incluida `/images/hero-bg.jpg`, que la portada ya pedía desde antes y devuelve 404.

El sitio está construido para no romperse por eso: donde va una foto hay un
degradado de marca de respaldo (`components/ui/FotoFondo.tsx`). Se ve digno sin
fotos, pero con fotos reales pasa de "plantilla" a "empresa de verdad". **No hay
que tocar código para agregarlas: basta con dejar el archivo en la ruta exacta.**

## Cómo entregarlas

- Formato **JPG** (el sitio las sirve como AVIF/WebP automáticamente).
- **Horizontales**, nunca verticales, salvo donde se indique.
- Peso: exporta a calidad 80. Cada archivo por debajo de **500 KB**.
- Nombre de archivo **idéntico** al de la lista (minúsculas, sin tildes ni espacios).
- Con personas: que sea gente real del equipo, con uniforme, y **con autorización
  de uso de imagen firmada**. Sin eso, mejor fotos de espacios sin rostros.

---

## 1. Prioridad alta — las 8 que cambian toda la percepción

Van en `apps/web/public/images/`.

| # | Archivo | Tamaño mínimo | Qué debe mostrar |
|---|---|---|---|
| 1 | `images/hero-bg.jpg` | 2400×1400 | **Portada del sitio.** Fachada de edificio residencial o conjunto, o conserje en la recepción/portería. Con espacio "vacío" al centro: encima va el titular. |
| 2 | `images/servicios-hogar/hero.jpg` | 2400×1400 | **Portada de Servicios del Hogar.** Sala o cocina de apartamento recién arreglada, luz natural, ordenada. Es la foto más importante de la página que estás mostrando. |
| 3 | `images/servicios-hogar/aseo-regular.jpg` | 1200×675 | Persona con uniforme trapeando o aspirando una sala. Ambiente doméstico, no oficina. |
| 4 | `images/servicios-hogar/limpieza-profunda.jpg` | 1200×675 | Detalle: limpieza de vidrios, interior de horno o nevera. Que se note el "antes/después". |
| 5 | `images/servicios-hogar/post-obra.jpg` | 1200×675 | Apartamento en obra gris o recién remodelado, con polvo de construcción o ya limpio. |
| 6 | `images/servicios-hogar/eventos.jpg` | 1200×675 | Mesa servida, copas, personal de uniforme formal atendiendo. Reunión en casa, no salón de eventos. |
| 7 | `images/servicios-hogar/cocina.jpg` | 1200×675 | Manos preparando o emplatando comida en una cocina de hogar. |
| 8 | `images/servicios-hogar/jardin.jpg` | 1200×675 | Terraza, balcón o antejardín con plantas, alguien podando o regando. |

> Las 6 tarjetas de servicio (3–8) se recortan a **16:9**. Deja aire arriba y abajo:
> el nombre del servicio se superpone en la parte inferior sobre un degradado oscuro.

## 2. Prioridad media — refuerzan confianza

| # | Archivo | Tamaño | Qué debe mostrar |
|---|---|---|---|
| 9 | `images/nosotros/equipo.jpg` | 1600×900 | Foto grupal del equipo. Es la que convence de que la empresa existe. |
| 10 | `images/nosotros/operacion.jpg` | 1600×900 | Bodega, alistamiento o logística en funcionamiento. |
| 11 | `images/seguridad-salud/capacitacion.jpg` | 1600×900 | Capacitación, charla de seguridad o entrega de dotación. |
| 12 | `images/og-image.jpg` | 1200×630 (exacto) | **Miniatura al compartir el enlace** en WhatsApp, LinkedIn o Facebook. Logo sobre foto o sobre verde de marca. Hoy también da 404: al compartir el sitio no aparece imagen. |

*(La 12 ya está referenciada en el código y sólo falta el archivo. Las 9–11
todavía no están conectadas; las conecto en cuanto lleguen, es un cambio de una
línea por página.)*

## 3. Estas NO son archivos: se cargan desde la administración

No me las pases a mí, las sube el personal y quedan en la base de datos:

- **Galería y videos de Servicios del Hogar** → `/gestion-hogar`, pestaña **Galería**.
  Fotos *y* videos de trabajos reales. Alimenta el carrusel de la landing y la tienda.
  Recomendado: 8–12 piezas para arrancar.
- **Foto de cada conserje** → `/gestion-hogar`, pestaña **Concerjes**.
  Retrato **cuadrado** (600×600), fondo neutro, uniforme, de la cintura hacia arriba.
  Es lo que más sube la conversión en la tienda: el cliente quiere ver a quién
  va a dejar entrar a su casa.

## 4. Lo que conviene evitar

- Fotos de banco de imágenes con gente evidentemente extranjera: se nota y resta
  credibilidad justo donde se necesita confianza.
- Capturas con marca de agua.
- Fotos verticales de celular para los espacios horizontales: se recortan mal.
- Collages o imágenes con texto encima: el texto lo pone el sitio.

## Dónde ponerlas

```
apps/web/public/images/hero-bg.jpg
apps/web/public/images/servicios-hogar/hero.jpg
apps/web/public/images/servicios-hogar/aseo-regular.jpg
...
```

Crear la carpeta `images/` (y `servicios-hogar/` dentro) si no existe. Con eso
basta: el código ya las está buscando en esas rutas exactas.
