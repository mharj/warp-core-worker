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
	public errors: {ts: Date; error: Error}[];
	public runCount: number;
	public errorCount: number;
	public start: Date | undefined;
	public end: Date | undefined;

	public commonContext: CommonTaskContext;

	public abortSignal: AbortSignal;
	protected logger?: ILoggerLike;
	public data: ReturnType | undefined;
	public taskError: Error | undefined;
	private description?: string;
	constructor(params: TaskParams<TaskProps, CommonTaskContext>, data: ReturnType | undefined, abortSignal: AbortSignal, logger: ILoggerLike | undefined) {
		this.uuid = params.uuid;
		this.props = params.props;
		this.data = data;
		this.status = params.status;
		this.disabled = params.disabled;
		this.errors = params?.errors ?? [];
		this.runCount = params?.runCount ?? 0;
		this.errorCount = params?.errorCount ?? 0;
		this.start = params?.start ?? undefined;
		this.end = params?.end ?? undefined;
		this.commonContext = params.commonContext;
		this.abortSignal = abortSignal;
		this.logger = logger;
	}

	protected abstract buildDescription(): Promise<string>;

	public async getDescription(): Promise<string> {
		if (!this.description) {
			this.description = await this.buildDescription();
		}
		return this.description;
	}

	public abstract runTask(): Promise<ReturnType>;

	/**
	 * Check if the task is allowed to restart
	 * @returns {Promise<void>}
	 * @example
	 * public allowRestart(): Promise<void> {
	 * 	 return this.status === TaskStatusType.REJECTED ? Promise.resolve() : Promise.reject(new Error('Task is not allowed to restart'));
	 * }
	 */
	public allowRestart(): Promise<void> {
		return Promise.reject(new Error('Task is not allowed to restart'));
	}

	/**
	 * Check if the task is allowed to be retried on error
	 * @returns {Promise<boolean>} true if the task should be retried, false otherwise
	 * @example
	 * public retry(): Promise<boolean> {
	 * 	 return Promise.resolve(this.errorCount < 4);
	 * }
	 */
	public retry(): Promise<boolean> {
		return Promise.resolve(false);
	}

	public onErrorSleep(): Promise<number> {
		return Promise.resolve(0);
	}

	public onInit(): Promise<void> {
		return Promise.resolve();
	}

	public onPreStart(): Promise<void> {
		return Promise.resolve();
	}

	public onRejected(): Promise<void> {
		return Promise.resolve();
	}

	public onResolved(): Promise<void> {
		return Promise.resolve();
	}
}
