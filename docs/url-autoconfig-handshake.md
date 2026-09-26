# Especificación de Configuración Automática por URL y Handshake Seguro de Wipe

Este documento describe el protocolo de inicialización y vinculación remota del Offline POS a través de enlaces web (retorno desde Onboarding de Mini-ERP o distribución vía WhatsApp).

---

## 1. Parámetros de URL Reconocidos por el POS

El POS analiza los siguientes parámetros en `window.location.search` al momento de su inicialización (`bootstrap`):

| Parámetro | Requerido | Descripción | Ejemplo |
|---|---|---|---|
| `connector_url` / `base_url` | **Sí** | URL base del endpoint del conector REST. | `http://localhost:4100/connector` |
| `api_key` | **Sí** | Clave secreta emitida para la terminal POS (`v4.0.0`). | `pos_live_38bf8c69...` |
| `branch` | No | Código de sucursal (por defecto: `CENTRAL`). | `CENTRAL`, `SUC01` |
| `pos_terminal` | No | Nombre o identificación de la terminal/caja (por defecto: `Caja 1`). | `Caja 1`, `Mostrador` |
| `wipe_key` | No | Token criptográfico de autorización de borrado previo (handshake). | UUID emitido por la terminal |

---

## 2. Protocolo de Handshake Seguro (Modo Demo -> Onboarding -> POS)

Para evitar que un enlace malicioso borre los datos de una terminal en producción, el POS implementa una autorización de doble vía (*Handshake*):

```text
  [Offline POS (Modo Demo)]
         │
         │ 1. Usuario hace clic en "🚀 Conectar Mini-ERP"
         │ 2. POS genera `wipe_key` = UUID aleatorio
         │ 3. POS guarda en localStorage: `pending-wipe-key`
         ▼
  Redirección a Mini-ERP:
  /onboarding?return_url=http://localhost:5173/&wipe_key=UUID
         │
         │ 4. Comerciante crea su cuenta y su comercio en Mini-ERP
         │ 5. Mini-ERP aprovisiona base SQLite, catálogo y API Key
         ▼
  Retorno automático al POS:
  http://localhost:5173/?connector_url=...&api_key=...&wipe_key=UUID
         │
         │ 6. POS valida: incoming `wipe_key` === stored `pending-wipe-key`
         │
    ┌────┴───────────────────────────┐
    ▼                                ▼
[Coincide: Enfoque 3]         [No coincide o ausente]
Auto-wipe de datos demo       Si hay ventas previas: Enfoque 2
Descarga nuevo catálogo       (Precarga el wizard /CONFIG sin borrar)
Entra directo a /sale         Si la terminal está limpia: Auto-wipe
```

---

## 3. Flujo de Inicialización vía WhatsApp

Es común que el dueño de un negocio genere las credenciales en su computadora o celular e inicialice una terminal (tablet, PC de mostrador) enviándole el enlace por WhatsApp.

1. **En dispositivo nuevo o limpio (`hasUserData === false`):**
   * El POS detecta que no existen ventas ni turnos locales que proteger.
   * Aplica la configuración, descarga el catálogo semilla y queda listo para vender (`/sale`) de forma instantánea.
2. **En dispositivo con ventas reales previas y sin `wipe_key` (`hasUserData === true`):**
   * El POS activa la protección de integridad (Enfoque 2).
   * **No borra datos.** Precarga los campos de conexión en el asistente `/CONFIG` y le solicita confirmación al operador antes de cualquier descarte.

---

## 4. Limpieza Automática de la URL

Una vez procesada la configuración (sea exitosa o enviada a confirmación), el POS ejecuta:
```ts
window.history.replaceState({}, '', window.location.pathname);
```
Esto elimina los parámetros (`api_key`, `connector_url`, `wipe_key`) de la barra de direcciones del navegador, protegiendo las credenciales en caso de que el usuario recargue (F5) o comparta su pantalla.
