export const enum TaskStatusType {
	// start states 0-9
	Created = 0,
	Init = 1,
	Pending = 2,
	// running states 10-19
	Starting = 10,
	Running = 11,
	// end states 90-99
	Aborted = 97,
	Resolved = 99,
	Rejected = 98,
}

export const taskStatusTextTypes = ['created', 'init', 'pending', 'starting', 'running', 'aborted', 'resolved', 'rejected'] as const;
export type TaskStatusTextType = (typeof taskStatusTextTypes)[number];

export function getTaskName(status: TaskStatusType): TaskStatusTextType {
	switch (status) {
		case TaskStatusType.Created:
			return 'created';
		case TaskStatusType.Init:
			return 'init';
		case TaskStatusType.Pending:
			return 'pending';
		case TaskStatusType.Starting:
			return 'starting';
		case TaskStatusType.Running:
			return 'running';
		case TaskStatusType.Aborted:
			return 'aborted';
		case TaskStatusType.Resolved:
			return 'resolved';
		case TaskStatusType.Rejected:
			return 'rejected';
	}
}

export function isStartState(status: TaskStatusType): boolean {
	return status < 10;
}

export function isRunningState(status: TaskStatusType): boolean {
	return status >= 10 && status < 90;
}
