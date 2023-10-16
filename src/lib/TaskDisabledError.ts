import {FatalTaskError} from './FatalTaskError';

export class TaskDisabledError extends FatalTaskError {
	constructor(message: string) {
		super(message);
		this.name = 'TaskDisabledError';
	}
}
