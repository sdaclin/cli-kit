const errors = {};
export default errors;

createError('ALREADY_EXISTS',              Error,      'A object with the same name has already been registered and would overwrite the existing object');
createError('CONFLICT',                    Error,      'A parameter conflicts with the value of another parameter');
createError('DEFAULT_COMMAND_NOT_FOUND',   Error,      'The default command was not found');
createError('EMPTY_STRING',                Error,      'A string value was undefined, null, empty, or false');
createError('FILE_NOT_FOUND',              Error,      'The file does not exist or access is restricted');
createError('INVALID_ALIAS',               TypeError,  'An alias is empty, not a string, or an invalid format');
createError('INVALID_ARGUMENT',            TypeError,  'A function argument is undefined or the incorrect data type');
createError('INVALID_CLIKIT_OBJECT',       TypeError,  'A function was passed a cli-kit object that is not supported');
createError('INVALID_DATA_TYPE',           Error,      'The CLI argument or option has been assigned an unsupported data type');
createError('INVALID_DATE',                RangeError, 'A value was not a valid date');
createError('INVALID_EXTENSION',           Error,      'Unable to load an extension due to bad path, bad package.json, missing main file, etc');
createError('INVALID_JSON',                Error,      'The string does not contain valid JSON');
createError('INVALID_NODE_JS',             Error,      'The current Node.js version is too old');
createError('INVALID_NUMBER',              Error,      'Unable to parse value into the number');
createError('INVALID_OPTION',              Error,      'The option parameters are incomplete or contains invalid values');
createError('INVALID_OPTION_FORMAT',       TypeError,  'Unable to parse an option\'s foramt');
createError('INVALID_PACKAGE_JSON',        Error,      'A package.json file does not exist, did not contain valid JSON, or define an object');
createError('INVALID_VALUE',               Error,      'Unable to transform the value to the desired data type or conform to the required format');
createError('MISSING_REQUIRED_ARGUMENT',   Error,      'A required command line argument was not found');
createError('MISSING_REQUIRED_OPTION',     Error,      'A required command line option was not found');
createError('NO_EXECUTABLE',               Error,      'Attempted to run an undefined executable');
createError('NOT_AN_OPTION',               Error,      'An option is not an option and should be treated as an argument');
createError('NOT_YES_NO',                  RangeError, 'The value is not "yes", "y", "no", or "n"');
createError('RANGE_ERROR',                 RangeError, 'The value is not within the acceptable min/max range');
createError('TEMPLATE_NOT_FOUND',          Error,      'The specified template file does not exist or access is denied');
createError('TYPE_ERROR',                  TypeError,  'A variable is undefined or the incorrect data type');

/**
 * Creates an the error object and populates the message, code, and metadata.
 *
 * @param {String} code - The error code.
 * @param {Error|RangeError|TypeError} type - An instantiable error object.
 * @param {String} desc - A generic error description.
 */
function createError(code, type, desc) {
	errors[code] = function (msg, meta) {
		const err = new type(msg);

		if (desc) {
			if (!meta) {
				meta = {};
			}
			meta.desc = desc;
		}

		return Object.defineProperties(err, {
			code: {
				configurable: true,
				enumerable: true,
				writable: true,
				value: `ERR_${code}`
			},
			meta: {
				configurable: true,
				value: meta || undefined,
				writable: true
			}
		});
	};

	Object.defineProperties(errors[code], {
		name: {
			configurable: true,
			value: code,
			writable: true
		},
		toString: {
			configurable: true,
			value: function toString() {
				return `ERR_${code}`;
			},
			writable: true
		}
	});
}
