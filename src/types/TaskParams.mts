import {type TTaskProps} from './TaskProps.mjs';
import {type TaskStatusType} from './TaskStatus.mjs';
import {type ITaskInstance} from '../interfaces/ITask.mjs';

/**
 * Task constructor params
 */
export type TaskParams<TP extends TTaskProps, CommonTaskContext> = {
	readonly uuid: string;
	commonContext: CommonTaskContext;
	disabled: boolean;
	end: Date | undefined;
	errors: Set<{ts: Date; error: Error}>;
	props: TP;
	/** Total resolve count */
	resolveCount: number;
	/** Total reject count */
	rejectCount: number;
	start: Date | undefined;
	status: TaskStatusType;
	/** Current run try count */
	tryCount: number;
};

export type InferParamsFromInstance<TI extends ITaskInstance<string, TTaskProps, unknown, unknown>> = TaskParams<TI['props'], TI['commonContext']>;
