/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable import/namespace */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-unused-expressions */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/no-identical-functions */
import {type ILoggerLike, LogLevel} from '@avanio/logger-like';
import {sleep} from '@avanio/sleep';
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as sinon from 'sinon';
import 'mocha';
import {v4 as uuid} from 'uuid';
import {
	AbstractSimpleTask,
	type ImportObjectMap,
	Worker,
	type TaskTrigger,
	TaskStatusType,
	FatalTaskError,
	type TaskWorkerLogMapping,
	buildTaskLog,
	getTaskStatusString,
	type FullTaskInstance,
	TaskRetryError,
} from './';

chai.use(chaiAsPromised);
const expect = chai.expect;

const logMapper: TaskWorkerLogMapping = {
	abort: LogLevel.Debug,
	delete: LogLevel.Debug,
	flow_abort: LogLevel.Debug,
	flow_error: LogLevel.Debug,
	flow_limit: LogLevel.Debug,
	flow_retry: LogLevel.Debug,
	flow_sleep: LogLevel.Debug,
	not_start: LogLevel.Debug,
	rejected: LogLevel.Debug,
	resolved: LogLevel.Debug,
	start: LogLevel.Debug,
	status_change_default: LogLevel.Debug,
	status_change_error: LogLevel.Debug,
	status_change_info: LogLevel.Debug,
};

const spyLogger = {
	debug: sinon.spy(),
	error: sinon.spy(),
	info: sinon.spy(),
	warn: sinon.spy(),
} satisfies ILoggerLike;

class Test1 extends AbstractSimpleTask<'test1', {test: string; onInit?: true; onResolved?: true; onRejected?: true; onPreStart?: true}, string, unknown> {
	public readonly type = 'test1';
	public trigger: TaskTrigger = {type: 'instant'};
	public runTask(): string {
		if (this.props.test === 'throw' || this.props.test === 'throw-on-reject') {
			throw new Error('test');
		}
		if (this.props.test === 'progress') {
			this.setProgress(25);
			this.setProgress(50);
			this.setProgress(75);
		}
		return 'test1';
	}

	public allowRestart(): boolean {
		return true;
	}

	protected buildDescription(): string {
		if (this.props.test === 'description-throw') {
			throw new Error('description-throw');
		}
		return `${this.type} task`;
	}

	public onInit(): void {
		this.props.onInit = true;
	}

	public onPreStart(): boolean {
		if (this.props.test === 'pre-start-false') {
			return false;
		}
		this.props.onPreStart = true;
		return true;
	}

	public onResolved(): void {
		if (this.props.test === 'throw-on-resolve') {
			throw new Error('onResolved');
		}
		this.props.onResolved = true;
	}

	public onRejected(): void {
		if (this.props.test === 'throw-on-reject') {
			throw new Error('onRejected');
		}
		this.props.onRejected = true;
	}

	public retry(): boolean {
		return this.runCount < 4;
	}

	public onErrorSleep(): number {
		return this.runCount * 100;
	}
}

class Test2 extends AbstractSimpleTask<'test2', {test: string}, string, unknown> {
	public readonly type = 'test2';
	public trigger: TaskTrigger = {type: 'interval', interval: 200};
	public readonly singleInstance = true;

	public onPreStart(): boolean {
		return this.runCount < 4;
	}

	public runTask(): string {
		return 'test2';
	}

	protected buildDescription(): string {
		return `${this.type} task`;
	}

	public retry(): boolean {
		return true;
	}

	public onErrorSleep(): number {
		return this.runCount * 100;
	}
}

class Test3 extends AbstractSimpleTask<'test3', {test: string}, string, unknown> {
	public readonly type = 'test3';
	public trigger: TaskTrigger = {type: 'cron', cron: '* * * * * *'};
	public readonly singleInstance = true;
	public runTask(): string {
		return 'test3';
	}

	protected buildDescription(): string {
		return `${this.type} task`;
	}

	public retry(): boolean {
		return this.runCount < 4;
	}

	public onErrorSleep(): number {
		return this.runCount * 100;
	}
}

const importMapping: ImportObjectMap<Test1 | Test2 | Test3> = {
	test1: Test1,
	test2: Test2,
	test3: Test3,
};

let worker: Worker<unknown, Test1 | Test2 | Test3>;

describe('Worker', () => {
	beforeEach(function () {
		worker = new Worker(
			{
				taskUniqueIdBuilder: uuid,
				//	logger: console,
			},
			logMapper,
		);
		worker.addLogger(spyLogger);
		worker.on('addTask', async (_task) => {
			// console.log('task add', await _task.getDescription());
		});
		worker.on('updateTask', async (_task) => {
			// console.log('task update', await _task.getDescription());
		});
		worker.on('deleteTask', async (_task) => {
			// console.log('task delete', await _task.getDescription());
		});
		spyLogger.debug.resetHistory();
		spyLogger.error.resetHistory();
		spyLogger.info.resetHistory();
		spyLogger.warn.resetHistory();
	});
	it('should initialize a task', async function () {
		const task = await worker.initializeTask(Test1, {test: 'test'}, {});
		await worker.startTask(task);
		const data = await worker.waitTask(task);
		await expect(worker.startTask(task)).to.eventually.be.rejectedWith(Error, buildTaskLog(task, 'is already started'));
		expect(data).to.be.eq('test1');
		expect(task.props.onInit).to.be.eq(true);
		expect(task.props.onPreStart).to.be.eq(true);
		expect(task.props.onRejected).to.be.eq(undefined);
		expect(task.props.onResolved).to.be.eq(true);
		expect(await task.getDescription()).to.be.eq('test1 task');
		expect(task.start).to.be.instanceOf(Date);
		expect(task.end).to.be.instanceOf(Date);
		expect(task.data).to.be.eq('test1');
		expect(task.taskError).to.be.undefined;
		await worker.restartTask(task);
		await worker.waitTask(task);
		const getTasks = worker.getTasksByType('test1');
		expect(getTasks?.[0]).to.be.eq(task);
		expect(worker.getTaskCount()).to.be.eq(1);
		// hack to test running task blocking
		task.status = TaskStatusType.Running;
		await expect(worker.restartTask(task)).to.be.eventually.rejectedWith(Error, buildTaskLog(task, 'is already running'));
	});
	it('throw from onResolve', async function () {
		const task = await worker.initializeTask(Test1, {test: 'throw-on-resolve'}, {});
		await worker.waitTask(task);
		const errors = Array.from(task.errors);
		expect(errors.length).to.be.eq(1);
		expect(task.runCount).to.be.eq(1);
		expect(errors[0].error).to.be.instanceOf(Error).and.to.have.property('message', buildTaskLog(task, 'onResolved: onResolved'));
	});
	it('throw from onRejected', async function () {
		const task = await worker.initializeTask(Test1, {test: 'throw-on-reject'}, {});
		await expect(worker.waitTask(task)).to.be.eventually.rejectedWith(Error, 'retry limit reached');
		const errors = Array.from(task.errors);
		expect(task.runCount).to.be.eq(4);
		expect(errors.length).to.be.eq(6); // 4 retry, 1 retry limit, 1 onRejected error
		expect(errors[5].error).to.be.instanceOf(Error).and.to.have.property('message', buildTaskLog(task, 'onRejected: onRejected'));
	});
	it('should emit task event to worker updateTask', async function () {
		const task = await worker.initializeTask(Test1, {test: 'test'}, {});
		const testPromise = new Promise<void>((resolve) => {
			worker.on('updateTask', (_task) => {
				expect(_task).to.be.eq(task);
				resolve();
			});
		});
		task.update();
		await testPromise;
	});
	describe('restart', function () {
		let task: FullTaskInstance<string | undefined, Test1>;
		beforeEach(async function () {
			task = await worker.initializeTask(Test1, {test: 'test'}, {});
		});
		it('should prevent task to be restarted', async function () {
			for (const currentStatus of [TaskStatusType.Starting, TaskStatusType.Running]) {
				task.status = currentStatus;
				await expect(worker.restartTask(task), `${getTaskStatusString(task.status)} status should not be restartable`).to.be.eventually.rejectedWith(
					Error,
					buildTaskLog(task, 'is already running'),
				);
			}
		});
		afterEach(async function () {
			await worker.deleteTask(task);
		});
	});
	describe('stop and delete', function () {
		it('should abort initialize task', async function () {
			const task = await worker.initializeTask(Test1, {test: 'test'}, {});
			await worker.stopTask(task);
			await worker.deleteTask(task);
			expect(worker.getTaskCount()).to.be.eq(0);
		});
		it('should abort started task', async function () {
			const task = await worker.initializeTask(Test1, {test: 'test'}, {});
			await worker.startTask(task);
			await worker.stopTask(task);
			await worker.deleteTask(task);
			expect(worker.getTaskCount()).to.be.eq(0);
		});
		it('should abort resolved task', async function () {
			const task = await worker.initializeTask(Test1, {test: 'test'}, {});
			await worker.waitTask(task);
			await worker.stopTask(task);
			await worker.deleteTask(task);
			expect(worker.getTaskCount()).to.be.eq(0);
		});
	});
	it('restartTask old promises reject', async function () {
		const restartTask = await worker.initializeTask(Test1, {test: 'test'}, {});
		restartTask.status = TaskStatusType.Pending;
		const oldPromise = worker.waitTask(restartTask); // before restart promise (restart throws error to all old waiting promises)
		await worker.restartTask(restartTask);
		await expect(oldPromise).to.be.eventually.rejectedWith(Error, buildTaskLog(restartTask, 'restarting'));
		await expect(worker.waitTask(restartTask)).to.be.eventually.eq('test1');
	});
	it('should get current task with getOrInitializeTask and hook to promise (init)', async function () {
		// initial data
		const oldTask = await worker.initializeTask(Test1, {test: 'test'}, {});
		// test
		const task = await worker.getOrInitializeTask(oldTask.uuid, 'test1', Test1, {test: 'test'}, {});
		expect(task.uuid).to.be.eq(oldTask.uuid);
		const data = await worker.waitTask(task);
		expect(data).to.be.eq('test1');
		expect(worker.getTaskCount()).to.be.eq(1);
		await expect(worker.getOrInitializeTask(oldTask.uuid, 'test2', Test2, {test: 'test'}, {})).to.be.eventually.rejectedWith(
			Error,
			buildTaskLog(task, 'type mismatch, expected type test2'),
		);
	});
	it('should fail to pre-start a task', async function () {
		worker.setLogMapping({
			abort: LogLevel.None,
			delete: LogLevel.None,
			flow_error: LogLevel.None,
			flow_limit: LogLevel.None,
			flow_retry: LogLevel.None,
			flow_sleep: LogLevel.None,
			rejected: LogLevel.None,
			resolved: LogLevel.None,
			start: LogLevel.None,
			status_change_default: LogLevel.None,
			status_change_error: LogLevel.None,
			status_change_info: LogLevel.None,
		});
		const task = await worker.initializeTask(Test1, {test: 'pre-start-false'}, {});
		await worker.waitTask(task);
		expect(task.props.onPreStart).to.be.eq(undefined);
		expect(spyLogger.debug.args[0][0]).to.be.eq(buildTaskLog(task, 'onPreStart is false, not started'));
	});
	it('should get current task with getOrInitializeTask and hook to promise (running)', async function () {
		// initial data
		const oldTask = await worker.initializeTask(Test1, {test: 'test'}, {});
		await worker.startTask(oldTask);
		// test
		const task = await worker.getOrInitializeTask(oldTask.uuid, 'test1', Test1, {test: 'test'}, {});
		expect(task.uuid).to.be.eq(oldTask.uuid);
		const data = await worker.waitTask(task);
		expect(data).to.be.eq('test1');
		expect(worker.getTaskCount()).to.be.eq(1);
	});
	it('should get current task with getOrInitializeTask and hook to promise (resolved)', async function () {
		// initial data
		const oldTask = await worker.getOrInitializeTask(undefined, 'test1', Test1, {test: 'test'}, {});
		const waitTaskOncePromise = worker.waitTaskRun(oldTask);
		const waitTaskPromise = worker.waitTask(oldTask);
		await waitTaskOncePromise;
		await waitTaskPromise;
		// test
		const task = await worker.getOrInitializeTask(oldTask.uuid, 'test1', Test1, {test: 'test'}, {});
		expect(task.uuid).to.be.eq(oldTask.uuid);
		const data = await worker.waitTask(task);
		expect(data).to.be.eq('test1');
		expect(worker.getTaskCount()).to.be.eq(1);
	});
	it('should initialize a task without start', async function () {
		const task = await worker.initializeTask(Test1, {test: 'test'}, {});
		const data = await worker.waitTask(task);
		await expect(worker.startTask(task)).to.eventually.be.rejectedWith(Error, buildTaskLog(task, 'is already started'));
		expect(data).to.be.eq('test1');
		expect(task.props.onInit).to.be.eq(true);
		expect(task.props.onPreStart).to.be.eq(true);
		expect(task.props.onRejected).to.be.eq(undefined);
		expect(task.props.onResolved).to.be.eq(true);
		expect(await task.getDescription()).to.be.eq('test1 task');
		expect(task.start).to.be.instanceOf(Date);
		expect(task.end).to.be.instanceOf(Date);
		expect(task.data).to.be.eq('test1');
		expect(task.taskError).to.be.undefined;
		expect(worker.getTaskCount()).to.be.eq(1);
	});
	it('should initialize a task, start and stop', async function () {
		const task = await worker.initializeTask(Test1, {test: 'test'}, {});
		await worker.startTask(task);
		const waitPromise = worker.waitTask(task);
		await expect(worker.stopTask(task)).to.eventually.be.undefined;
		await expect(waitPromise).to.eventually.be.rejectedWith(Error, `Task ${task.uuid} ${task.type} aborted`);
		expect(worker.getTaskCount()).to.be.eq(1);
	});
	it('should fail to run broken task', async function () {
		this.slow(1400); // ~620ms
		const task = await worker.initializeTask(Test1, {test: 'throw'}, {});
		await worker.startTask(task);
		await expect(worker.waitTaskRun(task)).to.be.eventually.rejectedWith(TaskRetryError, 'failed, retrying #1');
		await expect(worker.waitTaskRun(task)).to.be.eventually.rejectedWith(TaskRetryError, 'failed, retrying #2');
		await expect(worker.waitTaskRun(task)).to.be.eventually.rejectedWith(TaskRetryError, 'failed, retrying #3');
		await expect(worker.waitTask(task)).to.be.eventually.rejectedWith(FatalTaskError, 'retry limit reached');
		expect(task.errors).to.have.lengthOf(5);
		expect(task.runCount).to.be.eq(4);
		expect(task.errorCount).to.be.eq(4);
		expect(task.runErrorCount).to.be.eq(4);
		expect(task.props.onInit).to.be.eq(true);
		expect(task.props.onPreStart).to.be.eq(true);
		expect(task.props.onRejected).to.be.eq(true);
		expect(task.props.onResolved).to.be.eq(undefined);
		expect(task.start).to.be.instanceOf(Date);
		expect(task.end).to.be.instanceOf(Date);
		expect(task.data).to.be.undefined;
		expect(task.taskError).to.be.instanceOf(Error);
		expect(worker.getTaskCount()).to.be.eq(1);
	});
	it('should fail on disabled task', async function () {
		const task = await worker.initializeTask(Test1, {test: 'test'}, {});
		task.disabled = true;
		await worker.startTask(task);
		await expect(worker.waitTask(task)).to.be.eventually.rejectedWith(Error, `Task ${task.uuid} ${task.type} is disabled`);
		expect(task.errors).to.have.lengthOf(1);
		expect(task.runCount).to.be.eq(0);
		expect(task.props.onInit).to.be.eq(undefined);
		expect(task.props.onPreStart).to.be.eq(undefined);
		expect(task.props.onRejected).to.be.eq(true);
		expect(task.props.onResolved).to.be.eq(undefined);
		expect(worker.getTaskCount()).to.be.eq(1);
	});
	it('should initialize interval task', async function () {
		this.slow(1000); // ~460ms
		const task = await worker.initializeTask(Test2, {test: 'test'}, {});
		await worker.startTask(task);
		expect(worker.getTaskCount()).to.be.eq(1);
		await expect(worker.waitTask(task)).to.be.eventually.rejectedWith(Error, `Task ${task.uuid} ${task.type} is not instant and cannot be waited`);
		await expect(worker.waitTaskRun(task)).to.be.eventually.rejectedWith(Error, `Task ${task.uuid} ${task.type} is not instant and cannot be waited`);
		await sleep(550);
		expect(task.errorCount).to.be.eq(0); // no errors
		expect(task.runCount).to.be.eq(3); // interval task runs also at start
		await expect(worker.restartTask(task)).to.be.eventually.rejectedWith(Error, `Task ${task.uuid} ${task.type} is not allowed to restart`);
		await worker.deleteTask(task);
		expect(await task.getDescription()).to.be.eq('test2 task');
		expect(worker.getTaskCount()).to.be.eq(0);
	});
	it('should initialize cron task', async function () {
		this.timeout(5000);
		this.slow(5500); // ~2500ms
		let task = await worker.initializeTask(Test3, {test: 'test'}, {});
		task = await worker.initializeTask(Test3, {test: 'test'}, {});
		await worker.startTask(task);
		expect(worker.getTaskCount()).to.be.eq(1);
		await sleep(2500);
		expect(task.runCount).to.be.greaterThanOrEqual(2);
		await worker.deleteTask(task);
		expect(await task.getDescription()).to.be.eq('test3 task');
		expect(worker.getTaskCount()).to.be.eq(0);
	});

	it('should import task', async function () {
		const taskUuid1 = uuid();
		const taskUuid2 = uuid();
		const taskUuid3 = uuid();
		await worker.importTasks(
			[
				{
					commonContext: {},
					data: 'test1',
					disabled: false,
					end: new Date(),
					errorCount: 0,
					errors: new Set(),
					props: {test: 'hello'},
					runCount: 1,
					runErrorCount: 0,
					start: new Date(),
					status: TaskStatusType.Running,
					taskError: undefined,
					type: 'test1',
					uuid: taskUuid1,
				},
				{
					commonContext: {},
					data: 'test1',
					disabled: false,
					end: new Date(),
					errorCount: 0,
					errors: new Set(),
					props: {test: 'hello'},
					runCount: 1,
					runErrorCount: 0,
					start: new Date(),
					status: TaskStatusType.Resolved,
					taskError: undefined,
					type: 'test1',
					uuid: taskUuid2,
				},
				{
					commonContext: {},
					data: 'test1',
					disabled: false,
					end: new Date(),
					errorCount: 0,
					errors: new Set(),
					props: {test: 'hello'},
					runCount: 1,
					runErrorCount: 0,
					start: new Date(),
					status: TaskStatusType.Rejected,
					taskError: new FatalTaskError('test'),
					type: 'test1',
					uuid: taskUuid3,
				},
				{
					commonContext: {},
					data: 'test2',
					disabled: false,
					end: new Date(),
					errorCount: 0,
					errors: new Set(),
					props: {test: 'hello'},
					runCount: 1,
					runErrorCount: 0,
					start: new Date(),
					status: TaskStatusType.Resolved,
					taskError: undefined,
					type: 'test2',
					uuid: uuid(),
				},
				{
					commonContext: {},
					data: 'test2',
					disabled: false,
					end: new Date(),
					errorCount: 0,
					errors: new Set(),
					props: {test: 'hello'},
					runCount: 1,
					runErrorCount: 0,
					start: new Date(),
					status: TaskStatusType.Resolved,
					taskError: undefined,
					type: 'test2',
					uuid: uuid(),
				},
			],
			importMapping,
		);
		expect(worker.getTaskCount()).to.be.eq(4); // 5 raw tasks, type test2 is single instance so only 1 is imported
		const task1 = worker.getTaskByUuid(taskUuid1);
		if (!task1) {
			throw new Error('Task not found');
		}
		const task2 = worker.getTaskByUuid(taskUuid2);
		if (!task2) {
			throw new Error('Task not found');
		}
		const task3 = worker.getTaskByUuid(taskUuid3);
		if (!task3) {
			throw new Error('Task not found');
		}

		const data1 = await worker.waitTask(task1);
		expect(data1).to.be.eq('test1');

		const data2 = await worker.waitTask(task2);
		expect(data2).to.be.eq('test1');

		await expect(worker.waitTask(task3)).to.be.eventually.rejectedWith(FatalTaskError, 'test');
	});
	it('should fail task if cant build task description', async function () {
		const task = await worker.initializeTask(Test1, {test: 'description-throw'}, {});
		await expect(worker.waitTask(task)).to.be.eventually.rejectedWith(FatalTaskError, 'description-throw');
	});
	it('should update task data outside of instance', async function () {
		const task = await worker.initializeTask(Test1, {test: 'test'}, {});
		await worker.updateTask({
			commonContext: task.commonContext,
			data: task.data,
			disabled: true, // change as disabled
			end: task.end,
			errorCount: task.errorCount,
			errors: task.errors,
			props: task.props,
			runCount: task.runCount,
			runErrorCount: task.runErrorCount,
			start: task.start,
			status: task.status,
			taskError: task.taskError,
			type: task.type,
			uuid: task.uuid,
		});
		expect(task.disabled).to.be.eq(true);
	});
	it('should get task progress events', async function () {
		const updateTaskSpy = sinon.spy();
		const task = await worker.initializeTask(Test1, {test: 'progress'}, {});
		worker.on('updateTask', (task) => updateTaskSpy({[getTaskStatusString(task.status)]: task.progress}));
		await worker.waitTask(task);
		expect(updateTaskSpy.callCount).to.be.eq(7);
		const taskProgress = updateTaskSpy.args.map(([arg]) => arg);
		expect(taskProgress).to.be.eql([
			{init: undefined},
			{starting: undefined},
			{running: undefined},
			{running: 25},
			{running: 50},
			{running: 75},
			{resolved: undefined},
		]);
	});
});
