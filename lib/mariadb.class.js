const mariadb = require('mariadb');
const crypto = require('crypto');

'use strict';

/**
 *	@param {string} msg - string to be hashed
 *	@returns {string} Hashed message
 * */
function SHA256(msg) {
	return crypto.createHash('sha256').update(msg).digest('hex');
}

class Database {
	constructor(config, rejectEmpty = false, limitQueryExecution = true) {
		this._config = config;
		this._rejectEmpty = config.rejectEmpty || rejectEmpty;
		this._limitQueryExecution = limitQueryExecution;
		// hashed connection info for connection id
		this._connectionHash = SHA256(`${config.host}${config.user}${config.database}`);

		// check if __sqlPools already declared, if not declare it as object
		if (global.__sqlPools === undefined) {
			global.__sqlPools = {};
		}
	};

	/**
	 *	Expose mariadb package
	 *	@returns {Object} current connection
	 * */
	connection() {
		return __sqlPools[this._connectionHash]
			? __sqlPools[this._connectionHash].getConnection()
			: undefined;
	};

	/**
	 *	Escape undefined in args as null. Preventing query execution from throwing error
	 * 	@param {string[]} args - arguments to be passed into query
	 * 	@returns {string[]} escaped args
	 * */
	escapeUndefined(args){
		if(!args instanceof Object){
			return args === undefined ? null : args;
		}

		for(const key in args){
			if(args[key] === undefined){
				args[key] = null;
			}
		}

		return args;
	};

	/**
	 *	Execute query with arguments
	 * 	@param {string} sql - sql query
	 * 	@param {string[]} args - escaped arguments to be passed into query (avoiding injection)
	 * 	@param {boolean} [dateStrings=true] - if false datetime columns will be returned as js Date object
	 * 	@returns {Object[]} sql query result
	 * */
	query(sql, args =[], stripMeta = true, dateStrings = true) {
		return new Promise(async (resolve, reject) => {
			//create pool and add it to global to minimize number of same connection in mysql
			if (!__sqlPools[this._connectionHash]) {
				__sqlPools[this._connectionHash] = await mariadb.createPool(this._config);
			}

			//just in case. Limit query executed only for data manipulation only
			if (this._limitQueryExecution && sql.match(/(GRANT|SHUTDOWN)($|[\s\;])/i)) {
				reject({
					errno: 0,
					msg: "SQL Query contains forbidden words : CREATE,TRUNCATE,GRANT,DROP,ALTER,SHUTDOWN",
				});

				return;
			}

			let con;
			try {
				con = await this.connection();
				const res = await con.query({ sql, dateStrings }, this.escapeUndefined(args));

				if (Array.isArray(res) && res.length == 0 && this._rejectEmpty) {
					reject({ code: 'EMPTY_RESULT' });
				} else {
					if(stripMeta){
						delete res.meta;
					}

					if(typeof(res.insertId) === 'bigint'){
						res.insertId = Number(res.insertId);
					}

					resolve(res);
				}
			} catch (error) {
				reject(error);
			} finally {
				if (con) {
					con.release();
				}
			}
		});
	};

	/**
	 *	Execute query batch with arguments
	 * 	@param {string} sql - sql query
	 * 	@param {string[]} args - escaped arguments to be passed into query (avoiding injection)
	 * 	@param {boolean} [dateStrings=true] - if false datetime columns will be returned as js Date object
	 * 	@returns {Object[]} sql query result
	 * */
	batch(sql, args, stripMeta = true, dateStrings = true) {
		return new Promise(async (resolve, reject) => {
			//create pool and add it to global to minimize number of same connection in mysql
			if (!__sqlPools[this._connectionHash]) {
				__sqlPools[this._connectionHash] = await mariadb.createPool(this._config);
			}

			//just in case. Limit query executed only for data manipulation only
			if (this._limitQueryExecution && sql.match(/(CREATE|TRUNCATE|GRANT|DROP|ALTER|SHUTDOWN)($|[\s\;])/i)) {
				reject({
					errno: 0,
					msg: "SQL Query contains forbidden words : CREATE,TRUNCATE,GRANT,DROP,ALTER,SHUTDOWN",
				});

				return;
			}

			let con;
			try {
				con = await this.connection();
				const res = await con.batch({ sql, dateStrings }, args);

				if (Array.isArray(res) && res.length == 0 && this._rejectEmpty) {
					reject({ code: 'EMPTY_RESULT' });
				} else {
					if(stripMeta){
						delete res.meta;
					}

					resolve(res);
				}
			}
			catch (error) {
				reject(error);
			}
			finally {
				if (con) {
					con.release();
				}
			}
		});
	};

	/**
	 *	Debug SQL query with arguments
	 * 	@param {string} sql - sql query
	 * 	@param {string[]} args - escaped arguments to be passed into query (avoiding injection)
	 * 	@returns {Object[]} sql query with arguments
	 * */
	debug(sql, args) {
		if(!Array.isArray(args)){
			args = [args];
		}

		for(const arg of args){
			if(sql.match(/\?/)){
				sql = sql.replace(/\?/, `"${arg}"`);
			} else {
				break;
			}
		}

		return sql.replace(/[\t\n\ ]+/g,' ');
	}

	/**
	 *	End current connection and delete it from global object
	 * */
	async end() {
		await __sqlPools[this._connectionHash].end();
		delete __sqlPools[this._connectionHash];
	};
}

module.exports = Database;
