/**
 * Task status type enum
 * @see {@link TaskStatusTextType}.
 * @see {@link getTaskStatusString}.
 */
export const enum TaskStatusType {
	// start states 0-9
	Created = 0,
	Init = 1,
	Pending = 2,
	// running states 10-19
	Starting = 10,
	Running = 11,
	// final states 90-99
	Aborted = 97,
	Resolved = 99,
	Rejected = 98,
}

/**
 * Task status text constants.
 * @see {@link TaskStatusTextType}.
 * @see {@link TaskStatusType}.
 * @see {@link getTaskStatusString}.
 */
export const taskStatusTextTypes = ['created', 'init', 'pending', 'starting', 'running', 'aborted', 'resolved', 'rejected'] as const;

/**
 * Task status text values mapped from {@link TaskStatusType} with {@link getTaskStatusString}.
 * @see {@link taskStatusTextTypes}.
 * @see {@link TaskStatusType}.
 * @see {@link getTaskStatusString}.
 */
export type TaskStatusTextType = (typeof taskStatusTextTypes)[number];

/**
 * Map task status enum to task status text.
 * @param {TaskStatusType} status enum {@link TaskStatusType}
 * @returns {string} - {@link TaskStatusTextType}.
 * @example
 * getTaskName(TaskStatusType.Created) // 'created'
 */
export function getTaskStatusString(status: TaskStatusType): TaskStatusTextType {
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

/**
 * Is task status in start state (0-9).
 * @param {TaskStatusType} status enum {@link TaskStatusType}
 * @returns {boolean} - true if status is in start state.
 */
export function isStartState(status: TaskStatusType): boolean {
	return status < 10;
}

/**
 * Is task status in running state (10-89).
 * @param {TaskStatusType} status enum {@link TaskStatusType}
 * @returns {boolean} - true if status is in running state.
 */
export function isRunningState(status: TaskStatusType): boolean {
	return status >= 10 && status < 90;
}

/**
 * Is task in final state (90>=).
 * @param {TaskStatusType} status enum {@link TaskStatusType}
 * @returns {boolean} - true if status is in end state.
 */
export function isEndState(status: TaskStatusType): boolean {
	return status >= 90;
}
