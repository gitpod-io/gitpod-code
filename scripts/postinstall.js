const cp = require('child_process');
const yarn = 'yarn';
const glob = require('glob');

/**
 * @param {string} location
 * @param {*} [opts]
 */
function yarnInstall(location, opts) {
	opts = opts || { env: process.env };
	opts.cwd = location;
	opts.stdio = 'inherit';

	const raw = process.env['npm_config_argv'] || '{}';
	const argv = JSON.parse(raw);
	const original = argv.original || [];
	const args = original.filter(arg => arg === '--ignore-optional' || arg === '--frozen-lockfile' || arg === '--check-files');
	if (opts.ignoreEngines) {
		args.push('--ignore-engines');
		delete opts.ignoreEngines;
	}

	console.log(`Installing dependencies in ${location}...`);
	console.log(`$ yarn ${args.join(' ')}`);
	const result = cp.spawnSync(yarn, args, opts);

	if (result.error || result.status !== 0) {
		process.exit(1);
	}
}

const extensionDirectories = glob.sync("./*/package.json")

for (let dir of extensionDirectories) {
    dir = dir.replace("package.json", "");
    yarnInstall(dir, { ignoreEngines: true });
}
