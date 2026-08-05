#!/usr/bin/env python3
"""
Hotel Andino S.A.S. — Análisis de datos desde los CSV.

Uso:
    py python/analisis.py [FECHA]
    python python/analisis.py [FECHA]

Si no se indica fecha, se usa la fecha de hoy.
Genera en consola el reporte operativo (comidas entregadas) y
el flujo de caja del día. Solo usa la librería estándar.
"""

import csv
import datetime
import os
import sys
from collections import defaultdict

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")

SERVICIOS = ["Desayuno", "Almuerzo", "Cena"]


def leer(nombre):
    """Lee un CSV y devuelve lista de dicts."""
    ruta = os.path.join(BASE, nombre)
    if not os.path.exists(ruta):
        return []
    with open(ruta, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def formatear(valor):
    return f"${valor:,.0f}".replace(",", ".")


def reporte_operativo(fecha):
    consumos = [c for c in leer("consumos.csv") if c.get("fecha") == fecha]
    comidas = defaultdict(int)
    for c in consumos:
        comidas[c.get("servicio", "")] += 1

    reservas = {r["id_reserva"]: r for r in leer("reservas.csv")}
    huespedes = {h["id"]: h for h in leer("huespedes.csv")}

    print("=" * 56)
    print(f"  REPORTE OPERATIVO  —  {fecha}")
    print("=" * 56)
    for s in SERVICIOS:
        print(f"  {s:<12} {comidas.get(s, 0):>4}  entregados")
    total = sum(comidas.get(s, 0) for s in SERVICIOS)
    print(f"  {'Total':<12} {total:>4}")
    print("-" * 56)
    print("  Detalle:")
    for c in sorted(consumos, key=lambda x: x.get("hora", "")):
        rsv = reservas.get(c.get("id_reserva", ""), {})
        hp = huespedes.get(rsv.get("id_huesped", ""), {})
        nombre = hp.get("nombre", "?")
        print(
            f"    {c.get('hora',''):>6}  {c.get('servicio',''):<10} "
            f"Hab {rsv.get('habitacion','?'):<4} {nombre}"
        )
    print()

    comandas = [x for x in leer("comandas.csv")
                if x.get("fecha") == fecha and x.get("estado") != "Cancelada"]
    ventas = sum(float(x.get("total", 0) or 0) for x in comandas)
    print(f"  Comandas del día: {len(comandas)}  —  ventas {formatear(ventas)}")
    print()


def flujo_caja(fecha):
    movs = [m for m in leer("caja.csv") if m.get("fecha") == fecha]
    ingresos = sum(float(m.get("valor", 0) or 0)
                   for m in movs if m.get("tipo") == "ingreso")
    egresos = sum(float(m.get("valor", 0) or 0)
                  for m in movs if m.get("tipo") == "egreso")
    externos = sum(float(m.get("valor", 0) or 0)
                   for m in movs if m.get("origen") == "externo" and m.get("tipo") == "ingreso")
    huespedes = sum(float(m.get("valor", 0) or 0)
                    for m in movs if m.get("origen") == "huesped" and m.get("tipo") == "ingreso")

    print("=" * 56)
    print(f"  FLUJO DE CAJA  —  {fecha}")
    print("=" * 56)
    print(f"  Cobros de clientes externos : {formatear(externos)}")
    print(f"  Consumos de huéspedes       : {formatear(huespedes)}")
    print(f"  Total ingresos              : {formatear(ingresos)}")
    print(f"  Egresos (gastos)            : {formatear(egresos)}")
    print(f"  Neto del día                : {formatear(ingresos - egresos)}")
    print("-" * 56)
    print("  Movimientos:")
    for m in sorted(movs, key=lambda x: x.get("id", "")):
        tipo = "ING" if m.get("tipo") == "ingreso" else "EGR"
        origen = m.get("origen", "?")
        reserva = f" (res {m.get('id_reserva')})" if m.get("id_reserva") else ""
        print(
            f"    {m.get('hora',''):>6}  {tipo:<4} {origen:<7}{reserva:<12} "
            f"{m.get('concepto','')[:30]:<32} {formatear(float(m.get('valor',0) or 0))}"
        )
    print()


def main():
    # Salida en UTF-8 para soportar acentos y símbolos en cualquier consola
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass
    fecha = sys.argv[1] if len(sys.argv) > 1 else datetime.date.today().isoformat()
    reporte_operativo(fecha)
    flujo_caja(fecha)


if __name__ == "__main__":
    main()
