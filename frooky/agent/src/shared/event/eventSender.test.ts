import { SEND_INTERVAL_MS } from "../defaultValues";
import { BaseEvent } from "./baseEvent";
import { startEventSender, stopEventSender } from "./eventSender";

class TestEvent extends BaseEvent {
  constructor(public readonly value: string) {
    super();
    this.type = "test-event";
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("eventSender", () => {
  afterEach(() => {
    // stop any interval left running by the test so state doesn't leak between tests
    stopEventSender();
  });

  describe("startEventSender()", () => {
    it("does nothing while the queue is empty", async () => {
      const sendSpy = fn();
      const queue: BaseEvent[] = [];

      startEventSender(queue, 10, sendSpy);
      await wait(30);

      expect(sendSpy).not.toHaveBeenCalled();
    });

    it("sends and drains a single queued event on the configured interval", async () => {
      const sendSpy = fn();
      const event = new TestEvent("hello");
      const queue: BaseEvent[] = [event];

      startEventSender(queue, 10, sendSpy);
      await wait(30);

      expect(sendSpy).toHaveBeenCalledWith([event]);
      expect(queue).toEqual([]);
    });

    it("batches all events queued since the previous tick into a single send call", async () => {
      const sendSpy = fn();
      const eventA = new TestEvent("a");
      const eventB = new TestEvent("b");
      const queue: BaseEvent[] = [];

      startEventSender(queue, 30, sendSpy);
      queue.push(eventA, eventB);
      await wait(60);

      expect(sendSpy.mock.calls[0]).toEqual([[eventA, eventB]]);
      expect(queue).toEqual([]);
    });

    it("uses the default send interval when none is provided", async () => {
      const sendSpy = fn();
      const event = new TestEvent("default-interval");
      const queue: BaseEvent[] = [event];

      startEventSender(queue, undefined, sendSpy);
      await wait(SEND_INTERVAL_MS - 50);
      expect(sendSpy).not.toHaveBeenCalled();

      await wait(100);
      expect(sendSpy).toHaveBeenCalledWith([event]);
    });

    it("puts the events back at the front of the queue when send() throws", async () => {
      const sendSpy = fn(() => {
        throw new Error("boom");
      });
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const event = new TestEvent("retry-me");
      const queue: BaseEvent[] = [event];

      startEventSender(queue, 10, sendSpy);
      await wait(30);

      expect(queue).toEqual([event]);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it("does not start a second interval when one is already running", async () => {
      const sendSpyA = fn();
      const sendSpyB = fn();
      const eventA = new TestEvent("a");
      const eventB = new TestEvent("b");
      const queueA: BaseEvent[] = [eventA];
      const queueB: BaseEvent[] = [eventB];

      startEventSender(queueA, 10, sendSpyA);
      startEventSender(queueB, 10, sendSpyB);
      await wait(30);

      expect(sendSpyA.mock.calls.length).toBeGreaterThan(0);
      expect(sendSpyB).not.toHaveBeenCalled();
      expect(queueB).toEqual([eventB]);
    });
  });

  describe("stopEventSender()", () => {
    it("can be called when no interval is running without throwing", () => {
      expect(() => stopEventSender()).not.toThrow();
    });

    it("stops the interval so no further sends happen", async () => {
      const sendSpy = fn();
      const queue: BaseEvent[] = [];

      startEventSender(queue, 10, sendSpy);
      stopEventSender();
      queue.push(new TestEvent("late"));
      await wait(30);

      expect(sendSpy).not.toHaveBeenCalled();
    });

    it("allows starting a new interval after stopping", async () => {
      const sendSpyA = fn();
      const queueA: BaseEvent[] = [new TestEvent("a")];
      startEventSender(queueA, 10, sendSpyA);
      stopEventSender();

      const sendSpyB = fn();
      const eventB = new TestEvent("b");
      const queueB: BaseEvent[] = [eventB];
      startEventSender(queueB, 10, sendSpyB);
      await wait(30);

      expect(sendSpyB).toHaveBeenCalledWith([eventB]);
    });
  });
});
