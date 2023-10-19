import {TTaskProps} from './TaskProps';
import {TaskStatusType} from './TaskStatus';
import {ITaskInstance} from '../interfaces/ITask';

/**
 * Task constructor params
 */
export type TaskParams<TP extends TTaskProps, CommonTaskContext> = {
	readonly uuid: string;
	disabled: boolean;
	props: TP;
	status: TaskStatusType;
	errors: Set<{ts: Date; error: Error}>;
	runCount: number;
	errorCount: number;
	start: Date | undefined;
	end: Date | undefined;
	commonContext: CommonTaskContext;
};

export type InferParamsFromInstance<TI extends ITaskInstance<string, TTaskProps, unknown, unknown>> = TaskParams<TI['props'], TI['commonContext']>;
