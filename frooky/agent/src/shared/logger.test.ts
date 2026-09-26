import type { FrookyAgent } from "../FrookyAgent";
import { LogEvent } from "./event/logEvent";
import { logger, LogLevel } from "./logger";

function createMockAgent(): FrookyAgent {
  return { addEventToLog: (_event: LogEvent) => {} } as unknown as FrookyAgent;
}

describe("logger", () => {
  let spy: Mock | undefined;

  beforeEach(() => {
    logger.setLogTo("console");
    logger.setVerbosity("error");
    logger.setAgent(undefined as unknown as FrookyAgent);
  });

  afterEach(() => {
    spy?.mockRestore();
    spy = undefined;
  });

  describe("configuration", () => {
    it("defaults to error verbosity on the console target", () => {
      spy = spyOn(console, "error");
      logger.error("boom");
      expect(spy).toHaveBeenCalled();
    });

    it("setAgent() only sets the agent, not verbosity or logTo", () => {
      const agent = createMockAgent();
      logger.setVerbosity("debug");
      logger.setAgent(agent);

      const eventSpy = spyOn(agent, "addEventToLog");
      spy = spyOn(console, "debug");

      logger.debug("hello");

      expect(spy).toHaveBeenCalled();
      expect(eventSpy).not.toHaveBeenCalled();

      eventSpy.mockRestore();
    });

    it("setVerbosity() and setLogTo() can be changed independently", () => {
      logger.setVerbosity("warn");

      const warnSpy = spyOn(console, "warn");
      spy = spyOn(console, "error");

      logger.warn("careful");
      logger.error("failure");

      expect(warnSpy).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe("verbosity filtering", () => {
    const cases: Array<{
      verbosity: LogLevel;
      call: "error" | "warn" | "info" | "debug";
      method: "error" | "warn" | "log" | "debug";
      expectLogged: boolean;
    }> = [
      { verbosity: "none", call: "error", method: "error", expectLogged: false },
      { verbosity: "error", call: "error", method: "error", expectLogged: true },
      { verbosity: "error", call: "warn", method: "warn", expectLogged: false },
      { verbosity: "warn", call: "warn", method: "warn", expectLogged: true },
      { verbosity: "warn", call: "info", method: "log", expectLogged: false },
      { verbosity: "info", call: "info", method: "log", expectLogged: true },
      { verbosity: "info", call: "debug", method: "debug", expectLogged: false },
      { verbosity: "debug", call: "debug", method: "debug", expectLogged: true },
    ];

    for (const { verbosity, call, method, expectLogged } of cases) {
      it(`verbosity="${verbosity}" ${expectLogged ? "allows" : "suppresses"} .${call}()`, () => {
        logger.setVerbosity(verbosity);

        spy = spyOn(console, method);
        logger[call]("message");

        if (expectLogged) {
          expect(spy).toHaveBeenCalled();
        } else {
          expect(spy).not.toHaveBeenCalled();
        }
      });
    }
  });

  describe("message formatting", () => {
    it("passes a single string message through without a level prefix or colors", () => {
      logger.setVerbosity("info");

      spy = spyOn(console, "log");
      logger.info("connected");

      expect(spy).toHaveBeenCalledWith("connected");
    });

    it("joins an array message into one multi-line message", () => {
      logger.setVerbosity("debug");

      spy = spyOn(console, "debug");
      logger.debug(["line one", "line two"]);

      expect(spy).toHaveBeenCalledWith("line one\nline two");
    });
  });

  describe("console target dispatch", () => {
    it("routes info to console.log", () => {
      logger.setVerbosity("info");
      spy = spyOn(console, "log");
      logger.info("x");
      expect(spy).toHaveBeenCalled();
    });

    it("routes warn to console.warn", () => {
      logger.setVerbosity("warn");
      spy = spyOn(console, "warn");
      logger.warn("x");
      expect(spy).toHaveBeenCalled();
    });

    it("routes error to console.error", () => {
      spy = spyOn(console, "error");
      logger.error("x");
      expect(spy).toHaveBeenCalled();
    });

    it("routes debug to console.debug", () => {
      logger.setVerbosity("debug");
      spy = spyOn(console, "debug");
      logger.debug("x");
      expect(spy).toHaveBeenCalled();
    });
  });

  describe("eventlog target", () => {
    it("forwards a LogEvent to frooky.addEventToLog() instead of the console", () => {
      let captured: LogEvent | undefined;
      const agent = {
        addEventToLog: (event: LogEvent) => {
          captured = event;
        },
      } as unknown as FrookyAgent;

      logger.setAgent(agent);
      logger.setLogTo("eventlog");

      spy = spyOn(console, "error");

      logger.error("decoder error");

      expect(spy).not.toHaveBeenCalled();
      expect(captured).toBeDefined();
      expect(captured!.level).toBe("error");
      expect(captured!.msg).toBe("decoder error");
    });

    it("logs a console error and does not throw when logTo is 'eventlog' but no agent was set", () => {
      logger.setLogTo("eventlog");

      spy = spyOn(console, "error");

      expect(() => {
        logger.error("decoder error");
      }).not.toThrow();

      expect(spy).toHaveBeenCalledWith(
        "Cannot log to eventLog, since no frooky agent is set. Make sure to set the agent using setAgent(frookyAgent) first.",
      );
    });
  });
});

export {};
