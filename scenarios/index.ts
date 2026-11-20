import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ScenarioDefinition, ScenarioRunResult } from "./types.ts";
import { parseScenario } from "./dsl.ts";
import { runScenario } from "./runner.ts";

const SCENARIO_DIR = dirname(fileURLToPath(import.meta.url));

export interface ScenarioSummary {
  id: string;
  name: string;
  category: string;
  assetCount: number;
  tags: string[];
}

export class ScenarioRegistry {
  private readonly scenarios = new Map<string, ScenarioDefinition>();

  constructor(definitions: ScenarioDefinition[] = []) {
    for (const definition of definitions) this.add(definition);
  }

  add(definition: ScenarioDefinition): ScenarioDefinition {
    this.scenarios.set(definition.id, definition);
    return definition;
  }

  get(id: string): ScenarioDefinition | undefined {
    return this.scenarios.get(id);
  }

  list(): ScenarioDefinition[] {
    return Array.from(this.scenarios.values());
  }

  summary(): ScenarioSummary[] {
    return this.list().map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      category: scenario.category,
      assetCount: scenario.priceChanges.length,
      tags: [...scenario.tags],
    }));
  }

  run(id: string, prices?: Record<string, number>): ScenarioRunResult {
    const scenario = this.get(id);
    if (!scenario) throw new Error(`Unknown scenario: ${id}`);
    return runScenario(scenario, prices);
  }
}

export function loadBundledScenarios(
  directory: string = SCENARIO_DIR,
): ScenarioRegistry {
  const registry = new ScenarioRegistry();
  for (const file of readdirSync(directory).sort()) {
    if (!file.endsWith(".json")) continue;
    const json = readFileSync(resolve(directory, file), "utf8");
    registry.add(parseScenario(json));
  }
  return registry;
}

export function scenarioPaths(directory: string = SCENARIO_DIR): string[] {
  return readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => join(directory, file));
}
