export type TaskTrigger =
	| {
			type: 'instant';
	  }
	| {
			type: 'interval';
			interval: number;
	  }
	| {
			type: 'cron';
			cron: string;
	  };
