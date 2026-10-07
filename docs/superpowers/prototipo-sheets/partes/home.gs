// ======================================================================================
// La home de la aplicación web (PRUEBA de UX). Sin inicializar: el formulario. Inicializada:
// abrir la planilla y abrir el POS con esta planilla, la sucursal y la caja en el link.
// ======================================================================================

/** Lo que la home necesita para dibujarse; también lo devuelven posInicializar y posReiniciar. */
function estadoDeLaHome_() {
  var planilla = SpreadsheetApp.getActiveSpreadsheet();
  var estado = {
    inicializada: inicializada_(),
    contrato: CONTRACT_VERSION,
    modelos: MODELOS.map(function (m) {
      return { clave: m.clave, etiqueta: m.etiqueta, disponible: hayDatos_(m.clave) };
    }),
  };
  if (estado.inicializada) {
    estado.comercio = leerConfiguracion_('Comercio') || planilla.getName();
    estado.sucursal = leerConfiguracion_('Sucursal');
    estado.caja = leerConfiguracion_('Caja');
    // Directo al Tablero (el script no elige qué pestaña ve quien abre la planilla; el link sí).
    var tablero = planilla.getSheetByName(TABLERO);
    estado.planillaUrl = planilla.getUrl() + (tablero ? '#gid=' + tablero.getSheetId() : '');
    estado.posUrl = posUrl();
    estado.webAppUrl = ScriptApp.getService().getUrl();
    estado.permitirReiniciar = normalize(leerConfiguracion_(CLAVE_REINICIAR)) === 'si';
  }
  return estado;
}

function hayDatos_(clave) {
  try {
    fuenteDeDatos_(clave);
    return true;
  } catch (error) {
    return false;
  }
}

function doGet() {
  if (typeof CONFIG_LABELS === 'undefined') {
    return htmlPage('<p>Falta el archivo columnas.gs en el proyecto de Apps Script.</p>');
  }
  var estado = JSON.stringify(estadoDeLaHome_()).replace(/</g, '\\u003c');
  return HtmlService.createHtmlOutput(HOME_HTML.replace('__ESTADO__', estado))
    .setTitle('POS · Google Sheets')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

var HOME_HTML = [
  '<!doctype html><html><head><base target="_blank"><style>',
  ':root{--texto:#1f2937;--suave:#6b7280;--borde:#d1d5db;--acento:#2563eb;--fondo:#f9fafb;--error:#b91c1c}',
  'body{font-family:system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem;color:var(--texto);background:#fff}',
  'h1{margin:0 0 .25rem;font-size:1.6rem}.sub{color:var(--suave);margin:0 0 1.5rem}',
  'label{display:block;font-weight:600;margin:1rem 0 .35rem}',
  'input[type=text]{width:100%;box-sizing:border-box;padding:.6rem .7rem;border:1px solid var(--borde);border-radius:.4rem;font:inherit}',
  'input::placeholder{color:#9ca3af}',
  '.modelos{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}',
  '.modelo{display:flex;gap:.5rem;align-items:center;border:1px solid var(--borde);border-radius:.4rem;padding:.6rem .7rem;font-weight:400;margin:0;cursor:pointer}',
  '.modelo.no{color:var(--suave);cursor:default}.modelo small{color:var(--suave)}',
  '.boton{display:inline-block;padding:.75rem 1.25rem;border-radius:.5rem;background:var(--acento);color:#fff;text-decoration:none;font-weight:600;border:0;font:inherit;font-weight:600;cursor:pointer}',
  '.boton.sec{background:#fff;color:var(--acento);border:1px solid var(--acento)}',
  '.boton[disabled]{opacity:.6;cursor:default}',
  '.acciones{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.5rem}',
  '.caja{background:var(--fondo);border:1px solid var(--borde);border-radius:.5rem;padding:1rem;margin-top:1.5rem}',
  '.caja h2{font-size:1.05rem;margin:0}.nota{color:var(--suave);font-size:.9rem}',
  '.ok{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:.4rem;padding:.6rem .8rem}',
  '.error{color:var(--error);font-weight:600}',
  '.peligro{margin-top:2rem;border-top:1px solid var(--borde);padding-top:1rem}',
  '.peligro .boton{background:var(--error)}',
  '</style></head><body><div id="app"></div><script>',
  'var estado = __ESTADO__;',
  'var app = document.getElementById("app");',
  'function esc(t){return String(t==null?"":t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}',
  'function b64url(t){return btoa(unescape(encodeURIComponent(t))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");}',
  'function linkAlPos(caja){',
  '  var datos={type:"google-sheets",webAppUrl:estado.webAppUrl,branch:estado.sucursal,pointOfSale:caja};',
  '  return estado.posUrl+"#connect="+b64url(JSON.stringify(datos));',
  '}',
  'function dibujar(mensaje){ if(estado.inicializada){lista(mensaje);}else{formulario(mensaje);} }',
  'function formulario(error){',
  '  var modelos=estado.modelos.map(function(m,i){',
  '    return "<label class=\\"modelo"+(m.disponible?"":" no")+"\\"><input type=radio name=modelo value=\\""+m.clave+"\\""+(m.disponible?"":" disabled")+(i===0&&m.disponible?" checked":"")+"> "+esc(m.etiqueta)+(m.disponible?"":" <small>(pronto)</small>")+"</label>";',
  '  }).join("")+"<label class=\\"modelo\\"><input type=radio name=modelo value=\\"\\"> Vacía <small>(empezar de cero)</small></label>";',
  '  app.innerHTML="<h1>Preparar la planilla</h1><p class=sub>Para usarla con el POS. Contrato "+esc(estado.contrato)+"</p>"+',
  '    "<form id=f><label for=comercio>Nombre del comercio</label><input type=text id=comercio placeholder=\\"ej. Ferretería El Tornillo\\" required>"+',
  '    "<label for=sucursal>Sucursal</label><input type=text id=sucursal placeholder=\\"ej. Centro\\" required>"+',
  '    "<label for=caja>Caja</label><input type=text id=caja placeholder=\\"ej. Caja 1\\" required>"+',
  '    "<label>Empezar con</label><div class=modelos>"+modelos+"</div>"+',
  '    "<p class=nota>Con un modelo, la planilla arranca con productos, clientes y una semana de ventas de ejemplo, para probar. Vacía, cargás tus productos y clientes.</p>"+',
  '    (error?"<p class=error>"+esc(error)+"</p>":"")+',
  '    "<div class=acciones><button class=boton id=ir type=submit>Preparar la planilla</button></div></form>";',
  '  document.getElementById("comercio").focus();',
  '  document.getElementById("f").onsubmit=function(ev){',
  '    ev.preventDefault();',
  '    var elegido=document.querySelector("input[name=modelo]:checked");',
  '    var boton=document.getElementById("ir"); boton.disabled=true; boton.textContent="Preparando… (puede tardar unos segundos)";',
  '    google.script.run.withSuccessHandler(function(nuevo){estado=nuevo;dibujar(nuevo.resumen);})',
  '      .withFailureHandler(function(e){boton.disabled=false;boton.textContent="Preparar la planilla";var p=document.querySelector(".error");if(!p){p=document.createElement("p");p.className="error";boton.parentNode.before(p);}p.textContent=e.message;})',
  '      .posInicializar({comercio:document.getElementById("comercio").value,sucursal:document.getElementById("sucursal").value,caja:document.getElementById("caja").value,modelo:elegido?elegido.value:""});',
  '  };',
  '}',
  'function lista(mensaje){',
  '  app.innerHTML="<h1>"+esc(estado.comercio)+"</h1><p class=sub>Sucursal "+esc(estado.sucursal)+" · contrato "+esc(estado.contrato)+"</p>"+',
  '    (mensaje?"<p class=ok>Listo. "+esc(mensaje)+"</p>":"")+',
  '    "<div class=acciones><a class=\\"boton sec\\" href=\\""+esc(estado.planillaUrl)+"\\">Abrir la planilla</a></div>"+',
  '    "<div class=caja><h2>Abrir el POS en esta terminal</h2>"+',
  '    "<label for=caja>Caja</label><input type=text id=caja value=\\""+esc(estado.caja)+"\\">"+',
  '    "<p class=nota>Cada terminal es una caja: abrí esta página desde cada una y poné su nombre.</p>"+',
  '    "<div class=acciones><a class=boton id=pos href=\\"#\\">Abrir el POS</a></div></div>"+',
  '    (estado.permitirReiniciar?"<div class=peligro><p class=nota>Reiniciar borra todas las pestañas de la planilla y vuelve a este formulario.</p><button class=boton id=reiniciar>Reiniciar la planilla</button></div>":"");',
  '  var caja=document.getElementById("caja"), pos=document.getElementById("pos");',
  '  function actualizar(){pos.href=linkAlPos(caja.value.trim());}',
  '  caja.oninput=actualizar; actualizar();',
  '  var r=document.getElementById("reiniciar");',
  '  if(r){r.onclick=function(){r.disabled=true;r.textContent="Reiniciando…";',
  '    google.script.run.withSuccessHandler(function(nuevo){estado=nuevo;dibujar();})',
  '      .withFailureHandler(function(e){r.disabled=false;r.textContent="Reiniciar la planilla";alert(e.message);}).posReiniciar();};}',
  '}',
  'dibujar();',
  '</script></body></html>',
].join('\n');
