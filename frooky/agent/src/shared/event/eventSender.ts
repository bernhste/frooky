import { SEND_INTERVAL_MS } from "../defaultValues";
import { BaseEvent } from "./baseEvent";

let senderIntervalId: ReturnType<typeof setInterval> | null = null;

export function startEventSender(eventQueue: BaseEvent[], sendInterval: number = SEND_INTERVAL_MS, sendFn: typeof send = send): void {
  if (senderIntervalId !== null) {
    return; // already running
  }

  senderIntervalId = setInterval(() => {
    if (eventQueue.length === 0) return;

    const eventsToSend = eventQueue.splice(0, eventQueue.length);

    try {
      sendFn(eventsToSend);
    } catch (error) {
      console.error(`Failed to send events: ${error}`);
      eventQueue.unshift(...eventsToSend);
    }
  }, sendInterval);
}

export function stopEventSender(): void {
  if (senderIntervalId !== null) {
    clearInterval(senderIntervalId);
    senderIntervalId = null;
  }
}
