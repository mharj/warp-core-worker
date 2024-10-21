/**
 * Task trigger is instant (with start/wait method)
 */
export type InstantTaskTrigger = {
	type: 'instant';
};

/**
 * Task trigger is interval based.
 */
export type IntervalTaskTrigger = {
	type: 'interval';
	interval: number;
};

/**
 * Task trigger is cron based.
 */
export type CronTaskTrigger = {
	type: 'cron';
	cron: string;
};

/**
 * Task trigger type
 */
export type TaskTrigger = InstantTaskTrigger | IntervalTaskTrigger | CronTaskTrigger;
