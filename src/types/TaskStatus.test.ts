import * as chai from 'chai';
import 'mocha';
import {TaskStatusType, getTaskName} from './TaskStatus';

const expect = chai.expect;

describe('Test', function () {
	it('should', function () {
		expect(getTaskName(TaskStatusType.Aborted)).to.equal('aborted');
		expect(getTaskName(TaskStatusType.Created)).to.equal('created');
		expect(getTaskName(TaskStatusType.Init)).to.equal('init');
		expect(getTaskName(TaskStatusType.Pending)).to.equal('pending');
		expect(getTaskName(TaskStatusType.Rejected)).to.equal('rejected');
		expect(getTaskName(TaskStatusType.Resolved)).to.equal('resolved');
		expect(getTaskName(TaskStatusType.Running)).to.equal('running');
		expect(getTaskName(TaskStatusType.Starting)).to.equal('starting');
	});
});
