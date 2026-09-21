/**
 * Puente HTTP entre el POS y esta planilla (conector de Google Sheets, #67).
 *
 * Un solo endpoint: doPost(e). Request (Content-Type text/plain, para evitar
 * el preflight CORS que Apps Script no maneja):
 *   { action, payload, idempotencyKey?, sharedSecret? }
 * Response (siempre HTTP 200 — Apps Script no deja controlar el status):
 *   { ok: true, data } | { ok: false, error }
 *
 * Desplegar como Web App: "Execute as: Me", "Who has access: Anyone".
 * Secreto compartido opcional: propiedad de script SHARED_SECRET
 * (Project Settings > Script properties). Si existe, todo request debe
 * traer el mismo `sharedSecret`.
 *
 * Diseño: cada request toma el lock del script de punta a punta (varias
 * terminales pueden sincronizar a la vez contra la misma planilla). Las
 * lecturas también lo toman — simple y seguro para el volumen de un
 * micro-comercio.
 */

var HEADERS = {
  Productos: ['id', 'sku', 'barcodes', 'name', 'price', 'taxRate', 'category'],
  Clientes: ['id', 'name', 'document', 'phone', 'createdAt'],
  Ventas: [
    'saleId',
    'fecha',
    'customerId',
    'linea',
    'tipo',
    'productId',
    'descripcion',
    'cantidad',
    'precioUnitario',
    'descuentoTipo',
    'descuentoValor',
    'totalVenta',
    'ajusteGlobalPct',
    'estado',
    'anuladaEn',
    'motivoAnulacion',
  ],
  Pagos: ['saleId', 'fecha', 'medio', 'monto', 'referencia', 'estado'],
  CuentaCorriente: ['fecha', 'holdId', 'saleId', 'customerId', 'monto'],
  Turnos: [
    'sessionId',
    'abiertoEn',
    'cerradoEn',
    'aperturaEfectivo',
    'contadoEfectivo',
    'ventas',
    'cash',
    'debit',
    'credit',
    'transfer',
    'qr',
    'account',
    'efectivoEsperado',
    'diferencia',
  ],
  _Idempotency: ['key', 'at'],
};

// Columnas que se fuerzan a texto plano: que Sheets no convierta un código de barras
// o un ISO 8601 en número/fecha.
var TEXT_COLUMNS = {
  Productos: ['id', 'sku', 'barcodes'],
  Clientes: ['id', 'document', 'phone', 'createdAt'],
  Ventas: ['saleId', 'fecha', 'customerId', 'productId', 'anuladaEn'],
  Pagos: ['saleId', 'fecha', 'referencia'],
  CuentaCorriente: ['fecha', 'holdId', 'saleId', 'customerId'],
  Turnos: ['sessionId', 'abiertoEn', 'cerradoEn'],
  _Idempotency: ['key', 'at'],
};

// Datos de prueba: solo se siembran cuando esta llamada CREA la pestaña.
var SEED = {
  Productos: [
    ['p-001', 'SKU-001', '7790001000011', 'Gaseosa cola 500ml', 1200, 0.21, 'bebidas'],
    ['p-002', 'SKU-002', '7790001000028,7790001000035', 'Alfajor triple', 900, 0.21, 'golosinas'],
    ['p-003', 'SKU-003', '7790001000042', 'Yerba 1kg', 4500, 0.21, 'almacen'],
    ['p-004', 'SKU-004', '', 'Pan (kg)', 2200, 0.105, 'panaderia'],
    ['p-005', 'SKU-005', '7790001000059', 'Agua mineral 1.5L', 1100, 0.21, 'bebidas'],
  ],
  Clientes: [
    ['c-001', 'Ana Gómez', '30111222', '1155501234', '2026-01-01T00:00:00.000Z'],
    ['c-002', 'Carlos Ruiz', '', '', '2026-01-01T00:00:00.000Z'],
    ['c-003', 'Lucía Fernández', '27333444', '1155505678', '2026-01-01T00:00:00.000Z'],
  ],
};

var ACTIONS = {
  pullProducts: pullProducts,
  pullCustomers: pullCustomers,
  pushSale: idempotent(pushSale),
  pushSaleVoid: idempotent(pushSaleVoid),
  pushCustomer: idempotent(pushCustomer),
  pushAccountHoldConfirm: idempotent(pushAccountHoldConfirm),
  pushCashSession: idempotent(pushCashSession),
};

// ---------------------------------------------------------------- entrada

function doGet() {
  // Health check para probar el despliegue desde el navegador.
  return respond({ ok: true, data: { service: 'pos-sheets-bridge' } });
}

function doPost(e) {
  var request;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (error) {
    return respond({ ok: false, error: 'El body no es JSON válido' });
  }
  if (!request || typeof request.action !== 'string') {
    return respond({ ok: false, error: 'Falta action' });
  }

  var expectedSecret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (expectedSecret && request.sharedSecret !== expectedSecret) {
    return respond({ ok: false, error: 'Secreto compartido inválido' });
  }

  var handler = ACTIONS[request.action];
  if (!handler) {
    return respond({ ok: false, error: 'Acción desconocida: ' + request.action });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (error) {
    return respond({ ok: false, error: 'Planilla ocupada, reintentar' });
  }
  try {
    ensureSheetsExist();
    return respond({ ok: true, data: handler(request.payload || {}, request.idempotencyKey) });
  } catch (error) {
    return respond({ ok: false, error: String(error && error.message ? error.message : error) });
  } finally {
    lock.releaseLock();
  }
}

function respond(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

// ------------------------------------------------------- auto-provisión

function ensureSheetsExist() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(function (name) {
    if (spreadsheet.getSheetByName(name)) {
      return;
    }
    var headers = HEADERS[name];
    var sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    (TEXT_COLUMNS[name] || []).forEach(function (header) {
      sheet.getRange(1, headers.indexOf(header) + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
    });
    if (SEED[name]) {
      appendRows(name, SEED[name]);
    }
    if (name === '_Idempotency') {
      sheet.hideSheet();
    }
  });
}

// --------------------------------------------------------------- helpers

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function appendRows(name, rows) {
  if (rows.length === 0) {
    return;
  }
  var sheet = getSheet(name);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/** Filas de datos como objetos { header: valor, _row: nº de fila en la hoja }. */
function readRows(name) {
  var sheet = getSheet(name);
  var last = sheet.getLastRow();
  if (last < 2) {
    return [];
  }
  var headers = HEADERS[name];
  return sheet
    .getRange(2, 1, last - 1, headers.length)
    .getValues()
    .map(function (values, index) {
      var row = { _row: index + 2 };
      headers.forEach(function (header, column) {
        row[header] = values[column];
      });
      return row;
    });
}

function setCells(name, rowNumber, values) {
  var sheet = getSheet(name);
  var headers = HEADERS[name];
  Object.keys(values).forEach(function (header) {
    sheet.getRange(rowNumber, headers.indexOf(header) + 1).setValue(values[header]);
  });
}

/** Devuelve un objeto sin las claves vacías — así el JSON no manda '' donde el POS espera "ausente". */
function compact(object) {
  var result = {};
  Object.keys(object).forEach(function (key) {
    var value = object[key];
    if (value !== '' && value !== null && value !== undefined) {
      result[key] = value;
    }
  });
  return result;
}

function orEmpty(value) {
  return value === undefined || value === null ? '' : value;
}

/**
 * Envuelve una acción de escritura: si la key ya está en _Idempotency responde
 * éxito sin reescribir; si no, escribe y recién ahí registra la key.
 */
function idempotent(write) {
  return function (payload, key) {
    if (!key) {
      throw new Error('Falta idempotencyKey');
    }
    if (hasKey(key)) {
      return {};
    }
    write(payload);
    appendRows('_Idempotency', [[key, new Date().toISOString()]]);
    return {};
  };
}

function hasKey(key) {
  return readRows('_Idempotency').some(function (row) {
    return String(row.key) === key;
  });
}

// ----------------------------------------------------------------- pulls

function pullProducts() {
  var items = readRows('Productos')
    .filter(function (row) {
      return row.id !== '' && row.name !== '' && !isNaN(Number(row.price));
    })
    .map(function (row) {
      return {
        id: String(row.id),
        sku: String(row.sku),
        barcodes: String(row.barcodes)
          .split(',')
          .map(function (code) {
            return code.trim();
          })
          .filter(function (code) {
            return code !== '';
          }),
        name: String(row.name),
        price: Number(row.price),
        taxRate: Number(row.taxRate),
        category: String(row.category),
      };
    });
  return { items: items };
}

function pullCustomers() {
  var items = readRows('Clientes')
    .filter(function (row) {
      return row.id !== '' && row.name !== '';
    })
    .map(function (row) {
      return compact({
        id: String(row.id),
        name: String(row.name),
        document: String(row.document),
        phone: String(row.phone),
      });
    });
  return { items: items };
}

// ---------------------------------------------------------------- pushes

function pushSale(payload) {
  var sale = payload.sale;
  if (!sale || !sale.id) {
    throw new Error('Falta sale');
  }
  var lineRows = sale.lines.map(function (line, index) {
    var discount = line.discount || {};
    return [
      sale.id,
      sale.createdAt,
      orEmpty(sale.customerId),
      index + 1,
      line.kind,
      orEmpty(line.productId),
      orEmpty(line.description),
      line.qty,
      line.unitPrice,
      orEmpty(discount.type),
      orEmpty(discount.value),
      sale.total,
      orEmpty(sale.globalAdjustmentPercentage),
      'cerrada',
      '',
      '',
    ];
  });
  var paymentRows = sale.payments.map(function (payment) {
    return [
      sale.id,
      sale.createdAt,
      payment.method,
      payment.amount,
      orEmpty(payment.reference),
      'cerrada',
    ];
  });
  appendRows('Ventas', lineRows);
  appendRows('Pagos', paymentRows);
}

/** Marca (no borra, RNF-07) las filas de una venta; devuelve cuántas encontró. */
function markSaleRows(sheetName, saleId, values) {
  var count = 0;
  readRows(sheetName).forEach(function (row) {
    if (String(row.saleId) === saleId) {
      setCells(sheetName, row._row, values);
      count++;
    }
  });
  return count;
}

function pushSaleVoid(payload) {
  var found = markSaleRows('Ventas', payload.saleId, {
    estado: 'anulada',
    anuladaEn: payload.voidedAt,
    motivoAnulacion: orEmpty(payload.voidReason),
  });
  if (found === 0) {
    // La venta todavía no llegó: el motor de sync reintenta con backoff.
    throw new Error('Venta no encontrada: ' + payload.saleId);
  }
  markSaleRows('Pagos', payload.saleId, { estado: 'anulada' });
}

function pushCustomer(payload) {
  var customer = payload.customer;
  if (!customer || !customer.id) {
    throw new Error('Falta customer');
  }
  appendRows('Clientes', [
    [
      customer.id,
      customer.name,
      orEmpty(customer.document),
      orEmpty(customer.phone),
      customer.createdAt,
    ],
  ]);
}

/**
 * Ledger de fiado. El POS solo manda { holdId, saleId }: el cliente sale de la
 * fila de Ventas y el monto de la fila de Pagos (medio "account") de esa venta.
 */
function pushAccountHoldConfirm(payload) {
  var saleId = payload.saleId;
  var saleRow = readRows('Ventas').filter(function (row) {
    return String(row.saleId) === saleId;
  })[0];
  var paymentRow = readRows('Pagos').filter(function (row) {
    return String(row.saleId) === saleId && row.medio === 'account';
  })[0];
  if (!saleRow || !paymentRow) {
    throw new Error('Venta a cuenta no encontrada: ' + saleId);
  }
  appendRows('CuentaCorriente', [
    [
      new Date().toISOString(),
      payload.holdId,
      saleId,
      String(saleRow.customerId),
      Number(paymentRow.monto),
    ],
  ]);
}

/**
 * Resumen de un turno cerrado. Suma Pagos de las ventas del turno con estado
 * "cerrada" (las anuladas no cuentan), igual que
 * domain/cash-session.ts::calculateCashSessionSummary en el POS.
 */
function pushCashSession(payload) {
  var session = payload.session;
  if (!session || !session.id) {
    throw new Error('Falta session');
  }
  var inSession = {};
  session.sales.forEach(function (id) {
    inSession[id] = true;
  });
  var totals = { cash: 0, debit: 0, credit: 0, transfer: 0, qr: 0, account: 0 };
  var countedSales = {};
  readRows('Pagos').forEach(function (row) {
    var saleId = String(row.saleId);
    if (inSession[saleId] && row.estado === 'cerrada' && totals[row.medio] !== undefined) {
      totals[row.medio] += Number(row.monto);
      countedSales[saleId] = true;
    }
  });
  var expectedCash = session.openingAmount + totals.cash;
  var counted = session.closingAmount;
  appendRows('Turnos', [
    [
      session.id,
      session.openedAt,
      orEmpty(session.closedAt),
      session.openingAmount,
      orEmpty(counted),
      Object.keys(countedSales).length,
      totals.cash,
      totals.debit,
      totals.credit,
      totals.transfer,
      totals.qr,
      totals.account,
      expectedCash,
      counted === undefined ? '' : counted - expectedCash,
    ],
  ]);
}
