import Java from "frida-java-bridge";
import { Decoder } from "../../../../shared/decoders/baseDecoder";
import { DecodedValue } from "../../../../shared/decoders/decodedValue";
import { IterableDecoder } from "../../java/lang/IterableDecoder";
import { BundleDecoder } from "../os/BundleDecoder";
import { ClipDataDecoder } from "./clipData/ClipDataDecoder";
import { ComponentNameDecoder } from "./ComponentNameDecoder";
import { IntentFlagDecoder } from "./IntentFlagDecoder";

type DecodedIntent = {
  action: string | null;
  data: string | null;
  type: string | null;
  package: string | null;
  component: DecodedValue | null;
  selector: DecodedValue | null;
  flags: DecodedValue;
  categories: DecodedValue | null;
  extras: DecodedValue | null;
  clipData: DecodedValue | null;
};

export class IntentDecoder extends Decoder<Java.Wrapper> {
  decode(value: Java.Wrapper): DecodedValue {
    const flagDecoder = new IntentFlagDecoder({
      type: "android.content.IntentFlagDecoder",
      settings: this.decodable.settings,
    });

    // categories
    const categoriesDecoder = new IterableDecoder({
      type: "java.util.Set<String>",
      settings: this.decodable.settings,
    });
    const categories = value.getCategories();

    // components
    const componentDecoder = new ComponentNameDecoder({
      type: "android.content.ComponentName",
      settings: this.decodable.settings,
    });
    const componentName = value.getComponent();

    // extras can be decoded with the BundleDecoder
    const extrasDecoder = new BundleDecoder({
      type: "android.os.Bundle",
      settings: this.decodable.settings,
    });
    const extrasBundle = value.getExtras();

    // clip
    const clipDataDecoder = new ClipDataDecoder({
      type: "android.content.ClipData",
      settings: this.decodable.settings,
    });
    const clipData = value.getClipData();

    // selector: the Intent that resolution/routing is actually performed against instead of this
    // one - relevant for intent redirection analysis, so decode it the same way as the intent itself
    const selectorDecoder = new IntentDecoder({
      type: "android.content.Intent",
      settings: this.decodable.settings,
    });
    const selector = value.getSelector();

    const decoded: DecodedIntent = {
      action: value.getAction()?.toString() ?? null,
      data: value.getDataString()?.toString() ?? null,
      type: value.getType()?.toString() ?? null,
      package: value.getPackage()?.toString() ?? null,
      component: componentName ? componentDecoder.decode(componentName) : null,
      selector: selector ? selectorDecoder.decode(selector) : null,
      flags: flagDecoder.decode(value.getFlags()),
      categories: categories ? categoriesDecoder.decode(categories) : null,
      extras: extrasBundle ? extrasDecoder.decode(extrasBundle) : null,
      clipData: clipData ? clipDataDecoder.decode(clipData) : null,
    };

    return {
      type: this.decodable.type,
      value: decoded,
    };
  }
}
