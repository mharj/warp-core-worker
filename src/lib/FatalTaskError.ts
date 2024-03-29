import {buildErrorString} from './errorUtil';

/**
 * FatalTaskError is a special control error which tells Worker to stop re-try and fail the task.
 */
export class FatalTaskError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FatalTaskError';
	}
}

/**
 * Build FatalTaskError instance from any catch value.
 */
export function buildFatalError(error: unknown): FatalTaskError {
	if (error instanceof FatalTaskError) {
		return error;
	}
	const taskError = new FatalTaskError(buildErrorString(error));
	if (error instanceof Error) {
		taskError.stack = error.stack; // clone stack
	}
	return taskError;
}
