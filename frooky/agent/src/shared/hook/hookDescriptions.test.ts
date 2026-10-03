import { describeHooked, describeLoad } from "./hookDescriptions";

describe("describeLoad()", () => {
  const none = { added: 0, updated: 0, removed: 0, retried: 0, unchanged: 0, hookedMethods: 0, hookedFunctions: 0, waiting: 0, notFound: 0 };

  it("lists the changes, then what the new, updated and retried declarations resolved to", () => {
    expect(describeLoad({ ...none, added: 2, updated: 1, hookedMethods: 3, hookedFunctions: 1, notFound: 1, unchanged: 38 })).toBe(
      "2 new, 1 updated, 38 unchanged; hooked 3 methods and 1 function, 1 not found",
    );
  });

  it("lists retried declarations", () => {
    expect(describeLoad({ ...none, retried: 4, notFound: 4, unchanged: 35 })).toBe("4 retried, 35 unchanged; hooked nothing, 4 not found");
  });

  it("leaves out the hooked part when only removing", () => {
    expect(describeLoad({ ...none, removed: 1, unchanged: 1 })).toBe("1 removed, 1 unchanged");
  });

  it("says so when nothing changed", () => {
    expect(describeLoad({ ...none, unchanged: 5 })).toBe("no changes");
  });
});

describe("describeHooked()", () => {
  it("uses singular and plural", () => {
    expect(describeHooked({ hookedMethods: 1, hookedFunctions: 2, waiting: 0, notFound: 0 })).toBe("hooked 1 method and 2 functions");
  });

  it("lists the waiting and the not found declarations", () => {
    expect(describeHooked({ hookedMethods: 1, hookedFunctions: 0, waiting: 2, notFound: 1 })).toBe("hooked 1 method, 2 waiting, 1 not found");
  });
});

export {};
