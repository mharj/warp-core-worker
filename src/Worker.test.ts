/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-unused-expressions */
/* eslint-disable sonarjs/no-duplicate-string */
/* eslint-disable sonarjs/no-identical-functions */
import {sleep} from '@avanio/sleep';
import * as chai from 'chai';
import 'mocha';
import * as chaiAsPromised from 'chai-as-promised';
import {v4 as uuid} from 'uuid';
import {AbstractSimpleTask, ImportObjectMap, Worker, TaskTrigger, TaskStatusType, FatalTaskError, HandleTaskUpdateCallback} from './';

chai.use(chaiAsPromised);
const expect = chai.expect;

class Test1 extends AbstractSimpleTask<'test1', {test: string; onInit?: true; onResolved?: true; onRejected?: true; onPreStart?: true}, string, unknown> {
	public readonly type = 'test1';
	public trigger: TaskTrigger = {type: 'instant'};
	public async runTask(): Promise<string> {
		if (this.props.test === 'throw') {
			throw new Error('test');
		}
		return 'test1';
	}

	public allowRestart(): Promise<void> {
		return Promise.resolve();
	}

	protected buildDescription(): Promise<string> {
		return Promise.resolve(`${this.type} task`);
	}

	public async onInit(): Promise<void> {
		this.props.onInit = true;
	}

	public async onPreStart(): Promise<boolean> {
		this.props.onPreStart = true;
		return true;
	}

	public async onResolved(): Promise<void> {
		this.props.onResolved = true;
	}

	public async onRejected(): Promise<void> {
		this.props.onRejected = true;
	}

	public retry(): Promise<boolean> {
		return Promise.resolve(this.runCount < 4);
	}

	public onErrorSleep(): Promise<number> {
		return Promise.resolve(this.runCount * 100);
	}
}

class Test2 extends AbstractSimpleTask<'test2', {test: string}, string, unknown> {
	public readonly type = 'test2';
	public trigger: TaskTrigger = {type: 'interval', interval: 200};
	public readonly singleInstance = true;
	public async runTask(): Promise<string> {
		return 'test2';
	}

	protected buildDescription(): Promise<string> {
		return Promise.resolve(`${this.type} task`);
	}

	public retry(): Promise<boolean> {
		return Promise.resolve(this.runCount < 4);
	}

	public onErrorSleep(): Promise<number> {
		return Promise.resolve(this.runCount * 100);
	}
}

class Test3 extends AbstractSimpleTask<'test3', {test: string}, string, unknown> {
	public readonly type = 'test3';
	public trigger: TaskTrigger = {type: 'cron', cron: '* * * * * *'};
	public readonly singleInstance = true;
	public async runTask(): Promise<string> {
		return 'test3';
	}

	protected buildDescription(): Promise<string> {
		return Promise.resolve(`${this.type} task`);
	}

	public retry(): Promise<boolean> {
		return Promise.resolve(this.runCount < 4);
	}

	public onErrorSleep(): Promise<number> {
		return Promise.resolve(this.runCount * 100);
	}
}

const importMapping: ImportObjectMap<Test1 | Test2 | Test3> = {
	test1: Test1,
	test2: Test2,
	test3: Test3,
};

let worker: Worker<unknown, Test1 | Test2 | Test3>;
let currentCallback: HandleTaskUpdateCallback<Test1 | Test2 | Test3>;

describe('Worker', () => {
	beforeEach(function () {
		worker = new Worker({
			taskUniqueIdBuilder: uuid,
			//	logger: console,
		});
		currentCallback = worker.onTaskUpdate(async (_data, _task) => {
			// console.log('task update', _data.status, await task.getDescription());
		});
	});
	it('should initialize a task', async function () {
		const task = await worker.initializeTask(Test1, {test: 'test'}, {});
		await worker.startTask(task);
		const data = await worker.waitTask(task);
		await expect(worker.startTask(task)).to.eventually.be.rejectedWith(Error, `Task ${task.uuid} ${task.type} is already started`);
		expect(data).to.be.eq('test1');
		expect(task.props.onInit).to.be.eq(true);
		expect(task.props.onPreStart).to.be.eq(true);
		expect(task.props.onRejected).to.be.eq(undefined);
		expect(task.props.onResolved).to.be.eq(true);
		await expect(task.getDescription()).to.be.eventually.eq('test1 task');
		expect(task.start).to.be.instanceOf(Date);
		expect(task.end).to.be.instanceOf(Date);
		expect(task.data).to.be.eq('test1');
		expect(task.taskError).to.be.undefined;
		await worker.restartTask(task);
		await worker.waitTask(task);
		const getTasks = worker.getTasksByType('test1');
		expect(getTasks?.[0]).to.be.eq(task);
	});
	it('should get current task with getOrInitializeTask and hook to promise (init)', async function () {
		// initial data
		const oldTask = await worker.initializeTask(Test1, {test: 'test'}, {});
		// test
		const task = await worker.getOrInitializeTask(oldTask.uuid, 'test1', Test1, {test: 'test'}, {});
		expect(task.uuid).to.be.eq(oldTask.uuid);
		const data = await worker.waitTask(task);
		expect(data).to.be.eq('test1');
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
	});
	it('should get current task with getOrInitializeTask and hook to promise (resolved)', async function () {
		// initial data
		const oldTask = await worker.initializeTask(Test1, {test: 'test'}, {});
		await worker.waitTask(oldTask);
		// test
		const task = await worker.getOrInitializeTask(oldTask.uuid, 'test1', Test1, {test: 'test'}, {});
		expect(task.uuid).to.be.eq(oldTask.uuid);
		const data = await worker.waitTask(task);
		expect(data).to.be.eq('test1');
	});
	it('should initialize a task without start', async function () {
		const task = await worker.initializeTask(Test1, {test: 'test'}, {});
		const data = await worker.waitTask(task);
		await expect(worker.startTask(task)).to.eventually.be.rejectedWith(Error, `Task ${task.uuid} ${task.type} is already started`);
		expect(data).to.be.eq('test1');
		expect(task.props.onInit).to.be.eq(true);
		expect(task.props.onPreStart).to.be.eq(true);
		expect(task.props.onRejected).to.be.eq(undefined);
		expect(task.props.onResolved).to.be.eq(true);
		await expect(task.getDescription()).to.be.eventually.eq('test1 task');
		expect(task.start).to.be.instanceOf(Date);
		expect(task.end).to.be.instanceOf(Date);
		expect(task.data).to.be.eq('test1');
		expect(task.taskError).to.be.undefined;
	});
	it('should initialize a task, start and stop', async function () {
		const task = await worker.initializeTask(Test1, {test: 'test'}, {});
		await worker.startTask(task);
		const waitPromise = worker.waitTask(task);
		await expect(worker.stopTask(task)).to.eventually.be.undefined;
		await expect(waitPromise).to.eventually.be.rejectedWith(Error, `Task ${task.uuid} ${task.type} aborted`);
	});
	it('should fail to run broken task', async function () {
		this.slow(1400); // ~620ms
		const task = await worker.initializeTask(Test1, {test: 'throw'}, {});
		await worker.startTask(task);
		await expect(worker.waitTask(task)).to.be.eventually.rejectedWith(Error, `Task ${task.uuid} ${task.type} retry limit reached`);
		expect(task.errors).to.have.lengthOf(5);
		expect(task.runCount).to.be.eq(4);
		expect(task.props.onInit).to.be.eq(true);
		expect(task.props.onPreStart).to.be.eq(true);
		expect(task.props.onRejected).to.be.eq(true);
		expect(task.props.onResolved).to.be.eq(undefined);
		expect(task.start).to.be.instanceOf(Date);
		expect(task.end).to.be.instanceOf(Date);
		expect(task.data).to.be.undefined;
		expect(task.taskError).to.be.instanceOf(Error);
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
	});
	it('should initialize interval task', async function () {
		this.slow(1000); // ~460ms
		const task = await worker.initializeTask(Test2, {test: 'test'}, {});
		await worker.startTask(task);
		await expect(worker.waitTask(task)).to.be.eventually.rejectedWith(Error, `Task ${task.uuid} ${task.type} is not instant and cannot be waited`);
		await sleep(450);
		expect(task.runCount).to.be.eq(3); // interval task runs also at start
		await expect(worker.restartTask(task)).to.be.eventually.rejectedWith(Error, `Task ${task.uuid} ${task.type} is not allowed to restart`);
		await worker.deleteTask(task);
		await expect(task.getDescription()).to.be.eventually.eq('test2 task');
	});
	it('should initialize cron task', async function () {
		this.timeout(5000);
		this.slow(5500); // ~2500ms
		let task = await worker.initializeTask(Test3, {test: 'test'}, {});
		task = await worker.initializeTask(Test3, {test: 'test'}, {});
		await worker.startTask(task);
		await sleep(2500);
		expect(task.runCount).to.be.greaterThanOrEqual(2);
		await worker.deleteTask(task);
		await expect(task.getDescription()).to.be.eventually.eq('test3 task');
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
					start: new Date(),
					status: TaskStatusType.Resolved,
					taskError: undefined,
					type: 'test2',
					uuid: uuid(),
				},
			],
			importMapping,
		);
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

		await expect(worker.waitTask(task3)).to.be.eventually.rejectedWith(Error, 'test');
	});
	afterEach(function () {
		worker.removeTaskUpdate(currentCallback);
	});
});
