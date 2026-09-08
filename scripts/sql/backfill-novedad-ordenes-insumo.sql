-- Backfill: lleva la observacion que se escribio al crear la orden a la
-- trazabilidad, para que las ordenes viejas muestren la novedad igual que las
-- nuevas (ver crearOrdenInsumo en apps/inventario/.../ordenes-insumo/actions.ts).
-- Idempotente: no vuelve a anexar si el evento ya trae "Novedad:".
begin;

-- 1) Ordenes que ya tienen evento de CREACION: se anexa la novedad al mensaje.
update orden_insumo_eventos e
set mensaje = coalesce(nullif(btrim(e.mensaje), ''), 'Orden creada.')
              || chr(10) || 'Novedad: ' || btrim(o.observacion)
from ordenes_insumo o
where e.orden_id = o.id
  and e.tipo = 'CREACION'
  and o.observacion is not null
  and btrim(o.observacion) <> ''
  and coalesce(e.mensaje, '') not like '%Novedad:%';

-- 2) Ordenes sin evento de CREACION (cargas masivas): se crea un COMENTARIO
--    fechado en la creacion de la orden.
insert into orden_insumo_eventos (orden_id, tipo, mensaje, usuario_id, usuario_nombre, created_at)
select o.id, 'COMENTARIO', 'Novedad: ' || btrim(o.observacion), o.creado_por, u.nombre, o.created_at
from ordenes_insumo o
left join usuarios u on u.id = o.creado_por
where o.observacion is not null
  and btrim(o.observacion) <> ''
  and not exists (
    select 1 from orden_insumo_eventos e where e.orden_id = o.id and e.tipo = 'CREACION'
  )
  and not exists (
    select 1 from orden_insumo_eventos e
    where e.orden_id = o.id and coalesce(e.mensaje, '') like '%Novedad:%'
  );

commit;
