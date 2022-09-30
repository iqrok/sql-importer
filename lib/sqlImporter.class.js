const fs = require('fs');
const _mariadb = require('./mariadb.class.js');

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

		self.config = undefined;
		self.mysql = undefined;

		if(config){
			self.init(config);
		}
	}

	init(config){
		const self = this;

		self.config = config;
		self.config.verbose = config.verbose !== undefined
			? Number(config.verbose)
			: 1;

		self.mysql = new _mariadb({...self.config, multipleStatements: true});

		return self;
	}

	async getAllTables(database){
		const self = this;

		const sql = {
				query: `SELECT table_name FROM information_schema.tables
					WHERE table_schema = ?`,
				params: [database],
			};

		return self.mysql.query(sql.query, sql.params)
			.then(res => {
				const data = [];
				for(const item of res){
					data.push(item.table_name);
				}

				return response(true, data);
			})
			.catch(error => {
				return response(false, error, true);
			});
	}

	async dropAllTables(database){
		const self = this;

		const tables = await self.getAllTables(database);

		if(!tables.status){
			return response(true, 'Db contains no Tables');
		}

		for(const name of tables.data){
			await self.mysql.query('SET FOREIGN_KEY_CHECKS=0;DROP TABLE `' + name + '`;SET FOREIGN_KEY_CHECKS=1;')
				.then(res => {
					console.log(res, `TABLE '${name}' is dropped!`);
				})
				.catch(error => {
					console.error(`TABLE '${name}' Error:`, error);
				});
		}
	};

	async dropNonTables(database){
		const self = this;

		const rFunctions = await self.getAllFunctions(database);
		if(!rFunctions.status){
			return response(true, 'Db contains no Functions');
		}

		for(const name of rFunctions.data){
			await self.mysql.query('SET FOREIGN_KEY_CHECKS=0;DROP FUNCTION IF EXISTS `'
					+ name + '`;SET FOREIGN_KEY_CHECKS=1;')
				.then(res => {
					console.log(res, `FUNCTION '${name}' is dropped!`);
				})
				.catch(error => {
					console.error(`FUNCTION '${name}' Error:`, error);
				});
		}

		const rProcedures = await self.getAllProcedures(database);
		if(!rProcedures.status){
			return response(true, 'Db contains no Procedures');
		}

		for(const name of rProcedures.data){
			await self.mysql.query('SET FOREIGN_KEY_CHECKS=0;DROP PROCEDURE IF EXISTS `'
					+ name + '`;SET FOREIGN_KEY_CHECKS=1;')
				.then(res => {
					console.log(res, `PROCEDURE '${name}' is dropped!`);
				})
				.catch(error => {
					console.error(`PROCEDURE '${name}' Error:`, error);
				});
		}
	};

	async getAllProcedures(database){
		const self = this;

		const sql = {
				query: `SHOW PROCEDURE STATUS WHERE Db = ?`,
				params: [database],
			};

		return self.mysql.query(sql.query, sql.params)
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

	async getAllFunctions(database){
		const self = this;

		const sql = {
				query: `SHOW FUNCTION STATUS WHERE Db = ?`,
				params: [database],
			};

		return self.mysql.query(sql.query, sql.params)
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

	getNonTableCreates(sql){
		const self = this;

		const results = {
				routines: [],
				triggers: [],
			};

		const getDelimiters = function(queries){
				let _delimiters = queries.match(/DELIMITER ([\S]+)/gm);
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

					for(let text of trimmed){
						text = text.replace(
								/DEFINER=(.*?)\@(.*?)\s/,
								'DEFINER=`' + self.config.user + '`'
									+ '@`' + self.config.host + '`'
							).trim();
					}

					removed.push(...trimmed);
				}

				return removed;
			};

		const tmp = [];
		for(const delimiter of getDelimiters(sql)){
			const escaped = escapeRegex(delimiter);
			const regex = new RegExp('DELIMITER ' + escaped
				+ '([^]*?)' + 'DELIMITER', 'gim');
			const matches = sql.match(regex);
			const trimmed = removeDelimiters(matches, delimiter);

			tmp.push(...trimmed);
		}

		for(const query of tmp){
			if(query.match(/ PROCEDURE|FUNCTION /i)) {
				results.routines.push(query);
			} else if (query.match(/ TRIGGER /i)) {
				results.triggers.push(query);
			}
		}

		return results;
	}

	async parse(filepath){
		const self = this;

		const sql = await fs.promises.readFile(filepath, 'utf8')
			.then(str => {
				return str
					// remove single line comments
					.replace(/(^-- (.*)[\n|\r])|(--)/gm, '')
					// remove empty lines
					.replace(/^\s*$(?:\r\n?|\n)/gm, '')
			})
			.catch(error => {
				return {error};
			});

		if(sql.error){
			console.error(error);
			return null;
		}

		const queries = sql.split(';');

		const length = queries.length;
		const type = {
				nonTable: self.getNonTableCreates(sql),
				table: [],
				view: [],
				data: [],
				drop: [],
				misc: [],
			};

		for(let idx = 0; idx < length; idx++){
			queries[idx] = queries[idx].trim();

			if(queries[idx].match(/^INSERT /i)){
				type.data.push(queries[idx]);
			} else if(queries[idx].match(/^(ALTER|CREATE)/i)
			){
				if(queries[idx].match(/ VIEW /i)){
					type.view.push(queries[idx]);
				} else {
					type.table.push(queries[idx]);
				}

			} else if(queries[idx].match(/^(DROP)/i)){
				type.drop.push(queries[idx]);
			} else {
				type.misc.push(queries[idx]);
			}
		}

		return type;
	}

	async emptyDatabase(){
		const self = this;

		// drop all tables and routines first
		await self.dropAllTables(self.config.database);
		await self.dropNonTables(self.config.database);
	};

	async importFile(filepath, withData = true){
		const self = this;

		const execAll = async function(queries, verbose, _retry = false){
			let status = true;
			for(let query of queries){
				try{
					const res = await self.mysql.query(query);
					status &= true;

					if(verbose > 1){
						console.log(
							query,
							'\nSuccess:',
							res,
							'\n-------------------------------------------\n'
						);
					}

					if(_retry){
						query = undefined;
					}
				} catch(error) {
					if(verbose > 0){
						console.error(
							query,
							'\nError:',
							error,
							'\n-------------------------------------------\n'
						);
					}

					status &= false;
				}
			}

			return {
				status,
				queries: queries.filter(x => x !== undefined),
			};
		};

		// drop all tables and routines first
		await self.emptyDatabase();

		// group sql queries file into: table, non-table, data, and misc
		const parsed = await self.parse(filepath);

		if(!parsed){
			console.error('Error at parsing SQL File!');
			return null;
		}

		// create db structure first
		const { verbose } = self.config;
		const iRoutines = await execAll(parsed.nonTable.routines, verbose);
		const iTables = await execAll(parsed.table, verbose);
		const iTriggers = await execAll(parsed.nonTable.triggers, verbose);
		const iViews = await execAll(parsed.view, verbose);

		if(!withData){
			return;
		}

		// add data
		let qData = parsed.data;
		for(let idx = 0; idx < 5; idx++){
			const iData = await execAll(qData, verbose, true);
			if(iData.status){
				break;
			}
			qData = iData.queries;
		}
	}
}

module.exports = new IMPORTER();
