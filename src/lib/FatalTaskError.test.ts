import * as chai from 'chai';
import 'mocha';
import {FatalTaskError, buildFatalError} from './FatalTaskError';

const expect = chai.expect;

describe('fatal task error', function () {
	it('should check if have FatalTaskError instance', function () {
		expect(new FatalTaskError('test')).to.be.instanceOf(Error);
		expect(new FatalTaskError('test')).to.be.instanceOf(FatalTaskError);
	});
	it('should build FatalTaskError instance from any catch values', function () {
		expect(buildFatalError(new FatalTaskError('test'))).to.be.instanceOf(FatalTaskError);
		expect(buildFatalError(new Error('test'))).to.be.instanceOf(FatalTaskError);
		expect(buildFatalError('test')).to.be.instanceOf(FatalTaskError);
		expect(buildFatalError(undefined)).to.be.instanceOf(FatalTaskError);
	});
});
