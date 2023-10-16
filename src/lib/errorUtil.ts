export function haveError(err: unknown): Error {
	if (err instanceof Error) {
		return err;
	}
	return new TypeError(`Unknown error: ${err}`);
}
