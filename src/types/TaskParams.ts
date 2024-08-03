import {type TTaskProps} from './TaskProps';
import {type TaskStatusType} from './TaskStatus';
import {type ITaskInstance} from '../interfaces/ITask';

/**
 * Task constructor params
 */
export type TaskParams<TP extends TTaskProps, CommonTaskContext> = {
	readonly uuid: string;
	commonContext: CommonTaskContext;
	disabled: boolean;
	end: Date | undefined;
	/** Current run error count */
	errorCount: number;
	errors: Set<{ts: Date; error: Error}>;
	props: TP;
	/** Total run count */
	runCount: number;
	/** Total run error count */
	runErrorCount: number;
	start: Date | undefined;
	status: TaskStatusType;
};

export type InferParamsFromInstance<TI extends ITaskInstance<string, TTaskProps, unknown, unknown>> = TaskParams<TI['props'], TI['commonContext']>;
