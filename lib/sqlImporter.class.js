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

		return self;
	}

	close(){
		const self = this;

		if(self.mysql){
			self.mysql.end();
			self.mysql = undefined;
		}
	}

	getAllTables(){
		const self = this;

		return self.mysql.query(`SHOW TABLES`)
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

	dropTable(name){
		const self = this;

		const { verbose } = self.config;
		const query = 'SET FOREIGN_KEY_CHECKS=0;'
				+ 'DROP TABLE IF EXISTS `' + name + '`;'
				+ 'DROP VIEW IF EXISTS `' + name + '`;'
				+ 'SET FOREIGN_KEY_CHECKS=1;';

		return self.mysql.query(query)
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

	async dropNonTables(database){
		const self = this;

		const { verbose } = self.config;

		const rFunctions = await self.getAllFunctions(database);
		if(!rFunctions.status){
			return response(true, 'Db contains no Functions');
		}

		for(const name of rFunctions.data){
			await self.mysql.query('SET FOREIGN_KEY_CHECKS=0;DROP FUNCTION IF EXISTS `'
					+ name + '`;SET FOREIGN_KEY_CHECKS=1;')
				.then(res => {
					if(verbose > 1){
						console.log(
							'\n================= DROP ====================\n',
							`FUNCTION '${name}' is DROPPED`,
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
							`Failed at dropping FUNCTION '${name}'`,
							'\n++++++++++++++++++++++++++++++++++++++++++\n',
							error,
							'\n++++++++++++++++ ERROR +++++++++++++++++++\n',
						);
					}
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
					if(verbose > 1){
						console.log(
							'\n================= DROP ====================\n',
							`PROCEDURE '${name}' is DROPPED`,
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
							`Failed at dropping PROCEDURE '${name}'`,
							'\n++++++++++++++++++++++++++++++++++++++++++\n',
							error,
							'\n++++++++++++++++ ERROR +++++++++++++++++++\n',
						);
					}
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

	_changeDefiner(query){
		const self = this;

		return query.replace(
				/DEFINER=(.*?)\@(.*?)\s/,
				'DEFINER=`' + self.config.user + '`'
					+ '@`' + self.config.host + '` '
			);
	};

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

	_getNameFromQuery(type, query){
		const self = this;

		if(typeof(query) != 'string'){
			return false;
		}

		type = type.toUpperCase();
		let match = null;

		switch(type){
			case 'TABLE':
				match = query.match(/CREATE[\s]+TABLE[\s]+(.*?)[\s\(]/im);
				break;

			case 'VIEW':
				match = query.match(/CREATE.*?VIEW[\s]+(.*?)[\s\(]/im);
				break;

			case 'ROUTINE':
				match = query.match(/CREATE.*?(?:PROCEDURE|FUNCTION)[\s]+(.*?)[\s\(]/im);
				break;

			default:
				break;
		}

		return match ? match[1].replace(/[^0-9a-zA-Z\$\_]/g, '') : null;
	};

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
			console.error(sql.error);
			return null;
		}

		const _queries = sql.split(';');

		const length = _queries.length;
		const queries = {
				nonTable: self.getNonTableCreates(sql),
				table: [],
				view: [],
				data: [],
				drop: [],
				misc: [],
			};

		for(let idx = 0; idx < length; idx++){
			_queries[idx] = _queries[idx].trim();

			if(_queries[idx].match(/^INSERT /i)){
				queries.data.push(_queries[idx]);
			} else if(_queries[idx].match(/^(ALTER|CREATE)/i)){
				if(_queries[idx].match(/ VIEW /i)){
					queries.view.push(self._changeDefiner(_queries[idx]));
				} else {
					queries.table.push(_queries[idx]);
				}
			} else if(_queries[idx].match(/^(DROP)/i)){
				queries.drop.push(_queries[idx]);
			} else {
				queries.misc.push(_queries[idx]);
			}
		}

		const names = {
			tables: self._getNameFromQueries('TABLE', queries.table),
			views: self._getNameFromQueries('VIEW', queries.view),
			routines: self._getNameFromQueries('ROUTINE', queries.nonTable.routines),
		};

		return { queries, names };
	}

	async emptyDatabase(closeConnection = true){
		const self = this;

		if(!self.mysql){
			self.mysql = new _mariadb({
					...self.config,
					multipleStatements: true
				});
		}

		// drop all tables and routines first
		await self.dropAllTables(self.config.database);
		await self.dropNonTables(self.config.database);

		if(closeConnection){
			self.close();
		}
	};

	async importFile(filepath, options = {}){
		const self = this;

		if(!self.mysql){
			self.mysql = new _mariadb({
					...self.config,
					multipleStatements: true
				});
		}

		let { withData, dropFirst } = options;

		if(withData === undefined){
			withData = true;
		}

		if(dropFirst === undefined){
			dropFirst = true;
		}

		const execAll = async function(queries, verbose, _retry = false){
			let status = true;
			for(let query of queries){
				try{
					const res = await self.mysql.query(query);
					status &= true;

					if(verbose > 1){
						console.log(
							'\n================= QUERY ===================\n',
							query,
							'\n===========================================\n',
							res,
							'\n================ SUCCESS ==================\n',
						);
					}

					if(_retry){
						query = undefined;
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

					status &= false;
				}
			}

			return {
				status,
				queries: queries.filter(x => x !== undefined),
			};
		};

		if(dropFirst){
			// drop all tables and routines first
			await self.emptyDatabase(false);
		}

		// group sql queries file into: table, non-table, data, and misc
		const parsed = await self.parse(filepath);

		if(!parsed){
			console.error('Error at parsing SQL File!');
			return null;
		}

		const { queries, names } = parsed;

		// create db structure first
		const { verbose } = self.config;

		// always drop if drop query exists in file
		const iDrops = await execAll(queries.drop, verbose);

		const iRoutines = await execAll(queries.nonTable.routines, verbose);
		const iTables = await execAll(queries.table, verbose);
		const iTriggers = await execAll(queries.nonTable.triggers, verbose);

		// exported sql from phpmyadmin might already add view as table
		// drop them first
		for(const view of names.views){
			await self.dropTable(view);
		}

		const iViews = await execAll(queries.view, verbose);

		if(!withData){
			return;
		}

		// add data
		let qData = queries.data;
		for(let idx = 0; idx < 5; idx++){
			const iData = await execAll(qData, verbose, true);
			if(iData.status){
				break;
			}
			qData = iData.queries;
		}

		self.close();
	}
}

module.exports = new IMPORTER();
