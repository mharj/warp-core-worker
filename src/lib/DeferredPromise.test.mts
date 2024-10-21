/* eslint-disable @typescript-eslint/no-unused-expressions */
/* eslint-disable no-unused-expressions */
import {describe, expect, it} from 'vitest';
import {DeferredPromise} from './DeferredPromise.mjs';

describe('DeferredPromise', function () {
	it('should check if Promise is already resolved', function () {
		const deferred = new DeferredPromise();
		expect(deferred.resolve(undefined)).to.be.undefined;
		expect(() => deferred.resolve(undefined)).to.throw('Promise already resolved');
		expect(() => deferred.reject(undefined)).to.throw('Promise already resolved');
	});
});
