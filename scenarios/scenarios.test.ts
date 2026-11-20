import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defineScenario, parseScenario, validateScenario } from "./dsl.ts";
import { createMarketState, executeAction, runScenario } from "./runner.ts";
import { loadBundledScenarios } from "./index.ts";

describe("typed scenario DSL", () => {
  it("parses and validates bundled scenarios", () => {
    const registry = loadBundledScenarios();
    const summaries = registry.summary();
    assert.equal(summaries.length, 4);
    assert.deepEqual(
      summaries.map((scenario) => scenario.id),
      [
        "2008-financial-crisis",
        "2020-covid-crash",
        "3ac-ftx-contagion",
        "luna-ust-collapse",
      ],
    );
  });

  it("defines and runs a custom typed scenario", () => {
    const scenario = defineScenario({
      id: "custom-drawdown",
      name: "Custom drawdown",
      description: "25% XLM drawdown with elevated volatility",
      priceChanges: [{ asset: "XLM", changePercent: -25 }],
      correlationShifts: [
        { asset1: "XLM", asset2: "BTC", newCorrelation: 0.8 },
      ],
      volatilityMultipliers: [{ asset: "XLM", multiplier: 3 }],
      teardown: [{ type: "assert", condition: "price(XLM) < 80" }],
    });

    assert.equal(validateScenario(scenario).valid, true);
    const result = runScenario(scenario, { XLM: 100 });
    assert.equal(result.final.prices.get("XLM"), 75);
    assert.equal(result.final.volatility.get("XLM"), 3);
    assert.equal(result.final.correlations.get("BTC:XLM"), 0.8);
  });

  it("rejects invalid scenario definitions and JSON", () => {
    const invalid = defineScenario({
      id: "",
      name: "",
      description: "",
      priceChanges: [{ asset: "XLM", changePercent: -50 }],
      correlationShifts: [{ asset1: "XLM", asset2: "BTC", newCorrelation: 2 }],
    });
    assert.equal(validateScenario(invalid).valid, false);
    assert.throws(() => parseScenario("{"), /not valid/);
    assert.throws(
      () =>
        parseScenario(JSON.stringify({ id: "x", name: "x", description: "x" })),
      /priceChanges/,
    );
  });

  it("executes individual actions and surfaces assertion failures", () => {
    const state = createMarketState({ XLM: 100 });
    const result = executeAction(
      state,
      { type: "applyPriceChange", asset: "XLM", changePercent: -10 },
      0,
    );
    assert.equal(result.state.prices.get("XLM"), 90);

    const assertion = executeAction(
      state,
      { type: "assert", condition: "price(XLM) > 100" },
      1,
    );
    assert.equal(assertion.assertion?.passed, false);
    assert.throws(
      () =>
        runScenario(
          defineScenario({
            id: "failing",
            name: "Failing",
            description: "Assertion must fail",
            priceChanges: [],
            teardown: [{ type: "assert", condition: "price(XLM) > 100" }],
          }),
          { XLM: 90 },
        ),
      /Scenario assertion failed/,
    );
  });
});
