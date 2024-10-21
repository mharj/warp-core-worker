import {type EventEmitter} from 'events';
import {type ILoggerLike} from '@avanio/logger-like';
import {type InferParamsFromInstance, type TaskParams} from '../types/TaskParams.mjs';
import {type TTaskProps} from '../types/TaskProps.mjs';
import {type TaskTrigger} from '../types/TaskTrigger.mjs';
/**
 * Worker EventEmitter events
 */
export type TaskEventMap<This extends ITaskInstance<string, TTaskProps, unknown, unknown>> = {
	update: [this: This];
};

export interface ITaskInstance<TaskType extends string, TaskProps extends TTaskProps, ReturnType, CommonTaskContext>
	extends TaskParams<TaskProps, CommonTaskContext>,
		EventEmitter<TaskEventMap<ITaskInstance<TaskType, TaskProps, ReturnType, CommonTaskContext>>> {
	/** limit only one instance of this task type */
	readonly singleInstance: boolean;
	/** task type string */
	readonly type: TaskType;
	/** task trigger type */
	readonly trigger: TaskTrigger;
	abortSignal: AbortSignal;
	/** task data after runTask */
	data: ReturnType | undefined;
	/** this is actual error task did throw */
	taskError: Error | undefined;
	/** optional task progress */
	progress: number | undefined;
	/**
	 * @return boolean if task is allowed to be restarted
	 */
	allowRestart(): boolean | Promise<boolean>;
	/** Builds description of the task */
	getDescription(): string | Promise<string>;
	/** run task action */
	runTask(): Promise<ReturnType> | ReturnType;
	/**
	 * @returns value how long to sleep before retrying
	 */
	onErrorSleep(): Promise<number> | number;
	/**
	 * @returns true if the task should be retried on failure
	 */
	retry(): Promise<boolean> | boolean;
	/** callback when task is initialized */
	onInit(): Promise<void> | void;
	/** callback when task is resolved */
	onResolved(): Promise<void> | void;
	/** callback when task is rejected */
	onRejected(): Promise<void> | void;
	/**
	 * Called before the task is running.
	 * how to use:
	 * - clear old errors
	 * - validate current props
	 * @returns true if the task should be started
	 */
	onPreStart(): Promise<boolean> | boolean;

	/**
	 * manual Notify about task update (like current props update).
	 */
	update(): void;
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
