import {EventEmitter} from 'events';
import {type ILoggerLike} from '@avanio/logger-like';
import {type TaskEventMap, type ITaskInstance} from './interfaces/ITask.mjs';
import {type TaskParams} from './types/TaskParams.mjs';
import {type TTaskProps} from './types/TaskProps.mjs';
import {type TaskStatusType} from './types/TaskStatus.mjs';
import {type TaskTrigger} from './types/TaskTrigger.mjs';

export abstract class AbstractSimpleTask<TaskType extends string, TaskProps extends TTaskProps, ReturnType, CommonTaskContext>
	extends EventEmitter<TaskEventMap<AbstractSimpleTask<TaskType, TTaskProps, ReturnType, CommonTaskContext>>>
	implements ITaskInstance<TaskType, TaskProps, ReturnType, CommonTaskContext>
{
	public readonly uuid: string;
	public abstract readonly type: TaskType;
	/**
	 * If task need to be a single instance, default is false
	 * @example
	 * public override readonly singleInstance = true;
	 */
	public readonly singleInstance: boolean = false;
	public abstract trigger: TaskTrigger;
	public props: TaskProps;
	public disabled: boolean;
	public errors: Set<{ts: Date; error: Error}>;
	public resolveCount: number;
	public rejectCount: number;
	public tryCount: number;
	public start: Date | undefined;
	public end: Date | undefined;
	public commonContext: CommonTaskContext;
	public abortSignal: AbortSignal;
	protected logger?: ILoggerLike;
	public data: ReturnType | undefined;
	public taskError: Error | undefined;
	private description?: string | Promise<string>;
	private _progress: number | undefined;
	private _status: TaskStatusType;

	constructor(params: TaskParams<TaskProps, CommonTaskContext>, data: ReturnType | undefined, abortSignal: AbortSignal, logger: ILoggerLike | undefined) {
		super();
		this.uuid = params.uuid;
		this.props = params.props;
		this.data = data;
		this._status = params.status;
		this.disabled = params.disabled;
		this.errors = params.errors;
		this.resolveCount = params.resolveCount;
		this.rejectCount = params.rejectCount;
		this.tryCount = params.tryCount;
		this.start = params?.start ?? undefined;
		this.end = params?.end ?? undefined;
		this.commonContext = params.commonContext;
		this.abortSignal = abortSignal;
		this.logger = logger;
	}

	protected abstract buildDescription(): Promise<string> | string;

	public get progress(): number | undefined {
		return this._progress;
	}

	public set progress(progress: number | undefined) {
		if (this._progress !== progress) {
			this._progress = progress;
			this.update();
		}
	}

	public get status(): TaskStatusType {
		return this._status;
	}

	/**
	 * When status is set, progress is reset to undefined
	 */
	public set status(status: TaskStatusType) {
		this._status = status;
		this._progress = undefined;
	}

	public getDescription(): string | Promise<string> {
		if (!this.description) {
			this.description = this.buildDescription();
		}
		return this.description;
	}

	public update(): void {
		this.emit('update', this);
	}

	public abstract runTask(): Promise<ReturnType> | ReturnType;

	/**
	 * Check if the task instance is allowed to restart, default is false
	 * @returns {boolean | Promise<boolean>} true if the task can be restarted, false otherwise
	 * @example
	 * public override allowRestart(): boolean {
	 * 	 return this.status === TaskStatusType.REJECTED;
	 * }
	 */
	public allowRestart(): Promise<boolean> | boolean {
		return false;
	}

	/**
	 * Check if the task is allowed to be retried on error, default is false
	 * @returns {Promise<boolean>} true if the task should be retried, false otherwise
	 * @example
	 * public override retry(): Promise<boolean> | boolean {
	 *   return this.tryCount < 4;
	 * }
	 */
	public retry(): Promise<boolean> | boolean {
		return false;
	}

	/**
	 * Sleep time before retrying the task, default is 0
	 * @returns {Promise<number> | number} time in milliseconds to sleep before retrying
	 * @example
	 * public override onErrorSleep(): Promise<number> | number {
	 * 	 return this.tryCount * 100;
	 * }
	 */
	public onErrorSleep(): Promise<number> | number {
		return 0;
	}

	public onInit(): Promise<void> | void {}

	/**
	 * Called before the task is running.
	 * how to use:
	 * - clear old errors
	 * - validate current props
	 * @returns true if the task should be started
	 * @example
	 * public override onPreStart(): Promise<boolean> | boolean {
	 *   // leave only the last 10 errors
	 *   if (this.errors.size > 10) {
	 *     const errors = Array.from(this.errors);
	 *     errors.splice(0, errors.length - 10);
	 *     this.errors = new Set(errors);
	 *   }
	 *   return true;
	 * }
	 */
	public onPreStart(): Promise<boolean> | boolean {
		return true;
	}

	/**
	 * Called when the task is rejected
	 * @returns {Promise<void> | void}
	 * @example
	 * public override onRejected(): Promise<void> | void {
	 * 	 this.logger?.error('Task rejected', this.taskError);
	 * }
	 
	 */
	public onRejected(): Promise<void> | void {}

	/**
	 * Called when the task is resolved
	 * @returns {Promise<void> | void}
	 * @example
	 * public override onResolved(): Promise<void> | void {
	 * 	 this.logger?.info('Task resolved', this.data);
	 * }
	 */
	public onResolved(): Promise<void> | void {}

	/**
	 * Set the task progress and emit the update event
	 */
	protected setProgress(progress: number | undefined): void {
		this.progress = progress;
	}
}
