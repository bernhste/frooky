import Java from "frida-java-bridge";
import { DEFAULT_DECODER_SETTINGS } from "../../../../shared/defaultValues";
import { LocationDecoder } from "./LocationDecoder";

describe("LocationDecoder", () => {
  it("decodes the coordinates and leaves unset optional values null", () => {
    const location = Java.use("android.location.Location").$new("gps");
    location.setLatitude(47.3769);
    location.setLongitude(8.5417);
    location.setAccuracy(5);
    location.setTime(0);
    const decoder = new LocationDecoder({ type: "android.location.Location", settings: DEFAULT_DECODER_SETTINGS });

    expect(decoder.decode(location)).toEqual({
      type: "android.location.Location",
      value: {
        provider: "gps",
        latitude: 47.3769,
        longitude: 8.5417,
        accuracy: 5,
        altitude: null,
        speed: null,
        bearing: null,
        time: "1970-01-01T00:00:00.000Z",
        mock: false,
      },
    });
  });
});
