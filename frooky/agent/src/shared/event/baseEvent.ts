import { uuidv4 } from "../utils";

export abstract class BaseEvent {
  readonly id: string = uuidv4();
  readonly timestamp: string = new Date().toISOString();
  type: string = "";
}
