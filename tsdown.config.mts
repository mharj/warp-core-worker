import {defineConfig} from 'tsdown';

export default defineConfig({
	entry: 'src/index.ts',
	deps: {
		onlyBundle: ['@luolapeikko/sleep', '@open-draft/deferred-promise', '@luolapeikko/key-logger', '@luolapeikko/logger-type', '@luolapeikko/loglevel-type'],
	},
});
