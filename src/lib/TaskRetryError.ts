/**
 * Error class for task retry handling.
 */
export class TaskRetryError extends Error {
	public constructor(message: string, count: number) {
		super(`${message} #${count}`);
		this.name = 'TaskRetryError';
	}
}
