/**
 * Error class for task retry handling.
 */
export class TaskRetryError extends Error {
	constructor(message: string, count: number) {
		super(`${message} #${count}`);
		this.name = 'TaskRetryError';
	}
}
