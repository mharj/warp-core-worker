import {ILoggerLike} from '@avanio/logger-like';
import {TaskTrigger} from '../types/TaskTrigger';
import {InferParamsFromInstance, TaskParams} from '../types/TaskParams';
import {TTaskProps} from '../types/TaskProps';

export interface ITaskInstance<TaskType extends string, TaskProps extends TTaskProps, ReturnType, CommonTaskContext>
	extends TaskParams<TaskProps, CommonTaskContext> {
	readonly singleInstance: boolean;
	readonly type: TaskType;
	readonly trigger: TaskTrigger;
	abortSignal: AbortSignal;
	/** task data after runTask */
	data: ReturnType | undefined;
	/** this is actual error task did throw */
	taskError: Error | undefined;
	/**
	 * @return Promise that resolves or rejects if task is allowed to restart
	 */
	allowRestart(): Promise<void>;
	getDescription(): Promise<string>;
	runTask(): Promise<ReturnType>;
	/**
	 * @returns value how long to sleep before retrying
	 */
	onErrorSleep(): Promise<number>;
	/**
	 * @returns true if the task should be retried on failure
	 */
	retry(): Promise<boolean>;
	onInit(): Promise<void>;
	onResolved(): Promise<void>;
	onRejected(): Promise<void>;
	/**
	 * Called before the task is running.
	 * how to use:
	 * - clear old errors
	 * - validate current props
	 */
	onPreStart(): Promise<void>;
}

export type ITaskConstructor<TI extends ITaskInstance<string, TTaskProps, unknown, unknown>> = new (
	params: InferParamsFromInstance<TI>,
	data: unknown,
	abortSignal: AbortSignal,
	logger: ILoggerLike | undefined,
) => TI;

export type ITaskConstructorParts<TaskType extends string, TaskProps extends TTaskProps, ReturnType, CommonTaskContext> = new (
	params: InferParamsFromInstance<ITaskInstance<TaskType, TaskProps, ReturnType, CommonTaskContext>>,
	data: ReturnType | undefined,
	abortSignal: AbortSignal,
	logger: ILoggerLike | undefined,
) => ITaskInstance<TaskType, TaskProps, ReturnType, CommonTaskContext>;

export type ITaskConstructorInferFromInstance<TI extends ITaskInstance<string, TTaskProps, unknown, unknown>> = new (
	params: InferParamsFromInstance<TI>,
	data: TI['data'],
	abortSignal: AbortSignal,
	logger: ILoggerLike | undefined,
) => TI;
