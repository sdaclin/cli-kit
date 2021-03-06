import Argument from './argument';
import ArgumentList from './argument-list';
import CommandList from './command-list';
import debug from '../lib/debug';
import E from '../lib/errors';
import fs from 'fs';
import HookEmitter from 'hook-emitter';
import Lookup from './lookup';
import Option from './option';
import OptionList from './option-list';
import path from 'path';

import { declareCLIKitClass } from '../lib/util';

/**
 * `Command` and `Extension` are lazy loaded due to circular references.
 */
let Command;
let Extension;

const { chalk } = debug;
const { log } = debug('cli-kit:context');
const { highlight, note } = debug.styles;

/**
 * Properties to ignore when mixing an existing context into a new context.
 * @type {RegExp}
 */
const propIgnoreRegExp = /^_events|_links|args|commands|lookup|options$/;

/**
 * Defines a context that contains commands, options, and args. Serves as the
 * base class for `CLI` and `Context` objects.
 *
 * @extends {HookEmitter}
 */
export default class Context extends HookEmitter {
	/**
	 * Constructs a context instance.
	 *
	 * @param {Object} [params] - Various parameters.
	 * @param {Array<Object>} [params.args] - An array of arguments.
	 * @param {Boolean} [params.camelCase=true] - Camel case option names.
	 * @param {Object|Map|String|Array.<String>} [params.commands] - A map of command names to
	 * command descriptors, a path to command .js file, a path to a directory of .js files, or an
	 * array of paths to files or directories.
	 * @param {String} [params.desc] - The description of the CLI or command displayed in the help
	 * output.
	 * @param {Object|Array.<String>} [params.extensions] - An map of extension names to extension
	 * paths or an array of extension paths. A extension path is either a path to a directory
	 * containing a Node.js module, a path to a .js file, or the name of a executable.
	 * @param {String} [params.name] - The name of the context such as the program or the command
	 * name.
	 * @param {Array<Object>|Object|Map} [params.options] - An array of options.
	 * @param {Context} [params.parent] - The parent context.
	 * @param {Boolean} [params.showBannerForExternalCLIs=false] - If `true`, shows the `CLI`
	 * banner, assuming banner is enabled, for non-cli-kit enabled CLIs.
	 * @param {String} [params.title] - The context title.
	 * @param {Boolean} [params.treatUnknownOptionsAsArguments=false] - When `true`, any argument is
	 * encountered during parsing that resembles a option that does not exist, it will add it
	 * untouched to `_` as an argument as well as to `argv` as a boolean flag. When `false`, it will
	 * only add the argument to `argv` as a boolean flag.
	 * @access public
	 */
	constructor(params = {}) {
		if (!params || typeof params !== 'object' || (params.clikit instanceof Set && !params.clikit.has('Context'))) {
			throw E.INVALID_ARGUMENT('Expected parameters to be an object, CLI, Command, or Context', { name: 'clikit', scope: 'Context.constructor', value: params.clikit });
		}

		if (params.args && !Array.isArray(params.args)) {
			throw E.INVALID_ARGUMENT('Expected args to be an array', { name: 'args', scope: 'Context.constructor', value: params.args });
		}

		if (params.options && typeof params.options !== 'object') {
			throw E.INVALID_ARGUMENT('Expected options to be an object or an array', { name: 'options', scope: 'Context.constructor', value: params.options });
		}

		if (params.extensions && typeof params.extensions !== 'object') {
			throw E.INVALID_ARGUMENT('Expected extensions to be an object or an array', { name: 'extensions', scope: 'Context.constructor', value: params.extensions });
		}

		super();

		const ignoreOut = params.clikit instanceof Set && params.clikit.has('Context');

		for (const prop of Object.keys(params)) {
			if (!propIgnoreRegExp.test(prop) || ((prop === 'stdout' || prop === 'stderr') && ignoreOut)) {
				this[prop] = params[prop];
			}
		}

		declareCLIKitClass(this, 'Context');

		this.args     = new ArgumentList();
		this.commands = new CommandList();
		this.options  = new OptionList();

		// initialize the lookup table as a hidden property so that it won't get mixed in when being
		// loaded from an extension
		Object.defineProperty(this, 'lookup', {
			configurable: true,
			writable: true,
			value: new Lookup()
		});

		this.camelCase = params.camelCase !== false;

		// initialize the commands
		let { commands } = params;
		if (commands) {
			if (typeof commands === 'string') {
				commands = [ commands ];
			}

			if (Array.isArray(commands)) {
				const js = /^(.+)\.js$/;

				for (let commandPath of commands) {
					let m;
					let stat;

					commandPath = path.resolve(commandPath);

					try {
						stat = fs.statSync(commandPath);
					} catch (e) {
						if (e.code === 'ENOENT') {
							throw E.FILE_NOT_FOUND(`Command path does not exist: ${commandPath}`, { name: 'commands', scope: 'Context.constructor', value: commandPath });
						}
						throw e;
					}

					if (stat.isDirectory()) {
						for (const filename of fs.readdirSync(commandPath)) {
							if (m = filename.match(js)) {
								const module = require(path.join(commandPath, filename));
								this.command(m[1], module.__esModule ? module.default : module);
							}
						}
					} else if (stat.isFile() && (m = commandPath.match(js))) {
						const module = require(commandPath);
						this.command(m[1], module.__esModule ? module.default : module);
					}
				}

			} else if (typeof params.commands === 'object') {
				const isMap = params.commands instanceof Map;
				const entries = isMap ? params.commands.entries() : Object.entries(params.commands);
				for (const [ name, cmd ] of entries) {
					this.command(name, cmd);
				}

			} else {
				throw E.INVALID_ARGUMENT('Expected commands to be an object, map, path, or array of paths', { name: 'commands', scope: 'Context.constructor', value: params.commands });
			}
		}

		if (params.clikit instanceof Set && (params.clikit.has('CLI') || params.clikit.has('Command'))) {
			// the options are coming from an existing CLI or Command object, so we need to copy
			// them into this context, but only if they option does not already exist in a parent
			// context
			const isCLI = params.clikit.has('CLI');
			const entries = params.options instanceof Map ? params.options.entries() : Object.entries(params.options);
			for (const [ group, options ] of entries) {
				for (const option of options) {
					let add = true;

					if (isCLI && option.name !== 'version') {
						// scan all parents to see if this flag is a dupe
						let found = false;
						for (let p = this.parent; p && !found; p = p.parent) {
							for (const opts of p.options.values()) {
								for (const opt of opts) {
									if (opt.name === option.name) {
										found = true;
										break;
									}
								}
							}
						}
						add = !found;
					}

					if (add) {
						this.option(option, group);
					}
				}
			}
		} else {
			// initialize the options
			if (Array.isArray(params.options)) {
				let group = null;
				for (const groupOrOption of params.options) {
					if (!groupOrOption || (typeof groupOrOption !== 'string' && typeof groupOrOption !== 'object') || Array.isArray(groupOrOption)) {
						throw E.INVALID_ARGUMENT('Expected options array element to be a string or an object', { name: 'options', scope: 'Context.constructor', value: groupOrOption });
					}
					if (typeof groupOrOption === 'string') {
						group = groupOrOption;
					} else {
						for (const format of Object.keys(groupOrOption)) {
							this.option(format, group, groupOrOption[format]);
						}
					}
				}
			} else if (typeof params.options === 'object') {
				for (const format of Object.keys(params.options)) {
					this.option(format, params.options[format]);
				}
			}
		}

		if (Array.isArray(params.args)) {
			for (const arg of params.args) {
				this.argument(arg);
			}
		}

		// load extensions... this must happen last
		// note that extensions defined in the `CLI` params are loaded by the `CLI` constructor, not
		// here, because we need to load the extension after the `CLI` has added its auto-generated
		// options
		if (params.extensions) {
			if (Array.isArray(params.extensions)) {
				for (const ext of params.extensions) {
					this.extension(ext);
				}
			} else {
				for (const [ name, ext ] of Object.entries(params.extensions)) {
					this.extension(ext, name);
				}
			}
		}
	}

	/**
	 * Adds an argument to this context.
	 *
	 * @param {Argument|Object|String} arg - An `Argument` instance or options to pass into an
	 * `Argument` constructor.
	 * @returns {Context}
	 * @access public
	 */
	argument(arg = {}) {
		this.args.add(arg);
		return this;
	}

	/**
	 * Adds a command to this context.
	 *
	 * @param {Command|Object|String} cmd - A `Command` instance, `Command` constructor options, or
	 * a command name.
	 * @param {Object} [params] - When `cmd` is the command name, then this is the options to pass
	 * into the `Command` constructor.
	 * @returns {Context}
	 * @access public
	 */
	command(cmd, params) {
		if (!Command) {
			Command = require('./command').default;
		}

		if (cmd instanceof Command) {
			cmd.parent = this;
		} else {
			let name = cmd;
			if (name && typeof name === 'object' && !Array.isArray(name)) {
				params = name;
				name = params.name;
			}

			if (typeof params === 'function') {
				params = {
					action: params
				};
			} else if (!params) {
				params = {};
			}

			if (typeof params !== 'object' || Array.isArray(params)) {
				throw E.INVALID_ARGUMENT('Expected command parameters to be an object', { name: 'params', scope: 'Context.command', value: params });
			}

			params.parent = this;

			cmd = new Command(name, params);
		}

		log(`Adding command: ${highlight(cmd.name)}`);
		return this.registerCommand(cmd);
	}

	/**
	 * Registers an external package as a command context that invokes the package.
	 *
	 * @param {Extension|String} ext - A extension instance or the path to the extension to wire up.
	 * @param {String} [name] - The extension name used for the context name. If not set, it will
	 * attempt to find a `package.json` with a `cli-kit.name` value
	 * @returns {Context}
	 * @access public
	 */
	extension(ext, name) {
		if (!Extension) {
			Extension = require('./extension').default;
		}

		if (ext instanceof Extension) {
			ext.parent = this;
		} else {
			if (ext && typeof ext === 'object') {
				name = ext.name;
				ext = ext.path;
			}

			ext = new Extension({
				extensionPath: ext,
				name,
				parent: this
			});
		}

		log(`Adding extension: ${highlight(ext.name)}`);
		return this.registerCommand(ext);
	}

	/**
	 * Renders the help screen for this context including the parent contexts.
	 *
	 * @returns {Promise<Object>}
	 * @access private
	 */
	generateHelp() {
		return this.hook('generateHelp', () => {
			const results = {
				contexts: [],
				error: undefined,
				suggestions: [],
				warnings: undefined
			};
			const pkgJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
			const scopes = [];
			let ctx = this;

			while (ctx) {
				scopes.push({
					title: `${ctx.title} options`,
					name: ctx.name,
					...ctx.options.generateHelp()
				});
				results.contexts.unshift(ctx.name);
				ctx = ctx.parent;
			}

			// remove duplicate options
			const longs = new Set();
			const shorts = new Set();
			let j = scopes.length;
			while (j--) {
				for (const [ group, options ] of Object.entries(scopes[j].groups)) {
					for (let i = 0; i < options.length; i++) {
						const { long, short } = options[i];
						let nuke = false;
						if (long !== null) {
							if (longs.has(long)) {
								nuke = true;
							} else {
								longs.add(long);
							}
						}
						if (short !== null) {
							if (shorts.has(short)) {
								nuke = true;
							} else {
								shorts.add(short);
							}
						}
						if (nuke) {
							scopes[j].count--;
							options.splice(i--, 1);
						}
					}
				}
			}

			// set the description
			results.desc = this.desc ? String(this.desc).trim().replace(/^\w/, c => c.toLocaleUpperCase()) : null;

			// set the commands
			results.commands = {
				title: this.parent ? `${this.title} commands` : 'Commands',
				...this.commands.generateHelp()
			};

			// update the default command
			if (this.defaultCommand) {
				for (const cmd of results.commands.entries) {
					if (cmd.name === this.defaultCommand) {
						cmd.default = true;
						break;
					}
				}
			}

			// set the arguments
			results.arguments = {
				title: this.parent ? `${this.title} arguments` : 'Arguments',
				...this.args.generateHelp()
			};

			// set the options
			results.options = {
				count: scopes.reduce((p, c) => p + c.count, 0),
				scopes
			};

			// set the usage line
			const usage = results.contexts.slice();
			results.commands.count && usage.push('<command>');
			results.options.count && usage.push('[options]');
			usage.push.apply(usage, results.arguments.entries.map(arg => {
				const name = `<${arg.name}${arg.multiple ? '...' : ''}>`;
				return arg.required ? name : `[${name}]`;
			}));
			results.usage = {
				title: 'Usage',
				text: usage.join(' ')
			};

			return results;
		})();
	}

	/**
	 * Scan parent contexts to find the specified property in the top-most context.
	 *
	 * @param {String} name - The property name.
	 * @param {*} defaultValue - A default value if no value is found.
	 * @returns {*}
	 * @access private
	 */
	get(name, defaultValue) {
		let value = this[name];
		for (let p = this.parent; p; p = p.parent) {
			value = p.get(name, value);
		}
		return value !== undefined ? value : defaultValue;
	}

	/**
	 * Scan parent contexts to find the specified property in the bottom-most context.
	 *
	 * @param {String} name - The property name.
	 * @param {*} defaultValue - A default value if no value is found.
	 * @returns {*}
	 * @access private
	 */
	prop(name, defaultValue) {
		let value = this[name];
		for (let p = this.parent; value === undefined && p; p = p.parent) {
			value = p.prop(name, value);
		}
		return value !== undefined ? value : defaultValue;
	}

	/**
	 * Adds an option to this context.
	 *
	 * @param {Option|String} optOrFormat - An `Option` instance or the option format.
	 * @param {String} [group] - If `params` is present, then this value is the name of the group to
	 * assign the option to. If `params` is not present, then this value will be treated as the
	 * description.
	 * @param {Object} [params] - When `optOrFormat` is a format string, then this argument is
	 * passed into the `Option` constructor.
	 * @returns {Context}
	 * @access public
	 *
	 * @example
	 *   ctx.option('--foo');
	 *   ctx.option('--foo', 'enables foo mode');
	 *   ctx.option('--foo', { desc: 'enables foo mode' });
	 *   ctx.option('--foo', 'Silly Options', { desc: 'enables foo mode' });
	 *   ctx.option(new Option('--foo'));
	 *   ctx.option(new Option('--foo'), 'Silly Options');
	 */
	option(optOrFormat, group, params) {
		if (group) {
			if (typeof group === 'object') {
				params = group;
				group = null;
			} else if (typeof group !== 'string') {
				throw E.INVALID_ARGUMENT('Expected group to be a non-empty string', { name: 'group',  scope: 'Context.command', value: group });
			} else if (!params) {
				params = { desc: group };
				group = null;
			}
		}

		if (!params) {
			params = {};
		}

		params.parent = this;

		const opt = optOrFormat instanceof Option ? optOrFormat : new Option(optOrFormat, params);
		group || (group = opt.group || '');

		this.options.add(group, opt);

		if (opt.long) {
			this.lookup.long[opt.long] = opt;
		}

		if (opt.short) {
			this.lookup.short[opt.short] = opt;
		}

		for (const [ alias, visible ] of Object.entries(opt.aliases.long)) {
			if (visible) {
				this.lookup.long[alias] = opt;
			}
		}

		for (const [ alias, visible ] of Object.entries(opt.aliases.short)) {
			if (visible) {
				this.lookup.short[alias] = opt;
			}
		}

		return this;
	}

	/**
	 * Registers a command or extension to add to this context's list of commands and alias lookup.
	 *
	 * @param {Command} cmd - The command instance.
	 * @return {Context}
	 * @access private
	 */
	registerCommand(cmd) {
		if (this.commands.has(cmd.name)) {
			throw E.ALREADY_EXISTS(`Command "${cmd.name}" already exists`, { name: 'cmd',  scope: 'Context.registerCommand', value: cmd });
		}

		this.commands.add(cmd);

		this.lookup.commands[cmd.name] = cmd;
		if (cmd.aliases) {
			for (const alias of Object.keys(cmd.aliases)) {
				if (!this.commands.has(alias)) {
					this.lookup.commands[alias] = cmd;
				}
			}
		}

		return this;
	}
}
