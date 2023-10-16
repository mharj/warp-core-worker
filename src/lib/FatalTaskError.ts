export class FatalTaskError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FatalTaskError';
	}
}
