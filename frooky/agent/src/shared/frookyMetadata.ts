/**
 * Target platform for hooks.
 *
 * @public
 */
export type Platform = "Android" | "iOS";

/**
 * Descriptive information about a hook file. Not used to install hooks.
 *
 * @public
 */
export interface FrookyMetadata {
  /**
   * Platform the hook file is written for.
   */
  platform?: Platform;

  /**
   * Name of the hook collection.
   */
  name?: string;

  /**
   * Short description of what the hooks capture.
   */
  description?: string;

  /**
   * Category of the hook collection, e.g. to group or filter events in an event parser.
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
