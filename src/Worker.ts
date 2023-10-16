import {ILoggerLike} from '@avanio/logger-like';
import * as Cron from 'cron';
import {ITaskConstructorInferFromInstance, ITaskInstance} from './interfaces/ITask';
import {DeferredPromise} from './lib/DeferredPromise';
import {haveError} from './lib/errorUtil';
import {FatalTaskError} from './lib/FatalTaskError';
import {TaskDisabledError} from './lib/TaskDisabledError';
import {sleep} from './lib/timeUtils';
import {InferDataFromInstance} from './types/TaskData';
import {TTaskProps} from './types/TaskProps';
import {TaskStatusType, getTaskName, isStartState} from './types/TaskStatus';

type HandleTaskUpdateCallback<TI extends ITaskInstance<string, TTaskProps, unknown, unknown>> = (taskData: InferDataFromInstance<TI>) => Promise<void>;

type FullTaskInstance<ReturnType, TI extends ITaskInstance<string, TTaskProps, unknown, unknown>> = ITaskInstance<
	TI['type'],
	TI['props'],
	ReturnType,
	TI['commonContext']
>;

export type ImportObjectMap<CType extends ITaskInstance<string, TTaskProps, unknown, unknown>> = {
	[E in CType as E['type']]?: ITaskConstructorInferFromInstance<CType>;
} & {[prop: string]: unknown};

export type WorkerOptions = {
	taskUniqueIdBuilder: () => string;
	logger?: ILoggerLike;
};

interface TaskWorkerInstance<TI extends ITaskInstance<string, TTaskProps, unknown, unknown>> {
	abortController: AbortController;
	type: TI['type'];
	task: TI;
	promise: DeferredPromise<unknown>;
	cron?: Cron.CronJob;
	intervalRef?: ReturnType<typeof setInterval>;
}

export class Worker<CommonTaskContext, TI extends ITaskInstance<string, TTaskProps, unknown, CommonTaskContext>> {
	private buildTaskUniqueId: () => string;
	private tasks = new Map<string, TaskWorkerInstance<FullTaskInstance<unknown, TI>>>();
	private logger?: ILoggerLike;

	private handleTaskUpdates = new Set<HandleTaskUpdateCallback<TI>>();
	constructor(opts: WorkerOptions) {
		this.buildTaskUniqueId = opts.taskUniqueIdBuilder;
		this.logger = opts.logger;
	}

	public onTaskUpdate(taskUpdateCallback: HandleTaskUpdateCallback<TI>): HandleTaskUpdateCallback<TI> {
		this.handleTaskUpdates.add(taskUpdateCallback);
		return taskUpdateCallback;
	}

	public removeTaskUpdate(taskUpdateCallback: HandleTaskUpdateCallback<TI>) {
		this.handleTaskUpdates.delete(taskUpdateCallback);
	}

	public async initializeTask<CType extends TI>(
		TaskClass: ITaskConstructorInferFromInstance<CType>,
		props: CType['props'],
		commonContext: CType['commonContext'],
	): Promise<FullTaskInstance<CType['data'], CType>> {
		const abortController = new AbortController();
		const classInstance = new TaskClass(
			{
				commonContext,
				disabled: false,
				end: undefined,
				errors: [],
				props,
				runCount: 0,
				start: undefined,
				status: TaskStatusType.Created,
				uuid: this.buildTaskUniqueId(),
			},
			undefined,
			abortController.signal,
			this.logger,
		);
		if (classInstance.singleInstance) {
			const existingTask = this.lookupSingleInstanceTask(classInstance);
			if (existingTask) {
				existingTask.task.props = props; // update props
				existingTask.task.commonContext = commonContext; // update common context
				return existingTask.task;
			}
		}
		classInstance.getDescription(); // pre-build description
		const currentWorkerInstance = this.handleTaskInstanceBuild(abortController, classInstance);
		await this.setTaskStatus(currentWorkerInstance, classInstance.status); // change status to created
		this.tasks.set(classInstance.uuid, currentWorkerInstance); // store task
		return classInstance;
	}

	private reloadImportTask(
		TaskClass: ITaskConstructorInferFromInstance<TI>,
		params: InferDataFromInstance<TI>,
	): TaskWorkerInstance<FullTaskInstance<unknown, TI>> {
		const abortController = new AbortController();
		const {uuid, commonContext, props, disabled, status, errors, runCount, start, end, data} = params;
		const classInstance = new TaskClass(
			{
				commonContext,
				disabled,
				end,
				errors,
				props,
				runCount,
				start,
				status,
				uuid,
			},
			data,
			abortController.signal,
			this.logger,
		);
		classInstance.taskError = params.taskError; // attach task error from import
		if (classInstance.singleInstance) {
			const existingTask = this.lookupSingleInstanceTask(classInstance);
			if (existingTask) {
				return existingTask;
			}
		}
		classInstance.getDescription(); // pre-build description
		const currentWorkerInstance = this.handleTaskInstanceBuild(abortController, classInstance);
		this.tasks.set(classInstance.uuid, currentWorkerInstance); // store task
		// handle task promises if task is already resolved/rejected
		if (currentWorkerInstance.task.status === TaskStatusType.Resolved) {
			setTimeout(() => {
				!currentWorkerInstance.promise.isDone && currentWorkerInstance.promise.resolve(currentWorkerInstance.task.data);
			}, 10); // delay resolve a bit
		}
		if (currentWorkerInstance.task.status === TaskStatusType.Rejected) {
			// istanbul ignore next
			if (!currentWorkerInstance.task.taskError) {
				throw new Error(`Task ${currentWorkerInstance.task.uuid} ${currentWorkerInstance.type} rejected but no error data found`);
			}
			setTimeout(() => {
				!currentWorkerInstance.promise.isDone && currentWorkerInstance.promise.reject(currentWorkerInstance.task.taskError);
			}, 10); // delay reject a bit
		}
		return currentWorkerInstance;
	}

	/**
	 * Start this task
	 * @param task Task instance
	 */
	public async startTask<ReturnType>(task: FullTaskInstance<ReturnType, TI>): Promise<void> {
		const instance = this.tasks.get(task.uuid);
		this.assertInstance(instance, task.uuid);
		// check if task is already started
		if (instance.task.status > TaskStatusType.Init) {
			throw new Error(`Task ${instance.task.uuid} ${instance.type} is already started`);
		}
		await this.setTaskStatus(instance, TaskStatusType.Init);
		this.handleTriggerConnection(instance);
	}

	public async waitTask<ReturnType>(task: FullTaskInstance<ReturnType, TI>): Promise<ReturnType> {
		const instance = this.tasks.get(task.uuid);
		this.assertInstance(instance, task.uuid);
		if (instance.task.trigger.type !== 'instant') {
			throw new Error(`Task ${instance.task.uuid} ${instance.type} is not instant and cannot be waited`);
		}
		// not started yet - start it
		if (instance.task.status < TaskStatusType.Init) {
			this.startTask(task);
		}
		return instance.promise as Promise<ReturnType>;
	}

	public async restartTask<ReturnType>(task: FullTaskInstance<ReturnType, TI>): Promise<void> {
		const instance = this.tasks.get(task.uuid);
		this.assertInstance(instance, task.uuid);
		if (instance.task.trigger.type !== 'instant') {
			throw new Error(`Task ${instance.task.uuid} ${instance.type} is not instant and cannot be restarted`);
		}
		await instance.task.allowRestart();
		!instance.promise.isDone && instance.promise.reject(new Error('Task restart')); // trow error to reject old promise if someone is waiting for it
		instance.promise = new DeferredPromise<unknown>(); // reset promise
		await this.setTaskStatus(instance, TaskStatusType.Pending);
		this.handleTriggerConnection(instance);
	}

	public getTaskByUuid(uuid: string): FullTaskInstance<unknown, TI> | undefined {
		const instance = this.tasks.get(uuid);
		return instance?.task;
	}

	/**
	 * stop currently running task and wait for it to resolved/rejected
	 * @param task
	 */
	public async stopTask<ReturnType>(task: FullTaskInstance<ReturnType, TI>): Promise<void> {
		const instance = this.tasks.get(task.uuid);
		this.assertInstance(instance, task.uuid);
		await this.handleTaskAbort(instance);
		try {
			await instance.promise; // wait promise to be resolved/rejected
		} catch (err) {
			// ignore abort error
		}
	}

	/**
	 * Stop and delete this task from worker and wait for it to resolved/rejected
	 * @param task
	 */
	public async deleteTask<ReturnType>(task: FullTaskInstance<ReturnType, TI>): Promise<void> {
		const instance = this.tasks.get(task.uuid);
		this.assertInstance(instance, task.uuid);
		await this.handleTaskAbort(instance);
		// clear cron if exists
		if (instance.cron) {
			instance.cron.stop();
			instance.cron = undefined;
		}
		// clear interval if exists
		if (instance.intervalRef) {
			clearInterval(instance.intervalRef);
			instance.intervalRef = undefined;
		}
		this.tasks.delete(task.uuid);
		this.logger?.debug(`Task ${instance.task.uuid} ${instance.type} deleted`);
		await instance.promise; // wait promise to be resolved/rejected
	}

	public async importTasks(data: InferDataFromInstance<TI>[], importMapping: ImportObjectMap<TI>): Promise<void> {
		const taskInstances = data.reduce<TaskWorkerInstance<FullTaskInstance<unknown, TI>>[]>((acc, taskData) => {
			const TaskClass = importMapping[taskData.type] as ITaskConstructorInferFromInstance<TI> | undefined;
			if (TaskClass) {
				acc.push(this.reloadImportTask(TaskClass, taskData));
			}
			return acc;
		}, []);
		// start trigger connection for all tasks
		await Promise.all(
			taskInstances.map(async (currentWorkerInstance) => {
				// revert status to pending if task was on running state
				if (currentWorkerInstance.task.status === TaskStatusType.Running || currentWorkerInstance.task.status === TaskStatusType.Starting) {
					currentWorkerInstance.task.start = undefined; // reset start
					currentWorkerInstance.task.end = undefined; // reset end
					await this.setTaskStatus(currentWorkerInstance, TaskStatusType.Pending); // change status to pending
				}
				this.handleTriggerConnection(currentWorkerInstance, true);
			}),
		);
	}

	private assertInstance(
		instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>> | undefined,
		uuid: string,
	): asserts instance is TaskWorkerInstance<FullTaskInstance<unknown, TI>> {
		if (!instance) {
			// istanbul ignore next
			throw new Error(`Task ${uuid} not found`);
		}
	}

	private async handleTaskAbort(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>) {
		this.logger?.debug(`Task ${instance.task.uuid} ${instance.type} abort`);
		// if task is not resolved/rejected yet
		if (instance.task.status < 90) {
			await this.setTaskStatus(instance, TaskStatusType.Aborted);
		}
		instance.abortController.abort();
	}

	private resetTaskInstance(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>) {
		instance.abortController = new AbortController(); // reset abort controller
		// reset promise
		if (!instance.promise.isDone) {
			instance.promise.reject(new Error('Task reset')); // trow error to reject old promise if someone is waiting for it
		}
		instance.promise = new DeferredPromise<unknown>(); // reset promise
		instance.task.errors = []; // reset errors // TODO maybe limit x last errors by config
		instance.task.start = undefined; // reset start
		instance.task.end = undefined; // reset end
		instance.task.status = TaskStatusType.Init; // reset status
	}

	private async handleTriggerConnection(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>, isImport = false): Promise<void> {
		try {
			switch (instance.task.trigger.type) {
				case 'instant':
					// ignore if task is already started (for import task)
					if (!isStartState(instance.task.status)) {
						return;
					}
					setTimeout(() => {
						this.runTask(instance);
					}, 0);
					break;
				case 'interval':
					if (instance.intervalRef) {
						clearInterval(instance.intervalRef);
					}

					isImport && this.resetTaskInstance(instance);
					setTimeout(() => {
						this.runTask(instance);
					}, 0);
					instance.intervalRef = setInterval(async () => {
						this.resetTaskInstance(instance);
						await this.setTaskStatus(instance, TaskStatusType.Pending);
						this.runTask(instance);
					}, instance.task.trigger.interval);
					break;
				case 'cron':
					if (instance.cron) {
						// istanbul ignore next
						instance.cron.stop();
					}
					isImport && this.resetTaskInstance(instance);
					instance.cron = new Cron.CronJob(instance.task.trigger.cron, async () => {
						this.resetTaskInstance(instance);
						await this.setTaskStatus(instance, TaskStatusType.Pending);
						this.runTask(instance);
					});
					instance.cron.start();
					break;
				default:
					// istanbul ignore next
					throw new Error(`Task ${instance.task.uuid} is not triggerable`);
			}
		} catch (err) {
			// istanbul ignore next
			await this.handleReject(instance, haveError(err));
		}
	}

	private async runTask(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): Promise<void> {
		let isTaskRetired = false;
		while (!isTaskRetired) {
			this.logger?.debug(`Task ${instance.task.uuid} ${instance.type} run ${instance.task.runCount}`);
			try {
				if (instance.task.disabled) {
					throw new TaskDisabledError(`Task ${instance.task.uuid} ${instance.type} is disabled`);
				}
				isTaskRetired = await this.runTaskFlow(instance);
			} catch (err) {
				instance.task.errors.push({ts: new Date(), error: haveError(err)});
				if (err instanceof FatalTaskError) {
					this.logger?.error(`Task ${instance.task.uuid} ${instance.type} ${err.name} error`);
					isTaskRetired = await this.handleReject(instance, err);
				} else if (!(await instance.task.retry())) {
					const msg = `Task ${instance.task.uuid} ${instance.type} retry limit reached`;
					this.logger?.error(msg);
					const limitError = new FatalTaskError(msg);
					instance.task.errors.push({ts: new Date(), error: haveError(limitError)});
					isTaskRetired = await this.handleReject(instance, limitError);
				} else {
					this.logger?.info(`Task ${instance.task.uuid} ${instance.type} retry`);
					const sleepTime = await instance.task.onErrorSleep();
					if (sleepTime > 0) {
						this.logger?.debug(`Task ${instance.task.uuid} ${instance.type} sleep ${sleepTime}ms`);
						await this.setTaskStatus(instance, TaskStatusType.Pending);
						await sleep(sleepTime);
					}
				}
			}
		}
	}

	/**
	 * handle task reject
	 * @returns true if task should be retried
	 */
	private async handleReject(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>, err: Error): Promise<boolean> {
		this.logger?.error(`Task ${instance.task.uuid} ${instance.type} rejected`);
		instance.task.end = new Date();
		instance.task.taskError = err;
		await this.setTaskStatus(instance, TaskStatusType.Rejected);
		await instance.task.onRejected();
		instance.promise.reject(err);
		return true;
	}

	/**
	 * handle task resolve
	 * @param instance
	 * @returns true if task should be retried
	 */
	private async handleResolve(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): Promise<boolean> {
		this.logger?.debug(`Task ${instance.task.uuid} ${instance.type} resolved`);
		instance.task.end = new Date();
		await this.setTaskStatus(instance, TaskStatusType.Resolved);
		await instance.task.onResolved();
		return true;
	}

	/**
	 * run task flow
	 * @returns true if task should be retried
	 */
	private async runTaskFlow(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): Promise<boolean> {
		if (instance.task.status > TaskStatusType.Pending && instance.task.status < 90) {
			throw new FatalTaskError(`Task ${instance.task.uuid} ${instance.type} is already running`);
		}
		if (!instance.task.start) {
			instance.task.start = new Date();
		}
		instance.task.runCount++;
		this.assertIfAbort(instance);
		if (instance.task.status === TaskStatusType.Init) {
			await instance.task.onInit();
			this.assertIfAbort(instance);
		}
		await this.setTaskStatus(instance, TaskStatusType.Starting);
		await instance.task.onPreStart();
		await this.setTaskStatus(instance, TaskStatusType.Running);
		this.assertIfAbort(instance);
		const data = await instance.task.runTask();
		instance.task.data = data; // store data to task instance
		const status = await this.handleResolve(instance);
		instance.promise.resolve(data); // solve waiting promise
		return status;
	}

	private assertIfAbort(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>) {
		if (instance.abortController.signal.aborted) {
			throw new FatalTaskError(`Task ${instance.task.uuid} ${instance.task.type} aborted`);
		}
	}

	private handleTaskInstanceBuild<ReturnType>(
		abortController: AbortController,
		task: FullTaskInstance<ReturnType, TI>,
	): TaskWorkerInstance<FullTaskInstance<ReturnType, TI>> {
		return {
			abortController,
			promise: new DeferredPromise<unknown>(),
			task,
			type: task.type,
		};
	}

	private lookupSingleInstanceTask<ReturnType>(
		taskInstance: FullTaskInstance<ReturnType, TI>,
	): TaskWorkerInstance<FullTaskInstance<ReturnType, TI>> | undefined {
		if (taskInstance.singleInstance) {
			return [...this.tasks.values()].find((task) => task.type === taskInstance.type) as TaskWorkerInstance<FullTaskInstance<ReturnType, TI>> | undefined;
		}
		return undefined;
	}

	private setTaskStatus(workerInstance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>, status: TaskStatusType): Promise<void> {
		const statusInfo =
			workerInstance.task.status === status ? `to ${getTaskName(status)}` : `from ${getTaskName(workerInstance.task.status)} to ${getTaskName(status)}`;
		const message = `Task ${workerInstance.task.uuid} ${workerInstance.type} status changed ${statusInfo}`;
		switch (status) {
			case TaskStatusType.Rejected:
				this.logger?.error(message);
				break;
			case TaskStatusType.Init:
			case TaskStatusType.Resolved:
				this.logger?.info(message);
				break;
			default:
				this.logger?.debug(message);
		}
		workerInstance.task.status = status;
		return this.notifyTaskUpdate(workerInstance);
	}

	private async notifyTaskUpdate(workerInstance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): Promise<void> {
		const data = this.buildTaskAsTaskData(workerInstance.task);
		await Promise.all(Array.from(this.handleTaskUpdates).map((cb) => cb(data)));
	}

	private buildTaskAsTaskData(task: FullTaskInstance<unknown, TI>): InferDataFromInstance<TI> {
		const {type, uuid, commonContext, props, status, disabled, errors, runCount, start, end, data, taskError} = task;
		return {
			commonContext,
			data,
			disabled,
			end,
			errors,
			props,
			runCount,
			start,
			status,
			taskError,
			type,
			uuid,
		};
	}
}
