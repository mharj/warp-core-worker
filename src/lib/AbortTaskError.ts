import {FatalTaskError} from './FatalTaskError';

/**
 * AbortTaskError is a special control error which tells Worker to stop the task.
 * It is not considered as a fatal error, but a controlled stop.
 */
export class AbortTaskError extends FatalTaskError {
	constructor(message: string) {
		super(message);
		this.name = 'AbortTaskError';
	}
}
