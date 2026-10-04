import { z } from 'zod';
import { PluginRegistrationError } from './errors';

export const PluginKindSchema = z.enum(['engine', 'collector', 'bridge']);
export type PluginKind = z.infer<typeof PluginKindSchema>;

export const PluginManifestSchema = z.object({
  name: z.string().min(1),
  kind: PluginKindSchema,
  version: z.string().min(1).optional(),
  description: z.string().optional(),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

/** Setup callback receiving the host's shared context. */
export type PluginSetup<Context extends object> = (
  context: Context,
) => void | Promise<void>;

/**
 * Minimal plugin host.
 *
 * Every capability in OpenMimic — including the official engines — is
 * assembled through this one path. There is no privileged registration route,
 * which is what makes "official engines are plugins too" more than a slogan.
 */
export class PluginHost<Context extends object = Record<string, unknown>> {
  private readonly manifests = new Map<string, PluginManifest>();

  constructor(readonly context: Context) {}

  async register(manifest: PluginManifest, setup: PluginSetup<Context>): Promise<void> {
    const parsed = PluginManifestSchema.parse(manifest);
    if (this.manifests.has(parsed.name)) {
      throw new PluginRegistrationError(`plugin already registered: ${parsed.name}`);
    }
    await setup(this.context);
    this.manifests.set(parsed.name, parsed);
  }

  list(): PluginManifest[] {
    return [...this.manifests.values()];
  }

  has(name: string): boolean {
    return this.manifests.has(name);
  }

  get(name: string): PluginManifest | undefined {
    return this.manifests.get(name);
  }
}
