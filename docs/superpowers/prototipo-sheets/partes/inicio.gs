// ======================================================================================
// Inicialización (PRUEBA de UX): la home de la aplicación web la llama con lo que completa el
// comercio. Ojo: desde una página de HtmlService, cualquiera que abra la URL puede llamar a
// cualquier función pública del proyecto (google.script.run). Por eso las únicas públicas de acá
// son posInicializar (que se niega si la planilla ya está inicializada) y posReiniciar (que exige
// "Permitir reiniciar" = Sí en Configuración, algo que solo un editor de la planilla puede poner).
// ======================================================================================

/** El dispositivo de las filas de prueba: así se distinguen de lo que escriben las terminales. */
var DISPOSITIVO_DE_PRUEBA = 'datos-de-prueba';

/** Los modelos que ofrece la home: clave → etiqueta y la función de su archivo de datos. */
var MODELOS = [
  { clave: 'ferreteria', etiqueta: 'Ferretería' },
  { clave: 'kiosco', etiqueta: 'Kiosco' },
  { clave: 'almacen', etiqueta: 'Almacén' },
];

/** El orden de las pestañas después de inicializar. */
var ORDEN_DE_PESTANAS = ['Tablero', 'Productos', 'Clientes', 'Ventas', 'Pagos', 'CuentaCorriente', 'MovimientosCaja', 'Cobranzas', 'Configuración'];

var CLAVE_REINICIAR = 'Permitir reiniciar';

/** Inicializada = ya tiene la pestaña Productos (también una planilla anterior a esta prueba). */
function inicializada_() {
  return getSheet('Productos') !== null;
}

/**
 * Crea las pestañas, guarda comercio, sucursal y caja en Configuración, le pone a la planilla el
 * nombre del comercio (la empresa que muestra el POS) y carga los datos del modelo elegido.
 * opciones: { comercio, sucursal, caja, modelo: 'ferreteria' | 'kiosco' | 'almacen' | '' }.
 * Devuelve el estado de la home.
 */
function posInicializar(opciones) {
  var o = opciones || {};
  var comercio = textoDe_(o.comercio);
  var sucursal = textoDe_(o.sucursal);
  var caja = textoDe_(o.caja);
  if (!comercio) throw new Error('Falta el nombre del comercio.');
  if (!sucursal) throw new Error('Falta la sucursal.');
  if (!caja) throw new Error('Falta la caja.');
  var fuente = o.modelo ? fuenteDeDatos_(String(o.modelo)) : null;

  var resumen = conLock_(function () {
    if (inicializada_()) throw new Error('Esta planilla ya está inicializada.');
    var planilla = SpreadsheetApp.getActiveSpreadsheet();
    var vacias = planilla.getSheets().filter(function (hoja) {
      return hoja.getLastRow() === 0 && hoja.getLastColumn() === 0;
    });
    // La "Hoja 1" vacía de una planilla nueva pasa a ser el Tablero: quien tenga la planilla
    // abierta está parado ahí, y así termina viendo el Tablero (el script no le puede cambiar la
    // pestaña). Las otras vacías sobran.
    var tablero = vacias.shift() || null;
    if (tablero) tablero.setName(TABLERO);
    vacias.forEach(function (hoja) {
      planilla.deleteSheet(hoja);
    });
    ensureSheetsExist();
    ordenarPestanas_(planilla);
    planilla.rename(comercio);
    escribirConfiguracion_([
      ['Comercio', comercio],
      ['Sucursal', sucursal],
      ['Caja', caja],
      [CLAVE_REINICIAR, 'No'],
    ]);
    var resumen = fuente
      ? cargarDatos_(fuente(), { branch: sucursal, pointOfSale: caja })
      : 'Planilla vacía, lista para cargar productos y clientes.';
    planilla.setActiveSheet(crearTablero_(planilla, comercio, tablero));
    return resumen;
  });
  var estado = estadoDeLaHome_();
  estado.resumen = resumen;
  return estado;
}

/** Vuelve la planilla a cero (solo para probar): borra las pestañas del POS y deja una hoja vacía. */
function posReiniciar() {
  conLock_(function () {
    if (normalize(leerConfiguracion_(CLAVE_REINICIAR)) !== 'si') {
      throw new Error('Para reiniciar, poné "Sí" en "' + CLAVE_REINICIAR + '" (pestaña Configuración).');
    }
    var planilla = SpreadsheetApp.getActiveSpreadsheet();
    var nueva = planilla.insertSheet('Hoja 1', 0);
    planilla.getSheets().forEach(function (hoja) {
      if (hoja.getName() !== nueva.getName()) planilla.deleteSheet(hoja);
    });
    planilla.rename('Planilla sin inicializar');
  });
  return estadoDeLaHome_();
}

function ordenarPestanas_(planilla) {
  ORDEN_DE_PESTANAS.forEach(function (nombre, indice) {
    var hoja = planilla.getSheetByName(nombre);
    if (!hoja) return;
    planilla.setActiveSheet(hoja);
    planilla.moveActiveSheet(indice + 1);
  });
}

/** El valor de una clave de Configuración ('' si no está). */
function leerConfiguracion_(etiqueta) {
  var hoja = getSheet(CONFIG_SHEET);
  if (!hoja || hoja.getLastRow() === 0) return '';
  var filas = hoja.getRange(1, 1, hoja.getLastRow(), 2).getValues();
  for (var i = 0; i < filas.length; i++) {
    if (normalize(filas[i][0]) === normalize(etiqueta)) return String(filas[i][1]).trim();
  }
  return '';
}

// --------------------------------------------------------------------- piezas

function conLock_(trabajo) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    headerCache = {};
    return trabajo();
  } finally {
    lock.releaseLock();
  }
}

function textoDe_(valor) {
  return valor === undefined || valor === null ? '' : String(valor).trim();
}

/** La función del archivo de datos de cada rubro (se busca recién al usarla: cada uno es opcional). */
function fuenteDeDatos_(tipo) {
  var fuentes = {
    ferreteria: typeof datosFerreteria === 'function' ? datosFerreteria : null,
    kiosco: typeof datosKiosco === 'function' ? datosKiosco : null,
    almacen: typeof datosAlmacen === 'function' ? datosAlmacen : null,
  };
  if (!fuentes[tipo]) {
    throw new Error('Todavía no hay datos de prueba para ese modelo.');
  }
  return fuentes[tipo];
}

/** Escribe pares clave/valor en Configuración: actualiza la clave si está, si no la agrega arriba. */
function escribirConfiguracion_(pares) {
  var hoja = getSheet(CONFIG_SHEET);
  pares
    .slice()
    .reverse()
    .forEach(function (par) {
      var filas = hoja.getRange(1, 1, Math.max(hoja.getLastRow(), 1), 1).getValues();
      for (var i = 0; i < filas.length; i++) {
        if (normalize(filas[i][0]) === normalize(par[0])) {
          hoja.getRange(i + 1, 2).setValue(par[1]);
          return;
        }
      }
      hoja.insertRowsAfter(1, 1);
      hoja.getRange(2, 1, 1, 2).setValues([par]);
      hoja.getRange(2, 1).setFontWeight('bold');
    });
}

// --------------------------------------------------------- datos de prueba

/**
 * Carga productos, clientes y una historia de días anteriores a hoy (ventas, pagos, cuenta
 * corriente, cobranzas y movimientos de caja), con las fechas relativas a hoy. La historia es
 * siempre la misma para un mismo rubro (generador pseudoaleatorio con semilla fija): solo se
 * corren las fechas.
 */
function cargarDatos_(datos, origen) {
  var historia = datos.historia;
  var azar = generador_(historia.semilla || 1);
  var hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  var inicio = sumarDias_(hoy, -historia.dias);
  var alta = sumarDias_(inicio, -30).toISOString();

  var productos = datos.productos.map(function (p) {
    return Object.assign({}, p, { createdAt: p.createdAt || alta, blocked: p.blocked ? 'yes' : undefined });
  });
  var clientes = datos.clientes.map(function (c) {
    return Object.assign({}, c, { createdAt: c.createdAt || alta, blocked: c.blocked ? 'yes' : undefined });
  });
  var vendibles = productos.filter(function (p) {
    return !p.blocked;
  });
  var compradores = clientes.filter(function (c) {
    return !c.blocked;
  });
  var sello = { deviceId: DISPOSITIVO_DE_PRUEBA, branch: origen.branch, pointOfSale: origen.pointOfSale };
  var filas = { Ventas: [], Pagos: [], CuentaCorriente: [], MovimientosCaja: [], Cobranzas: [] };
  var saldos = {};
  var efectivo = 0;
  var cuentas = { ventas: 0, cobranzas: 0, anulaciones: 0 };

  // Saldos anteriores a la historia: deudas que ya venían de antes.
  clientes.forEach(function (c) {
    if (c.saldoInicial) {
      filas.CuentaCorriente.push(Object.assign({ fecha: inicio.toISOString(), customerId: c.id, monto: c.saldoInicial }, sello));
      saldos[c.id] = c.saldoInicial;
    }
  });

  var primerDia = true;
  for (var d = historia.dias; d >= 1; d--) {
    var dia = sumarDias_(hoy, -d);
    if (historia.cerrado.indexOf(dia.getDay()) !== -1) continue;
    var eventos = [];

    if (primerDia && historia.fondoInicial) {
      eventos.push({ tipo: 'caja', minuto: historia.turnos[0][0] * 60, direccion: 'in', monto: historia.fondoInicial, concepto: 'Fondo de cambio' });
      primerDia = false;
    }
    var cantidad = entre_(azar, historia.ventasPorDia[0], historia.ventasPorDia[1]);
    if (dia.getDay() === 6 && historia.factorSabado) cantidad = Math.round(cantidad * historia.factorSabado);
    for (var v = 0; v < cantidad; v++) {
      eventos.push({ tipo: 'venta', minuto: minutoAbierto_(azar, historia.turnos) });
    }
    historia.egresos.forEach(function (e) {
      if (azar() < e.probabilidad) {
        eventos.push({ tipo: 'caja', minuto: minutoAbierto_(azar, historia.turnos), direccion: 'out', monto: redondear_(entre_(azar, e.montos[0], e.montos[1]), 100), concepto: e.concepto, descripcion: e.descripcion });
      }
    });
    if (azar() < historia.cobranzasPorDia) {
      eventos.push({ tipo: 'cobranza', minuto: minutoAbierto_(azar, historia.turnos) });
    }
    eventos.sort(function (a, b) {
      return a.minuto - b.minuto;
    });
    // La anulación, el primer día abierto desde `diaDeLaAnulacion` (si ese día está cerrado, el siguiente).
    if (d <= historia.diaDeLaAnulacion && cuentas.anulaciones === 0) {
      eventos.anular = true;
    }

    var ticket = 0;
    var recibo = 0;
    var ventasDelDia = [];
    var fechaDia = fechaLocal_(dia);
    for (var i = 0; i < eventos.length; i++) {
      var ev = eventos[i];
      var cuando = new Date(dia.getTime() + ev.minuto * 60000 + entre_(azar, 0, 59) * 1000);
      if (ev.tipo === 'venta') {
        var venta = armarVenta_(azar, historia, vendibles, compradores, cuando);
        venta.ticket = ++ticket;
        venta.fechaTicket = fechaDia;
        escribirVenta_(filas, venta, sello);
        venta.pagos.forEach(function (p) {
          if (p.medio === 'cash') efectivo += p.monto;
          if (p.medio === 'account') saldos[venta.cliente] = (saldos[venta.cliente] || 0) + p.monto;
        });
        ventasDelDia.push(venta);
        cuentas.ventas++;
        // La anulación: un rato después de una venta sin cuenta corriente, a mitad del día.
        if (eventos.anular && !venta.cliente && ventasDelDia.length >= 3) {
          eventos.anular = false;
          var anulacion = armarAnulacion_(azar, venta, new Date(cuando.getTime() + entre_(azar, 10, 40) * 60000));
          anulacion.ticket = ++ticket;
          anulacion.fechaTicket = fechaDia;
          escribirVenta_(filas, anulacion, sello);
          venta.filas.forEach(function (f) {
            f.estado = 'anulada';
          });
          anulacion.pagos.forEach(function (p) {
            if (p.medio === 'cash') efectivo += p.monto;
          });
          cuentas.anulaciones++;
        }
      } else if (ev.tipo === 'caja') {
        if (ev.direccion === 'out' && ev.monto > efectivo) continue;
        efectivo += ev.direccion === 'in' ? ev.monto : -ev.monto;
        filas.MovimientosCaja.push(movimientoDeCaja_(azar, cuando, ev.direccion, ev.monto, ev.concepto, ev.descripcion, 'manual', sello));
      } else if (ev.tipo === 'cobranza') {
        // Paga un cliente con deuda; el bloqueado no (justamente por eso está bloqueado).
        var deudores = Object.keys(saldos).filter(function (id) {
          return saldos[id] >= 5000 && buscar_(compradores, id);
        });
        if (deudores.length === 0) continue;
        var deudor = deudores[entre_(azar, 0, deudores.length - 1)];
        var total = Math.min(saldos[deudor], redondear_(saldos[deudor] * (0.4 + azar() * 0.6), 1000));
        var medio = azar() < 0.6 ? 'cash' : 'transfer';
        var id = ulid_(cuando, azar);
        filas.Cobranzas.push(
          Object.assign(
            { customerPaymentId: id, fecha: cuando.toISOString(), customerId: deudor, medio: medio, monto: total, totalCobranza: total, fechaRecibo: fechaDia, numeroRecibo: ++recibo, estado: 'cerrada' },
            sello,
          ),
        );
        filas.CuentaCorriente.push(Object.assign({ fecha: cuando.toISOString(), customerId: deudor, monto: -total, customerPaymentId: id }, sello));
        saldos[deudor] -= total;
        if (medio === 'cash') efectivo += total;
        cuentas.cobranzas++;
      }
    }

    // Cierre del día: retiro de lo que sobra del fondo y, a veces, arqueo con una diferencia chica.
    var cierre = new Date(dia.getTime() + historia.turnos[historia.turnos.length - 1][1] * 3600000);
    if (historia.retiroAlCerrar && efectivo > historia.fondoInicial * 2) {
      var retiro = redondear_(efectivo - historia.fondoInicial, 1000);
      efectivo -= retiro;
      filas.MovimientosCaja.push(movimientoDeCaja_(azar, new Date(cierre.getTime() - 600000), 'out', retiro, 'Retiro', 'Retiro del día', 'manual', sello));
    }
    if (azar() < historia.arqueoProbabilidad) {
      var diferencia = historia.diferenciasDeArqueo[entre_(azar, 0, historia.diferenciasDeArqueo.length - 1)];
      if (diferencia !== 0) {
        var esperado = redondear_(efectivo, 0.01);
        var movimiento = movimientoDeCaja_(azar, cierre, diferencia > 0 ? 'in' : 'out', Math.abs(diferencia), 'Ajuste por arqueo', '', 'count-adjustment', sello);
        movimiento.esperado = esperado;
        movimiento.contado = redondear_(esperado + diferencia, 0.01);
        filas.MovimientosCaja.push(movimiento);
        efectivo += diferencia;
      }
    }
  }

  appendObjects('Productos', productos);
  appendObjects('Clientes', clientes);
  Object.keys(filas).forEach(function (nombre) {
    appendObjects(nombre, filas[nombre]);
  });
  return (
    datos.nombre + ': ' + productos.length + ' productos, ' + clientes.length + ' clientes, ' +
    cuentas.ventas + ' ventas, ' + cuentas.anulaciones + (cuentas.anulaciones === 1 ? ' anulación, ' : ' anulaciones, ') + cuentas.cobranzas +
    ' cobranzas y ' + filas.MovimientosCaja.length + ' movimientos de caja en los últimos ' +
    historia.dias + ' días.'
  );
}

function armarVenta_(azar, historia, productos, clientes, cuando) {
  var venta = { id: ulid_(cuando, azar), fecha: cuando, cliente: '', lineas: [], pagos: [] };
  if (azar() < historia.proporcionConCliente && clientes.length > 0) {
    venta.cliente = clientes[entre_(azar, 0, clientes.length - 1)].id;
  }
  var cantidadDeLineas = entre_(azar, historia.lineasPorVenta[0], historia.lineasPorVenta[1]);
  var usados = {};
  for (var i = 0; i < cantidadDeLineas; i++) {
    var p = elegirPonderado_(azar, productos);
    if (usados[p.id]) continue;
    usados[p.id] = true;
    var opciones = p.cantidades || [1];
    var linea = { tipo: 'product', productId: p.id, descripcion: p.name, cantidad: opciones[entre_(azar, 0, opciones.length - 1)], precio: p.price };
    if (azar() < historia.probabilidadDeDescuento) {
      linea.descuento = historia.descuentos[entre_(azar, 0, historia.descuentos.length - 1)];
    }
    venta.lineas.push(linea);
  }
  if (azar() < historia.probabilidadDeLineaLibre) {
    var libre = historia.lineasLibres[entre_(azar, 0, historia.lineasLibres.length - 1)];
    venta.lineas.push({ tipo: 'freeform', descripcion: libre.descripcion, cantidad: 1, precio: redondear_(entre_(azar, libre.precios[0], libre.precios[1]), 100) });
  }
  venta.total = redondear_(
    venta.lineas.reduce(function (suma, l) {
      return suma + importeDeLinea_(l);
    }, 0),
    0.01,
  );

  var cliente = venta.cliente ? buscar_(clientes, venta.cliente) : null;
  if (cliente && cliente.fia && azar() < historia.proporcionFiada) {
    venta.pagos.push({ medio: 'account', monto: venta.total });
  } else if (venta.total > historia.pagoDivididoDesde && azar() < 0.3) {
    var enEfectivo = redondear_(venta.total * 0.4, 1000);
    venta.pagos.push({ medio: 'cash', monto: enEfectivo });
    venta.pagos.push({ medio: 'debit', monto: redondear_(venta.total - enEfectivo, 0.01) });
  } else {
    venta.pagos.push({ medio: elegirMedio_(azar, historia.medios), monto: venta.total });
  }
  return venta;
}

/** La anulación es otra venta con las líneas y los pagos invertidos que apunta a la original. */
function armarAnulacion_(azar, original, cuando) {
  return {
    id: ulid_(cuando, azar),
    fecha: cuando,
    cliente: original.cliente,
    lineas: original.lineas.map(function (l) {
      return Object.assign({}, l, { cantidad: -l.cantidad });
    }),
    pagos: original.pagos.map(function (p) {
      return { medio: p.medio, monto: -p.monto };
    }),
    total: -original.total,
    anulaA: original.id,
    motivo: 'El cliente devolvió la mercadería',
  };
}

function importeDeLinea_(linea) {
  var bruto = redondear_(linea.cantidad * linea.precio, 0.01);
  if (!linea.descuento) return bruto;
  return redondear_(bruto * (1 - linea.descuento / 100), 0.01);
}

/** Agrega las filas de una venta (Ventas, Pagos y, si se fió, CuentaCorriente) y las guarda en `venta.filas`. */
function escribirVenta_(filas, venta, sello) {
  var fecha = venta.fecha.toISOString();
  venta.filas = [];
  venta.lineas.forEach(function (l, i) {
    var fila = Object.assign(
      {
        saleId: venta.id,
        fecha: fecha,
        customerId: venta.cliente,
        linea: i + 1,
        tipo: l.tipo,
        productId: l.productId,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precioUnitario: l.precio,
        descuentoTipo: l.descuento ? 'percentage' : undefined,
        descuentoValor: l.descuento,
        totalVenta: venta.total,
        estado: 'cerrada',
        motivoAnulacion: venta.motivo,
        anulaA: venta.anulaA,
        fechaTicket: venta.fechaTicket,
        numeroTicket: venta.ticket,
      },
      sello,
    );
    filas.Ventas.push(fila);
    venta.filas.push(fila);
  });
  venta.pagos.forEach(function (p) {
    var fila = Object.assign({ saleId: venta.id, fecha: fecha, medio: p.medio, monto: p.monto, estado: 'cerrada' }, sello);
    filas.Pagos.push(fila);
    venta.filas.push(fila);
    if (p.medio === 'account') {
      filas.CuentaCorriente.push(Object.assign({ fecha: fecha, saleId: venta.id, customerId: venta.cliente, monto: p.monto }, sello));
    }
  });
}

function movimientoDeCaja_(azar, cuando, direccion, monto, concepto, descripcion, origen, sello) {
  return Object.assign(
    {
      movementId: ulid_(cuando, azar),
      fecha: cuando.toISOString(),
      direccion: direccion,
      monto: monto,
      concepto: concepto,
      descripcion: descripcion || undefined,
      origenMovimiento: origen,
    },
    sello,
  );
}

// ------------------------------------------------------------------- utilidades

/** Generador pseudoaleatorio con semilla (mulberry32): la misma semilla da la misma historia. */
function generador_(semilla) {
  var a = semilla >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function entre_(azar, minimo, maximo) {
  return minimo + Math.floor(azar() * (maximo - minimo + 1));
}

function redondear_(valor, paso) {
  return Math.round(Math.round(valor / paso) * paso * 100) / 100;
}

function sumarDias_(fecha, dias) {
  var resultado = new Date(fecha.getTime());
  resultado.setDate(resultado.getDate() + dias);
  return resultado;
}

/** Un minuto del día (desde la medianoche) dentro de alguno de los horarios de atención. */
function minutoAbierto_(azar, turnos) {
  var turno = turnos[entre_(azar, 0, turnos.length - 1)];
  return entre_(azar, turno[0] * 60, turno[1] * 60 - 1);
}

/** La fecha de calendario local (la del ticket), en el huso del proyecto de Apps Script. */
function fechaLocal_(fecha) {
  function dos(n) {
    return (n < 10 ? '0' : '') + n;
  }
  return fecha.getFullYear() + '-' + dos(fecha.getMonth() + 1) + '-' + dos(fecha.getDate());
}

function elegirPonderado_(azar, items) {
  var total = items.reduce(function (s, it) {
    return s + (it.frecuencia || 1);
  }, 0);
  var tiro = azar() * total;
  for (var i = 0; i < items.length; i++) {
    tiro -= items[i].frecuencia || 1;
    if (tiro < 0) return items[i];
  }
  return items[items.length - 1];
}

function elegirMedio_(azar, medios) {
  var lista = Object.keys(medios).map(function (medio) {
    return { medio: medio, frecuencia: medios[medio] };
  });
  return elegirPonderado_(azar, lista).medio;
}

function buscar_(lista, id) {
  return lista.filter(function (x) {
    return x.id === id;
  })[0];
}

/** Un ULID (como los ids que genera el POS): 10 caracteres de tiempo y 16 al azar. */
function ulid_(fecha, azar) {
  var alfabeto = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  var tiempo = fecha.getTime();
  var texto = '';
  for (var i = 0; i < 10; i++) {
    texto = alfabeto.charAt(tiempo % 32) + texto;
    tiempo = Math.floor(tiempo / 32);
  }
  for (var j = 0; j < 16; j++) {
    texto += alfabeto.charAt(Math.floor(azar() * 32));
  }
  return texto;
}
