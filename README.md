# warp-core-worker

## Task class framework and Task Orchestrator

Features:

- Abstract Task class (Task)

  - Currently three trigger types: instant, scheduled, and interval.
  - Methods to handle preStart and post task execution.
    - preStart can be also is used to check if we need to execute the task. (in case reloading, re-triggering or no new data to process).
  - Rerun method to decide conditions to rerun the task.
  - Internal state data like, errors, run and error counts, start and stop Dates, etc.

- Task Orchestrator (Worker)
  - Task registration and initialization.
  - waitTask method to wait Promise for task completion (only for instant tasks).
  - callback to get task changes (i.e. save to db, send to client as events, etc.)
  - import method to import tasks on restarts. (i.e. from db, etc.)
    - restarts tasks which was running before restart.
  - Task abort.
  - Control Task re-runs/retry.
  - Customizable shared context for all task instances (i.e. have task owner, etc.)

## Minimal Example

```typescript
class Demo extends AbstractSimpleTask<'demo', {test: string}, string, unknown> {
	public readonly type = 'demo';
	public trigger: TaskTrigger = {type: 'instant'};
	protected buildDescription(): Promise<string> {
		return Promise.resolve(`${this.type} ${this.props.test}`);
	}

	public runTask(): Promise<string> {
		return Promise.resolve('demo');
	}
}

const worker = new Worker({
	taskUniqueIdBuilder: () => uuid(),
	// logger: console,
});

const task = await worker.initializeTask(Demo, {test: 'test'}, {}); // arg 1 is task class, arg 2 is current tasks props, arg 3 is common context.
await worker.startTask(task); // optional, waitTask will call startTask if not started yet.
const data = await worker.waitTask(task);
```

## Detailed [API Documentation](https://mharj.github.io/warp-core-worker/).


### TODO

- remove promises other than instant task trigger
- remove custom callback setup and use Event Emitter instead
