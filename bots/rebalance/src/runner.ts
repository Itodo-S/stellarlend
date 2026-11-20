import type { RebalanceSchedule, RebalanceScheduleEntry } from "./schedule.ts";
import {
  defaultRebalanceSchedule,
  enabledSchedules,
  loadSchedule,
  parseCronExpression,
} from "./schedule.ts";

export interface RebalanceJob {
  name: string;
  cron: string;
  timezone: string;
  queue: string;
  deviationThresholdPercent: number;
  slippageTolerancePercent: number;
  dryRun: boolean;
  run: () => Promise<RebalanceRunResult>;
}

export interface RebalanceRunResult {
  name: string;
  triggered: boolean;
  simulatedActions: number;
  executed: boolean;
  timestamp: string;
  error?: string;
}

export type RebalanceHandler = (
  entry: RebalanceScheduleEntry,
) => Promise<{ simulatedActions: number; executed: boolean }>;

export interface RebalanceRunnerOptions {
  schedule?: RebalanceSchedule;
  handler?: RebalanceHandler;
  now?: () => Date;
  onEvent?: (event: RebalanceRunEvent) => void;
}

export interface RebalanceRunEvent {
  type: "start" | "success" | "skipped" | "error";
  name: string;
  timestamp: string;
  message?: string;
}

export function buildRebalanceJobs(
  schedule: RebalanceSchedule = defaultRebalanceSchedule,
  handler: RebalanceHandler = async () => ({
    simulatedActions: 0,
    executed: false,
  }),
): RebalanceJob[] {
  return enabledSchedules(loadSchedule(schedule)).map((entry) => ({
    name: entry.name,
    cron: entry.cron,
    timezone: entry.timezone,
    queue: entry.targetQueue,
    deviationThresholdPercent: entry.deviationThresholdPercent,
    slippageTolerancePercent: entry.slippageTolerancePercent,
    dryRun: entry.dryRun,
    run: async () => {
      const result = await handler(entry);
      return {
        name: entry.name,
        triggered: true,
        simulatedActions: result.simulatedActions,
        executed: !entry.dryRun && result.executed,
        timestamp: new Date().toISOString(),
      };
    },
  }));
}

export class RebalanceRunner {
  private readonly jobs: RebalanceJob[];
  private readonly now: () => Date;
  private readonly onEvent: (event: RebalanceRunEvent) => void;

  constructor(options: RebalanceRunnerOptions = {}) {
    this.jobs = buildRebalanceJobs(options.schedule, options.handler);
    this.now = options.now ?? (() => new Date());
    this.onEvent = options.onEvent ?? (() => undefined);
  }

  getJobs(): RebalanceJob[] {
    return this.jobs.map((job) => ({ ...job }));
  }

  nextRun(job: RebalanceJob, after: Date = this.now()): Date {
    const [minuteField, hourField, dayField, monthField, weekdayField] =
      parseCronExpression(job.cron);
    const matches = (date: Date): boolean =>
      fieldMatches(minuteField, date.getUTCMinutes(), 0) &&
      fieldMatches(hourField, date.getUTCHours(), 0) &&
      fieldMatches(dayField, date.getUTCDate(), 1) &&
      fieldMatches(monthField, date.getUTCMonth() + 1, 1) &&
      fieldMatches(weekdayField, date.getUTCDay(), 0);

    const candidate = new Date(
      Date.UTC(
        after.getUTCFullYear(),
        after.getUTCMonth(),
        after.getUTCDate(),
        after.getUTCHours(),
        after.getUTCMinutes(),
        0,
        0,
      ),
    );
    for (let offset = 0; offset <= 366 * 24 * 60; offset += 1) {
      const probe = new Date(candidate.getTime() + offset * 60_000);
      if (probe <= after) continue;
      if (matches(probe)) return probe;
    }
    throw new Error(`No next run found for ${job.name}`);
  }

  async run(name?: string): Promise<RebalanceRunResult[]> {
    const selected = name
      ? this.jobs.filter((job) => job.name === name)
      : this.jobs;
    if (name && selected.length === 0)
      throw new Error(`Unknown rebalance job: ${name}`);

    const results: RebalanceRunResult[] = [];
    for (const job of selected) {
      const timestamp = this.now().toISOString();
      this.onEvent({ type: "start", name: job.name, timestamp });
      try {
        const result = await job.run();
        this.onEvent({
          type: result.executed ? "success" : "skipped",
          name: job.name,
          timestamp: result.timestamp,
          message: `simulated=${result.simulatedActions} executed=${result.executed}`,
        });
        results.push(result);
      } catch (error) {
        const failedAt = this.now().toISOString();
        const message = (error as Error).message;
        this.onEvent({
          type: "error",
          name: job.name,
          timestamp: failedAt,
          message,
        });
        results.push({
          name: job.name,
          triggered: false,
          simulatedActions: 0,
          executed: false,
          timestamp: failedAt,
          error: message,
        });
      }
    }
    return results;
  }
}

function fieldMatches(field: string, value: number, minimum: number): boolean {
  return field.split(",").some((part) => {
    if (part === "*") return true;
    const match = /^(\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part);
    if (!match) return false;
    const [, base, end, step] = match;
    const start = Number(base);
    const finish = end === undefined ? start : Number(end);
    const stepValue = step === undefined ? 1 : Number(step);
    if (value < Math.max(start, minimum) || value > finish) return false;
    return (value - start) % stepValue === 0;
  });
}
