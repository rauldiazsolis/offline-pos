// La home de la aplicación web (doGet). Sin preparar, el formulario para preparar la planilla.
// Preparada, abrir la planilla (en el Tablero) y abrir el POS con esta planilla, la sucursal y la
// caja en el link. La página se dibuja en el navegador con el estado que le pasa el servidor, y se
// redibuja con el que devuelve cada acción (posInicializar, posReiniciar, posAgregarTablero), sin
// recargar. Es pública: nunca muestra ni manda el secreto compartido.

/** Lo que la home necesita para dibujarse; también lo devuelven las acciones que llama. */
function estadoDeLaHome_() {
  var planilla = SpreadsheetApp.getActiveSpreadsheet();
  var estado = {
    inicializada: inicializada_(),
    contrato: CONTRACT_VERSION,
    modelos: MODELOS.map(function (modelo) {
      return {
        clave: modelo.clave,
        etiqueta: modelo.etiqueta,
        disponible: hayDatos_(modelo.clave),
      };
    }),
  };
  if (estado.inicializada) {
    var tablero = planilla.getSheetByName(TABLERO);
    estado.comercio = readConfigValue_('comercio') || planilla.getName();
    estado.sucursal = readConfigValue_('sucursal');
    estado.caja = readConfigValue_('caja');
    estado.tieneTablero = tablero !== null;
    // Directo al Tablero: el script no elige qué pestaña ve quien abre la planilla; el link sí.
    estado.planillaUrl = planilla.getUrl() + (tablero ? '#gid=' + tablero.getSheetId() : '');
    estado.posUrl = posUrl_();
    estado.webAppUrl = ScriptApp.getService().getUrl();
    estado.permitirReiniciar = normalize_(readConfigValue_('permitirReiniciar')) === 'si';
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

/** La página. No toma el lock ni crea pestañas: solo lee. */
function doGet() {
  // El estado va dentro de un <script>: "<" escapado, así ningún texto de la planilla lo cierra.
  var estado = JSON.stringify(estadoDeLaHome_()).replace(/</g, '\\u003c');
  return HtmlService.createHtmlOutput(HOME_HTML.replace('__ESTADO__', estado))
    .setTitle('POS · Google Sheets')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

var HOME_HTML = [
  '<!doctype html><html><head><base target="_blank"><style>',
  ':root{--texto:#1f2937;--suave:#6b7280;--borde:#d1d5db;--acento:#2563eb;--fondo:#f9fafb;',
  '--error:#b91c1c}',
  'body{font-family:system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem;',
  'color:var(--texto);background:#fff}',
  'h1{margin:0 0 .25rem;font-size:1.6rem}.sub{color:var(--suave);margin:0 0 1.5rem}',
  'label{display:block;font-weight:600;margin:1rem 0 .35rem}',
  'input[type=text]{width:100%;box-sizing:border-box;padding:.6rem .7rem;',
  'border:1px solid var(--borde);border-radius:.4rem;font:inherit}',
  'input::placeholder{color:#9ca3af}',
  '.modelos{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}',
  '.modelo{display:flex;gap:.5rem;align-items:center;border:1px solid var(--borde);',
  'border-radius:.4rem;padding:.6rem .7rem;font-weight:400;margin:0;cursor:pointer}',
  '.modelo.no{color:var(--suave);cursor:default}.modelo small{color:var(--suave)}',
  '.boton{display:inline-block;padding:.75rem 1.25rem;border-radius:.5rem;',
  'background:var(--acento);',
  'color:#fff;text-decoration:none;border:0;font:inherit;font-weight:600;cursor:pointer}',
  '.boton.sec{background:#fff;color:var(--acento);border:1px solid var(--acento)}',
  '.boton[disabled]{opacity:.6;cursor:default}',
  '.acciones{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.5rem}',
  '.caja{background:var(--fondo);border:1px solid var(--borde);border-radius:.5rem;padding:1rem;',
  'margin-top:1.5rem}',
  '.caja h2{font-size:1.05rem;margin:0}.nota{color:var(--suave);font-size:.9rem}',
  '.ok{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:.4rem;padding:.6rem .8rem}',
  '.error{color:var(--error);font-weight:600}',
  '.peligro{margin-top:2rem;border-top:1px solid var(--borde);padding-top:1rem}',
  '.peligro .boton{background:var(--error)}',
  '</style></head><body><div id="app"></div><script>',
  'var estado = __ESTADO__;',
  'var app = document.getElementById("app");',
  'function esc(t){return String(t==null?"":t).replace(/&/g,"&amp;").replace(/</g,"&lt;")',
  '  .replace(/>/g,"&gt;").replace(/"/g,"&quot;");}',
  'function b64url(t){return btoa(unescape(encodeURIComponent(t))).replace(/\\+/g,"-")',
  '  .replace(/\\//g,"_").replace(/=+$/,"");}',
  // El link que lee el POS: nunca lleva el secreto compartido.
  'function linkAlPos(caja){',
  '  var datos={type:"google-sheets",webAppUrl:estado.webAppUrl,branch:estado.sucursal,',
  '    pointOfSale:caja};',
  '  return estado.posUrl+"#connect="+b64url(JSON.stringify(datos));',
  '}',
  'function mostrarError(despuesDe,mensaje){var p=document.getElementById("error");',
  '  if(!p){p=document.createElement("p");p.id="error";p.className="error";',
  '  despuesDe.parentNode.insertBefore(p,despuesDe.nextSibling);}p.textContent=mensaje;}',
  'function llamar(funcion,argumento,boton,textoOriginal){',
  '  google.script.run.withSuccessHandler(function(nuevo){estado=nuevo;dibujar(nuevo.mensaje);})',
  '    .withFailureHandler(function(e){boton.disabled=false;boton.textContent=textoOriginal;',
  '      mostrarError(boton.parentNode,e.message);})[funcion](argumento);',
  '}',
  'function dibujar(mensaje){if(estado.inicializada){preparada(mensaje);}else{formulario();}}',
  'function formulario(){',
  '  var modelos=estado.modelos.map(function(m,i){',
  '    return "<label class=\\"modelo"+(m.disponible?"":" no")+"\\"><input type=radio name=modelo"',
  '      +" value=\\""+m.clave+"\\""+(m.disponible?"":" disabled")',
  '      +(i===0&&m.disponible?" checked":"")+"> "+esc(m.etiqueta)',
  '      +(m.disponible?"":" <small>(pronto)</small>")+"</label>";',
  '  }).join("")+"<label class=\\"modelo\\"><input type=radio name=modelo value=\\"\\"> Vacía"',
  '    +" <small>(empezar de cero)</small></label>";',
  '  app.innerHTML="<h1>Preparar la planilla</h1>"',
  '    +"<p class=sub>Para usarla con el POS. Contrato "+esc(estado.contrato)+"</p>"',
  '    +"<form id=f><label for=comercio>Nombre del comercio</label>"',
  '    +"<input type=text id=comercio placeholder=\\"ej. Ferretería El Tornillo\\" required>"',
  '    +"<label for=sucursal>Sucursal</label>"',
  '    +"<input type=text id=sucursal placeholder=\\"ej. Centro\\" required>"',
  '    +"<label for=caja>Caja</label>"',
  '    +"<input type=text id=caja placeholder=\\"ej. Caja 1\\" required>"',
  '    +"<label>Empezar con</label><div class=modelos>"+modelos+"</div>"',
  '    +"<p class=nota>Con un modelo, la planilla arranca con productos, clientes y diez días de"',
  '    +" ventas de ejemplo, para probar. Vacía, cargás tus productos y clientes.</p>"',
  '    +"<div class=acciones><button class=boton id=ir type=submit>Preparar la planilla</button>"',
  '    +"</div></form>";',
  '  document.getElementById("comercio").focus();',
  '  document.getElementById("f").onsubmit=function(ev){',
  '    ev.preventDefault();',
  '    var elegido=document.querySelector("input[name=modelo]:checked");',
  '    var boton=document.getElementById("ir");boton.disabled=true;',
  '    boton.textContent="Preparando… (puede tardar unos segundos)";',
  '    llamar("posInicializar",{comercio:document.getElementById("comercio").value,',
  '      sucursal:document.getElementById("sucursal").value,',
  '      caja:document.getElementById("caja").value,modelo:elegido?elegido.value:""},',
  '      boton,"Preparar la planilla");',
  '  };',
  '}',
  'function preparada(mensaje){',
  '  app.innerHTML="<h1>"+esc(estado.comercio)+"</h1><p class=sub>Sucursal "+esc(estado.sucursal)',
  '    +" · contrato "+esc(estado.contrato)+"</p>"',
  '    +(mensaje?"<p class=ok>Listo. "+esc(mensaje)+"</p>":"")',
  '    +"<div class=acciones><a class=\\"boton sec\\" id=planilla"',
  '    +" href=\\""+esc(estado.planillaUrl)',
  '    +"\\">Abrir la planilla</a></div>"',
  '    +(estado.tieneTablero?"":"<div class=caja><h2>Tablero</h2><p class=nota>Esta planilla"',
  '      +" todavía no tiene el Tablero: ventas del día, de la semana, medios de pago, lo más"',
  '      +" vendido y el fiado. Agregarlo no cambia nada más.</p><div class=acciones>"',
  '      +"<button class=\\"boton sec\\" id=tablero>Agregar el tablero</button></div></div>")',
  '    +"<div class=caja><h2>Abrir el POS en esta terminal</h2>"',
  '    +"<label for=caja>Caja</label><input type=text id=caja value=\\""+esc(estado.caja)+"\\">"',
  '    +"<p class=nota>Cada terminal es una caja: abrí esta página desde cada una y poné su"',
  '    +" nombre.</p><div class=acciones>"',
  '    +"<a class=boton id=pos href=\\"#\\">Abrir el POS</a></div>"',
  '    +"</div>"',
  '    +(estado.permitirReiniciar?"<div class=peligro><p class=nota>Reiniciar borra todas las"',
  '      +" pestañas de la planilla y vuelve al formulario.</p><div class=acciones>"',
  '      +"<button class=boton id=reiniciar>Reiniciar la planilla</button></div></div>":"");',
  '  var caja=document.getElementById("caja"),pos=document.getElementById("pos");',
  '  function actualizar(){pos.href=linkAlPos(caja.value.trim());}',
  '  caja.oninput=actualizar;actualizar();',
  '  var tablero=document.getElementById("tablero");',
  '  if(tablero){tablero.onclick=function(){tablero.disabled=true;',
  '    tablero.textContent="Agregando…";',
  '    llamar("posAgregarTablero",undefined,tablero,"Agregar el tablero");};}',
  '  var reiniciar=document.getElementById("reiniciar");',
  '  if(reiniciar){reiniciar.onclick=function(){reiniciar.disabled=true;',
  '    reiniciar.textContent="Reiniciando…";',
  '    llamar("posReiniciar",undefined,reiniciar,"Reiniciar la planilla");};}',
  '}',
  'dibujar();',
  '</script></body></html>',
].join('\n');
