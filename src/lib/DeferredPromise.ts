const atRegex = /^\s+at\s/;

export class DeferredPromise<ResolveType = unknown, RejectType = unknown> extends Promise<ResolveType> {
	private resolveHandler: (value: ResolveType | PromiseLike<ResolveType>) => void;
	private rejectHandler: (error: RejectType) => void;
	private _isDone = false;
	private initialCallStack: Error['stack'];
	private constructorStackString: string;

	constructor(executor: ConstructorParameters<typeof Promise<ResolveType>>[0] = () => {}) {
		let resolver: (value: ResolveType | PromiseLike<ResolveType>) => void;
		let rejector: (reason?: unknown) => void;

		super((resolve, reject) => {
			resolver = resolve;
			rejector = reject;
			return executor(resolve, reject); // Promise magic: this line is unexplicably essential
		});
		// stack setup
		const stack = Error().stack!.split('\n').slice(2);
		stack.splice(0, 1, `${stack[0]}: new ${this.constructor.name}()`); // update the current constructor caller string line to include the constructor name
		this.constructorStackString = stack[0];
		// store call stack for location where instance is created
		this.initialCallStack = stack.join('\n');

		// store handlers
		this.resolveHandler = resolver!;
		this.rejectHandler = rejector!;
	}

	/**
	 * Whether the promise has been resolved or rejected.
	 */
	public get isDone(): boolean {
		return this._isDone;
	}

	/**
	 * Resolve the promise with a value.
	 */
	public resolve(resolveValue: ResolveType | PromiseLike<ResolveType>) {
		if (this._isDone) {
			throw new Error('Promise already resolved');
		}
		this.resolveHandler(resolveValue);
		this._isDone = true;
	}

	/**
	 * Reject the promise with a value.
	 */
	public reject(rejectValue: RejectType) {
		if (this._isDone) {
			throw new Error('Promise already resolved');
		}
		// if rejectValue is an Error, prepend the initial call stack to the error stack
		if (rejectValue instanceof Error) {
			let currentCaller = Error().stack?.split('\n')[2];
			if (currentCaller) {
				currentCaller = `${currentCaller}: ${this.constructor.name}.reject()`;
			}
			if (rejectValue.stack) {
				this.updateErrorStack(rejectValue, rejectValue.stack);
			} else {
				// istanbul ignore next
				this.buildErrorStack(rejectValue, currentCaller);
			}
		}
		this.rejectHandler(rejectValue);
		this._isDone = true;
	}

	private buildErrorStack(error: Error, currentCaller: string | undefined): void {
		// istanbul ignore next
		error.stack = [error.toString(), currentCaller, this.initialCallStack].join('\n');
	}

	private updateErrorStack(error: Error, stack: string): void {
		const {head, atLines} = this.getStackAtLines(stack);
		atLines.splice(0, 1, `${atLines[0]}: ${this.constructor.name}.reject()`); // update the current caller string line to include the reject() call
		atLines.splice(1, 0, this.constructorStackString); // insert the constructor caller string line to stack
		error.stack = [head.join('\n'), ...atLines].join('\n');
	}

	private getStackAtLines(stack: string): {head: string[]; atLines: string[]} {
		const stackLines = stack.split('\n');
		const atLines = stackLines.filter((line) => atRegex.test(line));
		const head: string[] = [];
		for (const line of stackLines) {
			if (atRegex.test(line)) {
				break;
			}
			head.push(line);
		}
		return {head, atLines};
	}
}
