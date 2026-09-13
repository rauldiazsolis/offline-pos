import type { z } from 'zod';

/** Convierte los issues de un ZodError a la forma que usan los ErrorCode de validación en ErrorMeta. */
export function toZodIssues(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}
