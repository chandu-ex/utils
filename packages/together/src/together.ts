// @NOTE: we're not using concurrently because it can't handle readline (I think), so we lose support
// for build progress
import process from 'process';
import * as execa from 'execa';

let cleanupScheduled = false;
const instances: Together[] = [];

export function cleanup(): void {
	for (const instance of instances) {
		instance.shutdown();
	}
}

interface SpawnedProcess {
	name: string;
	child: execa.ExecaChildProcess;
}

export type Command = [string, string, execa.Options?];

export class Together {
	private readonly _children: SpawnedProcess[] = [];

	private _terminated = false;

	constructor(commands: Command[]) {
		instances.push(this);

		if (!cleanupScheduled) {
			process.on('SIGINT', cleanup);
			process.on('SIGTERM', cleanup);
			cleanupScheduled = true;
		}

		for (const [name, command, options = {}] of commands) {
			console.log('Launching', name);
			const child = execa.command(command, Object.assign(options, {stdio: 'inherit'}));
			this._children.push({name, child});
		}
	}

	shutdown(): void {
		if (this._terminated) {
			return;
		}

		this._terminated = true;

		for (const {name, child} of this._children) {
			console.log('Killing', name);
			child.cancel();
		}
	}
}

export default Together;
