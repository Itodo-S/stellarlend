export type ScenarioCategory = "historical" | "custom" | "hypothetical";

export interface AssetPriceChange {
  asset: string;
  changePercent: number;
  step?: number;
}

export interface CorrelationShift {
  asset1: string;
  asset2: string;
  newCorrelation: number;
}

export interface VolatilityMultiplier {
  asset: string;
  multiplier: number;
}

export interface ScenarioAction {
  type:
    | "setPrice"
    | "applyPriceChange"
    | "setCorrelation"
    | "setVolatility"
    | "assert";
  asset?: string;
  asset1?: string;
  asset2?: string;
  value?: number;
  correlation?: number;
  multiplier?: number;
  changePercent?: number;
  step?: number;
  condition?: string;
  expected?: number;
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  description: string;
  category: ScenarioCategory;
  version: string;
  created: string;
  author?: string;
  priceChanges: AssetPriceChange[];
  correlationShifts: CorrelationShift[];
  volatilityMultipliers: VolatilityMultiplier[];
  cascadingLiquidation?: boolean;
  durationSteps?: number;
  tags: string[];
  setup?: ScenarioAction[];
  teardown?: ScenarioAction[];
}

export type ScenarioInput = Partial<ScenarioDefinition> &
  Pick<ScenarioDefinition, "id" | "name" | "description"> & {
    priceChanges: AssetPriceChange[];
  };

export interface ScenarioValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ScenarioMarketState {
  prices: Map<string, number>;
  correlations: Map<string, number>;
  volatility: Map<string, number>;
}

export interface ScenarioStepResult {
  index: number;
  action: ScenarioAction;
  state: ScenarioMarketState;
  assertion?: { condition: string; passed: boolean };
}

export interface ScenarioRunResult {
  scenarioId: string;
  initial: ScenarioMarketState;
  steps: ScenarioStepResult[];
  final: ScenarioMarketState;
}
