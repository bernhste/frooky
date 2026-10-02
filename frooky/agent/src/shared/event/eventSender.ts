import { SEND_BATCH_SIZE, SEND_INTERVAL_MS } from "../defaultValues";
import { BaseEvent } from "./baseEvent";

let senderIntervalId: ReturnType<typeof setInterval> | null = null;
let runningQueue: BaseEvent[] | null = null;
let originalPush: ((...items: BaseEvent[]) => number) | null = null;

function defaultSendEvents(events: BaseEvent[]): void {
  const ndjson = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  send(ndjson);
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
