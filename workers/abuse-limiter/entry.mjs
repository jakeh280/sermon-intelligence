import { DurableObject } from 'cloudflare:workers';
import worker, { RequestBudget as BudgetLogic } from './worker.mjs';

// The runtime entry exports only handlers and Durable Object classes. Numeric
// exports used by Node tests are not valid Worker entrypoints.
export class RequestBudget extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.budget = new BudgetLogic(ctx);
  }

  fetch(request) { return this.budget.fetch(request); }
  alarm() { return this.budget.alarm(); }
}

export default worker;
