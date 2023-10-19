/* eslint-disable no-unused-expressions */
import * as chai from 'chai';
import 'mocha';
import * as chaiAsPromised from 'chai-as-promised';
import {AbstractSimpleTask} from './AbstractTask';
import {TTaskProps} from './types/TaskProps';
import {TaskStatusType} from './types/TaskStatus';
import {TaskTrigger} from './types/TaskTrigger';

chai.use(chaiAsPromised);
const expect = chai.expect;

class TestTask extends AbstractSimpleTask<'test', TTaskProps, void, {owner: string}> {
	public readonly type = 'test';
	public trigger: TaskTrigger = {type: 'instant'};
	public async runTask(): Promise<void> {
		return Promise.resolve();
	}

	protected buildDescription(): Promise<string> {
		return Promise.resolve(`${this.type} task`);
	}
}

const taskInstance = new TestTask(
	{
		commonContext: {owner: 'test'},
		disabled: false,
		end: undefined,
		errorCount: 0,
		errors: [],
		props: {},
		runCount: 0,
		start: undefined,
		status: TaskStatusType.Init,
		uuid: 'random-uuid',
	},
	undefined,
	new AbortController().signal,
	undefined,
);

describe('Test', function () {
	it('should check default implementations', async function () {
		await expect(taskInstance.onInit()).to.eventually.be.undefined;
		await expect(taskInstance.onPreStart()).to.eventually.be.undefined;
		await expect(taskInstance.onRejected()).to.eventually.be.undefined;
		await expect(taskInstance.onResolved()).to.eventually.be.undefined;
		await expect(taskInstance.onErrorSleep()).to.eventually.be.equal(0);
		await expect(taskInstance.retry()).to.eventually.be.false;
		await expect(taskInstance.allowRestart()).to.be.rejectedWith(`Task ${taskInstance.uuid} ${taskInstance.type} is not allowed to restart`);
	});
});
