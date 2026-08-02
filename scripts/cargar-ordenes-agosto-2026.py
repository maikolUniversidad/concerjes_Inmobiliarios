"""
Carga masiva de órdenes de insumo - Agosto 2026
Fuente: Excel de Claudia FP (26 sedes) y Aida FP (2 sedes)

Qué hace este script:
  1. Crea las sedes que no existen (CASA BLANCA, MARIA CLAUDIA MURIEL)
  2. Crea una orden de insumo (estado=APROBADA) por cada sede con items > 0
  3. Agrega los ítems de cada orden
  4. Hace upsert en sede_productos (parametrización base)
  5. Asigna el coordinador responsable a cada orden

Uso:
  python scripts/cargar-ordenes-agosto-2026.py [--dry-run]

Flags:
  --dry-run   Muestra qué se haría sin escribir en BD
"""

import sys
import uuid
from datetime import date

import openpyxl
import psycopg2
import psycopg2.extras

# ── Configuración ─────────────────────────────────────────────────────────────

DB_URL = "postgresql://postgres.esehmwmtevwrqxvbzmev:S9qxOMoOZCepMyke@aws-1-us-west-2.pooler.supabase.com:5432/postgres"

EXCEL_CLAUDIA = r"C:\Users\maiko\Downloads\052026 Claudia FP - Solicitud de pedidos periodica  AGOSTO.xlsm"
EXCEL_AIDA    = r"C:\Users\maiko\Downloads\042026 Aida FP - Solicitud de pedidos periodica V2 AGOSTO.xlsm"

PERIODO = date(2026, 8, 1)  # Mes agosto 2026

BODEGA_ID = "b28f9d83-c3c2-485f-a538-c7a9f970cff4"  # Bodega Central

# Coordinadores encontrados en el sistema
USER_AIDA   = "143a20bd-5d02-4d25-9e0a-cb4a01079fc8"  # Aida pacanchique
USER_ADMIN  = "2db42abb-5f98-4afd-a2b6-18b1429200cf"   # admin (fallback Claudia)

# Grupo para sedes nuevas (AD = Administraciones/Copropiedades, más genérico)
GRUPO_AD = "5b04ed2e-740c-490b-a95c-13b8f1e48f8e"

DRY_RUN = "--dry-run" in sys.argv

# ── Helpers ───────────────────────────────────────────────────────────────────

def norm(v):
    """Normaliza string para comparación."""
    if v is None:
        return ""
    return str(v).strip().upper().replace("  ", " ")

def cell_num(v):
    """Extrae número de celda openpyxl."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        n = float(v)
        return int(n) if n == int(n) else n
    s = str(v).strip()
    try:
        f = float(s)
        return int(f) if f == int(f) else f
    except (ValueError, TypeError):
        return None

def cell_str(v):
    if v is None:
        return None
    s = str(v).strip()
    return s if s else None

# ── Parser Excel ──────────────────────────────────────────────────────────────

def parse_excel(path):
    """
    Lee la hoja 'Mensual' y devuelve:
      - clientes: lista de nombres de sedes (columnas)
      - rows: lista de dicts con {item, nombre, presentacion, complemento, cat, cantidades: {sede: qty}}
    """
    wb = openpyxl.load_workbook(path, data_only=True, read_only=False)
    ws = wb["Mensual"]

    rows_raw = list(ws.iter_rows(values_only=True))

    # Fila 6 (índice 5) = encabezado de columnas
    header_row = rows_raw[5]  # FAVORITOS | ITEM | NOMBRE ESTANDAR | PRESENTACION | COMPLEMENTO | CAT. | [sedes...] | TOTAL

    # Identificar índices de columnas fijas
    col_item  = 1   # B
    col_nom   = 2   # C
    col_pres  = 3   # D
    col_comp  = 4   # E
    col_cat   = 5   # F
    col_start = 6   # G: primera sede
    # Última columna: TOTAL (la ignoramos)
    col_end   = len(header_row) - 1  # excluye TOTAL

    clientes = []
    for i in range(col_start, col_end):
        name = cell_str(header_row[i])
        if name:
            clientes.append((i, norm(name)))

    items = []
    for raw in rows_raw[6:]:  # desde fila 7
        item_num = cell_num(raw[col_item])
        nombre   = cell_str(raw[col_nom])
        if item_num is None or nombre is None:
            continue
        presentacion = cell_str(raw[col_pres])
        complemento  = cell_str(raw[col_comp])
        cat          = cell_str(raw[col_cat])

        cantidades = {}
        for (col_idx, sede_name) in clientes:
            qty = cell_num(raw[col_idx])
            if qty and qty > 0:
                cantidades[sede_name] = qty

        items.append({
            "item":         int(item_num),
            "nombre":       norm(nombre),
            "presentacion": norm(presentacion) if presentacion else "",
            "complemento":  complemento,
            "cat":          norm(cat) if cat else "C",
            "cantidades":   cantidades,
        })

    wb.close()
    return clientes, items


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print(f"{'[DRY RUN] ' if DRY_RUN else ''}Iniciando carga órdenes agosto 2026...\n")

    # ── 1. Parsear ambos Excel ────────────────────────────────────────────────
    print("Parseando Excel Claudia FP...")
    clientes_c, items_c = parse_excel(EXCEL_CLAUDIA)
    print(f"  → {len(clientes_c)} sedes, {len(items_c)} productos en catálogo")

    print("Parseando Excel Aida FP...")
    clientes_a, items_a = parse_excel(EXCEL_AIDA)
    print(f"  → {len(clientes_a)} sedes, {len(items_a)} productos en catálogo\n")

    # ── 2. Conectar a BD ──────────────────────────────────────────────────────
    conn = psycopg2.connect(DB_URL, sslmode="require")
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    # Cargar sedes existentes
    cur.execute("SELECT id, nombre FROM sedes ORDER BY nombre")
    sedes_db = {}
    for row in cur.fetchall():
        sedes_db[norm(row["nombre"])] = str(row["id"])

    # Cargar productos existentes
    cur.execute("SELECT id, nombre_estandar, presentacion FROM productos WHERE activo = true")
    productos_db = {}
    for row in cur.fetchall():
        key = (norm(row["nombre_estandar"]), norm(row["presentacion"] or ""))
        productos_db[key] = str(row["id"])

    # Verificar usuario Claudia en personas
    cur.execute("SELECT id, nombres, apellidos, usuario_id FROM personas WHERE nombres ILIKE '%claudia%' ORDER BY nombres")
    claudia_persona = cur.fetchall()

    # Siguiente número de orden
    cur.execute("SELECT numero FROM ordenes_insumo WHERE numero LIKE 'OI-202608-%' ORDER BY numero DESC LIMIT 1")
    last = cur.fetchone()
    next_seq = (int(last["numero"].split("-")[2]) + 1) if last else 1

    print("=== DIAGNÓSTICO ===")
    if claudia_persona:
        for p in claudia_persona:
            uid = p["usuario_id"]
            print(f"  ✓ Claudia en personas: {p['nombres']} {p['apellidos']} → usuario_id={uid}")
        claudia_user = str(claudia_persona[0]["usuario_id"]) if claudia_persona[0]["usuario_id"] else None
    else:
        claudia_user = None
        print("  ⚠ No se encontró persona 'Claudia' en el sistema → se usará usuario admin como creador")

    claudia_user = claudia_user or USER_ADMIN

    print(f"  Coordinador Claudia FP → {claudia_user}")
    print(f"  Coordinador Aida FP   → {USER_AIDA}\n")

    # ── 3. Construir mapa de archivos: {nombre_sede → (items, user_coordinador)} ──
    datasets = []
    for (col_idx, sede_name) in clientes_c:
        datasets.append((sede_name, items_c, claudia_user))
    for (col_idx, sede_name) in clientes_a:
        datasets.append((sede_name, items_a, USER_AIDA))

    # ── 4. Determinar sedes a crear ───────────────────────────────────────────
    sedes_nuevas = []
    for (sede_name, _, _) in datasets:
        if sede_name not in sedes_db:
            sedes_nuevas.append(sede_name)

    if sedes_nuevas:
        print(f"=== SEDES A CREAR ({len(sedes_nuevas)}) ===")
        for s in sedes_nuevas:
            print(f"  + {s}")
        print()

    # ── 4b. Determinar productos a crear ──────────────────────────────────────
    # Solo los productos que tienen cantidad > 0 en al menos una sede
    needed_products = {}  # (nombre, presentacion) → cat
    for (sede_name, items_list, _) in datasets:
        for item in items_list:
            qty = item["cantidades"].get(sede_name)
            if qty and qty > 0:
                key = (item["nombre"], item["presentacion"])
                needed_products[key] = item["cat"]

    productos_a_crear = []
    for (key, cat) in needed_products.items():
        if key not in productos_db:
            nombre, pres = key
            if nombre:
                productos_a_crear.append((nombre, pres, cat))

    if productos_a_crear:
        print(f"=== PRODUCTOS A CREAR ({len(productos_a_crear)}) ===")
        for (n, p, c) in productos_a_crear:
            print(f"  + [{c}] {n} | {p}")
        print()

    # ── 5. Procesar por sede ──────────────────────────────────────────────────
    ordenes_resumen = []
    productos_no_encontrados = set()
    total_ordenes = 0
    total_items   = 0
    total_param   = 0

    # Pre-agrupar: una sede puede aparecer en varios archivos (raro, pero cubrimos)
    from collections import defaultdict
    sede_data = defaultdict(list)
    for (sede_name, items, coord_user) in datasets:
        sede_data[sede_name].append((items, coord_user))

    try:
        # ── 5a. Crear productos faltantes ─────────────────────────────────────
        for (nombre, pres, cat) in productos_a_crear:
            key = (nombre, pres)
            new_id = str(uuid.uuid4())
            # Inferir tipo_insumo
            tipo = "ASEO"
            if any(x in nombre for x in ["CAFE", "AZUCAR", "VASO", "POCILLO", "AROMATICA", "PANELA"]):
                tipo = "CAFETERIA"
            elif any(x in nombre for x in ["PAPEL", "CUADERN", "PLUMON", "LAPIZ", "BOLIGRAFO"]):
                tipo = "PAPELERIA"
            elif any(x in nombre for x in ["ESPATULA", "HARAGAN", "HARAGÁN", "CARRO", "ESCALERA", "BALDE"]):
                tipo = "OTROS"

            if not DRY_RUN:
                cur.execute(
                    """INSERT INTO productos
                         (id, nombre_estandar, presentacion, tipo_insumo, cat_rotacion, activo)
                       VALUES (%s, %s, %s, %s::tipo_insumo, %s::categoria_rotacion, true)
                       ON CONFLICT DO NOTHING""",
                    (new_id, nombre.title() if nombre == nombre.upper() else nombre,
                     pres.title() if pres == pres.upper() else pres,
                     tipo, cat if cat in ("A","B","C","D") else "C")
                )
            productos_db[key] = new_id
            print(f"  + Producto creado: [{cat}] {nombre[:50]} | {pres}")

        # ── 5b. Crear sedes faltantes ─────────────────────────────────────────
        for sede_name in sedes_nuevas:
            new_id = str(uuid.uuid4())
            if not DRY_RUN:
                cur.execute(
                    """INSERT INTO sedes (id, grupo_id, nombre, activo)
                       VALUES (%s, %s, %s, true)
                       ON CONFLICT DO NOTHING""",
                    (new_id, GRUPO_AD, sede_name.title())
                )
            sedes_db[sede_name] = new_id
            print(f"  + Sede creada: {sede_name.title()} → {new_id}")

        # ── 5b. Crear ordenes por sede ────────────────────────────────────────
        for (sede_name, entry_list) in sede_data.items():
            sede_id = sedes_db.get(sede_name)
            if not sede_id:
                print(f"  ✗ Sede no encontrada: {sede_name}")
                continue

            # Recopilar todos los items con cantidad > 0 para esta sede
            # (si la sede aparece en ambos archivos, fusionamos)
            items_sede = {}
            coord_user = None
            for (items_list, cu) in entry_list:
                coord_user = cu
                for item in items_list:
                    qty = item["cantidades"].get(sede_name)
                    if qty and qty > 0:
                        key = (item["nombre"], item["presentacion"])
                        prod_id = productos_db.get(key)
                        if prod_id is None:
                            productos_no_encontrados.add(f"{item['nombre']} | {item['presentacion']}")
                        else:
                            items_sede[prod_id] = {
                                "cantidad":   qty,
                                "cat":        item["cat"],
                                "nombre":     item["nombre"],
                                "presentacion": item["presentacion"],
                            }

            if not items_sede:
                continue  # Skip sedes sin items

            # Generar número de orden
            numero = f"OI-202608-{str(next_seq).zfill(3)}"
            next_seq += 1
            orden_id = str(uuid.uuid4())

            print(f"  → {numero} | {sede_name[:45]:45s} | {len(items_sede):3d} items")
            ordenes_resumen.append((numero, sede_name, len(items_sede)))
            total_ordenes += 1
            total_items   += len(items_sede)

            if not DRY_RUN:
                # Crear orden
                cur.execute(
                    """INSERT INTO ordenes_insumo
                         (id, numero, sede_id, bodega_id, estado, periodo,
                          creado_por,
                          aprobado_solicitante_por, aprobado_solicitante_at,
                          aprobado_coordinador_por, aprobado_coordinador_at,
                          aprobado_por, aprobado_at)
                       VALUES
                         (%s, %s, %s, %s, 'APROBADA', %s,
                          %s,
                          %s, NOW(),
                          %s, NOW(),
                          %s, NOW())""",
                    (orden_id, numero, sede_id, BODEGA_ID, PERIODO,
                     coord_user,
                     coord_user, coord_user,
                     coord_user)
                )

                # Crear ítems
                for (prod_id, info) in items_sede.items():
                    cur.execute(
                        """INSERT INTO orden_insumo_items
                             (id, orden_id, producto_id, cantidad_solicitada,
                              cantidad_maxima_ref, es_adicional)
                           VALUES (%s, %s, %s, %s, %s, false)""",
                        (str(uuid.uuid4()), orden_id, prod_id,
                         info["cantidad"], info["cantidad"])
                    )
                    total_param += 1

                # Asignar coordinador como responsable
                cur.execute(
                    """INSERT INTO orden_insumo_responsables (orden_id, usuario_id)
                       VALUES (%s, %s) ON CONFLICT DO NOTHING""",
                    (orden_id, coord_user)
                )

                # Registrar evento de aprobación
                cur.execute(
                    """INSERT INTO orden_insumo_eventos
                         (id, orden_id, tipo, mensaje, estado_anterior, estado_nuevo,
                          usuario_id, usuario_nombre, usuario_email)
                       VALUES (%s, %s, 'APROBACION', 'Carga masiva agosto 2026',
                               'BORRADOR', 'APROBADA', %s,
                               'Sistema', 'sistema@conserjesinmobiliarios.com')""",
                    (str(uuid.uuid4()), orden_id, coord_user)
                )

            # ── 5c. Upsert parametrización sede_productos ─────────────────────
            if not DRY_RUN:
                for (prod_id, info) in items_sede.items():
                    cur.execute(
                        """INSERT INTO sede_productos
                             (id, sede_id, producto_id, cantidad_maxima, cantidad_minima, activo, created_by)
                           VALUES (%s, %s, %s, %s, 0, true, %s)
                           ON CONFLICT (sede_id, producto_id)
                           DO UPDATE SET
                             cantidad_maxima = EXCLUDED.cantidad_maxima,
                             activo = true,
                             updated_at = NOW()""",
                        (str(uuid.uuid4()), sede_id, prod_id,
                         info["cantidad"], coord_user)
                    )

        # ── 6. Commit ─────────────────────────────────────────────────────────
        if not DRY_RUN:
            conn.commit()
            print("\n✅ Commit exitoso")
        else:
            conn.rollback()
            print("\n[DRY RUN] Sin cambios en BD")

    except Exception as e:
        conn.rollback()
        print(f"\n❌ Error: {e}")
        raise
    finally:
        conn.close()

    # ── 7. Resumen ────────────────────────────────────────────────────────────
    print("\n" + "="*60)
    print(f"RESUMEN {'(DRY RUN)' if DRY_RUN else ''}")
    print("="*60)
    print(f"  Sedes nuevas creadas : {len(sedes_nuevas)}")
    print(f"  Órdenes creadas      : {total_ordenes}")
    print(f"  Ítems totales        : {total_items}")
    print(f"  Registros en param.  : {total_param}")

    if productos_no_encontrados:
        print(f"\n⚠ PRODUCTOS NO ENCONTRADOS en catálogo ({len(productos_no_encontrados)}):")
        for p in sorted(productos_no_encontrados):
            print(f"    - {p}")

    print("\nÓrdenes generadas:")
    for (num, sede, n_items) in ordenes_resumen:
        print(f"  {num} | {sede[:50]:50s} | {n_items} items")


if __name__ == "__main__":
    main()
