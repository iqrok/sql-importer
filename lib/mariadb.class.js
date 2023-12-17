const mariadb = require('mariadb');
const crypto = require('crypto');

'use strict';

/**
 *	@param {string} msg - string to be hashed
 *	@returns {string} Hashed message
 * */
function SHA256(msg) {
    const hash = crypto.createHash('sha256');
    hash.update(msg);
    return hash.digest('hex')
}

class Database {
    constructor() {};

    lastCon = {}

    setConfig(config, rejectEmpty = false, limitQueryExecution = true){
        this._config = config;
        this._rejectEmpty = config.rejectEmpty || rejectEmpty;
        this._limitQueryExecution = limitQueryExecution;
        // hashed connection info for connection id
        this._connectionHash = SHA256(`${config.host}${config.user}${config.database}`);

        // check if __sqlPools already declared, if not declare it as object
        if (global.__sqlPools === undefined) {
            global.__sqlPools = {};
        }
    }

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
    query(sql, args, stripMeta = false, dateStrings = true, strict = true) {
        const self = this

        return new Promise(async (resolve, reject) => {
            //create pool and add it to global to minimize number of same connection in mysql
            
            const isSelectQuery = sql.trim().match(/^(SELECT)/i) ? true: false

            if (!__sqlPools[self._connectionHash]) {

                // if it select query then
                if(isSelectQuery){
                    __sqlPools[self._connectionHash] = await mariadb.createPool(self._config);
                }else{
                    reject({
                        errno: 1,
                        msg: "Use 'beginTransaction' before every query",
                    });
    
                    return
                }

            }
            
            //just in case. Limit query executed only for data manipulation only
            if (self._limitQueryExecution) {
                if(strict && sql.match(/(GRANT|SHUTDOWN)($|[\s\;])/i)){
                    reject({
                        errno: 0,
                        msg: "SQL Query contains forbidden words : CREATE,TRUNCATE,GRANT,DROP,ALTER,SHUTDOWN",
                    });
    
                    return;
                }
            }

            let con
            try {

                let res
                if(isSelectQuery){
                    con = await self.connection()
                    res = await con.query({ sql, dateStrings }, self.escapeUndefined(args));
                }else{
                    res = await self.lastCon.query({ sql, dateStrings }, self.escapeUndefined(args));    
                }

                if (Array.isArray(res) && res.length == 0 && self._rejectEmpty) {
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
                if (isSelectQuery) {
                    con?.release();
                }
            }
        })
    };

    /**
     *	Execute query batch with arguments
     * 	@param {string} sql - sql query
     * 	@param {string[]} args - escaped arguments to be passed into query (avoiding injection)
     * 	@param {boolean} [dateStrings=true] - if false datetime columns will be returned as js Date object
     * 	@returns {Object[]} sql query result
     * */
    batch(sql, args, stripMeta = true, dateStrings = true, strict = true) {
        const self = this

        return new Promise(async (resolve, reject) => {
            //create pool and add it to global to minimize number of same connection in mysql
            
            const isSelectQuery = sql.trim().match(/^(SELECT)/i) ? true: false

            if (!__sqlPools[self._connectionHash]) {

                // if it select query then
                if(isSelectQuery){
                    __sqlPools[self._connectionHash] = await mariadb.createPool(self._config);
                }else{
                    reject({
                        errno: 1,
                        msg: "Use 'beginTransaction' before every query",
                    });
    
                    return
                }

            }
            
            //just in case. Limit query executed only for data manipulation only
            if (self._limitQueryExecution) {
                if(strict && sql.match(/(CREATE|TRUNCATE|GRANT|DROP|ALTER|SHUTDOWN)($|[\s\;])/i)){
                    reject({
                        errno: 0,
                        msg: "SQL Query contains forbidden words : CREATE,TRUNCATE,GRANT,DROP,ALTER,SHUTDOWN",
                    });
    
                    return;
                }
            }

            try {

                if(isSelectQuery){
                    self.lastCon = await self.connection()
                }

                const res = await self.lastCon.batch({ sql, dateStrings }, self.escapeUndefined(args));

                if (Array.isArray(res) && res.length == 0 && self._rejectEmpty) {
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
                if ("release" in self.lastCon && isSelectQuery) {
                    self.lastCon.release();
                }
            }
        })
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
     *	Begin transaction,
     *  transaction is important to rollback all change if there are any error
     *  in queries. Set it on every beginning of process.
     * */
    async beginTransaction(){
        const self = this

        //create pool and add it to global to minimize number of same connection in mysql
        if (!__sqlPools[self._connectionHash]) {
            __sqlPools[self._connectionHash] = await mariadb.createPool(self._config);
        }
        
        try {
            this.lastCon = await self.connection();
            return await this.lastCon.beginTransaction();
        }
        catch (error) {
            if (this.lastCon) {
                this.lastCon.release();
            }
            
            return error
        }
    }

    /**
     *	Commit
     *  If there are no error, then execute it normally.
     *  Set it on every end of process.
     * */
    async commit(){
        const self = this

        return new Promise(async (resolve, reject) => {
            if (!__sqlPools[self._connectionHash]) {
                return reject({
                    errno: 1,
                    msg: "Use 'beginTransaction' before every query",
                });
            }

            const result = await self.lastCon.commit()

            if ("release" in self.lastCon) {
                self.lastCon.release();
            }

            return resolve(result)
        })
    }

    /**
     *	Rollback
     *  If there are error, then execute undo every queries.
     *  Set it on every try "catch" of process.
     * */
    async rollback(){
        const self = this

        return new Promise(async (resolve, reject) => {
			if (!__sqlPools[self._connectionHash]) {
				return reject({
					errno: 1,
                    msg: "Use 'beginTransaction' before every query",
                });
				
            }
			
            const result = await self.lastCon.rollback()

            if ("release" in self.lastCon) {
                self.lastCon.release();
            }

            return resolve(result)
        })
    }

    /**
     *	escape string as parameter on query to check if string contains sql injection
     * 	@param {string} string - string that will be part of query
     * 	@returns {string} - string that already be escaped
     * */
    escape(string) {
        return this.connection().escape(string);
    }

    /**
     *	End current connection and delete it from global object
     * */
    async end() {
        await __sqlPools[this._connectionHash].end();
        delete __sqlPools[this._connectionHash];
    };

    /**
     *	End all connection and delete it from global object
     * */
    async endAll(){
        try{
            for(let connection in __sqlPools){
                await __sqlPools[connection].end();
                delete __sqlPools[connection];
            }
        }catch(err){}
    }


}

module.exports = new Database();
