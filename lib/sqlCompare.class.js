/**
 * @file lib/sqlCompare.class.js
 * */
const fs = require('fs');
const _mariadb = require('./mariadb.class.js');
const conn = require('./conn.lib.js');
const {
	getDelimiters,
	escapeRegex,
	removeDelimiters,
	changeDefiner,
	checkAlterHasPrimary,
	alterMultipleToSingle,
	insertMultipleToSingle,
	getColumnsFromCreateTable,
	parseQueryRoutine,
	getNameFromQuery,
	getNameFromQueries,
	getForeignKeyRelationship,
	getTableDependencies,
	topologySortDependencies,
	parseColumnCreateQuery,
	stripColumnDefinitionFromCreate,
	getNonTableCreates,
	isColumnIdentical,
	parseSQLInput,
	colDefToObject,
	colDefFromObject,
	regexForColDef,
	objDeepCompare,
} = require('./functions.lib.js');

/**
 * @defgroup DBCompare SQL Database Compare
 * @brief Compare SQL File input with existing database or with another SQL File.
 * */

/**
 * @ingroup DBCompare
 * @class SQLCompare lib/sqlCompare.class.js
 * @brief Compare 2 database, either from existing db or from file
 */
class SQLCompare {
	/** @private */
	_mysql = undefined;
	/** @private */
	_config = undefined;

	/**
	 * @public
	 * @var errno
	 * @brief Compare error number.
	 * If compare status is true, returned errno must be 0x00
	 *
	 * @details
	 * |name|value|bit pos|desc|
	 * |----|-----|-------|----|
	 * |REMOVED|0x01|0|Old column/table is removed in the new db
	 * |MODIFIED|0x02|1|Old column/table is modified in the new db
	 * |ADDED|0x04|2|New column/table is added in the new db
	 *
	 * @see getErrno
	 * */
	static errno = {
		REMOVED: 0x01,
		MODIFIED: 0x02,
		ADDED: 0x04,
	};

	/**
	 * @private
	 * @param config {#SqlConfig} Database configuration
	 * */
	constructor(config){
		const self = this;
		if(config) self.init(config);
	}

	/**
	 * Initialize instance with config
	 *
	 * @public
	 * @param config {#SqlConfig} Database configuration
	 * @returns {#SQLCompare} this instance
	 * */
	init(config){
		const self = this;

		self._config = config;
		self._config.verbose = config.verbose !== undefined
			? Number(config.verbose)
			: 1;

		return self;
	}

	/**
	 * Parse single ALTER TABLE query
	 *
	 * @private
	 * @param alter {**string**} ALTER TABLE query
	 * @returns {#AlterParsed} Parsed ALTER query
	 * */
	_parseAlter(alter) {
		const reg = regexForColDef();
		const RegExps = {
			PRIMARY: new RegExp('(?:PRIMARY\\s{1,}KEY)[\\W]{1,}\\((.*?)\\)', 'i'),
			MODIFY: new RegExp(
					'(?:MODIFY)[\\W]{1,}(.*?)\\W+([\\w]+)'
						+ '(?:\\({0,}([\\d]+){0,}\\){0,})'
						+ `${reg.UNSIGNED}${reg.ISNULLABLE}${reg.CHARACTER}`
						+ `${reg.DEFAULT}${reg.AUTOINC}`
						+ `(?:\\W+AUTO_INCREMENT\\W+\\w+){0,}` // handle if ALTER MODIFY contains AUTO_INCREMENT number
						+ '$',
					'mi'
				),
			FOREIGN: new RegExp(
					'(?:CONSTRAINT)[\\W]{1,}([\\w]+)'
						+ '(?:\\W{1,}FOREIGN\\s{1,}KEY)[\\W]+'
						+ '(.*?)[\\W]+(?:\\W{1,}REFERENCES)\\W{1,}'
						+ '([\\w]+)\\W{1,}([\\w]+)\\W+',
					'i'
				),
			KEY: new RegExp(
					'(UNIQUE\\s{1,}KEY|KEY)'
						+ '[\\W]{1,}([\\w]+)[^\\(]{1,}\\((.*?)\\)',
					'i'
				),
		};

		const quoteRegex = new RegExp("[\\`\\~\\'\\s\\\"]", "g");

		// check for primary key
		for (const type in RegExps) {
			const match = alter.match(RegExps[type]);

			if (!match) continue;

			switch(type) {

			case 'PRIMARY': {
				return {
					type,
					columns: match[1].replace(quoteRegex, '').split(',')
				};
			} break;

			case 'MODIFY': {
				const column = match[1];
				const columns = [ column ];

				/* shift match to make it identical
				 * like CREATE TABLE, which doesn't contain its column name
				 * */
				match.shift();

				return { type, column, columns, def: colDefToObject(match) };
			} break;

			case 'FOREIGN': {
				return {
					type,
					name: match[1],
					column: match[2],
					columns: [ match[2] ],
					ref: {
						table: match[3],
						column: match[4],
					},
				};
			} break;

			case 'KEY': {
				return {
					type: match[1].toUpperCase() === 'KEY' ? 'INDEX' : 'UNIQUE',
					name: match[2],
					columns: match[3].replace(quoteRegex, '').split(','),
				};
			} break;

			default: {
				console.error(`No Match for '${alter}'`);
			} break;

			}
		}
	}

	/**
	 * @brief Get All Tables' information. Currently, only extract table structure.
	 *
	 * @private
	 * @param parsed {#ParsedQuery} Parsed query
	 *
	 * @returns {#TableInfo} Tables' informations
	 * */
	_tableInfo(parsed) {
		const self = this;
		const tables = {};

		// parsig query.table first and initialize each table info
		for (const name in parsed.table) {

			if (!tables[name]) {
				tables[name] = { name, columns: {} };
			}

			const query = parsed.table[name][0];
			const info = getColumnsFromCreateTable(query);

			for (const col in info) {
				const detail = info[col];
				tables[name].columns[col] = parseColumnCreateQuery(detail);
			}
		}

		// ALTER query for each columns
		for (const query of parsed.alter) {
			const name = getNameFromQuery('ALTER', query);

			if (!tables[name]) tables[name] = { name, columns: {} };

			const definition = self._parseAlter(query);

			if (!definition) continue;

			switch (definition.type) {

			case 'PRIMARY': {
				for (const col of definition.columns) {
					if (!tables[name].columns[col]) {
						tables[name].columns[col] = {};
					}

					tables[name].columns[col].isPrimary = true;
				}
			} break;

			case 'MODIFY': {
				const { column, def } = definition;

				if (!tables[name].columns[column]) {
					tables[name].columns[column] = { ...def };
				} else {
					for (const key in def) {
						if (tables[name].columns[column][key] === def[key]) {
							continue;
						}

						tables[name].columns[column][key] = def[key];
					}
				}
			} break;

			case 'UNIQUE': {
				for (const col of definition.columns) {
					if (!tables[name].columns[col]) {
						tables[name].columns[col] = {};
					}

					if (!tables[name].columns[col].unique) {
						tables[name].columns[col].unique = [];
					}

					tables[name].columns[col].unique.push({
						name: definition.name,
						columns: definition.columns,
					});
				}

			} break;

			case 'INDEX': {
				for (const col of definition.columns) {
					if (!tables[name].columns[col]) {
						tables[name].columns[col] = {};
					}

					if (!tables[name].columns[col].index) {
						tables[name].columns[col].index = [];
					}

					tables[name].columns[col].index.push({
						name: definition.name,
						columns: definition.columns,
					});
				}

			} break;

			case 'FOREIGN': {
				const { column, ref } = definition;

				if (!tables[name].columns[column]) {
					tables[name].columns[column] = {};
				}

				if (!tables[name].columns[column].foreign) {
					tables[name].columns[column].foreign = [];
				}

				tables[name].columns[column].foreign.push({
					name: definition.name,
					column,
					ref,
				});
			} break;

			default: {
				console.error(`INVALID TYPE '${definition.type}'!`);
			} break;

			}
		}

		return tables;
	}

	/**
	 * loop thorugh all table information, to generate report
	 *
	 * @private
	 * @param[in, out] diff {#DiffReport} Diff report, will be modified on excuting this function
	 * @param[in] tables {#TableInfo{}} Table info for both `source` and `target`
	 * @param[in] index {**string**} diff report index to fill. Either 'source' or 'target'
	 *
	 * @return {#DiffReport} Final diff report
	 * */
	_loopDiff(diff, tables, index) {
		for(const tbl in tables) {
			if (diff[tbl] === undefined) diff[tbl] = {};

			const table = tables[tbl];

			for(const col in table.columns) {
				const column = table.columns[col];
				const res = colDefFromObject(column);

				if (diff[tbl][col] === undefined) diff[tbl][col] = {};

				diff[tbl][col][index] = `\`${tbl}\`.\`${col}\` ${res.def}; ${res.key}`
					// remove space before semicolon
					.replace(/\s{1,};/g, ';')
					// replace any double whitespaces into a space
					.replace(/\s{2,}/g, ' ')
					.trim();
			}
		}

		return diff;
	}

	/**
	 * Generate differences report
	 *
	 * @private
	 * @param source {#TableInfo} reference source table
	 * @param target {#TableInfo} table to be compared
	 *
	 * @returns {**Boolean**} **true** If both columns are identical. Otherwise **false**
	 * */
	_generateDiff(source, target) {
		const self = this;

		const diff = [];

		self._loopDiff(diff, source, 'source');
		self._loopDiff(diff, target, 'target');

		return diff;
	}

	/**
	 * Compare column's informations between source column and target column
	 *
	 * @detail source and target will be modified at the end of the function.
	 *         Both objects will contains unmatched columns.
	 *
	 * @private
	 * @param[in,out] source {#ColumnDef{}} reference source column
	 * @param[in,out] target {#ColumnDef{}} target column to be compared
	 * @param[in] isForward {**bool**} if **true**, then source is used as reference
	 * 							if **false**, then target is the reference.
	 *
	 * @returns {**Boolean**} **true** If both columns are identical.
	 * 							Otherwise **false**
	 * */
	_compareColumn(source, target, isForward = true) {
		const self = this;

		let status = true;

		const reference = isForward ? source : target;
		const comparee = isForward ? target : source;

		for (const key in reference) {
			let isSame = true;
			const type = typeof(reference && reference[key]);

			if (type !== typeof(comparee && comparee[key])) {
				isSame = false;
			} else {
				switch(type) {

				case 'array':
				case 'object': {
					isSame = objDeepCompare(reference[key], comparee[key]);
					if (isSame) {
						delete reference[key];
						delete comparee[key];
					}
				} break;

				default: {
					isSame = reference[key] === comparee[key];
				} break;

				}
			}

			const color = isSame ? '\x1b[1m\x1b[32m' : '\x1b[1m\x1b[91m';

			if(self._config.verbose > 0) {
				console.info(`  > Comparing COLUMN ${color}${key} - ${isSame}\x1b[0m`);
			}

			status &= isSame;
		}

		return Boolean(status);
	}

	/**
	 * Compare column's informations between source column and target column.
	 *
	 * @detail source and target will be modified at the end of the function.
	 *         Both objects will contains unmatched tables.
	 *
	 * @public
	 * @param[in,out] source {#ColumnDef{}} reference source column
	 * @param[in,out] target {#ColumnDef{}} target column to be compared
	 *
	 * @returns {**Object**}
	 *
	 * |key|type|note|
	 * |---|----|----|
	 * |status|**boolean**|**true** if identical|
	 * |diff|#DiffReport| |
	 * */
	compare(source, target) {
		const self = this;

		const res = {
			status: true,
			diff: undefined,
		};

		let isForward = true;

		for (const ref of [ source, target ]) {
			for (const tbl in ref) {
				if(self._config.verbose > 0) {
					console.info('\x1b[1m> Comparing TABLE\x1b[34m', tbl, '\x1b[0m');
				}

				const status = self._compareColumn(
						source[tbl]?.columns,
						target[tbl]?.columns,
						isForward
					);

				// check if there's any leftover column
				const keyLen = {
					source: typeof(source[tbl]?.columns) === 'object'
						? Object.keys(source[tbl]?.columns).length
						: 0,

					target: typeof(target[tbl]?.columns) === 'object'
						? Object.keys(target[tbl]?.columns).length
						: 0,

					get status() { return this.target === this.source },
				};

				// don't delete the table if both lengths are different.
				const isIdentical = status && keyLen.status;

				res.status &= isIdentical;

				if (isIdentical) {
					delete source[tbl];
					delete target[tbl];
				}
			}

			/* Check whether target still has member.
			 * If target is empty already, then exit the loop
			 * */
			if (Object.keys(target).length <= 0) break;

			// Flip the flag, we want to use target as the reference
			isForward ^= true;
		}

		if (!res.status) res.diff = self._generateDiff(source, target);

		conn.close(self._mysql);

		return res;
	}

	/**
	 * Get Error Number from #compare diff report.
	 *
	 * @details example on how to extract errno information
	 * @code{.js}
	 * const errno = inst.getErrno(res);
	 *
	 * if (errno & SQLCompare.errno.MODIFIED) {
	 * 	console.info('At least a column has been modified')
	 * }
	 *
	 * if (errno & SQLCompare.errno.REMOVED) {
	 * 	console.info('At least a column has been removed in new database')
	 * }
	 *
	 * if (errno & SQLCompare.errno.ADDED) {
	 * 	console.info('At least a column has been added in new database')
	 * }
	 * @endcode
	 *
	 * @public
	 * @param res {**Object**} #compare result.
	 * @return {**int**} error number. can be extracted by bit position.
	 * @see errno, printDiff
	 * */
	getErrno(res) {
		let errno = 0x00;

		const { diff } = res;

		for (const tbl in diff) {
			for (const col in diff[tbl]) {
				const { source, target } = diff[tbl][col];

				if (source !== undefined && target !== undefined) {
					errno |= SQLCompare.errno.MODIFIED;
				} else if (source !== undefined && target === undefined){
					errno |= SQLCompare.errno.REMOVED;
				} else if (source === undefined && target !== undefined){
					errno |= SQLCompare.errno.ADDED;
				} else {
					// no change. This part should never be reached.
				}
			}
		}

		return errno;
	}

	/**
	 * Print difference between both databases.
	 *
	 * @public
	 * @param res {**Object**} #compare result.
	 * */
	printDiff(res) {
		if (res.status) {
			console.info('Both Tables are identical!');
			return;
		}

		let str = '';

		const { diff } = res;

		for (const tbl in diff) {
			str += `@Table \x1b[1m${tbl}\x1b[0m\n`;

			for (const col in diff[tbl]) {
				const { source, target } = diff[tbl][col];

				const prefix = {
						src: source !== undefined && target !== undefined
							? '\x1b[1m\x1b[43m<-'
							: '\x1b[1m\x1b[41m--',
						tar: source !== undefined && target !== undefined
							? '\x1b[1m\x1b[44m+>'
							: '\x1b[1m\x1b[46m++',
					};

				str += `  source ${prefix.src} ${source ?? ''}\x1b[0m\n`
					+  `  target ${prefix.tar} ${target ?? ''}\x1b[0m\n`
					+  `\n`;
			}
		}

		console.info(str);

		return str.replace(/\\x1b\[\d+m/g, '');
	}

	/**
	 * Parsed content input into #TableInfo
	 *
	 * @private
	 * @param contents {**string**} SQL contents
	 *
	 * @returns {#TableInfo} Tables' informations
	 * */
	_processInput(contents) {
		const self = this;

		const parsed = parseSQLInput(contents, self._config);

		return self._tableInfo(parsed.queries);
	}

	/**
	 * Get information of existing database defined in [config](#SqlConfig)
	 *
	 * @public
	 * @returns {#TableInfo} Tables' informations
	 * */
	async existing() {
		const self = this;

		self._mysql = await conn.open(self._mysql, self._config);

		const tables = await conn.getAllTables(self._mysql);

		if (!tables.status) return tables;

		let str = '';
		const list = {};
		for (const table of tables.data) {
			const create = await conn.showCreate(self._mysql, 'TABLE', table);

			if (!create.status) {
				console.error(create);
				continue;
			}

			const query = create.data['Create Table'];

			str += query + ';\n\n';

			list[table] = query;
		}

		return self._processInput(str);
	}

	/**
	 * Extract information about database defined in a SQL file
	 *
	 * @public
	 * @param filepath {**string**} Path to SQL File
	 * @returns {#TableInfo} Tables' informations
	 * */
	async fromFile(filepath) {
		const self = this;

		const str = fs.readFileSync(filepath, 'utf8')
			// remove single line comments
			.replace(/(^-- (.*)[\n|\r])|(--)/gm, '')
			// remove empty lines
			.replace(/^\s*$(?:\r\n?|\n)/gm, '');

		return self._processInput(str);
	}

	/**
	 * Extract information about database defined in a string
	 *
	 * @public
	 * @param contents {**string**} SQL queries
	 * @returns {#TableInfo} Tables' informations
	 * */
	async fromString(contents) {
		const self = this;

		const str = contents
			// remove single line comments
			.replace(/(^-- (.*)[\n|\r])|(--)/gm, '')
			// remove empty lines
			.replace(/^\s*$(?:\r\n?|\n)/gm, '');

		return self._processInput(str);
	}
}

module.exports = SQLCompare;
