/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable no-unused-expressions */
import {describe, expect, it} from 'vitest';
import {TaskStatusType, getTaskStatusString, isEndState, isRunningState, isStartState} from './TaskStatus.mjs';

describe('Test', function () {
	it('should build task status as string', function () {
		expect(getTaskStatusString(TaskStatusType.Aborted)).to.equal('aborted');
		expect(getTaskStatusString(TaskStatusType.Created)).to.equal('created');
		expect(getTaskStatusString(TaskStatusType.Init)).to.equal('init');
		expect(getTaskStatusString(TaskStatusType.Pending)).to.equal('pending');
		expect(getTaskStatusString(TaskStatusType.Rejected)).to.equal('rejected');
		expect(getTaskStatusString(TaskStatusType.Resolved)).to.equal('resolved');
		expect(getTaskStatusString(TaskStatusType.Running)).to.equal('running');
		expect(getTaskStatusString(TaskStatusType.Starting)).to.equal('starting');
	});
	it('should check start states', function () {
		expect(isStartState(TaskStatusType.Created)).to.be.true;
		expect(isStartState(TaskStatusType.Init)).to.be.true;
		expect(isStartState(TaskStatusType.Pending)).to.be.true;
		expect(isStartState(TaskStatusType.Resolved)).to.be.false;
	});
	it('should check run states', function () {
		expect(isRunningState(TaskStatusType.Init)).to.be.false;
		expect(isRunningState(TaskStatusType.Starting)).to.be.true;
		expect(isRunningState(TaskStatusType.Running)).to.be.true;
		expect(isRunningState(TaskStatusType.Resolved)).to.be.false;
	});
	it('should check end states', function () {
		expect(isEndState(TaskStatusType.Created)).to.be.false;
		expect(isEndState(TaskStatusType.Aborted)).to.be.true;
		expect(isEndState(TaskStatusType.Rejected)).to.be.true;
		expect(isEndState(TaskStatusType.Resolved)).to.be.true;
	});
});
