/**
 * @file sqlImporter.class.js
 * */
const fs = require('fs');
const _mariadb = require('./mariadb.class.js');

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
} = require('./functions.lib.js');

/**
 * @defgroup SQLImporter SQL Importer
 * @brief Import SQL database from a file.
 * */

/**
 * Error from process.
 * @typedef {(string|Object|string[]|Object[])} resError
 */

/**
 * returned data from process.
 * @typedef {(string|Object|string[]|Object[])} resData
 */

/**
 * Colum Comparation detail
 * @typedef {Object} ColCompDetail
 * @property {string} name - column name
 * @property {string} detail - column detail, i.e. 'INT NOT NULL'
 */

/**
 * Table Comparation result
 * @typedef {Object} TableCompare
 * @property {ColCompDetail[]} new - new columns in the table
 * @property {ColCompDetail[]} same - same columns in the table
 * @property {ColCompDetail[]} mod - modified columns in the table
 * @property {String[]} nomore - SQL Error number
 */

/**
 * Response object with status, data and error
 * @ingroup SQLImporter
 * @typedef {Object} Response
 * @property {boolean} status - indicates whether the process run successfully or not.
 * @property {resError|undefined} error - presents if status is false, otherwise it's undefined.
 * @property {resData|undefined} data - presents if status is true, otherwise it's undefined.
 */
function response(status, content, debug = false){
	status = Boolean(status);

	if(debug) status ? console.log(content) : console.error(content);

	return status
		? {status, data: content}
		: {status, error: content};
}
/**
 * @ingroup SQLImporter
 * @class SQL_IMPORTER lib/sqlImporter.class.js
 */
class SQL_IMPORTER {
	/**
	 * @var DATABASE _mysql
	*/
	_mysql = undefined;

	/**
	 * @private
	 * */
	constructor(config){
		const self = this;

		self._config = undefined;

		self._contents = undefined;

		if(config) self.init(config);
	}

	/**
	 * Initiatlize instance with config
	 *
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
	 *
	 * @async
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
	 *
	 * @private
	 * @async
	 * @returns {Response} response - response from mysql query
	 * @returns {string[]} response.data - array of tables' names
	 * */
	_getAllTables(){
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
	 *
	 * @private
	 * @async
	 * @param {string} name - table's name
	 * */
	_dropTable(name){
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
	 *
	 * @private
	 * @param database **[string]** Database name
	 * @returns {Response|undefined} response - will return response if error is encountered
	 * */
	async _dropAllTables(database){
		const self = this;

		const tables = await self._getAllTables();

		if(!tables.status){
			return response(true, 'Db contains no Tables');
		}

		for(const name of tables.data){
			await self._dropTable(name);
		}
	}

	/**
	 * Drop all routines from connected database
	 *
	 * @private
	 * @param database **[string]** Database name
	 * @returns {Response|undefined} response - will return response if error is encountered
	 * */
	async _dropRoutines(database){
		const self = this;

		const { verbose } = self._config;

		for(const rName of [ 'FUNCTION', 'PROCEDURE' ]){
			const rRoutines = await self._getAllRoutines(database, rName);

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
	 *
	 * @private
	 * @param database **[string]** Database name
	 * @returns {Response} response
	 * @returns {string[]} response.data - array of routines' names
	 * */
	async _getAllRoutines(database, rName){
		const self = this;

		rName = rName.toUpperCase();

		const _sql = {
			query: `SHOW ${rName} STATUS WHERE Db = ?`,
			params: [ database ],
		};

		return self._mysql.query(_sql.query, _sql.params)
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
	 * Remove tables and routines from connected database
	 *
	 * @async
	 * @param {boolean} [query=true] - should connection be closed after the process is done
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
		await self._dropAllTables(self._config.database);
		await self._dropRoutines(self._config.database);

		if(closeConnection){
			self.close();
		}
	}

	/**
	 * Load sql file content
	 *
	 * @param filepath `string` - SQL file's path
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
	 *
	 * @param contents **[string]** - String containing SQL queries
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
	 * Parse sql file. Either #read or #sql must be called before.
	 *
	 * @async
	 * @return res {#ParsedQuery} - parsed sql file
	 * */
	async parse(){
		const self = this;

		if(!self._contents) throw 'SQL File is not loaded yet!';

		const parsed = parseSQLInput(self._contents, self._config);

		self._contents = undefined;

		return parsed;
	}

	/**
	 * Process table comparation result.
	 *
	 * @async
	 * @private
	 * @param {ParsedQuery} queries - Parsed SQL contents.
	 * @param {TableCompare} comparation - Table comparation result.
	 * */
	async _processSameTables(queries, comparation) {
		const self = this;

		// get existing routines and trigger
		const existingRoutine = await self._mysql.query(
				`SELECT
					routine_name as name
				FROM information_schema.routines
				WHERE routine_schema = ?`,
				[ self._config.database ]
			)
			.then(res => {
				const tmp = {};
				for(let i = 0; i < res.length; i++){
					tmp[res[i].name] = true;
				}
				return tmp;
			})
			.catch(err => {});

		const existingTrigger = await self._mysql.query(
				`SELECT
					trigger_name as name
				FROM information_schema.triggers
				WHERE trigger_schema = ?`,
				[ self._config.database ]
			)
			.then(res => {
				const tmp = {};
				for(let i = 0; i < res.length; i++){
					tmp[res[i].name] = true;
				}
				return tmp;
			})
			.catch(err => {});

		// FIXME: What if new procedures has different contents?
		// check duplicate routines and trigger, if it exist then remove new routines
		for(let i = 0; i < queries.procedures.length; i++){
			const query = queries.procedures[i];
			const name = parseQueryRoutine(query);

			if(existingRoutine[name]){
				queries.procedures.splice(i, 1);
			}
		}

		// FIXME: What if new functions has different contents?
		for(let i = 0; i < queries.functions.length; i++){
			const query = queries.functions[i];
			const name = parseQueryRoutine(query);

			if(existingRoutine[name]){
				queries.functions.splice(i, 1);
			}
		}

		// FIXME: What if new triggers has different contents?
		for(let i = 0; i < queries.triggers.length; i++){
			const query = queries.triggers[i];
			const name = parseQueryRoutine(query);

			if(existingTrigger[name]){
				queries.triggers.splice(i, 1);
			}
		}

		// remove alter primary_key in the same table
		let alterName = {};
		for(let i = 0; i < queries.alter.length; i++){
			const name = checkAlterHasPrimary(queries.alter[i]);
			if(name) alterName[name] = i;
		}

		for(let table in comparation){
			/*
			 * if existing table:
			 *
			 * - has new columns,
			 *   then remove "create table" and "insert"
			 *   & replace it with "alter table"
			 *
			 * - has no new columns
			 *   then only remove "create table" and "insert"
			 * */
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

	/**
	 * Compare tables from provided queries with exisiting ones inside database.
	 *
	 * @async
	 * @private
	 * @param {Queries} queries - Parsed SQL content.
	 * @returns {TableCompare} Table Comparation result.
	 * */
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
				console.error('_compareTables', err);
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
			const requested = getColumnsFromCreateTable(query);

			list[tbl] = {
				new: [],
				same: [],
				mod: [],
				nomore: Object.keys(existing[tbl]),
			};

			for(const reqCol in requested){
				const detail = requested[reqCol];

				const now = parseColumnCreateQuery(detail);
				const old = existing[tbl][reqCol];

				// column doesn't exist
				if (old === undefined) {
					list[tbl].new.push({ name: reqCol, detail });
					continue;
				}

				// remove from no_more
				const idx = list[tbl].nomore.indexOf(reqCol);
				list[tbl].nomore[idx] = undefined;

				if (isColumnIdentical(now, old)) {
					list[tbl].same.push({ name: reqCol, detail });
				} else {
					list[tbl].mod.push({ name: reqCol, detail });
				}
			}

			// remove undefine element fro array
			list[tbl].nomore = list[tbl].nomore.filter(x => x);
		}

		return list;
	}

	/**
	 * Execute queries.
	 *
	 * @private
	 * @param queries {**string[]**} List of SQL Queries.
	 * @param verbose {**number**}   Verbosity level.
	 * @returns {#FailedQuery[]} List of failed queries.
	 * */
	async _execute(queries, verbose){
		const self = this;

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
					msg: error.sqlMessage,
					query,
				});
			}
		}

		return _failedQueries;
	};

	/**
	 * Import sql file into connected database
	 *
	 * @param options {#ImportOptions} Import options	 *
	 * @returns {#FailedQuery[]} List of failed queries from all parts.
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

		if(dropFirst){
			// execute drop queries if any
			_failed.push(... await self._execute(queries.drop, verbose));
		} else {
			// compare existing table & column
			const comparation = await self._compareTables(queries);
			self._processSameTables(queries, comparation);
		}

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

			_failed.push(... await self._execute(tQueries, verbose));
		}

		// then create routine
		_failed.push(... await self._execute(queries.functions, verbose));
		_failed.push(... await self._execute(queries.procedures, verbose));

		// alter tables and create trigger at the end
		_failed.push(... await self._execute(queries.alter, verbose));
		_failed.push(... await self._execute(queries.triggers, verbose));

		// exported sql from phpmyadmin might already add view as table
		// drop them first
		for(const view of names.views){
			await self._dropTable(view);
		}

		_failed.push(... await self._execute(queries.view, verbose));

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
					_failed.push(... await self._execute(tQueries, verbose));
					break;

				case 2:
				case 'SINGLE':
				case 'single':
					for(const item of tQueries){
						const item = tQueries[idx];
						const singles = insertMultipleToSingle(item);
						_failed.push(... await self._execute(singles, verbose));
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
			error:  _failed.length <= 0 ? undefined : _failed,
		};
	}
}

module.exports = SQL_IMPORTER;
