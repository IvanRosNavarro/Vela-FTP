import { z } from 'zod';

const id = z.string().min(1).max(100);
const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'color #rrggbb')
  .nullable();

export interface Project {
  id: string;
  name: string;
  color: string | null;
  position: string;
  collapsed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Bookmark {
  id: string;
  siteId: string;
  name: string;
  remotePath: string;
  localPath: string | null;
  position: string;
  createdAt: number;
  updatedAt: number;
}

export interface PathVisit {
  path: string;
  visitedAt: number;
}

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  color,
});
export type ProjectInput = z.output<typeof projectInputSchema>;

export const projectUpdateInputSchema = z.object({
  id,
  name: z.string().trim().min(1).max(200).optional(),
  color: color.optional(),
  collapsed: z.boolean().optional(),
});

export const projectIdInputSchema = z.object({ id });
export const projectMoveInputSchema = z.object({ id, beforeId: id.nullable(), afterId: id.nullable() });

/** Mover un sitio: a otro proyecto (o a ninguno) y entre dos vecinos de ese grupo. */
export const siteRelocateInputSchema = z.object({
  id,
  projectId: id.nullable(),
  beforeId: id.nullable(),
  afterId: id.nullable(),
});

export const bookmarkInputSchema = z.object({
  siteId: id,
  name: z.string().trim().min(1).max(200),
  remotePath: z.string().min(1).max(4096).startsWith('/'),
  localPath: z.string().min(1).max(4096).nullable(),
});
export type BookmarkInput = z.output<typeof bookmarkInputSchema>;

export const bookmarkUpdateInputSchema = z.object({
  id,
  name: z.string().trim().min(1).max(200).optional(),
  localPath: z.string().min(1).max(4096).nullable().optional(),
});

export const bookmarkIdInputSchema = z.object({ id });
export const siteHistoryInputSchema = z.object({ siteId: id, limit: z.number().int().min(1).max(200) });
