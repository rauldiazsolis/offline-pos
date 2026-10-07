# Prototipo de `pos-sheets.gs` (temporal)

Lo que se probó con el usuario el 2026-10-06 y el 2026-10-07 en Sheets real, guardado para que no se
pierda mientras se porta al conector (plan `docs/superpowers/plans/2026-10-07-sheets-planilla-lista.md`).
**Se borra en el PR que cierra #219.**

- `pos-sheets.gs`: el archivo único de la última prueba (v5 con el fiado en L y la Hoja 1 como Tablero).
- `partes/`: inicialización y generador (`inicio.gs`), home (`home.gs`), tablero (`tablero.gs`) y los
  datos de cada rubro. Las funciones `datos*` se llaman sin `_` en `datos-ferreteria.gs`: `armar.py`
  las renombra.
- `armar.py`: arma `pos-sheets.gs` con el `bridge.gs` y el `columnas.gs` del repo (le saca `SEED` y
  el `doGet` viejo, y cambia los pasos de Configuración). `python3 armar.py`.
- `seeds.py`: generó `datos-kiosco.gs` y `datos-almacen.gs` (con los EAN-13).
