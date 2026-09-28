import {FatalTaskError} from './FatalTaskError';

export class TaskDisabledError extends FatalTaskError {
	public constructor(message: string) {
		super(message);
		this.name = 'TaskDisabledError';
	}
}
