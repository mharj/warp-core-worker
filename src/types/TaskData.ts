import {TaskParams} from './TaskParams';
import {TTaskProps} from './TaskProps';
import {ITaskInstance} from '../interfaces/ITask';

export type TaskData<TaskType extends string, TP extends TTaskProps, ReturnType, CommonTaskContext> = TaskParams<TP, CommonTaskContext> &
	Pick<ITaskInstance<TaskType, TP, ReturnType, CommonTaskContext>, 'type' | 'data' | 'taskError'>;

export type InferDataFromInstance<TI extends ITaskInstance<string, TTaskProps, unknown, unknown>> = TaskData<
	TI['type'],
	TI['props'],
	TI['data'],
	TI['commonContext']
>;
