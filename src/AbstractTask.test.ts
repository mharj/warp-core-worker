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
	public runTask(): void {
		// do nothing
	}

	protected buildDescription(): string {
		return `${this.type} task`;
	}
}

const taskInstance = new TestTask(
	{
		commonContext: {owner: 'test'},
		disabled: false,
		end: undefined,
		errorCount: 0,
		errors: new Set(),
		props: {},
		runCount: 0,
		runErrorCount: 0,
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
		expect(await taskInstance.onInit()).to.be.undefined;
		expect(await taskInstance.onPreStart()).to.be.true;
		expect(await taskInstance.onRejected()).to.be.undefined;
		expect(await taskInstance.onResolved()).to.be.undefined;
		expect(await taskInstance.onErrorSleep()).to.be.equal(0);
		expect(await taskInstance.retry()).to.be.false;
		expect(await taskInstance.allowRestart()).to.be.false;
	});
});
