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
				match = query.match(/CREATE[\s]+TABLE[\s]+(.*?)[\s\(]/im);
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
	};

	/**
	 * GET all column's name from CREATE statements 
	 * @params {string} query - INSERT statements with multiple values
	 * @returns {string[]} columns - list of column's name
	 * */
	_getColumnsFromCreateTable(query){
		
		const self = this
		const columns = {}

		// split values inside query into array. max only 2 nested parentheses.
		// https://stackoverflow.com/a/35271017/3258981
		const matches = query.match(/\((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*\)/gim);
		if(!matches) return columns;

		const rawCols = matches[0].matchAll(/`(.*?)`\s(.*?)\n/gm)

		for(let col of rawCols){
			columns[col[1]] = col[2].replace(",","")
		}

		return columns
	};

	/**
	 * GET all routine's name from FUNCTION, PROCEDURE AND TRIGGER statement
	 * @params {string} query - FUNCTION, PROCEDURE AND TRIGGER statements
	 * @returns {string} name - name of each statement
	 * */
	_parseQueryRoutine(query){
		const self = this

		try{
			const parsedQuery = query.match(/\s(FUNCTION|PROCEDURE|TRIGGER)\s`(.*?)`/im);
			return parsedQuery[2]
		}catch(err){
			console.log(err)
			return ""
		}
	}

	/**
	 * Check if alter statement contains "PRIMARY KEY"
	 * @params {string} query - ALTER statements
	 * @returns {string} name - name of each statement
	 * */
	_checkAlterHasPrimary(query){
		const self = this

		try{
			let parsedQuery = query.includes("ADD PRIMARY KEY");
			if(!parsedQuery){
				return false
			}
			
			parsedQuery = query.match(/ALTER TABLE `(.*?)`/im)

			return parsedQuery[1] || false
		}catch(err){
			console.log(err)
			return false
		}
	}

	/**
	 * Remove tables and routines from connected database
	 * @params {boolean} [query=true] - should connection be closed after the process is done
	 * */
	async emptyDatabase(closeConnection = true){
		const self = this;

		if(!self._mysql){
			self._mysql = _mariadb
			self._mysql.setConfig({
				...self._config,
				multipleStatements: true
			})
		}

		
		try{
			await self._mysql.beginTransaction()
			
			// drop all tables and routines first
			await self.dropAllTables(self._config.database);
			await self.dropRoutines(self._config.database);

			await self._mysql.commit()
		}catch(err){
			await self._mysql.rollback()
		}

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
		} while (keys.length && keys.length !== length)

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
				queries.alter.push(query);
			} else if(query.match(/^CREATE\s/i)){
				if(query.match(/\sVIEW\s/i)){
					queries.view.push(self._changeDefiner(query));
				} else if(query.match(/\sTABLE\s/i)){
					const name = self._getNameFromQuery('TABLE', query);

					if(queries.table[name] === undefined){
						queries.table[name] = [];
					}

					queries.table[name].push(query);
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

		if(!self._mysql || !self._mysql?._config){
			self._mysql = _mariadb
			self._mysql.setConfig({
				...self._config,
				multipleStatements: true
			})
		}

		// start transaction
		// although transaction only work for DML (https://github.com/iqrok/sql-importer/issues/5)
		await self._mysql.beginTransaction()

		let { withData, dropFirst, closeConnection, compareExisting, schemaUpdateClearData } = options;

		if(withData === undefined){
			withData = true;
		}

		if(dropFirst === undefined){
			dropFirst = true;
		}

		if(compareExisting === undefined){
			compareExisting = false;
		}

		// if true then it will clear data before update schema
		// if false then it will ignore error
		if(schemaUpdateClearData === undefined){
			schemaUpdateClearData = false;
		}

		const execAll = async function(queries, verbose){
			const _failedQueries= []

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
		if(compareExisting){

			// get existing table & columns
			const getExistTables = await self._mysql.query(`
			SELECT table_name, column_name, 
			CONCAT(
				IF(column_type IS NULL, "", CONCAT(column_type, " ")), 
				IF(is_nullable = "YES", "NULL", "NOT NULL"), 
				IF(column_default IS NULL, "", CONCAT(" DEFAULT ", column_default))
			) as columnDetail
			FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA = ?
			`,[self._config.database])
			.then(res => {

				const tables = {}

				// grouping columns by it's table
				for(let i = 0; i < res.length; i++){

					const curTbl = res[i]?.table_name
					const curCol = res[i]?.column_name

					if(!(curTbl in tables)){
						tables[curTbl] = {}
					}

					const newObj = {}
					newObj[curCol] = res[i].columnDetail

					Object.assign(tables[curTbl], newObj)

				}

				return tables
			})
			.catch(err => {
				console.log(err)
				return {}
			})

			// compare every existing tables
			const sameTables = {}
			
			for(let tbl of queries.sort){
				if(getExistTables[tbl] && queries.table[tbl]){

					sameTables[tbl] = []
					// compare every columns in each tables
					const columns = self._getColumnsFromCreateTable(queries.table[tbl][0])
					for(let column in columns){


						// if column not found on existing table then
						if(!(column in getExistTables[tbl])){
							sameTables[tbl].push({
								name: column,
								detail: columns[column],
								isUpdate: false
							})

						// if column found on existing table, but has different detail, then
						} else if((column in getExistTables[tbl]) && getExistTables[tbl][column] != columns[column]){
							sameTables[tbl].push({
								name: column,
								detail: columns[column],
								isUpdate: true,
								previousDetail: getExistTables[tbl][column]
							})
						}
					}
					
				}
			}

			if(Object.keys(sameTables).length > 0){

				// get existing routines and trigger
				const existingRoutine = await self._mysql.query(`
					SELECT 
						routine_name as name
					FROM information_schema.routines 
					WHERE routine_schema = ?
				`,[self._config.database])
				.then(res => {
					const tmp = {}
					for(let i = 0; i < res.length; i++){
						tmp[res[i].name] = true
					}
					return tmp
				})
				.catch(err => {})

				const existingTrigger = await self._mysql.query(`
					SELECT 
						trigger_name as name
					FROM information_schema.triggers 
					WHERE trigger_schema = ?
				`,[self._config.database])
				.then(res => {
					const tmp = {}
					for(let i = 0; i < res.length; i++){
						tmp[res[i].name] = true
					}
					return tmp
				})
				.catch(err => {})


				// check duplicate routines and trigger, if it exist then remove new routines
				for(let i = 0; i < queries.procedures.length; i++){
					const query = queries.procedures[i]
					const name = self._parseQueryRoutine(query)

					if(existingRoutine[name]){
						queries.procedures.splice(i, 1)
					}
				}

				for(let i = 0; i < queries.functions.length; i++){
					const query = queries.functions[i]
					const name = self._parseQueryRoutine(query)

					if(existingRoutine[name]){
						queries.functions.splice(i, 1)
					}
				}

				for(let i = 0; i < queries.triggers.length; i++){
					const query = queries.triggers[i]
					const name = self._parseQueryRoutine(query)

					if(existingTrigger[name]){
						queries.triggers.splice(i, 1)
					}
				}


				// remove alter primary_key with same table
				let alterName = {}
				for(let i = 0; i < queries.alter.length; i++){
					const name = self._checkAlterHasPrimary(queries.alter[i])
					if(name){
						alterName[name] = i
					}
				}



				for(let table in sameTables){
					
					// for existing table,
					// but has new columns, then
					// remove "create table" and "insert"  & replace it with "alter table"

					// for existing table,
					// but no new columns, then
					// only remove "create table" and "insert" 
					delete queries.table[table]
					delete queries.insert[table]

					// remove alter with primary_key and same exist in current db
					if(alterName[table] >= 0){
						queries.alter.splice(alterName[table], 1)
					}


					if(sameTables[table].length > 0){
						// console.log("========UPDATE SCHEMA==========")
						for(let column of sameTables[table]){
							if(column.isUpdate){
								// console.log(table, column)
								if(schemaUpdateClearData){
									await execAll([
										"UPDATE `"+table+"` SET `"+column.name+"` = NULL"
									], verbose)
								}

								queries.alter.unshift("ALTER TABLE `"+table+"` CHANGE `"+column.name+"` `"+column.name+"` "+column.detail)
							}else{
								queries.alter.unshift("ALTER TABLE `"+table+"` ADD `"+column.name+"` "+column.detail)
							}
						}
						// console.log("==================")
					}

				}

			}

		}


		// create db structure first
		_failed.push(... await execAll(queries.drop, verbose));

		// create tables first
		for(const tbl of queries.sort){
			const tQueries = queries.table[tbl];

			if(!tQueries) continue;

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
		
		if(_failed.length > 0){
			await self._mysql.rollback()
		}else{
			await self._mysql.commit()
		}

		if(closeConnection === true) await self.close();

		return {
				status: _failed.length <= 0,
				error: _failed,
			};
	}
}

module.exports = new IMPORTER();
