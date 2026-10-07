// El Tablero: una pestaña con fórmulas vivas sobre Ventas, Pagos, CuentaCorriente y Clientes. Se
// arma al preparar la planilla (o con posAgregarTablero, en una planilla preparada antes), con las
// columnas que el puente encuentra en ese momento; si después se mueven columnas, Sheets ajusta
// solo las referencias de las fórmulas. Las funciones van en inglés: Sheets las acepta así en
// cualquier idioma; los separadores, no (ver usaComa_).

/**
 * Agrega el Tablero a una planilla preparada que no lo tiene (una de antes), primero en el orden y
 * sin tocar nada más. Pública: la home la ofrece en esa planilla.
 */
function posAgregarTablero() {
  conLock_(function () {
    if (!inicializada_()) throw new Error('Primero hay que preparar la planilla.');
    var planilla = SpreadsheetApp.getActiveSpreadsheet();
    if (planilla.getSheetByName(TABLERO)) throw new Error('Esta planilla ya tiene tablero.');
    crearTablero_(planilla, readConfigValue_('comercio') || planilla.getName());
  });
}

/** Los 10 productos que más facturaron (cantidad × precio, sin descuentos) en los 7 días. */
var CONSULTA_MAS_VENDIDOS =
  "select Col1, sum(Col2), sum(Col3) where Col4 = true and Col1 <> '' group by Col1 " +
  "order by sum(Col3) desc limit 10 label Col1 'Producto', sum(Col2) 'Cantidad', " +
  "sum(Col3) 'Importe'";

/** El saldo de cada cliente en el libro de cuenta corriente, de mayor a menor. */
var CONSULTA_FIADO =
  "select Col1, sum(Col2) where Col1 <> '' group by Col1 order by sum(Col2) desc " +
  "label Col1 'Cliente', sum(Col2) 'Saldo'";

/** Montos sin decimales, con separador de miles (el formato respeta el idioma de la planilla). */
var FORMATO_MONTO = '"$"#,##0';

/** Arma el Tablero en `hoja` (vacía) o, sin ella, en una pestaña nueva al principio. */
function crearTablero_(planilla, comercio, hoja) {
  if (!hoja) {
    var anterior = planilla.getSheetByName(TABLERO);
    if (anterior) planilla.deleteSheet(anterior);
    hoja = planilla.insertSheet(TABLERO, 0);
  }
  separadorConComa = usaComa_(hoja);

  var venta = rangosDe_('Ventas', ['saleId', 'fecha', 'descripcion', 'cantidad', 'precioUnitario']);
  var pago = rangosDe_('Pagos', ['fecha', 'medio', 'monto']);
  var cuenta = rangosDe_('CuentaCorriente', ['customerId', 'monto']);
  var cliente = rangosDe_('Clientes', ['id', 'name']);

  hoja.getRange('A1').setValue(comercio).setFontSize(18).setFontWeight('bold');
  hoja
    .getRange('A2')
    .setValue(
      'Se actualiza solo con cada venta que llega del POS. ' +
        'Los montos ya descuentan las anulaciones.',
    )
    .setFontColor('#6b7280');

  // Indicadores.
  var hoy = '">="&TODAY()';
  var manana = '"<"&(TODAY()+1)';
  var indicadores = [
    [
      'Vendido hoy',
      '=SUMIFS(' +
        pago.monto +
        ';' +
        pago.fecha +
        ';' +
        hoy +
        ';' +
        pago.fecha +
        ';' +
        manana +
        ')',
      FORMATO_MONTO,
    ],
    [
      'Tickets hoy',
      '=COUNTUNIQUEIFS(' +
        venta.saleId +
        ';' +
        venta.fecha +
        ';' +
        hoy +
        ';' +
        venta.fecha +
        ';' +
        manana +
        ')',
      '0',
    ],
    [
      'Vendido en 7 días',
      '=SUMIFS(' + pago.monto + ';' + pago.fecha + ';">="&(TODAY()-6))',
      FORMATO_MONTO,
    ],
    ['Fiado pendiente', '=SUM(' + cuenta.monto + ')', FORMATO_MONTO],
  ];
  // A, C y E; el fiado en L, arriba de "Fiado por cliente".
  var columnas = [1, 3, 5, 12];
  indicadores.forEach(function (indicador, i) {
    var columna = columnas[i];
    hoja.getRange(4, columna).setValue(indicador[0]).setFontColor('#6b7280');
    hoja
      .getRange(5, columna)
      .setFormula(formula_(indicador[1]))
      .setNumberFormat(indicador[2])
      .setFontSize(20)
      .setFontWeight('bold');
  });

  // Ventas por día, de hace 13 días a hoy.
  titulo_(hoja, 'A7', 'Ventas por día (14 días)');
  encabezado_(hoja, 'A8:C8', ['Día', 'Vendido', 'Tickets']);
  for (var d = 0; d < 14; d++) {
    var fila = 9 + d;
    var dia = 'A' + fila;
    hoja
      .getRange(dia)
      .setFormula('=TODAY()-' + (13 - d))
      .setNumberFormat('ddd dd/mm');
    hoja
      .getRange('B' + fila)
      .setFormula(
        formula_(
          '=SUMIFS(' +
            pago.monto +
            ';' +
            pago.fecha +
            ';">="&' +
            dia +
            ';' +
            pago.fecha +
            ';"<"&(' +
            dia +
            '+1))',
        ),
      )
      .setNumberFormat(FORMATO_MONTO);
    hoja
      .getRange('C' + fila)
      .setFormula(
        formula_(
          '=COUNTUNIQUEIFS(' +
            venta.saleId +
            ';' +
            venta.fecha +
            ';">="&' +
            dia +
            ';' +
            venta.fecha +
            ';"<"&(' +
            dia +
            '+1))',
        ),
      );
  }

  // Medios de pago de los últimos 7 días.
  titulo_(hoja, 'E7', 'Medios de pago (7 días)');
  encabezado_(hoja, 'E8:F8', ['Medio', 'Monto']);
  var medios = Object.keys(VALUE_LABELS.medio);
  medios.forEach(function (medio, i) {
    var fila = 9 + i;
    hoja.getRange('E' + fila).setValue(VALUE_LABELS.medio[medio]);
    hoja
      .getRange('F' + fila)
      .setFormula(
        formula_(
          '=SUMIFS(' +
            pago.monto +
            ';' +
            pago.medio +
            ';E' +
            fila +
            ';' +
            pago.fecha +
            ';">="&(TODAY()-6))',
        ),
      )
      .setNumberFormat(FORMATO_MONTO);
  });

  // Los 10 productos que más facturaron en 7 días (cantidad × precio, sin descuentos).
  titulo_(hoja, 'H7', 'Más vendidos (7 días)');
  hoja
    .getRange('H8')
    .setFormula(
      formula_(
        '=IFERROR(ARRAYFORMULA(QUERY({' +
          venta.descripcion +
          '\\' +
          venta.cantidad +
          '\\' +
          venta.cantidad +
          '*' +
          venta.precioUnitario +
          '\\' +
          venta.fecha +
          '>=TODAY()-6};' +
          '"' +
          CONSULTA_MAS_VENDIDOS +
          '"; 0)); "Todavía no hay ventas")',
      ),
    );
  hoja.getRange('H8:J8').setFontWeight('bold');
  hoja.getRange('J9:J18').setNumberFormat(FORMATO_MONTO);
  hoja.getRange('I9:I18').setNumberFormat('#,##0.###');

  // Quién debe: el saldo de cada cliente en el libro de cuenta corriente.
  titulo_(hoja, 'L7', 'Fiado por cliente');
  hoja
    .getRange('L8')
    .setFormula(
      formula_(
        '=IFERROR(QUERY(QUERY(ARRAYFORMULA({IFERROR(VLOOKUP(' +
          cuenta.customerId +
          ';{' +
          cliente.id +
          '\\' +
          cliente.name +
          '};2;FALSE);' +
          cuenta.customerId +
          ')\\' +
          cuenta.monto +
          '});' +
          '"' +
          CONSULTA_FIADO +
          '"; 0); "select * where Col2 <> 0"; 1); "Nadie debe nada")',
      ),
    );
  hoja.getRange('L8:M8').setFontWeight('bold');
  hoja.getRange('M9:M60').setNumberFormat(FORMATO_MONTO);

  // Gráfico de ventas por día.
  var grafico = hoja
    .newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(hoja.getRange('A9:B22'))
    .setPosition(24, 1, 0, 0)
    .setOption('title', 'Vendido por día')
    .setOption('legend', { position: 'none' })
    .setOption('width', 720)
    .setOption('height', 300)
    .build();
  hoja.insertChart(grafico);

  [110, 110, 70, 20, 150, 110, 20, 230, 80, 110, 20, 200, 110].forEach(function (ancho, i) {
    hoja.setColumnWidth(i + 1, ancho);
  });
  hoja.setFrozenRows(2);
  return hoja;
}

/**
 * Los separadores de una fórmula dependen del idioma de la planilla: con coma decimal (español),
 * ";" entre argumentos y "\" entre columnas de un arreglo; con punto decimal, "," para las dos
 * cosas. Se prueba una fórmula en una celda y se borra.
 */
var separadorConComa = true;

function usaComa_(hoja) {
  var prueba = hoja.getRange('Z1');
  prueba.setFormula('=SUM(1,2)');
  SpreadsheetApp.flush();
  var anda = prueba.getValue() === 3;
  prueba.clear();
  return anda;
}

/**
 * Las fórmulas se escriben con ";" y "\" (como en español) y se pasan a "," si hace falta. Ningún
 * texto de las fórmulas del tablero lleva ";" ni "\": las consultas de QUERY tienen sus comas.
 */
function formula_(texto) {
  return separadorConComa ? texto.replace(/;/g, ',').replace(/\\/g, ',') : texto;
}

function titulo_(hoja, celda, texto) {
  hoja.getRange(celda).setValue(texto).setFontWeight('bold').setFontSize(12);
}

function encabezado_(hoja, rango, textos) {
  hoja.getRange(rango).setValues([textos]).setFontWeight('bold');
}

/** `Pestaña!$C$2:$C` de cada clave, según la columna donde el puente la encuentra hoy. */
function rangosDe_(nombre, claves) {
  var mapa = headerMap_(getSheet_(nombre), nombre).map;
  var rangos = {};
  claves.forEach(function (clave) {
    // Las del tablero son todas requeridas: headerMap_ ya avisa si falta una.
    var letra = letraDeColumna_(mapa[clave]);
    rangos[clave] = nombre + '!$' + letra + '$2:$' + letra;
  });
  return rangos;
}

function letraDeColumna_(numero) {
  var letra = '';
  while (numero > 0) {
    var resto = (numero - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    numero = Math.floor((numero - 1) / 26);
  }
  return letra;
}
