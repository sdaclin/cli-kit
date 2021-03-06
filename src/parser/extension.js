import Command from './command';
import debug from '../lib/debug';
import E from '../lib/errors';
import fs from 'fs';
import path from 'path';
import which from 'which';

import { declareCLIKitClass, findPackage } from '../lib/util';
import { spawn } from 'child_process';

const { log } = debug('cli-kit:extension');
const { highlight, note } = debug.styles;

/**
 * Defines a namespace that wraps an external program or script.
 *
 * @extends {Command}
 */
export default class Extension extends Command {
	/**
	 * An array of args to pass to the extension.
	 * @type {Array.<String>}
	 */
	execArgs = [];

	/**
	 * Set to `true` if this extension is a cli-kit extension. It shall remain `false` for native
	 * binaries and non-cli-kit CLI's.
	 * @type {Boolean}
	 */
	isCLIKitExtension = false;

	/**
	 * Detects the extension defined in the specified path and initializes it.
	 *
	 * @param {Object} params - Various parameters.
	 * @param {String} params.extensionPath - The path to the extension. The path can be an
	 * executable, a JavaScript file, or Node.js package. If the path is a Node.js package with a
	 * `package.json` containing a `"cli-kit"` propertly, it will merge the external cli-kit context
	 * tree into this namespace.
	 * @param {String} [params.name] - The extension name. If not set, it will load it from the
	 * extension's `package.json` or the filename.
	 * @access public
	 */
	constructor(params = {}) {
		if (!params || typeof params !== 'object' || Array.isArray(params)) {
			throw E.INVALID_ARGUMENT('Expected parameters to be an object or Context', { name: 'params', scope: 'Extension.constructor', value: params });
		}

		let { extensionPath, name, parent } = params;
		let executable = null;
		let pkg = null;
		let isCLIKitExtension = false;
		let startTime = Date.now();

		if (!extensionPath || typeof extensionPath !== 'string') {
			throw E.INVALID_ARGUMENT('Expected extension path to be a non-empty string', { extensionPath, name: 'extensionPath', scope: 'Extension.constructor', value: extensionPath });
		}

		name = String(name || '').trim();

		// first see if this is an executable
		try {
			executable = which.sync(extensionPath);
			params.action = () => this.exec();
		} catch (e) {
			// not an executable,
			if (fs.existsSync(extensionPath)) {
				// check if we have a JavaScript file or Node.js module
				pkg = findPackage(extensionPath);
				if (!pkg.main) {
					throw E.INVALID_EXTENSION(`Unable to find extension's main file: ${extensionPath}`);
				}

				// if there's not an explicit name, then fall back to the name in the package
				if (!name) {
					name = String(pkg.json.name || '').trim();
				}

				if (pkg.clikit) {
					log(`Requiring ${highlight(pkg.main)}`);
					let ctx;
					let err;

					try {
						ctx = require(pkg.main);
					} catch (e) {
						err = e;
					}

					if (ctx && ctx.__esModule) {
						ctx = ctx.default;
					}

					isCLIKitExtension = true;

					if (ctx && typeof ctx === 'object') {
						if (ctx.clikit instanceof Set && (ctx.clikit.has('CLI') || ctx.clikit.has('Command'))) {
							params = ctx;
							params.parent = parent;
						} else {
							isCLIKitExtension = false;
						}

					} else if (params.ignoreInvalidExtensions || (params.parent && params.parent.get('ignoreInvalidExtensions', false))) {
						params.action = () => {
							const { stderr } = this.get('terminal');
							if (err) {
								stderr.write(`Bad extension: ${pkg.json.name}\n`);
								stderr.write(`  ${err.toString()}\n`);
								let { stack } = err;
								const p = stack.indexOf('\n\n');
								if (p !== -1) {
									stack = stack.substring(0, p).trim();
								}
								for (const line of stack.split('\n')) {
									stderr.write(`  ${line}\n`);
								}
							} else {
								stderr.write(`Invalid extension: ${pkg.json.name}\n`);
							}
						};

					} else if (err) {
						// prefix the error with this extension's info
						const error = E.INVALID_EXTENSION(`Bad extension "${pkg.json.name}": ${err.message}`, { extensionPath, name: err.name, scope: 'Extension.constructor', value: err });
						error.stack = err.stack;
						throw error;

					} else {
						throw E.INVALID_EXTENSION(`Extension does not export an object: ${extensionPath}`, { extensionPath, name: 'ctx', scope: 'Extension.constructor', value: ctx });
					}
				}

				// init the aliases with any aliases from the package.json
				params.aliases = Array.isArray(pkg.json.aliases) ? pkg.json.aliases : [];

				// if the name is different than the one in the package.json, add it to the aliases
				if (params.name && params.name !== name && !params.aliases.includes(params.name)) {
					params.aliases.push(params.name);
				}

				// if the package has a bin script that matches the package name, then add any other
				// bin name that aliases the package named bin
				if (pkg.json.bin) {
					const primary = pkg.json.bin[pkg.json.name];
					for (const [ name, bin ] of Object.entries(pkg.json.bin)) {
						if (bin === primary && !params.aliases.includes(name)) {
							params.aliases.push(name);
						}
					}
				}

				if (pkg.json.description) {
					params.desc = pkg.json.description;
				}
			}
		}

		super(name || path.basename(extensionPath), params);
		declareCLIKitClass(this, 'Extension');

		this.banner            = params.banner;
		this.executable        = executable;
		this.isCLIKitExtension = isCLIKitExtension;
		this.pkg               = pkg;
		this.time              = Date.now() - startTime;

		if (!isCLIKitExtension) {
			// if this is a not a cli-kit-enabled extension, add a --version option to override
			// the CLI's --version and disable it
			this.option('-v, --version', {
				callback() {
					throw E.NOT_AN_OPTION('Non-cli-kit extensions do not support --version flag');
				},
				hidden: true
			});
		}

		if (isCLIKitExtension) {
			log(`Loaded cli-kit enable extension: ${highlight(pkg.json.name)} ${note(`(${this.time} ms)`)}`);

		} else if (pkg) {
			this.executable = process.execPath;
			this.execArgs.unshift(this.extensionPath);
			this.action = () => this.exec();
			log(`Loaded extension as Node package: ${highlight(extensionPath)} ${note(`(${this.time} ms)`)}`);

		} else if (executable) {
			log(`Loaded extension as executable: ${highlight(extensionPath)} ${note(`(${this.time} ms)`)}`);

		} else if (this.get('ignoreMissingExtensions', false)) {
			this.action = () => {
				const { stderr } = this.get('terminal');
				stderr.write(`Extension not found: ${highlight(extensionPath)}\n`);
			};

			log(`Loaded invalid extension: ${highlight(extensionPath)} ${note(`(${this.time} ms)`)}`);

		} else {
			throw E.INVALID_EXTENSION(`Extension not found: ${extensionPath}`, { extensionPath, name: 'extension', scope: 'Extension.constructor', value: extensionPath });
		}
	}

	/**
	 * Runs this extension's executable.
	 *
	 * @returns {Promise}
	 * @access private
	 */
	exec() {
		return new Promise((resolve, reject) => {
			if (!this.executable) {
				return reject(E.NO_EXECUTABLE('No executable to run', { name: 'executable', scope: 'Extension.run', value: this.executable }));
			}

			const { stderr, stdin, stdout } = this.get('terminal');
			const stdio = [
				!this.isCLIKitExtension || stdin === process.stdin   ? 'inherit' : 'pipe',
				!this.isCLIKitExtension || stdout === process.stdout ? 'inherit' : 'pipe',
				!this.isCLIKitExtension || stderr === process.stderr ? 'inherit' : 'pipe'
			];

			log(`Running: ${highlight(this.executable + this.execArgs.map(s => ' ' + s))} ${note(JSON.stringify(stdio))}`);
			const child = spawn(this.executable, this.execArgs, { stdio });

			if (stdio[1] === 'pipe') {
				child.stdout.pipe(stdout);
			}
			if (stdio[2] === 'pipe') {
				child.stderr.pipe(stderr);
			}

			child.on('close', (code = 0) => resolve({ code }));
		});
	}
}
