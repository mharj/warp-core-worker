/* eslint-disable sort-keys */
/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable no-unused-expressions */
import {describe, expect, it} from 'vitest';
import {AbstractSimpleTask, TaskStatusType, type TaskTrigger, type TTaskProps} from './index.mjs';

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
		tryCount: 0,
		errors: new Set(),
		props: {},
		resolveCount: 0,
		rejectCount: 0,
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
	it('should emit events', async function () {
		const promise = new Promise<void>((resolve) => {
			taskInstance.on('update', () => {
				resolve();
			});
		});
		taskInstance.update();
		await promise;
	});
});
