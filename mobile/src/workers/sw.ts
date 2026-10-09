/**
 * El service worker del POS mobile es el mismo que el de escritorio (#54): guarda todo el build al
 * instalarse y abre sin red. `build/sw-plugin.ts` compila este archivo desde la raíz del proyecto
 * que lo usa; acá solo se importa. Sus cachés llevan el nombre de la carpeta, como la base de datos.
 */
import '../../../src/workers/sw.ts';
