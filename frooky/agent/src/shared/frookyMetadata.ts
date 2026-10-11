/**
 * Target platform for hooks.
 *
 * @public
 */
export type Platform = "Android" | "iOS";

/**
 * Descriptive information about a hook file. Informational: it changes neither the hooks nor the events, and may
 * contain further fields of your own.
 *
 * @public
 */
export interface FrookyMetadata {
  /**
   * Platform the hook file is written for.
   */
  platform?: Platform;

  /**
   * Name of the hook file.
   */
  name?: string;

  /**
   * Short description of what the hooks capture.
   */
  description?: string;

  /**
   * Category of the hook file, e.g. `CRYPTO`.
   */
  category?: string;

  /**
   * Author or organization that maintains the hook file.
   */
  author?: string;

  /**
   * Version of the hook file.
   */
  version?: number;
}
