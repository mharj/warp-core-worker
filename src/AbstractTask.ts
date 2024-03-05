import {ILoggerLike} from '@avanio/logger-like';
import {ITaskInstance} from './interfaces/ITask';
import {TaskParams} from './types/TaskParams';
import {TTaskProps} from './types/TaskProps';
import {TaskStatusType} from './types/TaskStatus';
import {TaskTrigger} from './types/TaskTrigger';

export abstract class AbstractSimpleTask<TaskType extends string, TaskProps extends TTaskProps, ReturnType, CommonTaskContext>
	implements ITaskInstance<TaskType, TaskProps, ReturnType, CommonTaskContext>
{
	public readonly uuid: string;
	public abstract readonly type: TaskType;
	public readonly singleInstance: boolean = false;
	public abstract trigger: TaskTrigger;
	public props: TaskProps;
	public status: TaskStatusType;
	public disabled: boolean;
	public errors: Set<{ts: Date; error: Error}>;
	public runCount: number;
	public errorCount: number;
	public start: Date | undefined;
	public end: Date | undefined;

	public commonContext: CommonTaskContext;

	public abortSignal: AbortSignal;
	protected logger?: ILoggerLike;
	public data: ReturnType | undefined;
	public taskError: Error | undefined;
	private description?: string | Promise<string>;
	constructor(params: TaskParams<TaskProps, CommonTaskContext>, data: ReturnType | undefined, abortSignal: AbortSignal, logger: ILoggerLike | undefined) {
		this.uuid = params.uuid;
		this.props = params.props;
		this.data = data;
		this.status = params.status;
		this.disabled = params.disabled;
		this.errors = params.errors;
		this.runCount = params.runCount;
		this.errorCount = params.errorCount;
		this.start = params?.start ?? undefined;
		this.end = params?.end ?? undefined;
		this.commonContext = params.commonContext;
		this.abortSignal = abortSignal;
		this.logger = logger;
	}

	protected abstract buildDescription(): Promise<string> | string;

	public getDescription(): string | Promise<string> {
		if (!this.description) {
			this.description = this.buildDescription();
		}
		return this.description;
	}

	public abstract runTask(): Promise<ReturnType> | ReturnType;

	/**
	 * Check if the task instance is allowed to restart, default is false
	 * @returns {boolean | Promise<boolean>} true if the task can be restarted, false otherwise
	 * @example
	 * public allowRestart(): boolean {
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
	 * public retry(): Promise<boolean> {
	 * 	 return Promise.resolve(this.errorCount < 4);
	 * }
	 */
	public retry(): Promise<boolean> | boolean {
		return false;
	}

	/**
	 * Sleep time before retrying the task, default is 0
	 * @returns {Promise<number> | number} time in milliseconds to sleep before retrying
	 */
	public onErrorSleep(): Promise<number> | number {
		return 0;
	}

	public onInit(): Promise<void> | void {}

	public onPreStart(): Promise<boolean> | boolean {
		return true;
	}

	public onRejected(): Promise<void> | void {}

	public onResolved(): Promise<void> | void {}
}
