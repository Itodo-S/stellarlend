import type {
  ScenarioDefinition,
  ScenarioInput,
  ScenarioValidationResult,
} from "./types.ts";

export function defineScenario(input: ScenarioInput): ScenarioDefinition {
  return {
    category: "custom",
    version: "1.0.0",
    created: new Date(0).toISOString(),
    correlationShifts: [],
    volatilityMultipliers: [],
    tags: [],
    ...input,
  };
}

export function validateScenario(
  scenario: ScenarioDefinition,
): ScenarioValidationResult {
  const errors: string[] = [];

  if (!scenario.id?.trim()) errors.push("scenario.id is required");
  if (!scenario.name?.trim()) errors.push("scenario.name is required");
  if (!scenario.description?.trim())
    errors.push("scenario.description is required");
  if (!["historical", "custom", "hypothetical"].includes(scenario.category)) {
    errors.push("scenario.category is invalid");
  }
  if (
    !Array.isArray(scenario.priceChanges) ||
    scenario.priceChanges.length === 0
  ) {
    errors.push("scenario.priceChanges must contain at least one entry");
  }
  if (!Array.isArray(scenario.correlationShifts))
    errors.push("scenario.correlationShifts must be an array");
  if (!Array.isArray(scenario.volatilityMultipliers)) {
    errors.push("scenario.volatilityMultipliers must be an array");
  }
  if (!Array.isArray(scenario.tags))
    errors.push("scenario.tags must be an array");
  if (scenario.durationSteps !== undefined && scenario.durationSteps < 1) {
    errors.push("scenario.durationSteps must be positive");
  }

  const seenIds = new Set<string>();
  for (const change of scenario.priceChanges ?? []) {
    if (!change?.asset) errors.push("priceChanges.asset is required");
    if (typeof change?.changePercent !== "number")
      errors.push("priceChanges.changePercent must be a number");
    if (seenIds.has(change?.asset))
      errors.push(`duplicate price change asset: ${change.asset}`);
    seenIds.add(change?.asset);
  }

  for (const shift of scenario.correlationShifts ?? []) {
    if (!shift?.asset1 || !shift?.asset2)
      errors.push("correlationShifts assets are required");
    if (
      typeof shift?.newCorrelation !== "number" ||
      Math.abs(shift.newCorrelation) > 1
    ) {
      errors.push("correlationShifts.newCorrelation must be within -1..1");
    }
  }

  for (const multiplier of scenario.volatilityMultipliers ?? []) {
    if (!multiplier?.asset)
      errors.push("volatilityMultipliers.asset is required");
    if (
      typeof multiplier?.multiplier !== "number" ||
      multiplier.multiplier <= 0
    ) {
      errors.push("volatilityMultipliers.multiplier must be positive");
    }
  }

  return { valid: errors.length === 0, errors };
}

export function parseScenario(json: string): ScenarioDefinition {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Scenario JSON is not valid");
  }
  if (typeof raw !== "object" || raw === null)
    throw new Error("Scenario must be an object");

  const scenario = defineScenario(raw as ScenarioInput);
  const result = validateScenario(scenario);
  if (!result.valid)
    throw new Error(`Invalid scenario: ${result.errors.join("; ")}`);
  return scenario;
}
