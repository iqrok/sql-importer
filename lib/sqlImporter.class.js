const fs = require('fs');
const _mariadb = require('./mariadb.class.js');

/**
 * Error from process.
 * @typedef {(string|Object|string[]|Object[])} resError
 */

/**
 * returned data from process.
 * @typedef {(string|Object|string[]|Object[])} resData
 */

/**
 * Response object with status, data and error
 * @typedef {Object} Response
 * @property {boolean} status - indicates whether the process run successfully or not.
 * @property {resError|undefined} error - presents if status is false, otherwise it's undefined.
 * @property {resData|undefined} data - presents if status is true, otherwise it's undefined.
 */

function response(status, content, debug = false){
	status = Boolean(status);

	if(debug){
		status ? console.log(content) : console.error(content);
	}

	return status
		? {status, data: content}
		: {status, error: content};
}

class IMPORTER {
	constructor(config){
		const self = this;

		self._config = undefined;
		self._mysql = undefined;
		self._contents = undefined;

		if(config){
			self.init(config);
		}
	}

	/**
	 * Initiatlize instance with config
	 * @param {Object} config - mysql connection config
	 * @returns {Object} class instance
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
	 * close and delete mysql connection
	 * */
	async close(){
		const self = this;

		if(self._mysql){
			await self._mysql.end();
			self._mysql = undefined;
		}
	}

	/**
	 * Get all tables from connected database
	 * @returns {Response} response - response from mysql query
	 * @returns {string[]} response.data - array of tables' names
	 * */
	getAllTables(){
		const self = this;

		return self._mysql.query(`SHOW TABLES`)
			.then(res => {
				const data = [];
				for(const item of res){
					for(const key in item){
						data.push(item[key]);
					}
				}

				return response(true, data);
			})
			.catch(error => {
				return response(false, error, true);
			});
	}

	/**
	 * Drop table from connected database
	 * @params {string} name - table's name
	 * */
	dropTable(name){
		const self = this;

		const { verbose } = self._config;
		const query = 'SET FOREIGN_KEY_CHECKS=0;'
				+ 'DROP TABLE IF EXISTS `' + name + '`;'
				+ 'DROP VIEW IF EXISTS `' + name + '`;'
				+ 'SET FOREIGN_KEY_CHECKS=1;';

		return self._mysql.query(query)
			.then(res => {
				if(verbose > 1){
					console.log(
						'\n================= DROP ====================\n',
						`TABLE '${name}' is DROPPED`,
						'\n===========================================\n',
						res,
						'\n================ SUCCESS ==================\n',
					);
				}
			})
			.catch(error => {
				if(verbose > 0){
					console.error(
						'\n++++++++++++++++ DROP ++++++++++++++++++++\n',
						`Failed at dropping TABLE '${name}'`,
						'\n++++++++++++++++++++++++++++++++++++++++++\n',
						error,
						'\n++++++++++++++++ ERROR +++++++++++++++++++\n',
					);
				}
			});
	}

	/**
	 * Drop all tables from connected database
	 * @returns {Response|undefined} response - will return response if error is encountered
	 * */
	async dropAllTables(database){
		const self = this;

		const tables = await self.getAllTables();

		if(!tables.status){
			return response(true, 'Db contains no Tables');
		}

		for(const name of tables.data){
			await self.dropTable(name);
		}
	};

	/**
	 * Drop all routines from connected database
	 * @returns {Response|undefined} response - will return response if error is encountered
	 * */
	async dropRoutines(database){
		const self = this;

		const { verbose } = self._config;

		for(const rName of [ 'FUNCTION', 'PROCEDURE' ]){
			const rRoutines = await self.getAllRoutines(database, rName);

			if(!rRoutines.status){
				return response(true, `Db contains no '${rName}'`);
			}

			for(const name of rRoutines.data){
				await self._mysql.query('SET FOREIGN_KEY_CHECKS=0;'
						+ 'DROP ' + rName + ' IF EXISTS `' + name + '`;'
						+ 'SET FOREIGN_KEY_CHECKS=1;')
					.then(res => {
						if(verbose > 1){
							console.log(
								'\n================= DROP ====================\n',
								`${rName} '${name}' is DROPPED`,
								'\n===========================================\n',
								res,
								'\n================ SUCCESS ==================\n',
							);
						}
					})
					.catch(error => {
						if(verbose > 1){
							console.error(
								'\n++++++++++++++++ DROP ++++++++++++++++++++\n',
								`Failed at dropping ${rName} '${name}'`,
								'\n++++++++++++++++++++++++++++++++++++++++++\n',
								error,
								'\n++++++++++++++++ ERROR +++++++++++++++++++\n',
							);
						}
					});
			}
		}
	};

	/**
	 * Get all routines from connected database
	 * @returns {Response} response
	 * @returns {string[]} response.data - array of routines' names
	 * */
	async getAllRoutines(database, rName){
		const self = this;

		rName = rName.toUpperCase();

		const sql = {
			query: `SHOW ${rName} STATUS WHERE Db = ?`,
			params: [database],
		};

		return self._mysql.query(sql.query, sql.params)
			.then(res => {
				const data = [];
				for(const item of res){
					data.push(item.Name);
				}

				return response(true, data);
			})
			.catch(error => {
				return response(false, error, true);
			});
	}

	/**
	 * Change definer's name and host according to configuration
	 * @params {string} query - query string conatining DEFINER clause
	 * @returns {string} query string with modified DEFINER clause
	 * */
	_changeDefiner(query){
		const self = this;

		return query.replace(
			/DEFINER=(.*?)\@(.*?)\s/,
			'DEFINER=`' + self._config.user + '`'
					+ '@`' + self._config.host + '` '
		);
	};

	/**
	 * Get all CREATE clauses for not table, e.g. FUNCTION
	 * @params {string} sql - entire sql string from file
	 * @returns {Object} results - CREATE queries
	 * @returns {string[]} results.functions - FUNCTION's CREATE queries
	 * @returns {string[]} results.procedures - PROCEDURE's CREATE queries
	 * @returns {string[]} results.triggers - TRIGGER's CREATE queries
	 * */
	getNonTableCreates(sql){
		const self = this;

		const results = {
			functions: [],
			procedures: [],
			triggers: [],
		};

		const getDelimiters = function(queries){
			let _delimiters = queries.match(/DELIMITER\s([\S]+)/gm);
			const delimiters = [];

			if(_delimiters){
				_delimiters = Array.from(new Set(_delimiters));
				const length = _delimiters.length;

				for(let idx = 0; idx < length; idx++){
					const delimiter = _delimiters[idx]
						.replace('DELIMITER', '')
						.trim();

					if(delimiter !== ';'){
						delimiters.push(delimiter);
					}
				}
			}

			return delimiters;
		};

		const escapeRegex = function(string) {
			return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
		};

		const removeDelimiters = function(queries, delimiter){
			const removed = [];
			for(const item of queries){
				const regex = new RegExp(
					'DELIMITER',
					'gim'
				);

				const trimmed = item
					.replace(regex, '')
					.split(delimiter)
					.filter(text => text.trim().length > 0);

				const length = trimmed.length;
				for(let idx = 0; idx < length; idx++){
					removed.push(self._changeDefiner(trimmed[idx]));
				}
			}

			return removed;
		};

		const tmp = [];
		for(const delimiter of getDelimiters(sql)){
			const escaped = escapeRegex(delimiter);
			const regex = new RegExp('DELIMITER\\s' + escaped
				+ '([^]*?)' + 'DELIMITER', 'gim');
			const matches = sql.match(regex);
			const trimmed = removeDelimiters(matches, delimiter);

			tmp.push(...trimmed);
		}

		for(const query of tmp){
			if(query.match(/\sPROCEDURE\s/i)) {
				results.procedures.push(query);
			} else if(query.match(/\FUNCTION\s/i)) {
				results.functions.push(query);
			} else if (query.match(/\sTRIGGER\s/i)) {
				results.triggers.push(query);
			}
		}

		return results;
	}

	/**
	 * Get table's name from query
	 * @private
	 * @params {string} type - query's type which table's name will be extracted
	 * @params {string} query - sql query
	 * @returns {string|null} tables - extracted table's name if presents
	 * */
	_getNameFromQuery(type, query){
		const self = this;

		if(typeof(query) != 'string'){
			return false;
		}

		type = type.toUpperCase();
		let match = null;

		switch(type){
		case 'ALTER':
			match = query.match(/ALTER[\s]+TABLE[\s]+(.*?)[\s\(]/im);
			break;

		case 'TABLE':
			match = query.match(/CREATE.*?TABLE\s+(?:IF.*?NOT.*?EXISTS){0,}.*?([\w]+)/im);
			break;

		case 'VIEW':
			match = query.match(/CREATE.*?VIEW[\s]+(.*?)[\s\(]/im);
			break;

		case 'PROCEDURE':
		case 'FUNCTION':
		case 'ROUTINE':
			match = query.match(/CREATE.*?(?:PROCEDURE|FUNCTION)[\s]+(.*?)[\s\(]/im);
			break;

		case 'INSERT':
			match = query.match(/INSERT\s+INTO[\s]+(.*?)[\s\(]+/im);
			break;

		default:
			break;
		}

		return match ? match[1].replace(/[^0-9a-zA-Z\$\_]/g, '') : null;
	};

	/**
	 * Get table's name from queries
	 * @private
	 * @params {string} type - query's type which table's name will be extracted
	 * @params {string[]} queries - array of sql queries with same type
	 * @returns {string[]} tables - extracted table's names if presents
	 * */
	_getNameFromQueries(type, queries){
		const self = this;

		const names = [];

		for(const query of queries){
			const name = self._getNameFromQuery(type, query);

			if(name){
				names.push(name);
			}
		}

		return names;
	};

	/**
	 * Convert INSERT statements with multiple values into multiple INSERT statements
	 * @private
	 * @params {string} query - INSERT statements with multiple values
	 * @returns {string[]} inserts - multiple INSERT statements
	 * */
	_insertMultipleToSingle(query){
		const self = this;
		const inserts = [];

		// split values inside query into array. max only 2 nested parentheses.
		// https://stackoverflow.com/a/35271017/3258981
		const matches = query.match(/\((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*\)/gim);
		if(!matches) return inserts;

		const table = self._getNameFromQuery('INSERT', query);
		const columns = query.match(/(\(.*?\))\s+VALUES\s+/mi);

		// if columns clause is found, shift the matches as it contains column names
		if(columns) matches.shift();

		for(const val of matches){
			inserts.push('INSERT INTO `' + table + '` '
				+ (columns ? columns[1] : '')
				+ ' VALUES ' + val + ';');
		}

		return inserts;
	}

	/**
	 * Convert ALTER statements with multiple values
	 * into multiple ALTER statements for each values
	 *
	 * The idea is if 1 query is failed, it won't affect another queries.
	 * Currently, only support ADD and MODIFY
	 *
	 * @private
	 * @params {string} query - ALTER statements with multiple values
	 * @returns {string[]} inserts - multiple ALTER statements
	 * */
	_alterMultipleToSingle(query){
		const self = this;

		// count how many times ADD or MODIFY appears in query
		const count = query.match(/(?:ADD|MODIFY)\s{0,}/gmi);

		// if there's only 1 appearance, return the same one
		if (!count || count?.length <= 1) return [ query ];

		const table = self._getNameFromQuery('ALTER', query);

		// regex components. It's too long for comfort
		const reg_REFERENCES = '(?:REFERENCES.*?\\(.*?\\)(?:\\s{1,}ON.*?(?:[\\w|\\s]+){0,}){0,}){0,}';
		const reg_USING = '(?:USING.*?(?:[\\w|\\s]+))';
		const reg_REFUSING = `(?:\\s{1,}${reg_REFERENCES}|${reg_USING}){0,}`;
		const reg_ADDMOD = `(?![^a-z])((?:ADD|MODIFY)\\s{0,}.*?\\(.*?\\)${reg_REFUSING})`;

		const regex = new RegExp(reg_ADDMOD, 'gmi');

		const matches = query.matchAll(regex);
		const alters = [];

		for (const match of matches) {
			alters.push('ALTER TABLE `' + table + '` ' + match[1]);
		}

		return alters;
	}

	/**
	 * GET all column's name from CREATE statements
	 * @private
	 * @params {string} query - INSERT statements with multiple values
	 * @returns {string[]} columns - list of column's name
	 * */
	_getColumnsFromCreateTable(query){

		const self = this;
		const columns = {};

		// split values inside query into array. max only 2 nested parentheses.
		// https://stackoverflow.com/a/35271017/3258981
		const matches = query.match(/\((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*\)/gim);
		if(!matches) return columns;

		const rawCols = matches[0].matchAll(/`(.*?)`\s(.*?)\n/gm);

		for(let col of rawCols){
			columns[col[1]] = col[2].replace(",","");
		}

		return columns;
	};

	/**
	 * GET all routine's name from FUNCTION, PROCEDURE AND TRIGGER statement
	 * @private
	 * @params {string} query - FUNCTION, PROCEDURE AND TRIGGER statements
	 * @returns {string} name - name of each statement
	 * */
	_parseQueryRoutine(query){
		const self = this;

		try{
			const parsedQuery = query.match(/\s(FUNCTION|PROCEDURE|TRIGGER)\s`(.*?)`/im);
			return parsedQuery[2];
		}catch(err){
			console.log(err);
			return "";
		}
	}

	/**
	 * Check if alter statement contains "PRIMARY KEY"
	 * @private
	 * @params {string} query - ALTER statements
	 * @returns {string} name - name of each statement
	 * */
	_checkAlterHasPrimary(query){
		const self = this;

		try{
			const parsedQuery = query.includes("ADD PRIMARY KEY");
			if (!parsedQuery) return false;

			const match = query.match(/ALTER TABLE `(.*?)`/im);

			if (!match) return false

			return match[1];
		}catch(err){
			console.error(err);
			return false;
		}
	}

	/**
	 * Move column definitions inside CREATE TABLE to alter
	 * @private
	 * @params {string} query - CREATE TABLE statements
	 * @returns {{query: string, alter: string[]}} stripped query and list of found ALTER query
	 * */
	_stripColumnDefinitionFromCreate(query) {
		const self = this;

		// remove whitespaces at the beginning of each line
		query = query.replace(/\n\s+/gmi, '\n');

		const regex = /^((PRIMARY KEY|UNIQUE KEY|KEY|CONSTRAINT)\s+(.*?)(?:(?:,$)|$))/gmi;

		const table = self._getNameFromQuery('TABLE', query);
		const matches = query.matchAll(regex);

		const alter = [];

		for(const match of matches) {
			query = query
				// remove column definition
				.replace(match[1], '')
				// remove empty lines
				.replace(/^\n|\r/gmi, '');

			// add column definitions into alter
			alter.push(`ALTER TABLE ${table} ADD ${match[2]} ${match[3]}`);
		}

		return { query, alter };
	}

	_parseColumnCreateQuery(query) {
		const reg_DEFAULT = '(?:\\s{1,}DEFAULT\\s+([^\\s]+)\\s{0,}){0,}';
		const reg_ISNULLABLE = '(?:\\s{1,}(NOT NULL|NULL)){0,}';
		const reg_UNSIGNED = '(?:\\s{1,}(UNSIGNED)){0,}';
		const reg_CHARACTER = '(?:\\s{1,}CHARACTER.*?SET\\s{1,}[\\w]+\\s{1,}[\\w]+\\s{1,}\\w+){0,}';
		const reg_FIRST = '^([\\w]+)(?:\\({0,}([\\d]+){0,}\\){0,})';
		const reg_FINISH = `${reg_FIRST}${reg_UNSIGNED}${reg_ISNULLABLE}${reg_CHARACTER}${reg_DEFAULT}`;

		const regex = new RegExp(reg_FINISH, 'mi');
		const match = query.match(regex);

		if (!match) return undefined;

		//~ console.log(match);

		const type = match[2] ? `${match[1]}(${match[2]})` : match[1];
		const isUnsigned = match[3] && match[3].toUpperCase() === 'UNSIGNED';

		const def = {
			key: undefined,
			type: isUnsigned ? `${type} unsigned` : type,
			isUnsigned,
			datatype: match[1],
			length: match[1] === 'varchar' && match[2] ? Number(match[2]) : 0,
			is_nullable: match[4] === 'NULL' || match[5] === 'NULL',
			default: match[5] || undefined,
		};

		return def;
	}

	_isColumnChanged({ now, old }) {
		for(const key in old) {
			// skip key, it's not set in query string
			if (key === 'key') continue;

			// no need to check any further
			if(now[key] !== old[key]) return false;
		}

		return true;
	}
	/**
	 * Remove tables and routines from connected database
	 * @params {boolean} [query=true] - should connection be closed after the process is done
	 * */
	async emptyDatabase(closeConnection = true){
		const self = this;

		if(!self._mysql){
			self._mysql = new _mariadb({
				...self._config,
				multipleStatements: true
			});
		}

		// drop all tables and routines first
		await self.dropAllTables(self._config.database);
		await self.dropRoutines(self._config.database);

		if(closeConnection){
			self.close();
		}
	}

	/**
	 * Get tables relationship indentified by FOREIGN KEYs
	 * @params {string} query - ALTER query
	 * @returns {Object} res - tables dependencies
	 * @returns {string} res.table - table's name
	 * @returns {string[]} res.dependencies - table's dependencies
	 * */
	getForeignKeyRelationship(query){
		const self = this;

		const table = self._getNameFromQuery('ALTER', query);
		const FKs = query.match(/FOREIGN\s+KEY\s+.*?\s+REFERENCES\s+(.*?)[\s\(]/gmi);

		const tDep = {
			table,
			dependencies: [],
		};

		if(!FKs){
			return tDep;
		}

		const sets = new Set();
		for(const fk of FKs){
			const tRelated = fk.match(/FOREIGN\s+KEY\s+.*?\s+REFERENCES\s+(.*?)[\s\(]/i);

			if(!tRelated) continue;

			sets.add(tRelated[1].replace(/[^0-9a-zA-Z\$\_]/g, ''));
		}

		tDep.dependencies = Array.from(sets);

		return tDep;
	}

	/**
	 * Get tables relationship from multiple ALTER queries
	 * @params {string} queries - ALTER queries
	 * @returns {Object} res - tables dependencies with table's name as key
	 * */
	getTableDependencies(queries){
		const self = this;

		// change to object to make it easier when trying to find dependencies
		const tObjDep = {};
		for(const query of queries){
			const tDep = self.getForeignKeyRelationship(query);
			tObjDep[tDep.table] = tDep.dependencies;
		}

		return tObjDep;
	}

	/**
	 * Sort tables by dependencies
	 * https://stackoverflow.com/a/54346588/3258981
	 * @params {string} queries - ALTER queries
	 * @returns {string[]} res - sorted table from less or no dependencies first
	 * */
	topologySortDependencies(queries){
		const self = this;

		const tDep = self.getTableDependencies(queries);
		const used = new Set;
		const results = [];
		let keys = Object.keys(tDep);
		let i, items, length;

		do {
			length = keys.length;
			items = [];
			keys = keys.filter(k => {
				if (!tDep[k].every(Set.prototype.has, used)) return true;
				items.push(k);
			});
			results.push(...items);
			items.forEach(Set.prototype.add, used);
		} while (keys.length && keys.length !== length);

		results.push(...keys);

		return results;
	}

	/**
	 * Load sql file content
	 * @params {string} SQL file's path
	 * */
	read(filepath){
		const self = this;

		self._contents = fs.readFileSync(filepath, 'utf8')
			// remove single line comments
			.replace(/(^-- (.*)[\n|\r])|(--)/gm, '')
			// remove empty lines
			.replace(/^\s*$(?:\r\n?|\n)/gm, '');

		return self;
	}

	/**
	 * set SQL content from string
	 * @params {string} String containing SQL queries
	 * */
	sql(contents){
		const self = this;

		self._contents = contents
			// remove single line comments
			.replace(/(^-- (.*)[\n|\r])|(--)/gm, '')
			// remove empty lines
			.replace(/^\s*$(?:\r\n?|\n)/gm, '');

		return self;
	}

	/**
	 * Parse sql file
	 * @params {string} filepath - sql file's path
	 * @returns {Object} res - parsed sql file
	 * @returns {Object} res.queries - consists of sql queries
	 * @returns {Object} res.names - consists of tables and routines names
	 * @returns {string[]} res.queries.functions - consists of FUNCTION CREATE queries
	 * @returns {string[]} res.queries.procedures - consists of PROCEDURE CREATE queries
	 * @returns {string[]} res.queries.triggers - consists of TRIGGER CREATE queries
	 * @returns {string[]} res.queries.table - consists of TABLE CREATE queries
	 * @returns {string[]} res.queries.alter - consists of ALTER TABLE queries
	 * @returns {string[]} res.queries.view - consists of CREATE VIEW queries
	 * @returns {Object} res.queries.inserts - consists of INSERT queries, with each query grouped by table's name as key
	 * @returns {string[]} res.queries.drop - consists of DROP queries
	 * @returns {string[]} res.queries.sort - sorted table names based on table's dependencies
	 * @returns {string[]} res.queries.misc - other queries which not correctly parsed
	 * */
	async parse(){
		const self = this;

		if(self._contents === undefined){
			throw 'SQL File is not loaded yet!';
		}

		const sql = self._contents;

		if(sql.error){
			throw 'SQL File is not loaded yet!';
		}

		const _queries = sql.split(';');

		const length = _queries.length;
		const queries = {
			...self.getNonTableCreates(sql),
			table: [],
			alter: [],
			view: [],
			insert: [],
			drop: [],
			sort: [],
			misc: [],
		};

		for(let idx = 0; idx < length; idx++){
			const query = _queries[idx].trim();

			if(query.match(/^INSERT\s/i)){
				const name = self._getNameFromQuery('INSERT', query);

				if(queries.insert[name] === undefined){
					queries.insert[name] = [];
				}

				queries.insert[name].push(query);
			} else if(query.match(/^ALTER\s/i)){
				const multiple = self._alterMultipleToSingle(query);
				queries.alter.push(...multiple);
			} else if(query.match(/^CREATE\s/i)){
				if(query.match(/\sVIEW\s/i)){
					queries.view.push(self._changeDefiner(query));
				} else if(query.match(/\sTABLE\s/i)){
					const name = self._getNameFromQuery('TABLE', query);

					if(queries.table[name] === undefined){
						queries.table[name] = [];
					}

					// strip col definitions from CREATE TABLE and add them into alter
					const stripped = self._stripColumnDefinitionFromCreate(query);
					queries.alter.push(...stripped.alter);
					queries.table[name].push(stripped.query);
				}
			} else if(query.match(/^(DROP\s)/i)){
				queries.drop.push(query);
			} else {
				queries.misc.push(query);
			}
		}

		const names = {
			tables: self._getNameFromQueries('TABLE', queries.table),
			views: self._getNameFromQueries('VIEW', queries.view),
			functions: self._getNameFromQueries('FUNCTION', queries.functions),
			procedures: self._getNameFromQueries('ROUTINE', queries.procedures),
		};

		queries.sort = self.topologySortDependencies(queries.alter);

		self._contents = undefined;

		return { queries, names };
	}

	async _processSameTables(queries, comparation) {
		const self = this;

		// get existing routines and trigger
		const existingRoutine = await self._mysql.query(`
			SELECT
				routine_name as name
			FROM information_schema.routines
			WHERE routine_schema = ?
		`, [ self._config.database ])
			.then(res => {
				const tmp = {};
				for(let i = 0; i < res.length; i++){
					tmp[res[i].name] = true;
				}
				return tmp;
			})
			.catch(err => {});

		const existingTrigger = await self._mysql.query(`
			SELECT
				trigger_name as name
			FROM information_schema.triggers
			WHERE trigger_schema = ?
		`, [ self._config.database ])
			.then(res => {
				const tmp = {};
				for(let i = 0; i < res.length; i++){
					tmp[res[i].name] = true;
				}
				return tmp;
			})
			.catch(err => {});

		// check duplicate routines and trigger, if it exist then remove new routines
		for(let i = 0; i < queries.procedures.length; i++){
			const query = queries.procedures[i];
			const name = self._parseQueryRoutine(query);

			if(existingRoutine[name]){
				queries.procedures.splice(i, 1);
			}
		}

		for(let i = 0; i < queries.functions.length; i++){
			const query = queries.functions[i];
			const name = self._parseQueryRoutine(query);

			if(existingRoutine[name]){
				queries.functions.splice(i, 1);
			}
		}

		for(let i = 0; i < queries.triggers.length; i++){
			const query = queries.triggers[i];
			const name = self._parseQueryRoutine(query);

			if(existingTrigger[name]){
				queries.triggers.splice(i, 1);
			}
		}

		// remove alter primary_key with same table
		let alterName = {};
		for(let i = 0; i < queries.alter.length; i++){
			const name = self._checkAlterHasPrimary(queries.alter[i]);
			if(name){
				alterName[name] = i;
			}
		}

		for(let table in comparation){

			// for existing table,
			// but has new columns, then
			// remove "create table" and "insert"  & replace it with "alter table"

			// for existing table,
			// but no new columns, then
			// only remove "create table" and "insert"
			delete queries.table[table];
			delete queries.insert[table];

			// remove alter with primary_key and same exist in current db
			if(alterName[table] >= 0){
				queries.alter.splice(alterName[table], 1);
			}

			if(comparation[table].new.length > 0){
				for(const column of comparation[table].new){
					queries.alter.unshift(
						"ALTER TABLE `"
						+ table
						+ "` ADD `"
						+ column.name
						+ "` "
						+ column.detail
					);
				}
			}
		}
	}

	async _compareTables(queries) {
		const self = this;

		const sameTables = {};

		// get existing table & columns
		const existing = await self._mysql.query(
				`SELECT
					table_name,
					column_name,
					column_key,
					column_type,
					data_type,
					character_maximum_length,
					is_nullable,
					column_default
				FROM information_schema.COLUMNS
				WHERE TABLE_SCHEMA = ?`,
				[ self._config.database ]
			)
			.then(res => {
				const tables = {};

				// grouping columns by it's table
				const tblLen = res.length;
				for(let i = 0; i < tblLen; i++){

					if (!res[i]) continue;

					const current = {
						table: res[i].table_name,
						column: res[i].column_name,
					};

					if(!tables[current.table]) tables[current.table] = {};

					const newObj = {
						[current.column]: {
							key: res[i].column_key || undefined,
							type: res[i].column_type,
							datatype: res[i].data_type,
							length: res[i].data_type === 'varchar'
								? Number(res[i].character_maximum_length)
								: 0,
							is_nullable: res[i].is_nullable.toUpperCase() === 'YES',
							default: res[i].column_default ?? undefined,
						},
					};

					Object.assign(tables[current.table], newObj);
				}

				return tables;
			})
			.catch(err => {
				console.log(err);
				return undefined;
			});

		// no need to go any further
		if (existing === undefined) return undefined;

		const list = [];

		// compare every existing tables
		for(const tbl of queries.sort){
			if(!existing[tbl] || !queries.table[tbl]) continue;

			// compare every columns in each tables
			const query = queries.table[tbl][0];
			const requested = self._getColumnsFromCreateTable(query);

			list[tbl] = {
				new: [],
				same: [],
				mod: [],
				nomore: Object.keys(existing[tbl]),
			};

			for(const reqCol in requested){
				const detail = requested[reqCol];

				const now = self._parseColumnCreateQuery(detail);
				const old = existing[tbl][reqCol];

				// column doesn't exist
				if (old === undefined) {
					list[tbl].new.push({ name: reqCol, detail: requested[reqCol] });
					continue;
				}

				// remove from no_more
				const idx = list[tbl].nomore.indexOf(reqCol);
				list[tbl].nomore[idx] = undefined;

				if (self._isColumnChanged({ now, old })) {
					list[tbl].same.push({ name: reqCol, detail });
				} else {
					list[tbl].mod.push({ name: reqCol, detail });
					console.log('---->', reqCol, { now, old }, detail);
				}
			}

			// remove undefine element fro array
			list[tbl].nomore = list[tbl].nomore.filter(x => x);
		}

		return list;
	}

	/**
	 * Import sql file into connected database
	 * @params {Object} options - options
	 * @params {boolean} [options.dropFirst=true] - whether perform wipe database first before import or not
	 * @params {boolean|string} [options.withData=true] - whether perform insert data or not. Set to 'single' to insert data individually
	 * @returns {string[]} failed - failed sql queries
	 * @returns {number} failed.code - sql error code
	 * @returns {string} failed.query - failed sql query
	 * */
	async importFile(options = {}){
		const self = this;

		if(!self._mysql){
			self._mysql = new _mariadb({
				...self._config,
				multipleStatements: true
			});
		}

		let { withData, dropFirst, closeConnection } = options;

		if (withData === undefined) withData = true;
		if (dropFirst === undefined) dropFirst = true;

		const execAll = async function(queries, verbose){
			const _failedQueries= [];

			for(const query of queries){
				try{
					const res = await self._mysql.query(
						query.match(/^INSERT\s/)
							? query
							: 'SET FOREIGN_KEY_CHECKS=0;' + query
					);

					if(verbose > 1){
						console.log(
							'\n================= QUERY ===================\n',
							query,
							'\n===========================================\n',
							res,
							'\n================ SUCCESS ==================\n',
						);
					}
				} catch(error) {
					if(verbose > 0){
						console.error(
							'\n+++++++++++++++++ QUERY +++++++++++++++++++\n',
							query,
							'\n+++++++++++++++++ +++++ +++++++++++++++++++\n',
							error,
							'\n+++++++++++++++++ ERROR +++++++++++++++++++\n',
						);
					}

					_failedQueries.push({
						code: error.errno,
						query,
					});
				}
			}

			return _failedQueries;
		};

		if(dropFirst){
			// drop all tables and routines first
			await self.emptyDatabase(false);
		}

		// group sql queries file into: table, non-table, data, and misc
		const parsed = await self.parse();

		if(!parsed){
			return { status: false, error: 'Error at parsing SQL File!' };
		}

		const { queries, names } = parsed;

		const { verbose } = self._config;
		const _failed = [];


		// compare existing table & column
		if(!dropFirst){
			const comparation = await self._compareTables(queries);
			self._processSameTables(queries, comparation);
		}

		// create db structure first
		_failed.push(... await execAll(queries.drop, verbose));

		// create tables first
		for(const tbl of queries.sort){
			const tQueries = queries.table[tbl];

			if(!tQueries) continue;

			const { length } = tQueries;

			// handle possible duplicate when creating tables without dropping them
			if (!dropFirst) {
				for (let idx = 0; idx < length; idx++) {
					tQueries[idx] = tQueries[idx].replace(
							/CREATE.*?TABLE/gmi,
							'CREATE TABLE IF NOT EXISTS'
						);
				}
			}

			_failed.push(... await execAll(tQueries, verbose));
		}

		// then create routine
		_failed.push(... await execAll(queries.functions, verbose));
		_failed.push(... await execAll(queries.procedures, verbose));

		// alter tables and create trigger at the end
		_failed.push(... await execAll(queries.alter, verbose));
		_failed.push(... await execAll(queries.triggers, verbose));

		// exported sql from phpmyadmin might already add view as table
		// drop them first
		for(const view of names.views){
			await self.dropTable(view);
		}

		_failed.push(... await execAll(queries.view, verbose));

		// add data
		if(withData){
			let insertedTbl = queries.sort;

			// If queries.sort is empty, then try to use keys from queries.insert
			// which is the name of each table.
			// This condition occurs, when sql file contains only insert query
			if(insertedTbl.length <= 0){
				insertedTbl = Object.keys(queries.insert);
			}

			for(const tbl of insertedTbl){
				const tQueries = queries.insert[tbl];

				if(!tQueries) continue;

				switch(withData){
				case 1:
				case true:
					_failed.push(... await execAll(tQueries, verbose));
					break;

				case 2:
				case 'SINGLE':
				case 'single':
					for(const item of tQueries){
						const singles = self._insertMultipleToSingle(item);
						_failed.push(... await execAll(singles, verbose));
					}
					break;

				default:
					break;
				}
			}
		}

		if(closeConnection === true) await self.close();

		return {
			status: _failed.length <= 0,
			error: _failed,
		};
	}
}

module.exports = new IMPORTER();
