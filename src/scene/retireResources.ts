/**
 * Attempt each action in iteration order and report failures after later actions
 * have been attempted. The iterable must be a normal, non-throwing iterator;
 * only action invocation/rejection is isolated here.
 */
export function retireResources(actions: Iterable<() => void>): void {
  const failures: unknown[] = [];
  for (const action of actions) {
    try {
      action();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Resource retirement failed');
}

/** Run cleanup actions sequentially, awaiting each before starting the next. */
export async function retireAsyncResources(actions: Iterable<() => void | Promise<void>>): Promise<void> {
  const failures: unknown[] = [];
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Resource retirement failed');
}
