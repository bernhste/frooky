import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { decodeFields, useJavaClass } from "../../utils/javaValues";

// Optional values (altitude, accuracy, speed, bearing) are null when the location has none.
export class LocationDecoder extends Decoder<Java.Wrapper> {
  readonly decoderName = "LocationDecoder";
  readonly description =
    "Decodes an `android.location.Location`: provider, coordinates, accuracy in meters, altitude, speed, bearing, time and whether it is mocked.";

  decode(value: Java.Wrapper): DecodedValue {
    if (value == null) return { type: this.type, name: this.name, value: null };
    const location = Java.cast(value, useJavaClass("android.location.Location"));
    return {
      type: this.type,
      name: this.name,
      value: decodeFields(this.type, {
        provider: () => location.getProvider(),
        latitude: () => location.getLatitude(),
        longitude: () => location.getLongitude(),
        accuracy: () => (location.hasAccuracy() ? location.getAccuracy() : null),
        altitude: () => (location.hasAltitude() ? location.getAltitude() : null),
        speed: () => (location.hasSpeed() ? location.getSpeed() : null),
        bearing: () => (location.hasBearing() ? location.getBearing() : null),
        time: () => new Date(Number(location.getTime())).toISOString(),
        // isMock() since API 31, isFromMockProvider() before
        mock: () => (location.isMock ? location.isMock() : location.isFromMockProvider()),
      }),
    };
  }
}
