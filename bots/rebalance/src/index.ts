import type { RebalanceSchedule } from "./schedule.ts";
import type { RebalanceHandler } from "./runner.ts";
import { defaultRebalanceSchedule, loadSchedule } from "./schedule.ts";
import { RebalanceRunner } from "./runner.ts";

export interface RebalanceBotOptions {
  schedule?: RebalanceSchedule;
  handler?: RebalanceHandler;
  now?: () => Date;
  onEvent?: (event: {
    type: string;
    name: string;
    timestamp: string;
    message?: string;
  }) => void;
}

export class RebalanceBot {
  private readonly runner: RebalanceRunner;
  private readonly schedule: RebalanceSchedule;

  constructor(options: RebalanceBotOptions = {}) {
    this.schedule = loadSchedule(options.schedule ?? defaultRebalanceSchedule);
    this.runner = new RebalanceRunner({
      schedule: this.schedule,
      handler: options.handler,
      now: options.now,
      onEvent: options.onEvent,
    });
  }

  getRunner(): RebalanceRunner {
    return this.runner;
  }

  getSchedule(): RebalanceSchedule {
    return this.schedule;
  }

  async run(name?: string) {
    return this.runner.run(name);
  }
}
