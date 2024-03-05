import {ITaskInstance} from '../interfaces/ITask';
import {TTaskProps} from '../types/TaskProps';

/** Task log build function type */
export type TaskLogFunction = (task: ITaskInstance<string, TTaskProps, unknown, unknown>, message: string) => string;

/**
 * Default task log build function, `Task ${task.uuid} ${task.type} ${message}`
 */
export function buildTaskLog(task: ITaskInstance<string, TTaskProps, unknown, unknown>, message: string): string {
	return `Task ${task.uuid} ${task.type} ${message}`;
}
