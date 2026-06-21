import { DecodedValue } from "../../shared/decoders/decodedValue";

/**
 * Represents the result of a decode java value.
 */
export interface JavaDecodedValue extends DecodedValue {
  /** The resolved implementation type of the decoded value at runtime. */
  implementationType: string | undefined;
}
