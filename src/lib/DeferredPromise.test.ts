/* eslint-disable no-unused-expressions */
import * as chai from 'chai';
import 'mocha';
import {DeferredPromise} from './DeferredPromise';

const expect = chai.expect;

describe('DeferredPromise', function () {
	it('should check if Promise is already resolved', function () {
		const deferred = new DeferredPromise();
		expect(deferred.resolve(undefined)).to.be.undefined;
		expect(() => deferred.resolve(undefined)).to.throw('Promise already resolved');
		expect(() => deferred.reject(undefined)).to.throw('Promise already resolved');
	});
});
