import {describe, expect, it} from 'vitest';
import {haveError} from './errorUtil.mjs';

describe('error util', function () {
	it('should check if have Error instance', function () {
		expect(haveError(new Error('test'))).to.be.instanceOf(Error);
		expect(haveError(undefined)).to.be.instanceOf(TypeError);
	});
});
