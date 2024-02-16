import * as chai from 'chai';
import 'mocha';
import {TaskStatusType, getTaskStatusString} from './TaskStatus';

const expect = chai.expect;

describe('Test', function () {
	it('should', function () {
		expect(getTaskStatusString(TaskStatusType.Aborted)).to.equal('aborted');
		expect(getTaskStatusString(TaskStatusType.Created)).to.equal('created');
		expect(getTaskStatusString(TaskStatusType.Init)).to.equal('init');
		expect(getTaskStatusString(TaskStatusType.Pending)).to.equal('pending');
		expect(getTaskStatusString(TaskStatusType.Rejected)).to.equal('rejected');
		expect(getTaskStatusString(TaskStatusType.Resolved)).to.equal('resolved');
		expect(getTaskStatusString(TaskStatusType.Running)).to.equal('running');
		expect(getTaskStatusString(TaskStatusType.Starting)).to.equal('starting');
	});
});
