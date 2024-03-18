import * as EventEmitter from 'events';
import {ILoggerLike, LogLevel, LogMapping, MapLogger} from '@avanio/logger-like';
import {sleep} from '@avanio/sleep';
import * as Cron from 'cron';
import TypedEmitter from 'typed-emitter';
import type {ITaskConstructorInferFromInstance, ITaskInstance} from './interfaces/ITask';
import {AbortTaskError} from './lib/AbortTaskError';
import {DeferredPromise} from './lib/DeferredPromise';
import {haveError} from './lib/errorUtil';
import {FatalTaskError, buildFatalError} from './lib/FatalTaskError';
import {TaskDisabledError} from './lib/TaskDisabledError';
import {type TaskLogFunction, buildTaskLog} from './lib/taskLog';
import {TaskRetryError} from './lib/TaskRetryError';
import type {InferDataFromInstance} from './types/TaskData';
import type {TTaskProps} from './types/TaskProps';
import {TaskStatusType, getTaskStatusString, isEndState, isRunningState, isStartState} from './types/TaskStatus';

/**
 * Worker EventEmitter events
 */
export type WorkerEvents<TI extends ITaskInstance<string, TTaskProps, unknown, unknown>> = {
	import: () => void;
	addTask: (task: TI) => void;
	updateTask: (task: TI) => void;
	deleteTask: (task: TI) => void;
};

export const defaultLogMap = {
	abort: LogLevel.Info,
	delete: LogLevel.Error,
	flow_abort: LogLevel.None,
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
	/** custom log formatter */
	logFunction?: TaskLogFunction;
};

export interface TaskWorkerInstance<TI extends ITaskInstance<string, TTaskProps, unknown, unknown>> {
	abortController: AbortController;
	type: TI['type'];
	task: TI;
	promise: DeferredPromise<unknown>;
	promiseOnce: DeferredPromise<unknown>;
	cron?: Cron.CronJob;
	intervalRef?: ReturnType<typeof setInterval>;
}

export class Worker<CommonTaskContext, TI extends ITaskInstance<string, TTaskProps, unknown, CommonTaskContext>> extends (EventEmitter as {
	new <CommonTaskContext, TI extends ITaskInstance<string, TTaskProps, unknown, CommonTaskContext>>(): TypedEmitter<WorkerEvents<TI>>;
})<CommonTaskContext, TI> {
	private buildTaskUniqueId: () => string;
	private tasks = new Map<string, TaskWorkerInstance<FullTaskInstance<unknown, TI>>>();
	private logger: MapLogger<TaskWorkerLogMapping>;
	private buildLog: TaskLogFunction;

	private stepFlowDelay: number;

	constructor(opts: WorkerOptions, logMapping?: Partial<TaskWorkerLogMapping>) {
		super();
		this.buildTaskUniqueId = opts.taskUniqueIdBuilder;
		this.stepFlowDelay = opts.stepFlowDelay || 0;
		this.buildLog = opts.logFunction || buildTaskLog;
		this.logger = new MapLogger(opts.logger, Object.assign({}, defaultLogMap, logMapping));
	}

	/**
	 * set logger instance (or change it if already set on constructor)
	 * @param logger any common logger instance (console, log4js, winston, etc.)
	 * @see {@link https://www.npmjs.com/package/@avanio/logger-like | @avanio/logger-like} for more info.
	 * @example
	 * worker.setLogger(console);
	 */
	public addLogger(logger: ILoggerLike): void {
		this.logger.setLogger(logger);
	}

	public setLogMapping(logMap: Partial<TaskWorkerLogMapping>): void {
		this.logger.setLogMapping(logMap);
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
	 * Initialize and return task class instance and store it in worker
	 * @param TaskClass Task class
	 * @param props Task constructor properties
	 * @param commonContext Common context (all tasks shared this context type)
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
				runErrorCount: 0,
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
		// pre-build description
		void this.handlePreBuildDescription(classInstance, currentWorkerInstance);
		await this.setTaskStatus(currentWorkerInstance, classInstance.status); // change status to created
		this.tasks.set(classInstance.uuid, currentWorkerInstance); // store task
		this.emit('addTask', classInstance);
		classInstance.onUpdate(() => this.emit('updateTask', classInstance)); // hook task update event to worker update event
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
				return Promise.reject(new Error(this.buildLog(task, `type mismatch, expected type ${type}`)));
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
		const {uuid, commonContext, props, disabled, status, errorCount, errors, runCount, runErrorCount, start, end, data} = params;
		const classInstance = new TaskClass(
			{
				commonContext,
				disabled,
				end,
				errorCount,
				errors,
				props,
				runCount,
				runErrorCount,
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
		// pre-build description
		void this.handlePreBuildDescription(classInstance, currentWorkerInstance);
		this.tasks.set(classInstance.uuid, currentWorkerInstance); // store task
		classInstance.onUpdate(() => this.emit('updateTask', classInstance)); // hook task update event to worker update event
		haveReset && this.setTaskStatus(currentWorkerInstance, classInstance.status).catch((err) => this.handleReject(currentWorkerInstance, err)); // trigger status change after reset (async, not wait here)
		// handle task promises if task is already resolved/rejected
		if (currentWorkerInstance.task.trigger.type === 'instant' && !currentWorkerInstance.promise.isDone) {
			if (currentWorkerInstance.task.status === TaskStatusType.Resolved) {
				currentWorkerInstance.promise.resolve(currentWorkerInstance.task.data);
			}
			if (currentWorkerInstance.task.status === TaskStatusType.Rejected) {
				currentWorkerInstance.promise.catch(() => {}); // ignore promise rejection (we are resolving it now)
				currentWorkerInstance.promise.reject(
					currentWorkerInstance.task.taskError || new Error(this.buildLog(currentWorkerInstance.task, 'rejected but no error data found')),
				);
			}
		}
		return currentWorkerInstance;
	}

	/**
	 * Start this task instance.
	 * @throws {FatalTaskError} if task is already started
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
			throw new FatalTaskError(this.buildLog(instance.task, 'is already started'));
		}
		await this.setTaskStatus(instance, TaskStatusType.Init);
		await this.handleTriggerConnection(instance);
	}

	/**
	 * Wait for this task to be resolved/rejected (also starts task if not started yet)
	 * @throws {FatalTaskError} if task is not instant
	 * @throws {FatalTaskError} if task is already started
	 * @param {FullTaskInstance<ReturnType, TI>} task Task instance
	 * @returns {Promise<ReturnType> } Promise of current task data
	 */
	public async waitTask<ReturnType>(task: FullTaskInstance<ReturnType, TI>): Promise<ReturnType> {
		const instance = this.tasks.get(task.uuid);
		this.assertInstance(instance, task.uuid);
		if (instance.task.trigger.type !== 'instant') {
			throw new FatalTaskError(this.buildLog(instance.task, 'is not instant and cannot be waited'));
		}
		// not started yet - start it
		if (instance.task.status < TaskStatusType.Init) {
			await this.startTask(task);
		}
		return instance.promise as Promise<ReturnType>; // hook to main promise
	}

	/**
	 * Wait for this task to be resolved/rejected on each run (also starts task if not started yet)
	 *
	 * Note: Task will be running and retried even if this Promise is thrown as new Promise will be created for each new run.
	 * @throws {FatalTaskError} if task is not instant
	 * @throws {FatalTaskError} if task is already started
	 * @throws {TaskRetryError} if task will be retried and continue to next retry run
	 * @param {FullTaskInstance<ReturnType, TI>} task Task instance
	 * @returns {Promise<ReturnType> } Promise of single run task data
	 */
	public async waitTaskRun<ReturnType>(task: FullTaskInstance<ReturnType, TI>): Promise<ReturnType> {
		const instance = this.tasks.get(task.uuid);
		this.assertInstance(instance, task.uuid);
		if (instance.task.trigger.type !== 'instant') {
			throw new FatalTaskError(this.buildLog(instance.task, 'is not instant and cannot be waited'));
		}
		// not started yet - start it
		if (instance.task.status < TaskStatusType.Init) {
			await this.startTask(task);
		}
		return instance.promiseOnce as Promise<ReturnType>; // hook to single retry promise
	}

	/**
	 * Restart this task instance if it's not in running state
	 * @throws {FatalTaskError} if task is already running
	 * @throws {FatalTaskError} if task is not allowed to restart
	 * @param {FullTaskInstance<ReturnType, TI>} task Task instance
	 */
	public async restartTask<ReturnType>(task: FullTaskInstance<ReturnType, TI>): Promise<void> {
		const instance = this.tasks.get(task.uuid);
		this.assertInstance(instance, task.uuid);
		// check if we can restart this task
		if (!(await instance.task.allowRestart())) {
			throw new FatalTaskError(this.buildLog(instance.task, 'is not allowed to restart'));
		}
		// check if task is already running just before reset and start
		if (isRunningState(instance.task.status)) {
			throw new FatalTaskError(this.buildLog(instance.task, 'is already running'));
		}
		!instance.promise.isDone && instance.promise.reject(new Error(this.buildLog(instance.task, 'restarting'))); // throw error to reject old promise if someone is waiting for it
		this.resetTaskInstance(instance);
		await this.setTaskStatus(instance, TaskStatusType.Pending);
		// reset and run task now
		setTimeout(this.handleInstantJob.bind(this, instance), 0);
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
	 * Update task instance with new data, this is useful when task is updated from outside (like database events).
	 *
	 * Note: this will not directly affect tasks flow directly, just updates task data and status.
	 * @param {InferDataFromInstance<TI>} data - updated task data
	 */
	public async updateTask(data: InferDataFromInstance<TI>): Promise<void> {
		const instance = this.tasks.get(data.uuid);
		this.assertInstance(instance, data.uuid);
		// update current task instance with new data
		instance.task.commonContext = data.commonContext;
		instance.task.data = data.data;
		instance.task.disabled = data.disabled;
		instance.task.end = data.end;
		instance.task.errorCount = data.errorCount;
		instance.task.errors = data.errors;
		instance.task.props = data.props;
		instance.task.runCount = data.runCount;
		instance.task.runErrorCount = data.runErrorCount;
		instance.task.start = data.start;
		instance.task.status = data.status;
		instance.task.taskError = data.taskError;
		// type - readonly - not allowed to change
		// uuid - readonly - not allowed to change
		await this.notifyTaskUpdate(instance);
	}

	/**
	 * stop currently running task and wait for it to resolved/rejected
	 * @param task
	 */
	public async stopTask<ReturnType>(task: FullTaskInstance<ReturnType, TI>): Promise<void> {
		const instance = this.tasks.get(task.uuid);
		this.assertInstance(instance, task.uuid);
		return this.handleStopTask(instance);
	}

	/**
	 * Stop and delete this task from worker and wait for it to resolved/rejected
	 * @param task
	 */
	public async deleteTask<ReturnType>(task: FullTaskInstance<ReturnType, TI>): Promise<void> {
		const instance = this.tasks.get(task.uuid);
		this.assertInstance(instance, task.uuid);
		await this.handleStopTask(instance); // abort task first
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
		this.logKey('delete', instance, 'deleted');
		this.tasks.delete(task.uuid);
		this.emit('deleteTask', instance.task as TI);
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
					this.logger.debug(this.buildLog(currentWorkerInstance.task, 'restart on import'));
					currentWorkerInstance.task.start = undefined; // reset start
					currentWorkerInstance.task.end = undefined; // reset end
					await this.setTaskStatus(currentWorkerInstance, TaskStatusType.Pending); // change status to pending
					await this.handleTriggerConnection(currentWorkerInstance, true);
				}
			}
			this.emit('import');
		} catch (err) {
			// istanbul ignore next
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

	private async handleTaskAbort(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): Promise<void> {
		this.logKey('abort', instance, 'abort');
		await this.setTaskStatus(instance, TaskStatusType.Aborted);
		instance.abortController.abort();
		// trigger promise reject (Abort) if task is not resolved/rejected yet and use runTaskErrorHandler to handle it
		try {
			if (!instance.promise.isDone) {
				this.assertIfAbort(instance);
			}
		} catch (err) {
			await this.runTaskErrorHandler(instance, err);
		}
	}

	private async handleStopTask(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): Promise<void> {
		// check if task is already resolved/rejected/aborted
		if (isEndState(instance.task.status)) {
			return;
		}
		await this.handleTaskAbort(instance);
		try {
			await instance.promise; // wait promise to be resolved/rejected
		} catch (err) {
			// ignore abort error
		}
	}

	/**
	 * Reset task instance values.
	 * - setup new abort controller
	 * - reject old promise if task is instant and not resolved/rejected yet
	 * - new {@link DeferredPromise}
	 * - reset task `start` and `end` dates
	 * - reset task status to `Init`
	 */
	private resetTaskInstance(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): void {
		instance.abortController = new AbortController(); // reset abort controller
		// reset promise
		if (instance.task.trigger.type === 'instant' && !instance.promise.isDone) {
			// istanbul ignore next
			instance.promise.reject(new Error(this.buildLog(instance.task, 'reset'))); // throw error to reject old promise if someone is waiting for it
		}
		instance.promise = new DeferredPromise<unknown>(); // reset promise
		instance.task.start = undefined; // reset start
		instance.task.end = undefined; // reset end
		instance.task.status = TaskStatusType.Init; // reset status
		instance.task.errorCount = 0; // reset current error count
	}

	/**
	 * @throws never
	 * @returns {Promise<void>} - this method won't throw any error
	 */
	private async handleTriggerConnection(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>, isImport = false): Promise<void> {
		try {
			switch (instance.task.trigger.type) {
				case 'instant':
					// ignore if task is already started (for import task)
					if (!isStartState(instance.task.status)) {
						// istanbul ignore next
						return;
					}
					setTimeout(this.handleInstantJob.bind(this, instance), 0);
					break;
				case 'interval':
					if (instance.intervalRef) {
						// istanbul ignore next
						clearInterval(instance.intervalRef);
					}
					await this.setTaskStatus(instance, TaskStatusType.Pending);
					isImport && this.resetTaskInstance(instance);
					setTimeout(this.handleInstantJob.bind(this, instance), 0); // first run
					instance.intervalRef = setInterval(this.handleTimedJob.bind(this, instance), instance.task.trigger.interval);
					break;
				case 'cron':
					if (instance.cron) {
						// istanbul ignore next
						instance.cron.stop();
					}
					await this.setTaskStatus(instance, TaskStatusType.Pending);
					isImport && this.resetTaskInstance(instance);
					instance.cron = new Cron.CronJob(instance.task.trigger.cron, this.handleTimedJob.bind(this, instance));
					instance.cron.start();
					break;
				default:
					// istanbul ignore next
					throw new FatalTaskError(this.buildLog(instance.task, `is not triggerable with trigger: ${JSON.stringify(instance.task.trigger)}`));
			}
		} catch (err) {
			// istanbul ignore next
			await this.handleReject(instance, buildFatalError(err));
		}
	}

	/**
	 * handle instance job start
	 * @throws never
	 * @returns {Promise<void>} - this method won't throw any error
	 */
	private async handleInstantJob(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): Promise<void> {
		try {
			await this.runTask(instance);
		} catch (err) {
			// istanbul ignore next
			await this.handleReject(instance, buildFatalError(err));
		}
	}

	/**
	 * handle timed jobs
	 * this resets task instance and run it again
	 * @throws never
	 * @returns {Promise<void>} - this method won't throw any error
	 */
	private async handleTimedJob(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): Promise<void> {
		try {
			this.resetTaskInstance(instance);
			await this.setTaskStatus(instance, TaskStatusType.Pending);
			await this.runTask(instance);
		} catch (err) {
			// istanbul ignore next
			await this.handleReject(instance, buildFatalError(err));
		}
	}

	/**
	 * Run task instance.
	 * @throws {never} - this method won't throw any error
	 * @param instance
	 */
	private async runTask(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): Promise<void> {
		let isTaskRetired = false;
		while (!isTaskRetired) {
			if (instance.promise.isDone) {
				return; // task is already resolved/rejected, don't run it again (i.e. external Abort etc.)
			}
			try {
				if (instance.task.disabled) {
					throw new TaskDisabledError(this.buildLog(instance.task, 'is disabled'));
				}
				isTaskRetired = await this.runTaskFlow(instance);
			} catch (err) {
				isTaskRetired = await this.runTaskErrorHandler(instance, err);
			}
		}
	}

	/**
	 * handle task error and possible retries
	 * @see {@link runTask} flow and manual {@link handleTaskAbort}
	 * @returns true if task should be retried
	 */
	private async runTaskErrorHandler(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>, err: unknown): Promise<boolean> {
		if (instance.promise.isDone) {
			// istanbul ignore next
			return false; // task is already resolved/rejected, we don't try to handle it again (this might happen if task is aborted externally while running)
		}
		instance.task.errorCount++;
		instance.task.runErrorCount++;
		instance.task.errors.add({ts: new Date(), error: haveError(err)});
		if (err instanceof FatalTaskError) {
			if (err instanceof AbortTaskError) {
				this.logKey('flow_abort', instance, `${err.name}: ${err.message}`);
			} else {
				this.logKey('flow_error', instance, `${err.name}: ${err.message}`);
			}
			return this.handleReject(instance, err);
		} else if (!(await instance.task.retry())) {
			const limitError = new FatalTaskError(this.logKey('flow_limit', instance, 'retry limit reached'));
			instance.task.errors.add({ts: new Date(), error: limitError});
			return this.handleReject(instance, limitError);
		} else {
			// throw once and create new promise for retry
			instance.promiseOnce.reject(new TaskRetryError(this.buildLog(instance.task, 'failed, retrying'), instance.task.errorCount)); // reject once promise
			instance.promiseOnce = new DeferredPromise<unknown>(); // reset once promise
			this.logKey('flow_retry', instance, `retry: ${haveError(err).message}`);
			const sleepTime = await instance.task.onErrorSleep();
			await sleep(this.stepFlowDelay, {signal: instance.abortController.signal});
			if (sleepTime > 0) {
				this.logKey('flow_sleep', instance, `sleep ${sleepTime}ms`);
				await this.setTaskStatus(instance, TaskStatusType.Pending);
				await sleep(sleepTime, {signal: instance.abortController.signal});
			}
			return false;
		}
	}

	/**
	 * handle task reject
	 * @returns true if task should be retried
	 */
	private async handleReject(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>, err: Error): Promise<boolean> {
		this.logKey('rejected', instance, `rejected: ${haveError(err).message}`);
		instance.task.end = new Date();
		instance.task.taskError = err;
		if (instance.abortController.signal.aborted) {
			instance.task.status !== TaskStatusType.Aborted && (await this.setTaskStatus(instance, TaskStatusType.Aborted));
		} else {
			instance.task.status !== TaskStatusType.Rejected && (await this.setTaskStatus(instance, TaskStatusType.Rejected));
		}
		try {
			await instance.task.onRejected();
		} catch (onRejectedPromiseError) {
			// attach onRejected error to current task errors list
			const onRejectedError = new Error(buildTaskLog(instance.task, `onRejected: ${haveError(onRejectedPromiseError).message}`));
			if (onRejectedPromiseError instanceof Error) {
				onRejectedError.stack = onRejectedPromiseError.stack;
			}
			instance.task.errors.add({ts: new Date(), error: onRejectedError});
		}
		instance.promise.reject(err);
		instance.promiseOnce.reject(err); // reject once promise
		return true;
	}

	/**
	 * handle task resolve
	 * @param instance
	 * @returns {boolean} true if task should be retried
	 */
	private async handleResolve(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): Promise<boolean> {
		this.logKey('resolved', instance, 'resolved');
		instance.task.end = new Date();
		await this.setTaskStatus(instance, TaskStatusType.Resolved);
		try {
			await instance.task.onResolved();
		} catch (onResolvedPromiseError) {
			// attach onResolved error to current task errors list
			const onResolvedError = new Error(buildTaskLog(instance.task, `onResolved: ${haveError(onResolvedPromiseError).message}`));
			if (onResolvedPromiseError instanceof Error) {
				onResolvedError.stack = onResolvedPromiseError.stack;
			}
			instance.task.errors.add({ts: new Date(), error: onResolvedError});
		}
		return true;
	}

	/**
	 * run task flow
	 * @returns true if task should be retried
	 */
	private async runTaskFlow(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): Promise<boolean> {
		// this should not happen, but let's check it
		if (isRunningState(instance.task.status)) {
			// istanbul ignore next
			throw new FatalTaskError(this.buildLog(instance.task, 'is already running'));
		}
		const originalStatus = instance.task.status;
		const originalStart = instance.task.start;
		const originalEnd = instance.task.end;
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
			this.logKey('not_start', instance, 'onPreStart is false, not started');
			instance.task.start = originalStart; // revert start
			instance.task.end = originalEnd; // revert end
			await this.setTaskStatus(instance, originalStatus); // revert status
			instance.promise.resolve(instance.task.data); // solve waiting promise
			instance.promiseOnce.resolve(instance.task.data); // solve waiting promise
			return true; // task not needed to be started
		}
		await this.setTaskStatus(instance, TaskStatusType.Starting);
		// run step
		this.logKey('start', instance, `run ${instance.task.runCount}`);
		await sleep(this.stepFlowDelay, {signal: instance.abortController.signal});
		instance.task.runCount++;
		await this.setTaskStatus(instance, TaskStatusType.Running);
		this.assertIfAbort(instance);
		const data = await instance.task.runTask();
		instance.task.data = data; // store data to task instance
		// handle task resolve
		const status = await this.handleResolve(instance);
		instance.promise.resolve(data); // solve waiting promise
		instance.promiseOnce.resolve(data); // solve waiting promise
		return status;
	}

	private assertIfAbort(instance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): void {
		if (instance.abortController.signal.aborted) {
			throw new AbortTaskError(this.buildLog(instance.task, 'aborted'));
		}
	}

	private handleTaskInstanceBuild<ReturnType>(
		abortController: AbortController,
		task: FullTaskInstance<ReturnType, TI>,
	): TaskWorkerInstance<FullTaskInstance<ReturnType, TI>> {
		return {
			abortController,
			promise: new DeferredPromise<unknown>(),
			promiseOnce: new DeferredPromise<unknown>(),
			task,
			type: task.type,
		};
	}

	/**
	 * lookup single type task instance
	 * @throws never
	 * @returns TaskWorkerInstance<FullTaskInstance<unknown, TI>> | undefined
	 */
	private lookupSingleInstanceTask<ReturnType>(
		taskInstance: FullTaskInstance<ReturnType, TI>,
	): TaskWorkerInstance<FullTaskInstance<ReturnType, TI>> | undefined {
		return [...this.tasks.values()].find((task) => task.type === taskInstance.type) as TaskWorkerInstance<FullTaskInstance<ReturnType, TI>> | undefined;
	}

	private setTaskStatus(workerInstance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>, status: TaskStatusType): Promise<void> {
		const statusInfo =
			workerInstance.task.status === status
				? `to ${getTaskStatusString(status)}`
				: `from ${getTaskStatusString(workerInstance.task.status)} to ${getTaskStatusString(status)}`;
		const message = `status changed ${statusInfo}`;
		switch (status) {
			case TaskStatusType.Rejected:
				this.logKey('status_change_error', workerInstance, message);
				break;
			case TaskStatusType.Init:
			case TaskStatusType.Resolved:
			case TaskStatusType.Aborted:
				this.logKey('status_change_info', workerInstance, message);
				break;
			default:
				this.logKey('status_change_default', workerInstance, message);
		}
		workerInstance.task.status = status;
		return this.notifyTaskUpdate(workerInstance);
	}

	private async notifyTaskUpdate(workerInstance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>): Promise<void> {
		this.emit('updateTask', workerInstance.task as TI);
	}

	/**
	 * Handle log keys with buildLog
	 * @returns log message as string
	 */
	private logKey(key: keyof TaskWorkerLogMapping, workerInstance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>, message: string): string {
		const out = this.buildLog(workerInstance.task, message);
		this.logger.logKey(key, out);
		return out;
	}

	/**
	 * handle pre-build task description
	 * @throws never
	 * @returns {Promise<void>} - this method won't throw any error
	 */
	private async handlePreBuildDescription(
		classInstance: ITaskInstance<string, TTaskProps, unknown, CommonTaskContext>,
		currentWorkerInstance: TaskWorkerInstance<FullTaskInstance<unknown, TI>>,
	): Promise<void> {
		try {
			await classInstance.getDescription();
		} catch (err) {
			await this.handleReject(currentWorkerInstance, buildFatalError(err));
		}
	}
}
