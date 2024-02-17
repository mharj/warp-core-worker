import {ILoggerLike, LogLevel, LogMapping, MapLogger} from '@avanio/logger-like';
import {sleep} from '@avanio/sleep';
import * as Cron from 'cron';
import {ITaskConstructorInferFromInstance, ITaskInstance} from './interfaces/ITask';
import {DeferredPromise} from './lib/DeferredPromise';
import {haveError} from './lib/errorUtil';
import {FatalTaskError, buildFatalError} from './lib/FatalTaskError';
import {TaskDisabledError} from './lib/TaskDisabledError';
import {InferDataFromInstance} from './types/TaskData';
import {TTaskProps} from './types/TaskProps';
import {TaskStatusType, getTaskStatusString, isRunningState, isStartState} from './types/TaskStatus';

export const defaultLogMap = {
	abort: LogLevel.Info,
	delete: LogLevel.Error,
	flow_error: LogLevel.None,
	flow_limit: LogLevel.None,
	flow_retry: LogLevel.None,
	flow_sleep: LogLevel.None,
	not_start: LogLevel.None,
	rejected: LogLevel.Error,
	resolved: LogLevel.Info,
	start: LogLevel.Debug,
	status_change_default: LogLevel.None,
	status_change_error: LogLevel.None,
	status_change_info: LogLevel.None,
};

export type TaskWorkerLogMapping = LogMapping<keyof typeof defaultLogMap>; // build type

export type HandleTaskUpdateCallback<TI extends ITaskInstance<string, TTaskProps, unknown, unknown>> = (
	taskData: InferDataFromInstance<TI>,
	taskInstance: FullTaskInstance<unknown, TI>,
) => Promise<void>;

export type FullTaskInstance<ReturnType, TI extends ITaskInstance<string, TTaskProps, unknown, unknown>> = ITaskInstance<
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
	/** delay before continue to next flow step */
	stepFlowDelay?: number;
	logger?: ILoggerLike;
};

export interface TaskWorkerInstance<TI extends ITaskInstance<string, TTaskProps, unknown, unknown>> {
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
	private logger: MapLogger<TaskWorkerLogMapping>;

	private handleTaskUpdates = new Set<HandleTaskUpdateCallback<TI>>();
	private stepFlowDelay: number;
	constructor(opts: WorkerOptions, logMapping?: Partial<TaskWorkerLogMapping>) {
		this.buildTaskUniqueId = opts.taskUniqueIdBuilder;
		this.stepFlowDelay = opts.stepFlowDelay || 0;
		this.logger = new MapLogger(opts.logger, Object.assign({}, defaultLogMap, logMapping));
	}

	public onTaskUpdate(taskUpdateCallback: HandleTaskUpdateCallback<TI>): HandleTaskUpdateCallback<TI> {
		this.handleTaskUpdates.add(taskUpdateCallback);
		return taskUpdateCallback;
	}

	public removeTaskUpdate(taskUpdateCallback: HandleTaskUpdateCallback<TI>) {
		this.handleTaskUpdates.delete(taskUpdateCallback);
	}

	/**
	 * set logger instance (or change it if already set on constructor)
	 * @param logger any common logger instance (console, log4js, winston, etc.)
	 * @see {@link https://www.npmjs.com/package/@avanio/logger-like | @avanio/logger-like} for more info.
	 * @example
	 * worker.setLogger(console);
	 */
	public addLogger(logger: ILoggerLike) {
		this.logger.setLogger(logger);
	}

	/**
	 * get current task count in task worker
	 * @returns {number} number of tasks
	 * @example
	 * const taskCount = worker.getTaskCount();
	 */
	public getTaskCount(): number {
		return this.tasks.size;
	}

	/**
	 * Initialize task instance and store it in worker
	 * @param TaskClass Task class
	 * @param props Task props
	 * @param commonContext Common context
	 * @returns Task class instance
	 * @example
	 * const task = await worker.initializeTask(MyTask, {prop1: 'value1'}, {common: 'context'});
	 */
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
				errorCount: 0,
				errors: new Set(),
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
		const currentWorkerInstance = this.handleTaskInstanceBuild(abortController, classInstance);
		classInstance.getDescription().catch((err) => this.handleReject(currentWorkerInstance, err)); // pre-build description
		await this.setTaskStatus(currentWorkerInstance, classInstance.status); // change status to created
		this.tasks.set(classInstance.uuid, currentWorkerInstance); // store task
		return classInstance;
	}

	/**
	 * Get or initialize task instance and store it in worker
	 * @param uuid Task uuid or undefined
	 * @param type Task type
	 * @param TaskClass Task class
	 * @param props Task props
	 * @param commonContext Common context
	 * @returns return new Task class instance or existing task instance
	 * @example
	 * const task = await worker.getOrInitializeTask(oldTaskUuid, 'type', MyTask, {prop1: 'value1'}, {common: 'context'});
	 */
	public getOrInitializeTask<CType extends TI>(
		uuid: string | undefined,
		type: CType['type'],
		TaskClass: ITaskConstructorInferFromInstance<CType>,
		props: CType['props'],
		commonContext: CType['commonContext'],
	): Promise<FullTaskInstance<CType['data'], CType>> | FullTaskInstance<CType['data'], CType> {
		const task = (uuid && this.getTaskByUuid(uuid)) || undefined;
		if (task) {
			if (task.type !== type) {
				throw new Error(`Task ${task.uuid} type mismatch, expected ${type} but got ${task.type}`);
			}
			return task;
		}
		return this.initializeTask(TaskClass, props, commonContext);
	}

	private reloadImportTask(
		TaskClass: ITaskConstructorInferFromInstance<TI>,
		params: InferDataFromInstance<TI>,
	): TaskWorkerInstance<FullTaskInstance<unknown, TI>> {
		let haveReset = false;
		const abortController = new AbortController();
		const {uuid, commonContext, props, disabled, status, errorCount, errors, runCount, start, end, data} = params;
		const classInstance = new TaskClass(
			{
				commonContext,
				disabled,
				end,
				errorCount,
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
		if (classInstance.trigger.type !== 'instant') {
			classInstance.status = TaskStatusType.Created; // set status to created if task is not instant (allow to start)
			classInstance.start = undefined; // reset start
			classInstance.end = undefined; // reset end
			haveReset = true;
		}
		classInstance.taskError = params.taskError; // attach task error from import
		if (classInstance.singleInstance) {
			const existingTask = this.lookupSingleInstanceTask(classInstance);
			if (existingTask) {
				return existingTask;
			}
		}
		const currentWorkerInstance = this.handleTaskInstanceBuild(abortController, classInstance);
		classInstance.getDescription().catch((err) => this.handleReject(currentWorkerInstance, err)); // pre-build description
		this.tasks.set(classInstance.uuid, currentWorkerInstance); // store task
		haveReset && this.setTaskStatus(currentWorkerInstance, classInstance.status).catch((err) => this.handleReject(currentWorkerInstance, err)); // trigger status change after reset (async, not wait here)
		// handle task promises if task is already resolved/rejected
		if (currentWorkerInstance.task.trigger.type === 'instant' && !currentWorkerInstance.promise.isDone) {
			if (currentWorkerInstance.task.status === TaskStatusType.Resolved) {
				currentWorkerInstance.promise.resolve(currentWorkerInstance.task.data);
			}
			if (currentWorkerInstance.task.status === TaskStatusType.Rejected) {
				currentWorkerInstance.promise.catch(() => {}); // ignore promise rejection (we are resolving it now)
				currentWorkerInstance.promise.reject(
					currentWorkerInstance.task.taskError ||
						new Error(`Task ${currentWorkerInstance.task.uuid} ${currentWorkerInstance.type} rejected but no error data found`),
				);
			}
		}
		return currentWorkerInstance;
	}

	/**
	 * Start this task instance.
	 * @param task Task instance
	 * @returns Promise that will be resolved when task is started
	 * @example
	 * await worker.startTask(task);
	 */
	public async startTask<ReturnType>(task: FullTaskInstance<ReturnType, TI>): Promise<void> {
		const instance = this.tasks.get(task.uuid);
		this.assertInstance(instance, task.uuid);
		// check if task is already started
		if (instance.task.status > TaskStatusType.Init) {
			throw new Error(`Task ${instance.task.uuid} ${instance.type} is already started`);
		}
		await this.setTaskStatus(instance, TaskStatusType.Init);
		await this.handleTriggerConnection(instance);
	}

	/**
	 * Wait for this task to be resolved/rejected (also starts task if not started yet)
	 * @param task Task instance
	 * @returns ReturnType of task (resolved value or rejected error)
	 */
	public async waitTask<ReturnType>(task: FullTaskInstance<ReturnType, TI>): Promise<ReturnType> {
		const instance = this.tasks.get(task.uuid);
		this.assertInstance(instance, task.uuid);
		if (instance.task.trigger.type !== 'instant') {
			throw new Error(`Task ${instance.task.uuid} ${instance.type} is not instant and cannot be waited`);
		}
		// not started yet - start it
		if (instance.task.status < TaskStatusType.Init) {
			await this.startTask(task);
		}
		return instance.promise as Promise<ReturnType>;
	}

	/**
	 * Restart this task instance if it's not in running state
	 * @param task Task instance
	 */
	public async restartTask<ReturnType>(task: FullTaskInstance<ReturnType, TI>): Promise<void> {
		const instance = this.tasks.get(task.uuid);
		this.assertInstance(instance, task.uuid);
		// check if we can restart this task
		await instance.task.allowRestart();
		!instance.promise.isDone && instance.promise.reject(new Error('Task restart')); // throw error to reject old promise if someone is waiting for it
		// check if task is already running just before reset and start
		if (isRunningState(instance.task.status)) {
			throw new Error(`Task ${instance.task.uuid} ${instance.type} is already running`);
		}
		// reset and run task now
		setTimeout(async () => {
			this.resetTaskInstance(instance);
			await this.setTaskStatus(instance, TaskStatusType.Pending);
			await this.runTask(instance);
		}, 0);
	}

	/**
	 * Get task instance by uuid
	 * @param uuid
	 * @returns Task instance or undefined
	 */
	public getTaskByUuid(uuid: string): FullTaskInstance<unknown, TI> | undefined {
		const instance = this.tasks.get(uuid);
		return instance?.task;
	}

	/**
	 * Get all task instances based on type
	 * @returns Array of task instances
	 */
	public getTasksByType<T extends TI['type']>(type: T): FullTaskInstance<unknown, ITaskInstance<T, TTaskProps, unknown, CommonTaskContext>>[] {
		return Array.from(this.tasks.values())
			.filter((task) => task.type === type)
			.map((task) => task.task) as FullTaskInstance<unknown, ITaskInstance<T, TTaskProps, unknown, CommonTaskContext>>[];
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
		this.logger.logKey('delete', `Task ${instance.task.uuid} ${instance.type} deleted`);
		await instance.promise; // wait promise to be resolved/rejected
	}

	/**
	 * method to import tasks back to worker (like from database or other storage)
	 * @param data
	 * @param importMapping
	 */
	public async importTasks(data: InferDataFromInstance<TI>[], importMapping: ImportObjectMap<TI>): Promise<void> {
		const taskInstances = data.reduce<TaskWorkerInstance<FullTaskInstance<unknown, TI>>[]>((acc, taskData) => {
			const TaskClass = importMapping[taskData.type] as ITaskConstructorInferFromInstance<TI> | undefined;
			if (TaskClass) {
				acc.push(this.reloadImportTask(TaskClass, taskData));
			}
			return acc;
		}, []);
		try {
			for (const currentWorkerInstance of taskInstances) {
				// revert status to pending if task was on running state
				if (isRunningState(currentWorkerInstance.task.status)) {
					this.logger?.debug(`Task ${currentWorkerInstance.task.uuid} ${currentWorkerInstance.type} restart on import`);
					currentWorkerInstance.task.start = undefined; // reset start
					currentWorkerInstance.task.end = undefined; // reset end
					await this.setTaskStatus(currentWorkerInstance, TaskStatusType.Pending); // change status to pending
					await this.handleTriggerConnection(currentWorkerInstance, true);
				}
			}
		} catch (err) {
			this.logger.error(`Task import error: ${haveError(err)}`);
		}
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
		this.logger.logKey('abort', `Task ${instance.task.uuid} ${instance.type} abort`);
		// if task is not resolved/rejected yet
		if (instance.task.status < 90) {
			await this.setTaskStatus(instance, TaskStatusType.Aborted);
		}
		instance.abortController.abort();
	}

	private resetTaskInstance(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>) {
		instance.abortController = new AbortController(); // reset abort controller
		// reset promise
		if (instance.task.trigger.type === 'instant' && !instance.promise.isDone) {
			instance.promise.reject(new Error('Task reset')); // trow error to reject old promise if someone is waiting for it
		}
		instance.promise = new DeferredPromise<unknown>(); // reset promise
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
					setTimeout(async () => {
						await this.runTask(instance);
					}, 0);
					break;
				case 'interval':
					if (instance.intervalRef) {
						clearInterval(instance.intervalRef);
					}

					isImport && this.resetTaskInstance(instance);
					setTimeout(async () => {
						await this.runTask(instance);
					}, 0);
					instance.intervalRef = setInterval(async () => {
						this.resetTaskInstance(instance);
						await this.setTaskStatus(instance, TaskStatusType.Pending);
						await this.runTask(instance);
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
						await this.runTask(instance);
					});
					instance.cron.start();
					break;
				default:
					// istanbul ignore next
					throw new FatalTaskError(`Task ${instance.task.uuid} is not triggerable with trigger: ${JSON.stringify(instance.task.trigger)}`);
			}
		} catch (err) {
			// istanbul ignore next
			await this.handleReject(instance, buildFatalError(err));
		}
	}

	private async runTask(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): Promise<void> {
		let isTaskRetired = false;
		while (!isTaskRetired) {
			try {
				if (instance.task.disabled) {
					throw new TaskDisabledError(`Task ${instance.task.uuid} ${instance.type} is disabled`);
				}
				isTaskRetired = await this.runTaskFlow(instance);
			} catch (err) {
				instance.task.errorCount++;
				instance.task.errors.add({ts: new Date(), error: haveError(err)});
				if (err instanceof FatalTaskError) {
					this.logger.logKey('flow_error', `Task ${instance.task.uuid} ${instance.type} ${err.name} error`);
					isTaskRetired = await this.handleReject(instance, err);
				} else if (!(await instance.task.retry())) {
					const msg = `Task ${instance.task.uuid} ${instance.type} retry limit reached`;
					this.logger.logKey('flow_limit', msg);
					const limitError = new FatalTaskError(msg);
					instance.task.errors.add({ts: new Date(), error: haveError(limitError)});
					isTaskRetired = await this.handleReject(instance, limitError);
				} else {
					this.logger.logKey('flow_retry', `Task ${instance.task.uuid} ${instance.type} retry`);
					const sleepTime = await instance.task.onErrorSleep();
					await sleep(this.stepFlowDelay, {signal: instance.abortController.signal});
					if (sleepTime > 0) {
						this.logger.logKey('flow_sleep', `Task ${instance.task.uuid} ${instance.type} sleep ${sleepTime}ms`);
						await this.setTaskStatus(instance, TaskStatusType.Pending);
						await sleep(sleepTime, {signal: instance.abortController.signal});
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
		this.logger.logKey('rejected', `Task ${instance.task.uuid} ${instance.type} rejected`);
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
		this.logger.logKey('resolved', `Task ${instance.task.uuid} ${instance.type} resolved`);
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
		if (isRunningState(instance.task.status)) {
			throw new FatalTaskError(`Task ${instance.task.uuid} ${instance.type} is already running`);
		}
		if (!instance.task.start) {
			instance.task.start = new Date();
			instance.task.end = undefined;
		}
		// on init callback
		if (instance.task.status === TaskStatusType.Init) {
			await sleep(this.stepFlowDelay, {signal: instance.abortController.signal});
			this.assertIfAbort(instance);
			await instance.task.onInit();
		}
		// pre-run
		await sleep(this.stepFlowDelay, {signal: instance.abortController.signal});
		this.assertIfAbort(instance);
		// check if task is allowed to start
		if (!(await instance.task.onPreStart())) {
			this.logger.logKey('not_start', `Task ${instance.task.uuid} ${instance.type} not started`);
			this.resetTaskInstance(instance);
			await this.setTaskStatus(instance, instance.task.status); // update status
			return true; // task not needed to be started
		}
		await this.setTaskStatus(instance, TaskStatusType.Starting);
		// run step
		this.logger.logKey('start', `Task ${instance.task.uuid} ${instance.type} run ${instance.task.runCount}`);
		await sleep(this.stepFlowDelay, {signal: instance.abortController.signal});
		instance.task.runCount++;
		await this.setTaskStatus(instance, TaskStatusType.Running);
		this.assertIfAbort(instance);
		const data = await instance.task.runTask();
		instance.task.data = data; // store data to task instance
		// handle task resolve
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
			workerInstance.task.status === status
				? `to ${getTaskStatusString(status)}`
				: `from ${getTaskStatusString(workerInstance.task.status)} to ${getTaskStatusString(status)}`;
		const message = `Task ${workerInstance.task.uuid} ${workerInstance.type} status changed ${statusInfo}`;
		switch (status) {
			case TaskStatusType.Rejected:
				this.logger.logKey('status_change_error', message);
				break;
			case TaskStatusType.Init:
			case TaskStatusType.Resolved:
				this.logger.logKey('status_change_info', message);
				break;
			default:
				this.logger.logKey('status_change_default', message);
		}
		workerInstance.task.status = status;
		return this.notifyTaskUpdate(workerInstance);
	}

	private async notifyTaskUpdate(workerInstance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): Promise<void> {
		const data = this.buildTaskAsTaskData(workerInstance.task);
		await Promise.all(Array.from(this.handleTaskUpdates).map((cb) => cb(data, workerInstance.task)));
	}

	private buildTaskAsTaskData(task: FullTaskInstance<unknown, TI>): InferDataFromInstance<TI> {
		const {type, uuid, commonContext, props, status, disabled, errors, runCount, start, end, data, taskError, errorCount} = task;
		return {
			commonContext,
			data,
			disabled,
			end,
			errorCount,
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
