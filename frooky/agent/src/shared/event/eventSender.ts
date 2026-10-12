import { SEND_BATCH_SIZE, SEND_INTERVAL_MS } from "../defaultValues";
import { BaseEvent } from "./baseEvent";

let senderIntervalId: ReturnType<typeof setInterval> | null = null;
let runningQueue: BaseEvent[] | null = null;
let originalPush: ((...items: BaseEvent[]) => number) | null = null;

// One NDJSON line per event. An event that can't be serialized, e.g. with the wrapper of a Java object as a value, is
// dropped with an error, so it doesn't cost the other events.
export function serializeEvents(events: BaseEvent[]): string {
  let ndjson = "";
  for (const event of events) {
    try {
      ndjson += JSON.stringify(event) + "\n";
    } catch (error) {
      console.error(`Dropping an event that can't be serialized (${describeEvent(event)}): ${error}`);
    }
  }
  return ndjson;
}

// e.g. `hook-java org.owasp.mastestapp.MastgTest.receiveList`
function describeEvent(event: BaseEvent): string {
  const { javaClassName, method, module, symbol, offset } = event as unknown as Record<string, unknown>;
  const target = javaClassName !== undefined ? `${javaClassName}.${method}` : module !== undefined ? `${module}!${symbol ?? offset}` : undefined;
  return target ? `${event.type} ${target}` : String(event.type);
}

function defaultSendEvents(events: BaseEvent[]): void {
  const ndjson = serializeEvents(events);
  if (ndjson) send(ndjson);
}

export function startEventSender(
  eventQueue: BaseEvent[],
  sendInterval: number = SEND_INTERVAL_MS,
  sendFn: (events: BaseEvent[]) => void = defaultSendEvents,
  batchSize: number = SEND_BATCH_SIZE,
): void {
  if (senderIntervalId !== null) {
    return;
  }

  const effectiveBatchSize = Math.max(1, batchSize);
  runningQueue = eventQueue;
  originalPush = eventQueue.push;

  const flush = (minCount: number): void => {
    while (eventQueue.length >= minCount && eventQueue.length > 0) {
      const eventsToSend = eventQueue.splice(0, effectiveBatchSize);

      try {
        sendFn(eventsToSend);
      } catch (error) {
        console.error(`Failed to send events: ${error}`);
        eventQueue.unshift(...eventsToSend);
        break;
      }
    }
  };

  Object.defineProperty(eventQueue, "push", {
    value: function (...items: BaseEvent[]): number {
      const result = originalPush!.apply(this, items);
      flush(effectiveBatchSize);
      return result;
    },
    enumerable: false,
    configurable: true,
    writable: true,
  });

  flush(effectiveBatchSize);

  senderIntervalId = setInterval(() => {
    flush(1);
  }, sendInterval);
}

export function stopEventSender(): void {
  if (senderIntervalId !== null) {
    clearInterval(senderIntervalId);
    senderIntervalId = null;
  }
  if (runningQueue !== null) {
    delete (runningQueue as { push?: unknown }).push;
    runningQueue = null;
    originalPush = null;
  }
}
