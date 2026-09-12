import { ulid } from 'ulid';

/**
 * Único punto de la app que llama a `ulid()`. Todo lo demás (incluido
 * `domain/`, que no hace IO) recibe el id ya generado como parámetro.
 */
export const newId = (): string => ulid();
