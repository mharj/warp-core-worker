/**
 * build error message from any catch value.
 */
export function buildErrorString(error: unknown): string {
	if (typeof error === 'string') {
		return error;
	}
	if (error instanceof Error) {
		return error.message;
	}
	return `Unknown error: ${JSON.stringify(error)}`;
}

export function haveError(err: unknown): Error {
	if (err instanceof Error) {
		return err;
	}
	return new TypeError(`Unknown error: ${err}`);
}
