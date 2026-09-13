import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { toZodIssues } from './zod-issues.ts';

describe('toZodIssues', () => {
  it('mapea path/message desde un ZodError', () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const result = schema.safeParse({ name: 123, age: 'x' });

    if (result.success) throw new Error('se esperaba que fallara');

    const issues = toZodIssues(result.error);
    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.path)).toEqual(['name', 'age']);
    expect(issues.every((issue) => typeof issue.message === 'string' && issue.message !== '')).toBe(
      true,
    );
  });
});
