import Command from './parser/command';
import Context from './parser/context';
import debug from './lib/debug';
import E from './lib/errors';
import Extension from './parser/extension';
import fs from 'fs-extra';
import helpCommand, { renderHelp } from './commands/help';
import Parser from './parser/parser';
import path from 'path';
import OutputStream from './render/output-stream';
import semver from 'semver';

import { Console } from 'console';
import { declareCLIKitClass } from './lib/util';

const { error, log, warn } = debug('cli-kit:cli');
const { highlight }  = debug.styles;
const { pluralize } = debug;

/**
 * The required Node.js version for cli-kit. This is used to assert the Node version at runtime.
 * If the `CLI` instance is created with a `nodeVersion`, then it assert the greater of the two
 * Node versions.
 * @type {String}
 */
const clikitNodeVersion = fs.readJsonSync(path.resolve(__dirname, '..', 'package.json')).engines.node;

/**
 * Defines a CLI context and is responsible for parsing the command line arguments.
 *
 * @extends {Context}
 */
export default class CLI extends Context {
	/**
	 * Created a CLI instance.
	 *
	 * @param {Object} [params] - Various options.
	 * @param {String|Function} [params.banner] - A banner or a function that returns the banner
	 * to be displayed before each command.
	 * @param {Boolean} [params.colors=true] - Enables colors, specifically on the help screen.
	 * @param {Boolean} [params.defaultCommand] - The default command to execute.
	 * @param {Boolean} [params.errorIfUnknownCommand=true] - When `true`, `help` is enabled, and
	 * the parser didn't find a command, but it did find an unknown argument, it will show the help
	 * screen with an unknown command error.
	 * @param {Boolean} [params.help=false] - When `true`, enables the built-in help command.
	 * @param {Number} [params.helpExitCode] - The exit code to return when the help command is
	 * finished.
	 * @param {Boolean} [params.hideNoBannerOption=false] - When `true` and a `banner` is specified,
	 * it does not add the `--no-banner` option.
	 * @param {Boolean} [params.hideNoColorOption=false] - When `true` and `colors` is enabled, it
	 * does not add the `--no-color` option.
	 * @param {String} [params.name] - The name of the program. If not set, defaults to `"program"`
	 * in the help outut and `"This application"` in the Node version assertion.
	 * @param {String} [params.nodeVersion] - The required Node.js version to run the app.
	 * @param {Object} [params.renderOpts] - Various render options to control the output stream
	 * such as the display width.
	 * @param {Boolean} [params.showBannerForExternalCLIs=false] - If `true`, shows the `CLI`
	 * banner, assuming banner is enabled, for non-cli-kit enabled CLIs.
	 * @param {Object|stream.Writable} [params.stdout=process.stdout] - A stream or an object with a
	 * `write()` method to write output such as the help screen to.
	 * @param {Object|stream.Writable} [params.stderr=process.stderr] - A stream or an object with a
	 * `write()` method to write error messages to.
	 * @param {Boolean} [params.showHelpOnError=true] - If an error occurs and `help` is enabled,
	 * then display the error before the help information.
	 * @param {String} [params.title='Global'] - The title for the global context.
	 * @param {String} [params.version] - The program version.
	 * @access public
	 */
	constructor(params = {}) {
		if (!params || typeof params !== 'object' || Array.isArray(params)) {
			throw E.INVALID_ARGUMENT('Expected CLI parameters to be an object or Context', { name: 'params', scope: 'CLI.constructor', value: params });
		}

		if (params.banner !== undefined && typeof params.banner !== 'string' && typeof params.banner !== 'function') {
			throw E.INVALID_ARGUMENT('Expected banner to be a string or function', { name: 'banner', scope: 'CLI.constructor', value: params.banner });
		}

		if (params.extensions && typeof params.extensions !== 'object') {
			throw E.INVALID_ARGUMENT(
				'Expected extensions to be an array of extension paths or an object of names to extension paths',
				{ name: 'extensions', scope: 'CLI.constructor', value: params.extensions }
			);
		}

		if (params.helpExitCode !== undefined && typeof params.helpExitCode !== 'number') {
			throw E.INVALID_ARGUMENT('Expected help exit code to be a number', { name: 'helpExitCode', scope: 'CLI.constructor', value: params.helpExitCode });
		}

		if (params.stdout && (typeof params.stdout !== 'object' || typeof params.stdout.write !== 'function')) {
			throw E.INVALID_ARGUMENT('Expected stdout stream to be a writable stream', { name: 'stdout', scope: 'CLI.constructor', value: params.stdout });
		}

		if (params.stderr && (typeof params.stderr !== 'object' || typeof params.stderr.write !== 'function')) {
			throw E.INVALID_ARGUMENT('Expected stderr stream to be a writable stream', { name: 'stderr', scope: 'CLI.constructor', value: params.stderr });
		}

		super({
			args:                           params.args,
			camelCase:                      params.camelCase,
			commands:                       params.commands,
			desc:                           params.desc,
			name:                           params.name || 'program',
			options:                        params.options,
			showBannerForExternalCLIs:      params.showBannerForExternalCLIs,
			title:                          params.title || 'Global',
			treatUnknownOptionsAsArguments: params.treatUnknownOptionsAsArguments
		});

		declareCLIKitClass(this, 'CLI');

		this.appName                   = params.name;
		this.banner                    = params.banner;
		this.colors                    = params.colors !== false;
		this.errorIfUnknownCommand     = params.errorIfUnknownCommand !== false;
		this.helpExitCode              = params.helpExitCode;
		this.nodeVersion               = params.nodeVersion;
		this.warnings                  = [];

		const renderOpts = Object.assign({
			markdown: true
		}, params.renderOpts);

		// init the output streams
		this.stdout = new OutputStream(renderOpts);
		this.stdout.pipe(params.stdout || process.stdout);

		this.stderr = new OutputStream(renderOpts);
		this.stderr.pipe(params.stderr || process.stderr);

		process.on('exit', () => {
			this.stdout.end();
			this.stderr.end();
		});

		this.console = new Console(this.stdout, this.stderr);

		// set the default command
		this.defaultCommand = params.defaultCommand;

		// add the built-in help
		this.help = !!params.help;
		if (this.help) {
			if (this.defaultCommand === undefined) {
				this.defaultCommand = 'help';
			}

			// note: we must clone the help command params since the object gets modified
			this.command('help', Object.assign({}, helpCommand));

			this.option('-h, --help', 'displays the help screen');
		}

		// add the --no-banner flag
		if (this.banner && !params.hideNoBannerOption) {
			this.option('--no-banner', {
				desc: 'suppress the banner'
			});
		}

		// add the --no-colors flag
		if (this.colors && !params.hideNoColorOption) {
			this.option('--no-color', {
				aliases: [ '--no-colors' ],
				desc: 'disable colors'
			});
		}

		// add the --version flag
		if (params.version && !this.lookup.short.v && !this.lookup.long.version) {
			this.option('-v, --version', {
				callback: async ({ next, value }) => {
					if (await next()) {
						this.get('stdout').write(`${params.version}\n`);
						process.exit(0);
					}
				},
				desc: 'outputs the version'
			});
		}

		// add the extensions now that the auto-generated options exist
		if (params.extensions) {
			if (Array.isArray(params.extensions)) {
				for (const ext of params.extensions) {
					try {
						this.extension(ext);
					} catch (e) {
						this.warnings.push(e);
						warn(e);
					}
				}
			} else {
				for (const [ name, ext ] of Object.entries(params.extensions)) {
					try {
						this.extension(ext, name);
					} catch (e) {
						this.warnings.push(e);
						warn(e);
					}
				}
			}
		}
	}

	/**
	 * Parses the command line arguments and runs the command.
	 *
	 * @param {Array.<String>} [unparsedArgs] - An array of arguments to parse. If not specified, it
	 * defaults to the `process.argv` starting with the 3rd argument.
	 * @returns {Promise.<Arguments>}
	 * @access public
	 */
	async exec(unparsedArgs) {
		const { version } = process;
		let required = this.nodeVersion;
		if ((required && !semver.satisfies(version, required)) || !semver.satisfies(version, required = clikitNodeVersion)) {
			throw E.INVALID_NODE_JS(`${this.appName || 'This application'} requires Node.js version is ${required}, currently ${version}`, {
				name: 'nodeVersion',
				scope: 'CLI.exec',
				current: version,
				required
			});
		}

		if (unparsedArgs && !Array.isArray(unparsedArgs)) {
			throw E.INVALID_ARGUMENT('Expected arguments to be an array', { name: 'args', scope: 'CLI.exec', value: unparsedArgs });
		}

		const parser = new Parser();

		try {
			const { _, argv, contexts, unknown } = await parser.parse(unparsedArgs || process.argv.slice(2), this);
			let cmd = contexts[0];

			log('Parsing complete: ' +
				`${pluralize('option', Object.keys(argv).length, true)}, ` +
				`${pluralize('unknown option', Object.keys(unknown).length, true)}, ` +
				`${pluralize('arg', _.length, true)}, ` +
				`${pluralize('context', contexts.length, true)}`
			);

			const results = {
				_,
				argv,
				console: this.console,
				contexts,
				unknown,
				warnings: this.warnings
			};

			// determine the command to run
			if (this.help && argv.help && (!(cmd instanceof Extension) || cmd.isCLIKitExtension)) {
				log('Selected help command');
				cmd = this.commands.get('help');
				contexts.unshift(cmd);

			} else if (!(cmd instanceof Command) && this.defaultCommand && this.commands.has(this.defaultCommand)) {
				log(`Selected default command: ${this.defaultCommand}`);
				cmd = this.commands.get(this.defaultCommand);
				contexts.unshift(cmd);
			}

			// wire up the banner
			let banner = cmd.banner || this.get('banner');
			if (banner) {
				if (cmd instanceof Extension && !cmd.isCLIKitExtension && !cmd.get('showBannerForExternalCLIs')) {
					// disable the banner for non-cli-kit extensions
				} else {
					banner = String(typeof banner === 'function' ? await banner() : banner).trim();
					const showBanner = write => {
						if (banner && argv.banner) {
							write(`${banner}\n\n`);
						}
						banner = null;
					};
					this.stdout.on('start', showBanner);
					this.stderr.on('start', showBanner);
				}
			}

			results.help = () => renderHelp(cmd);

			// execute the command
			if (cmd && typeof cmd.action === 'function') {
				log(`Executing command: ${highlight(cmd.name)}`);
				return await cmd.action(results);
			}

			log('No command to execute, returning parsed arguments');
			return results;
		} catch (err) {
			error(err);

			const help = this.help && this.showHelpOnError !== false && this.commands.get('help');
			if (help) {
				return await help.action({
					contexts: err.contexts || parser.contexts || [ this ],
					err,
					warnings: this.warnings
				});
			}

			throw err;
		} finally {
			this.stdout.end();
			this.stderr.end();
		}
	}
}
