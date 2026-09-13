# Issues conocidos / a revisar

Lista de detalles que se anotan a medida que aparecen, para no interrumpir el trabajo en curso.
Se revisan juntos en los puntos de corte entre fases — anotar acá no implica arreglar ya.

## Abiertos

- **Motor de sync sin protección contra ciclos solapados** (`sync/engine.ts::startSyncEngine`): el
  loop dispara `runSyncCycle` cada 15s + en el evento `online` + bajo demanda (`/SINCRONIZAR`), sin
  ninguna guarda que impida que dos ciclos corran en paralelo si uno tarda más que el intervalo (una
  API lenta de verdad, no simulada en los tests actuales). No debería corromper nada — el backend
  dedupe por `Idempotency-Key` — pero es tráfico de red duplicado innecesario. Nunca se probó porque
  los dobles de test (`Connector` fake, `fetch` mockeado) resuelven todo al instante, sin delay.
