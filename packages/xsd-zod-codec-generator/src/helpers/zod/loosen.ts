import type { z } from 'zod';

export function zloosen<Z extends z.ZodObject<any, any, any>>(z: Z): Z {
  return (z as any).loose() as Z & { ['@_xlmns']?: string };
}
