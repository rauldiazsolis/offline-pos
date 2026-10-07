import json
def ean(prefix, i):
    b = f"{prefix}{i:05d}"[:12]
    s = sum(int(c) * (1 if k % 2 == 0 else 3) for k, c in enumerate(b))
    return b + str((10 - s % 10) % 10)

def productos(prefix, idp, lista):
    out = []
    for i, p in enumerate(lista, 1):
        nombre, sku, cat, precio, iva, freq, cant, *extra = p
        d = {'id': f'{idp}-{i:03d}', 'sku': sku, 'barcodes': '' if cant and any(isinstance(x, float) for x in cant) or (extra and extra[0] == 'sin-codigo') else ean(prefix, i),
             'name': nombre, 'price': precio, 'taxRate': iva, 'category': cat, 'frecuencia': freq}
        if cant: d['cantidades'] = cant
        if extra and isinstance(extra[0], dict): d.update(extra[0])
        out.append(d)
    return out

def js(v, ind=4):
    return json.dumps(v, ensure_ascii=False)

def archivo(fn, nombre, cabecera, prods, clientes, historia):
    lineas = [f"// ======================================================================================",
              f"// Datos de prueba: {cabecera}",
              f"// ======================================================================================",
              f"function {fn}() {{", "  return {", f"    nombre: '{nombre}',", "    productos: ["]
    for p in prods: lineas.append("      " + js(p).replace('"', "'").replace("'cantidades'", "cantidades") + ",")
    lineas.append("    ],"); lineas.append("    clientes: [")
    for c in clientes: lineas.append("      " + js(c).replace('"', "'") + ",")
    lineas.append("    ],"); lineas.append("    historia: " + json.dumps(historia, ensure_ascii=False, indent=2).replace('\n', '\n    ').replace('"', "'") + ",")
    lineas += ["  };", "}", ""]
    txt = "\n".join(lineas)
    import re
    txt = re.sub(r"'([A-Za-z_][A-Za-z0-9_]*)':", r"\1:", txt)
    return txt

I21, I10 = 0.21, 0.105
kiosco = [
  ('Gaseosa cola 500 ml','BEB-001','bebidas',1800,I21,9,None),
  ('Gaseosa cola 2,25 L','BEB-002','bebidas',4200,I21,5,None),
  ('Agua mineral 500 ml','BEB-003','bebidas',1200,I21,8,None),
  ('Agua saborizada 1,5 L','BEB-004','bebidas',2600,I21,4,None),
  ('Jugo en caja 1 L','BEB-005','bebidas',1900,I21,3,None),
  ('Bebida energizante 473 ml','BEB-006','bebidas',3200,I21,4,None,{'blocked':True,'blockedReason':'Lote vencido: no vender'}),
  ('Cerveza lata 473 ml','BEB-007','bebidas',2500,I21,6,[1,1,2,4]),
  ('Agua con gas 1,5 L','BEB-008','bebidas',1700,I21,2,None),
  ('Alfajor triple de chocolate','GOL-001','golosinas',1500,I21,9,[1,1,2]),
  ('Alfajor simple','GOL-002','golosinas',900,I21,7,[1,1,2,3]),
  ('Chocolate con leche 80 g','GOL-003','golosinas',2800,I21,4,None),
  ('Caramelo masticable','GOL-004','golosinas',100,I21,5,[5,10,20],'sin-codigo'),
  ('Chicles x5','GOL-005','golosinas',900,I21,6,None),
  ('Turrón de maní','GOL-006','golosinas',600,I21,5,[1,2]),
  ('Barra de cereal','GOL-007','golosinas',900,I21,4,None),
  ('Chupetín','GOL-008','golosinas',300,I21,4,[1,2,3]),
  ('Galletitas dulces rellenas','GOL-009','golosinas',1800,I21,5,None),
  ('Bombón de chocolate','GOL-010','golosinas',700,I21,3,[1,2]),
  ('Papas fritas 80 g','SNK-001','snacks',2400,I21,5,None),
  ('Maní salado 120 g','SNK-002','snacks',1600,I21,3,None),
  ('Palitos salados','SNK-003','snacks',1300,I21,3,None),
  ('Galletitas de agua','ALM-001','almacen',1500,I21,3,None),
  ('Yerba 500 g','ALM-002','almacen',3600,I21,3,None),
  ('Azúcar 1 kg','ALM-003','almacen',1500,I21,2,None),
  ('Leche larga vida 1 L','ALM-004','almacen',1700,I10,3,None),
  ('Cigarrillos box x20','CIG-001','cigarrillos',7200,I21,8,[1,1,2]),
  ('Encendedor','CIG-002','cigarrillos',1200,I21,4,None),
  ('Pilas AA x2','VAR-001','varios',3800,I21,2,None),
  ('Pañuelos descartables','VAR-002','varios',800,I21,3,None),
  ('Preservativos x3','VAR-003','varios',3500,I21,2,None),
]
k_clientes = [
  {'id':'kc-001','name':'Martín Gómez','document':'','phone':'1155003344','fia':True,'saldoInicial':8500},
  {'id':'kc-002','name':'Taller Mecánico Ruta 2','document':'20301234567','phone':'1144332211','fia':True},
  {'id':'kc-003','name':'Sofía Herrera','document':'','phone':''},
  {'id':'kc-004','name':'Diego López','document':'','phone':'1166001122','fia':True,'saldoInicial':15600,'blocked':True,'blockedReason':'No fiar hasta que pague'},
  {'id':'kc-005','name':'Paula Díaz','document':'','phone':''},
]
k_hist = {'semilla':20261007,'dias':10,'cerrado':[],'turnos':[[7,23]],'ventasPorDia':[45,70],'factorSabado':1.1,
  'lineasPorVenta':[1,2],'medios':{'cash':55,'qr':25,'debit':15,'transfer':5},'pagoDivididoDesde':15000,
  'proporcionConCliente':0.08,'proporcionFiada':0.7,'probabilidadDeDescuento':0.01,'descuentos':[10],
  'probabilidadDeLineaLibre':0.04,'lineasLibres':[{'descripcion':'Carga de celular','precios':[1000,5000]},{'descripcion':'Fotocopia','precios':[100,400]}],
  'cobranzasPorDia':0.3,'diaDeLaAnulacion':4,'fondoInicial':30000,'retiroAlCerrar':True,
  'egresos':[{'concepto':'Pago a proveedor','descripcion':'Distribuidora de golosinas','probabilidad':0.3,'montos':[20000,70000]},
             {'concepto':'Hielo','probabilidad':0.15,'montos':[3000,6000]}],
  'arqueoProbabilidad':0.8,'diferenciasDeArqueo':[0,0,0,-100,-200,100,50]}

almacen = [
  ('Jamón cocido (kg)','FIA-001','fiambreria',18000,I21,6,[0.15,0.2,0.25,0.3]),
  ('Queso de máquina (kg)','FIA-002','fiambreria',14000,I21,6,[0.2,0.25,0.3]),
  ('Salame (kg)','FIA-003','fiambreria',22000,I21,3,[0.1,0.15,0.2]),
  ('Queso cremoso (kg)','FIA-004','fiambreria',11000,I21,4,[0.25,0.5]),
  ('Papa (kg)','VER-001','verduleria',1200,I10,6,[1.0,2.0,3.0]),
  ('Cebolla (kg)','VER-002','verduleria',1100,I10,5,[0.5,1.0,2.0]),
  ('Tomate (kg)','VER-003','verduleria',2800,I10,5,[0.5,1.0]),
  ('Banana (kg)','VER-004','verduleria',2400,I10,4,[0.5,1.0,1.5]),
  ('Manzana (kg)','VER-005','verduleria',2600,I10,3,[0.5,1.0]),
  ('Pan francés (kg)','PAN-001','panaderia',3200,I10,9,[0.25,0.5,1.0]),
  ('Factura','PAN-002','panaderia',700,I10,5,[3,6,12],'sin-codigo'),
  ('Leche entera 1 L','LAC-001','lacteos',1700,I10,8,[1,1,2]),
  ('Yogur bebible 1 L','LAC-002','lacteos',2900,I21,3,None),
  ('Manteca 200 g','LAC-003','lacteos',3300,I21,3,None),
  ('Huevos x6','LAC-004','lacteos',1900,I10,5,None),
  ('Huevos maple x30','LAC-005','lacteos',7800,I10,2,None),
  ('Dulce de leche 400 g','LAC-006','lacteos',3200,I21,3,None),
  ('Queso rallado 150 g','LAC-007','lacteos',2900,I21,2,None),
  ('Yerba 1 kg','ALM-001','almacen',6800,I21,5,None),
  ('Azúcar 1 kg','ALM-002','almacen',1500,I21,4,None),
  ('Harina 000 1 kg','ALM-003','almacen',1100,I21,3,None),
  ('Fideos secos 500 g','ALM-004','almacen',1500,I21,5,[1,2]),
  ('Arroz 1 kg','ALM-005','almacen',1900,I21,3,None),
  ('Aceite de girasol 1,5 L','ALM-006','almacen',4600,I21,3,None),
  ('Aceite de oliva 500 ml','ALM-007','almacen',12500,I21,1,None,{'blocked':True,'blockedReason':'Precio a revisar'}),
  ('Puré de tomate 520 g','ALM-008','almacen',1200,I21,4,[1,2]),
  ('Sal fina 500 g','ALM-009','almacen',900,I21,2,None),
  ('Galletitas de agua','ALM-010','almacen',1500,I21,4,None),
  ('Café molido 250 g','ALM-011','almacen',6200,I21,1,None),
  ('Mate cocido x25','ALM-012','almacen',1800,I21,2,None),
  ('Gaseosa 2,25 L','BEB-001','bebidas',4200,I21,4,None),
  ('Agua mineral 2 L','BEB-002','bebidas',1500,I21,3,None),
  ('Vino tinto 750 ml','BEB-003','bebidas',5200,I21,2,None),
  ('Cerveza 1 L','BEB-004','bebidas',3800,I21,3,[1,2]),
  ('Lavandina 1 L','LIM-001','limpieza',1300,I21,2,None),
  ('Detergente 500 ml','LIM-002','limpieza',1900,I21,2,None),
  ('Papel higiénico x4','LIM-003','limpieza',3200,I21,2,None),
  ('Jabón en polvo 800 g','LIM-004','limpieza',5800,I21,1,None),
]
a_clientes = [
  {'id':'ac-001','name':'Rosa Benítez','document':'','phone':'1155667788','fia':True,'saldoInicial':23400},
  {'id':'ac-002','name':'Carlos Ruiz','document':'','phone':'','fia':True},
  {'id':'ac-003','name':'Familia Acosta','document':'','phone':'1144556699','fia':True,'saldoInicial':41200},
  {'id':'ac-004','name':'Norma Villalba','document':'','phone':'','fia':True},
  {'id':'ac-005','name':'Comedor Los Peques','document':'30715556662','phone':'1147778899','fia':True,'saldoInicial':64000},
  {'id':'ac-006','name':'Hernán Medina','document':'','phone':'','fia':True,'saldoInicial':18700,'blocked':True,'blockedReason':'Libreta cerrada'},
  {'id':'ac-007','name':'Lucía Fernández','document':'27333444','phone':'1155505678'},
  {'id':'ac-008','name':'Ramiro Paz','document':'','phone':'1166778899'},
]
a_hist = {'semilla':20261008,'dias':10,'cerrado':[],'turnos':[[8,13],[17,21]],'ventasPorDia':[30,50],'factorSabado':1.2,
  'lineasPorVenta':[1,5],'medios':{'cash':40,'debit':25,'qr':20,'transfer':10,'credit':5},'pagoDivididoDesde':25000,
  'proporcionConCliente':0.3,'proporcionFiada':0.8,'probabilidadDeDescuento':0.02,'descuentos':[5,10],
  'probabilidadDeLineaLibre':0.03,'lineasLibres':[{'descripcion':'Bolsa de hielo','precios':[1500,2500]},{'descripcion':'Envío a domicilio','precios':[1000,2000]}],
  'cobranzasPorDia':0.8,'diaDeLaAnulacion':2,'fondoInicial':40000,'retiroAlCerrar':True,
  'egresos':[{'concepto':'Pago a proveedor','descripcion':'Distribuidora de lácteos','probabilidad':0.3,'montos':[20000,90000]},
             {'concepto':'Compra de mercadería','descripcion':'Verdulería del mercado','probabilidad':0.3,'montos':[15000,40000]},
             {'concepto':'Limpieza','probabilidad':0.1,'montos':[3000,8000]}],
  'arqueoProbabilidad':0.7,'diferenciasDeArqueo':[0,0,0,-100,-500,200,50]}

open('partes/datos-kiosco.gs','w').write(archivo('datosKiosco_','Kiosco','kiosco. Abierto todos los días de 7 a 23, muchas ventas chicas, casi todo en efectivo o QR.',productos('7799883','k',kiosco),k_clientes,k_hist))
open('partes/datos-almacen.gs','w').write(archivo('datosAlmacen_','Almacén','almacén de barrio. Fiambres, verduras y pan por peso; la libreta (cuenta corriente) es habitual.',productos('7799884','a',almacen),a_clientes,a_hist))
