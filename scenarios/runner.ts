import type {
  ScenarioAction,
  ScenarioDefinition,
  ScenarioMarketState,
  ScenarioRunResult,
  ScenarioStepResult,
} from "./types.ts";

export function createMarketState(
  prices: Record<string, number> = {},
): ScenarioMarketState {
  return {
    prices: new Map(Object.entries(prices)),
    correlations: new Map(),
    volatility: new Map(),
  };
}

export function correlationKey(asset1: string, asset2: string): string {
  return [asset1, asset2].sort().join(":");
}

export function executeAction(
  state: ScenarioMarketState,
  action: ScenarioAction,
  index: number,
): ScenarioStepResult {
  switch (action.type) {
    case "setPrice": {
      if (!action.asset || typeof action.value !== "number")
        throw new Error("setPrice requires asset and value");
      state.prices.set(action.asset, action.value);
      break;
    }
    case "applyPriceChange": {
      if (!action.asset || typeof action.changePercent !== "number") {
        throw new Error("applyPriceChange requires asset and changePercent");
      }
      const current = state.prices.get(action.asset) ?? 100;
      state.prices.set(
        action.asset,
        current * (1 + action.changePercent / 100),
      );
      break;
    }
    case "setCorrelation": {
      if (
        !action.asset1 ||
        !action.asset2 ||
        typeof action.correlation !== "number"
      ) {
        throw new Error(
          "setCorrelation requires asset1, asset2 and correlation",
        );
      }
      state.correlations.set(
        correlationKey(action.asset1, action.asset2),
        action.correlation,
      );
      break;
    }
    case "setVolatility": {
      if (!action.asset || typeof action.multiplier !== "number") {
        throw new Error("setVolatility requires asset and multiplier");
      }
      state.volatility.set(action.asset, action.multiplier);
      break;
    }
    case "assert": {
      if (!action.condition) throw new Error("assert requires a condition");
      return {
        index,
        action,
        state: cloneState(state),
        assertion: {
          condition: action.condition,
          passed: evaluateCondition(state, action.condition, action.expected),
        },
      };
    }
    default:
      throw new Error(
        `Unknown scenario action: ${(action as ScenarioAction).type}`,
      );
  }

  return { index, action, state: cloneState(state) };
}

export function evaluateCondition(
  state: ScenarioMarketState,
  condition: string,
  expected?: number,
): boolean {
  const match = /^price\((\w+)\)\s*(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)$/.exec(
    condition.trim(),
  );
  if (!match) throw new Error(`Unsupported scenario condition: ${condition}`);
  const [, asset, operator, threshold] = match;
  if (!asset || !operator || threshold === undefined)
    throw new Error(`Unsupported scenario condition: ${condition}`);
  const actual = state.prices.get(asset) ?? 0;
  const target = expected ?? Number(threshold);

  switch (operator) {
    case "<":
      return actual < target;
    case "<=":
      return actual <= target;
    case ">":
      return actual > target;
    case ">=":
      return actual >= target;
    default:
      throw new Error(`Unsupported scenario operator: ${operator}`);
  }
}

export function runScenario(
  scenario: ScenarioDefinition,
  initialPrices: Record<string, number> = {},
): ScenarioRunResult {
  const state = createMarketState(initialPrices);
  const steps: ScenarioStepResult[] = [];
  let index = 0;

  for (const action of scenario.setup ?? []) {
    steps.push(executeAction(state, action, index++));
  }
  for (const change of scenario.priceChanges) {
    steps.push(
      executeAction(
        state,
        {
          type: "applyPriceChange",
          asset: change.asset,
          changePercent: change.changePercent,
        },
        index++,
      ),
    );
  }
  for (const shift of scenario.correlationShifts) {
    steps.push(
      executeAction(
        state,
        {
          type: "setCorrelation",
          asset1: shift.asset1,
          asset2: shift.asset2,
          correlation: shift.newCorrelation,
        },
        index++,
      ),
    );
  }
  for (const multiplier of scenario.volatilityMultipliers) {
    steps.push(
      executeAction(
        state,
        {
          type: "setVolatility",
          asset: multiplier.asset,
          multiplier: multiplier.multiplier,
        },
        index++,
      ),
    );
  }
  for (const action of scenario.teardown ?? []) {
    steps.push(executeAction(state, action, index++));
  }

  for (const step of steps) {
    if (step.assertion && !step.assertion.passed) {
      throw new Error(`Scenario assertion failed: ${step.assertion.condition}`);
    }
  }

  return {
    scenarioId: scenario.id,
    initial: createMarketState(initialPrices),
    steps,
    final: cloneState(state),
  };
}

export function cloneState(state: ScenarioMarketState): ScenarioMarketState {
  return {
    prices: new Map(state.prices),
    correlations: new Map(state.correlations),
    volatility: new Map(state.volatility),
  };
}
