import * as chai from 'chai';
import 'mocha';
import {haveError} from './errorUtil';

const expect = chai.expect;

describe('error util', function () {
	it('should check if have Error instance', function () {
		expect(haveError(new Error('test'))).to.be.instanceOf(Error);
		expect(haveError(undefined)).to.be.instanceOf(TypeError);
	});
});
