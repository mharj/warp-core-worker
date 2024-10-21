import {FatalTaskError} from './FatalTaskError.mjs';

export class TaskDisabledError extends FatalTaskError {
	constructor(message: string) {
		super(message);
		this.name = 'TaskDisabledError';
	}
}
