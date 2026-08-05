# -*- coding: utf-8 -*-
"""
Hotel Andino S.A.S. — Reportes de Balance (Streamlit)
======================================================
Genera reportes del balance diario (flujo de caja), comandas, comidas
entregadas e inventario, con gráficos y descarga en PDF.

Ejecutar desde la carpeta raíz del proyecto:
    python reportes/reportes.py
o bien:
    reportes\\run_reportes.bat
"""

import io
import os
import datetime

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

import pandas as pd

from fpdf import FPDF

# ------------------------------------------------------------------
# Configuración
# ------------------------------------------------------------------
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

COLORES = {
    "teal": "#0F766E",
    "teal_claro": "#14B8A6",
    "gold": "#D97706",
    "gold_claro": "#F59E0B",
    "navy": "#1E293B",
    "rojo": "#DC2626",
    "verde": "#059669",
    "fondo": "#F8FAFC",
    "texto": "#334155",
}

MEALS = ["Desayuno", "Almuerzo", "Cena"]

ORIGEN_LABEL = {
    "externo": "Clientes externos",
    "huesped": "Consumos de huéspedes",
    "comanda": "Ventas de comandas",
    "gasto": "Egresos",
}

FONT = "helvetica"
FONT_B = "helvetica"


def _registrar_fuentes(pdf):
    """Intenta usar Arial (soporta acentos). Si no existe, usa helvetica."""
    global FONT, FONT_B
    arial = os.path.join("C:\\Windows\\Fonts", "arial.ttf")
    arialbd = os.path.join("C:\\Windows\\Fonts", "arialbd.ttf")
    if os.path.exists(arial):
        try:
            pdf.add_font("Arial", "", arial)
            FONT = "Arial"
        except Exception:
            pass
    if os.path.exists(arialbd):
        try:
            pdf.add_font("Arial", "B", arialbd)
            FONT_B = "Arial"
        except Exception:
            FONT_B = FONT or "helvetica"
    else:
        FONT_B = FONT or "helvetica"


def txt_ok(valor):
    """Texto seguro para el PDF según la fuente cargada."""
    s = str(valor if valor is not None else "")
    if FONT != "helvetica":
        return s
    return s.encode("latin-1", "replace").decode("latin-1")


# ------------------------------------------------------------------
# Lectura de datos
# ------------------------------------------------------------------
def read_csv(nombre):
    ruta = os.path.join(DATA_DIR, nombre)
    if not os.path.exists(ruta):
        return pd.DataFrame()
    try:
        return pd.read_csv(ruta, dtype=str, encoding="utf-8").fillna("")
    except Exception:
        return pd.DataFrame()


def _num(valor):
    try:
        return float(valor)
    except (TypeError, ValueError):
        return 0.0


def fmt_pesos(valor):
    return "$ {:,.0f}".format(round(valor)).replace(",", ".")


def load_data(fecha_str):
    """Carga todos los datos del día seleccionado y devuelve un dict listo para reportar."""
    caja = read_csv("caja.csv")
    comandas = read_csv("comandas.csv")
    consumos = read_csv("consumos.csv")
    reservas = read_csv("reservas.csv")
    huespedes = read_csv("huespedes.csv")
    mesas = read_csv("mesas.csv")
    productos = read_csv("productos.csv")
    platos = read_csv("platos.csv")
    comanda_platos = read_csv("comanda_platos.csv")

    # --- Balance (movimientos del día) ---
    caja_dia = caja[caja["fecha"] == fecha_str].copy() if not caja.empty else caja.copy()
    if not caja_dia.empty:
        caja_dia["valor_num"] = caja_dia["valor"].apply(_num)

    def suma(origen=None, tipo=None):
        m = caja_dia
        if origen:
            m = m[m["origen"] == origen]
        if tipo:
            m = m[m["tipo"] == tipo]
        return _num(m["valor_num"].sum()) if not m.empty else 0.0

    totales = {
        "externos": suma("externo", "ingreso"),
        "huespedes": suma("huesped", "ingreso"),
        "comandas": suma("comanda", "ingreso"),
        "ingresos": suma(tipo="ingreso"),
        "egresos": suma(tipo="egreso"),
        "neto": suma(tipo="ingreso") - suma(tipo="egreso"),
    }

    # --- Comandas del día ---
    com_dia = comandas[comandas["fecha"] == fecha_str].copy() if not comandas.empty else comandas.copy()
    if not com_dia.empty:
        com_dia["total_num"] = com_dia["total"].apply(_num)

    def nombre_cliente(fila):
        if fila.get("tipo_servicio") == "mesa":
            mesa = mesas[mesas["id"] == fila.get("id_mesa")]
            return mesa.iloc[0]["nombre"] if not mesa.empty else "Mesa " + str(fila.get("id_mesa"))
        rsv = reservas[reservas["id_reserva"] == fila.get("id_reserva")]
        if rsv.empty:
            return "Res. " + str(fila.get("id_reserva"))
        hp = huespedes[huespedes["id"] == rsv.iloc[0]["id_huesped"]]
        return hp.iloc[0]["nombre"] if not hp.empty else "Res. " + str(fila.get("id_reserva"))

    com_dia = com_dia.copy()
    if not com_dia.empty:
        com_dia["cliente"] = com_dia.apply(nombre_cliente, axis=1)

    # --- Comidas entregadas (consumos) ---
    consumos_dia = consumos[consumos["fecha"] == fecha_str].copy() if not consumos.empty else consumos.copy()
    comidas = {m: int((consumos_dia["servicio"] == m).sum()) for m in MEALS}

    detalle_consumos = []
    for _, c in consumos_dia.iterrows():
        rsv = reservas[reservas["id_reserva"] == c.get("id_reserva")]
        hp = huespedes[huespedes["id"] == (rsv.iloc[0]["id_huesped"] if not rsv.empty else "")]
        detalle_consumos.append({
            "hora": c.get("hora", ""),
            "huesped": hp.iloc[0]["nombre"] if not hp.empty else c.get("id_reserva", ""),
            "habitacion": rsv.iloc[0]["habitacion"] if not rsv.empty else "",
            "servicio": c.get("servicio", ""),
        })

    # --- Evolución (últimos 14 días) ---
    hoy = datetime.date.fromisoformat(fecha_str)
    fechas = [(hoy - datetime.timedelta(days=i)).isoformat() for i in range(13, -1, -1)]
    evolucion = []
    if not caja.empty:
        caja_todos = caja.copy()
        caja_todos["valor_num"] = caja_todos["valor"].apply(_num)
        for f in fechas:
            dia = caja_todos[caja_todos["fecha"] == f]
            ing = _num(dia[dia["tipo"] == "ingreso"]["valor_num"].sum()) if not dia.empty else 0.0
            egr = _num(dia[dia["tipo"] == "egreso"]["valor_num"].sum()) if not dia.empty else 0.0
            com_ent = consumos[(consumos["fecha"] == f)].shape[0] if not consumos.empty else 0
            evolucion.append({"fecha": f, "ingresos": ing, "egresos": egr, "neto": ing - egr, "comidas": int(com_ent)})

    # --- Inventario (alertas) ---
    alertas = []
    if not productos.empty:
        productos = productos.copy()
        productos["stock"] = productos["stock"].apply(_num)
        productos["stock_minimo"] = productos["stock_minimo"].apply(_num)
        for _, p in productos.iterrows():
            if p["stock"] <= 0:
                alertas.append((p["nombre"], "Agotado", p["stock"], p["stock_minimo"]))
            elif p["stock"] <= p["stock_minimo"]:
                alertas.append((p["nombre"], "Stock bajo", p["stock"], p["stock_minimo"]))

    return {
        "fecha": fecha_str,
        "caja_dia": caja_dia,
        "totales": totales,
        "com_dia": com_dia,
        "consumos_dia": consumos_dia,
        "detalle_consumos": detalle_consumos,
        "comidas": comidas,
        "evolucion": evolucion,
        "fechas": fechas,
        "alertas": alertas,
    }


# ------------------------------------------------------------------
# Gráficos (matplotlib)
# ------------------------------------------------------------------
def _estilo():
    plt.rcParams["font.family"] = "DejaVu Sans"
    plt.rcParams["axes.facecolor"] = "#FFFFFF"
    plt.rcParams["figure.facecolor"] = "#FFFFFF"
    plt.rcParams["text.color"] = COLORES["texto"]
    plt.rcParams["axes.edgecolor"] = "#E2E8F0"


def _fig_bytes(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf


def grafico_ingresos(data):
    t = data["totales"]
    categorias = [
        ("Clientes externos", t["externos"]),
        ("Consumos huéspedes", t["huespedes"]),
        ("Ventas de comandas", t["comandas"]),
    ]
    categorias = [(n, v) for n, v in categorias if v > 0]
    if not categorias:
        return None
    nombres = [n for n, _ in categorias]
    valores = [v for _, v in categorias]
    colores = [COLORES["gold"], COLORES["teal"], COLORES["teal_claro"]]

    fig, ax = plt.subplots(figsize=(7, 4))
    ax.bar(nombres, valores, color=colores, edgecolor="white")
    for i, v in enumerate(valores):
        ax.text(i, v, fmt_pesos(v), ha="center", va="bottom", fontsize=10, fontweight="bold")
    ax.set_title("Ingresos del día por origen", fontsize=13, fontweight="bold")
    ax.set_ylabel("Valor (COP)")
    ax.spines[["top", "right"]].set_visible(False)
    return _fig_bytes(fig)


def grafico_composicion(data):
    t = data["totales"]
    valores = [
        ("Externos", t["externos"]),
        ("Huéspedes", t["huespedes"]),
        ("Comandas", t["comandas"]),
    ]
    valores = [(n, v) for n, v in valores if v > 0]
    if not valores:
        return None
    nombres = [n for n, _ in valores]
    vals = [v for _, v in valores]
    colores = [COLORES["gold"], COLORES["teal"], COLORES["teal_claro"]]

    fig, ax = plt.subplots(figsize=(5.5, 4))
    ax.pie(
        vals,
        labels=nombres,
        autopct="%1.1f%%",
        colors=colores,
        startangle=90,
        textprops={"fontsize": 11},
        wedgeprops={"edgecolor": "white", "linewidth": 2},
    )
    ax.set_title("Composición de los ingresos", fontsize=13, fontweight="bold")
    return _fig_bytes(fig)


def grafico_evolucion(data):
    fechas = data["evolucion"]
    if not any(r["ingresos"] or r["egresos"] for r in fechas):
        return None
    x = [r["fecha"][5:] for r in fechas]
    fig, ax = plt.subplots(figsize=(9, 4))
    ax.plot(x, [r["ingresos"] for r in fechas], marker="o", color=COLORES["teal"], label="Ingresos", linewidth=2)
    ax.plot(x, [r["egresos"] for r in fechas], marker="o", color=COLORES["rojo"], label="Egresos", linewidth=2)
    ax.plot(x, [r["neto"] for r in fechas], marker="o", color=COLORES["gold"], label="Neto", linewidth=2)
    ax.set_title("Balance de los últimos 14 días", fontsize=13, fontweight="bold")
    ax.set_ylabel("Valor (COP)")
    ax.legend()
    ax.grid(axis="y", linestyle="--", alpha=0.4)
    ax.spines[["top", "right"]].set_visible(False)
    plt.xticks(rotation=45, ha="right")
    return _fig_bytes(fig)


def grafico_comidas(data):
    c = data["comidas"]
    valores = [c[m] for m in MEALS]
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.bar(MEALS, valores, color=[COLORES["gold"], COLORES["teal"], COLORES["navy"]], edgecolor="white")
    for i, v in enumerate(valores):
        ax.text(i, v, str(v), ha="center", va="bottom", fontsize=12, fontweight="bold")
    ax.set_title("Comidas entregadas del día", fontsize=13, fontweight="bold")
    ax.set_ylabel("Cantidad")
    ax.spines[["top", "right"]].set_visible(False)
    return _fig_bytes(fig)


# ------------------------------------------------------------------
# PDF
# ------------------------------------------------------------------
def build_pdf(data, charts):
    """Genera el PDF del reporte y devuelve los bytes."""
    pdf = FPDF()
    _registrar_fuentes(pdf)
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.add_page()

    # Cabecera
    pdf.set_fill_color(15, 23, 42)
    pdf.rect(0, 0, 210, 30, "F")
    pdf.set_font(FONT, "B", 16)
    pdf.set_text_color(255, 255, 255)
    pdf.set_xy(12, 8)
    pdf.cell(0, 9, txt_ok("Hotel Andino S.A.S."), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(FONT, "", 10)
    pdf.set_text_color(204, 251, 241)
    pdf.cell(0, 6, txt_ok("Reporte de Balance — Sistema de Gestión Hotelera"), new_x="LMARGIN", new_y="NEXT")

    pdf.ln(6)
    pdf.set_text_color(30, 41, 59)
    pdf.set_font(FONT, "B", 13)
    pdf.cell(0, 8, txt_ok(f"Reporte del día: {data['fecha']}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(FONT, "", 9.5)
    pdf.set_text_color(100, 116, 139)
    pdf.cell(0, 6, txt_ok("Generado: " + datetime.datetime.now().strftime("%Y-%m-%d %H:%M")), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(4)

    t = data["totales"]

    def fila_seccion(titulo):
        pdf.ln(3)
        pdf.set_font(FONT, "B", 11)
        pdf.set_text_color(15, 118, 110)
        pdf.cell(0, 8, txt_ok(titulo), new_x="LMARGIN", new_y="NEXT")
        pdf.set_draw_color(15, 118, 110)
        pdf.set_line_width(0.4)
        pdf.line(10, pdf.get_y(), 200, pdf.get_y())
        pdf.ln(2)

    def fila_concepto(label, valor, negrita=False):
        pdf.set_font(FONT, "B" if negrita else "", 10)
        pdf.set_text_color(30, 41, 59)
        pdf.cell(120, 7, txt_ok(label))
        pdf.cell(0, 7, txt_ok(fmt_pesos(valor)), align="R", new_x="LMARGIN", new_y="NEXT")

    # Balance
    fila_seccion("Balance del día")
    fila_concepto("Ingresos por clientes externos", t["externos"])
    fila_concepto("Consumos de huéspedes (extras)", t["huespedes"])
    fila_concepto("Ventas de comandas (servicio aparte)", t["comandas"])
    fila_concepto("Total ingresos", t["ingresos"], negrita=True)
    fila_concepto("Egresos", t["egresos"])
    pdf.set_draw_color(30, 41, 59)
    pdf.set_line_width(0.6)
    pdf.line(10, pdf.get_y(), 200, pdf.get_y())
    fila_concepto("NETO DEL DÍA", t["neto"], negrita=True)

    # Gráficos de balance
    pdf.ln(4)
    if charts.get("ingresos"):
        pdf.image(charts["ingresos"], x=12, w=90)
    if charts.get("composicion"):
        pdf.image(charts["composicion"], x=108, w=88)

    # Movimientos de caja
    fila_seccion("Movimientos de caja")
    movs = data["caja_dia"]
    if movs.empty:
        pdf.set_font(FONT, "", 10)
        pdf.set_text_color(100, 116, 139)
        pdf.cell(0, 7, txt_ok("No hay movimientos registrados en esta fecha."), new_x="LMARGIN", new_y="NEXT")
    else:
        pdf.set_font(FONT, "B", 9)
        pdf.set_fill_color(241, 245, 249)
        pdf.set_text_color(30, 41, 59)
        pdf.cell(30, 7, txt_ok("Hora"), border=1, fill=True)
        pdf.cell(45, 7, txt_ok("Tipo"), border=1, fill=True)
        pdf.cell(70, 7, txt_ok("Concepto"), border=1, fill=True)
        pdf.cell(0, 7, txt_ok("Valor"), border=1, align="R", fill=True, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font(FONT, "", 9)
        for _, m in movs.iterrows():
            tipo = "Ingreso" if m.get("tipo") == "ingreso" else "Egreso"
            pdf.cell(30, 6, txt_ok(m.get("hora", "")))
            pdf.cell(45, 6, txt_ok(tipo))
            pdf.cell(70, 6, txt_ok(m.get("concepto", "")))
            pdf.cell(0, 6, txt_ok(fmt_pesos(_num(m.get("valor_num")))), align="R", new_x="LMARGIN", new_y="NEXT")

    # Comandas del día
    fila_seccion("Comandas del día (servicio aparte)")
    com = data["com_dia"]
    if com.empty:
        pdf.set_font(FONT, "", 10)
        pdf.set_text_color(100, 116, 139)
        pdf.cell(0, 7, txt_ok("No hay comandas en esta fecha."), new_x="LMARGIN", new_y="NEXT")
    else:
        pdf.set_font(FONT, "B", 9)
        pdf.set_fill_color(241, 245, 249)
        pdf.cell(25, 7, txt_ok("Comanda"), border=1, fill=True)
        pdf.cell(80, 7, txt_ok("Cliente"), border=1, fill=True)
        pdf.cell(35, 7, txt_ok("Estado"), border=1, fill=True)
        pdf.cell(0, 7, txt_ok("Total"), border=1, align="R", fill=True, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font(FONT, "", 9)
        for _, c in com.iterrows():
            pdf.cell(25, 6, txt_ok("#" + str(c.get("id_comanda"))))
            pdf.cell(80, 6, txt_ok(c.get("cliente", "")))
            pdf.cell(35, 6, txt_ok(c.get("estado", "")))
            pdf.cell(0, 6, txt_ok(fmt_pesos(_num(c.get("total_num")))), align="R", new_x="LMARGIN", new_y="NEXT")

    # Comidas entregadas
    fila_seccion("Comidas entregadas (plan de huéspedes)")
    pdf.set_font(FONT, "", 10)
    pdf.set_text_color(30, 41, 59)
    for m in MEALS:
        pdf.cell(0, 7, txt_ok(f"{m}: {data['comidas'][m]}"), new_x="LMARGIN", new_y="NEXT")
    if charts.get("comidas"):
        pdf.image(charts["comidas"], x=60, w=90)

    # Detalle de consumos
    fila_seccion("Detalle de consumos")
    det = data["detalle_consumos"]
    if not det:
        pdf.set_font(FONT, "", 10)
        pdf.set_text_color(100, 116, 139)
        pdf.cell(0, 7, txt_ok("No hay consumos en esta fecha."), new_x="LMARGIN", new_y="NEXT")
    else:
        pdf.set_font(FONT, "B", 9)
        pdf.set_fill_color(241, 245, 249)
        pdf.cell(30, 7, txt_ok("Hora"), border=1, fill=True)
        pdf.cell(80, 7, txt_ok("Huésped"), border=1, fill=True)
        pdf.cell(35, 7, txt_ok("Hab."), border=1, fill=True)
        pdf.cell(0, 7, txt_ok("Servicio"), border=1, fill=True, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font(FONT, "", 9)
        for r in det:
            pdf.cell(30, 6, txt_ok(r["hora"]))
            pdf.cell(80, 6, txt_ok(r["huesped"]))
            pdf.cell(35, 6, txt_ok(r["habitacion"]))
            pdf.cell(0, 6, txt_ok(r["servicio"]), new_x="LMARGIN", new_y="NEXT")

    # Evolución
    if charts.get("evolucion"):
        pdf.add_page()
        fila_seccion("Balance de los últimos 14 días")
        pdf.image(charts["evolucion"], x=15, w=180)

    # Alertas de inventario
    fila_seccion("Alertas de inventario")
    if not data["alertas"]:
        pdf.set_font(FONT, "", 10)
        pdf.set_text_color(5, 150, 105)
        pdf.cell(0, 7, txt_ok("Sin alertas: el inventario está en orden."), new_x="LMARGIN", new_y="NEXT")
    else:
        pdf.set_font(FONT, "B", 9)
        pdf.set_fill_color(254, 243, 199)
        pdf.cell(90, 7, txt_ok("Producto"), border=1, fill=True)
        pdf.cell(40, 7, txt_ok("Estado"), border=1, fill=True)
        pdf.cell(0, 7, txt_ok("Stock / Mínimo"), border=1, align="R", fill=True, new_x="LMARGIN", new_y="NEXT")
        pdf.set_font(FONT, "", 9)
        for nombre, estado, stock, minimo in data["alertas"]:
            pdf.cell(90, 6, txt_ok(nombre))
            pdf.cell(40, 6, txt_ok(estado))
            pdf.cell(0, 6, txt_ok(f"{stock:g} / {minimo:g}"), align="R", new_x="LMARGIN", new_y="NEXT")

    # Pie de página
    pdf.set_y(-15)
    pdf.set_font(FONT, "", 8)
    pdf.set_text_color(148, 163, 184)
    pdf.cell(0, 6, txt_ok(f"Hotel Andino S.A.S. — Reporte del día {data['fecha']} — Página {pdf.page_no()}"), align="C")

    return bytes(pdf.output())


# ------------------------------------------------------------------
# Interfaz Streamlit
# ------------------------------------------------------------------
def main():
    import streamlit as st

    st.set_page_config(page_title="Reportes de Balance — Hotel Andino", page_icon="📊", layout="wide")
    st.markdown(
        """
        <style>
        .block-container { padding-top: 1.6rem; }
        #MainMenu { visibility: hidden; }
        footer { visibility: hidden; }
        </style>
        """,
        unsafe_allow_html=True,
    )

    st.title("📊 Reportes de Balance — Hotel Andino S.A.S.")
    st.caption("Generación de reportes del flujo de caja, comandas y comidas entregadas.")

    hoy = datetime.date.today()
    fecha = st.sidebar.date_input("Fecha del reporte", value=hoy)
    fecha_str = fecha.isoformat()

    with st.spinner("Cargando datos..."):
        data = load_data(fecha_str)
        _estilo()
        charts = {
            "ingresos": grafico_ingresos(data),
            "composicion": grafico_composicion(data),
            "evolucion": grafico_evolucion(data),
            "comidas": grafico_comidas(data),
        }

    t = data["totales"]
    c1, c2, c3, c4, c5 = st.columns(5)
    c1.metric("Total ingresos", fmt_pesos(t["ingresos"]))
    c2.metric("Ventas de comandas", fmt_pesos(t["comandas"]))
    c3.metric("Egresos", fmt_pesos(t["egresos"]))
    c4.metric("Neto del día", fmt_pesos(t["neto"]))
    c5.metric("Comidas entregadas", sum(data["comidas"].values()))

    pestaña = st.tabs(["Balance", "Comidas entregadas", "Evolución", "Alertas de inventario", "Descargar PDF"])

    # --- Balance ---
    with pestaña[0]:
        col_izq, col_der = st.columns(2)
        with col_izq:
            st.subheader("Ingresos por origen")
            if charts["ingresos"]:
                st.image(charts["ingresos"], width="stretch")
            else:
                st.info("No hay ingresos registrados para esta fecha.")
        with col_der:
            st.subheader("Composición")
            if charts["composicion"]:
                st.image(charts["composicion"], width="stretch")
            else:
                st.info("Sin datos de composición.")

        st.subheader("Movimientos de caja")
        movs = data["caja_dia"]
        if movs.empty:
            st.info("No hay movimientos registrados para esta fecha.")
        else:
            tabla = movs[["hora", "tipo", "origen", "concepto", "valor_num", "registrado_por"]].copy()
            tabla["origen"] = tabla["origen"].map(ORIGEN_LABEL).fillna(tabla["origen"])
            tabla["tipo"] = tabla["tipo"].map({"ingreso": "Ingreso", "egreso": "Egreso"})
            tabla = tabla.rename(columns={
                "hora": "Hora", "tipo": "Tipo", "origen": "Origen",
                "concepto": "Concepto", "valor_num": "Valor", "registrado_por": "Registrado por",
            })
            st.dataframe(tabla, width="stretch", hide_index=True)

    # --- Comidas entregadas ---
    with pestaña[1]:
        col_izq, col_der = st.columns(2)
        with col_izq:
            st.subheader("Comidas entregadas")
            if charts["comidas"]:
                st.image(charts["comidas"], width="stretch")
        with col_der:
            st.subheader("Comandas del día")
            com = data["com_dia"]
            if com.empty:
                st.info("No hay comandas para esta fecha.")
            else:
                tabla = com[["id_comanda", "cliente", "estado", "total_num"]].copy()
                tabla = tabla.rename(columns={
                    "id_comanda": "Comanda", "cliente": "Cliente", "estado": "Estado", "total_num": "Total",
                })
                st.dataframe(tabla, width="stretch", hide_index=True)

        st.subheader("Detalle de consumos")
        if data["detalle_consumos"]:
            st.dataframe(pd.DataFrame(data["detalle_consumos"]), width="stretch", hide_index=True)
        else:
            st.info("No hay consumos registrados para esta fecha.")

    # --- Evolución ---
    with pestaña[2]:
        if charts["evolucion"]:
            st.image(charts["evolucion"], width="stretch")
            st.dataframe(pd.DataFrame(data["evolucion"]), width="stretch", hide_index=True)
        else:
            st.info("No hay datos históricos suficientes para graficar la evolución.")

    # --- Alertas ---
    with pestaña[3]:
        if data["alertas"]:
            st.dataframe(
                pd.DataFrame(data["alertas"], columns=["Producto", "Estado", "Stock", "Stock mínimo"]),
                width="stretch", hide_index=True,
            )
        else:
            st.success("Sin alertas: el inventario está en orden.")

    # --- Descargar PDF ---
    with pestaña[4]:
        st.subheader("Descargar reporte en PDF")
        st.write(
            "El PDF incluye el balance del día, los movimientos de caja, las comandas, "
            "las comidas entregadas, la evolución de los últimos 14 días y las alertas de inventario, "
            "con sus gráficos."
        )
        try:
            pdf_bytes = build_pdf(data, charts)
            st.download_button(
                label="⬇️ Descargar reporte en PDF",
                data=pdf_bytes,
                file_name=f"reporte_balance_{fecha_str}.pdf",
                mime="application/pdf",
                width="stretch",
            )
            st.success(f"PDF generado correctamente ({len(pdf_bytes):,} bytes).")
        except Exception as e:
            st.error(f"No se pudo generar el PDF: {e}")


if __name__ == "__main__":
    main()
