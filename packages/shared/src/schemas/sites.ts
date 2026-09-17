import { z } from 'zod';

export const remoteProtocolSchema = z.enum(['ftp', 'ftps', 'ftps-implicit', 'sftp']);
export const authMethodSchema = z.enum(['password', 'key', 'agent', 'anonymous']);

/** Secreto en un formulario: undefined = no tocar, null = borrar, string = nuevo valor. */
const secretField = z.string().max(4096).nullable().optional();

export const siteInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    protocol: remoteProtocolSchema,
    host: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[^\s/]+$/, 'host sin espacios ni barras'),
    port: z.number().int().min(1).max(65535),
    username: z.string().max(255),
    auth: authMethodSchema,
    keyPath: z.string().max(4096).nullable(),
    initialRemotePath: z.string().max(4096).startsWith('/').nullable(),
    initialLocalPath: z.string().max(4096).nullable(),
    maxConnections: z.number().int().min(1).max(10),
    notes: z.string().max(4000),
    /** undefined al editar = no cambiar de proyecto. */
    projectId: z.string().min(1).max(100).nullable().optional(),
    password: secretField,
    passphrase: secretField,
  })
  .superRefine((site, ctx) => {
    if (site.auth === 'key' && site.protocol !== 'sftp') {
      ctx.addIssue({ code: 'custom', path: ['auth'], message: 'La autenticación con clave solo existe en SFTP' });
    }
    if (site.auth === 'agent' && site.protocol !== 'sftp') {
      ctx.addIssue({ code: 'custom', path: ['auth'], message: 'El agente SSH solo existe en SFTP' });
    }
    if (site.auth === 'key' && !site.keyPath) {
      ctx.addIssue({ code: 'custom', path: ['keyPath'], message: 'Falta la ruta de la clave privada' });
    }
  });

export type SiteInput = z.output<typeof siteInputSchema>;

export interface Site {
  id: string;
  name: string;
  protocol: z.output<typeof remoteProtocolSchema>;
  host: string;
  port: number;
  username: string;
  auth: z.output<typeof authMethodSchema>;
  keyPath: string | null;
  initialRemotePath: string | null;
  initialLocalPath: string | null;
  maxConnections: number;
  notes: string;
  projectId: string | null;
  position: string;
  /** Los secretos nunca salen de main; solo si existen. */
  hasPassword: boolean;
  hasPassphrase: boolean;
  createdAt: number;
  updatedAt: number;
}

const id = z.string().min(1).max(100);

export const siteIdInputSchema = z.object({ id });
export const siteUpdateInputSchema = z.object({ id, site: siteInputSchema });
export const siteMoveInputSchema = z.object({ id, beforeId: id.nullable(), afterId: id.nullable() });

export const trustFingerprintInputSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  fingerprint: z.string().min(1).max(200),
  keyType: z.string().max(100).nullable(),
  /** true = sustituir las huellas anteriores de ese tipo (clave SSH o certificado). */
  replace: z.boolean(),
});

export const masterPasswordInputSchema = z.object({
  current: z.string().max(1024).nullable(),
  next: z.string().min(8).max(1024).nullable(),
});

export const unlockInputSchema = z.object({ password: z.string().min(1).max(1024) });
