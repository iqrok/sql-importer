/**
 * @file lib/conn.lib.js
 * */

/**
 * @defgroup CONN_FUNC Conn Functions
 * @brief MariaDB connector Helper Functions.
 * */

const _mariadb = require('./mariadb.class.js');

/**
 * Response object with status, data and error
 *
 * @ingroup CONN_FUNC
 * @param status {**bool**} response status.
 * @param content {**any**} response content.
 * @param debug {**bool**} to print content or not.
 *
 * @returns {#ConnResponse} Response
 */
function response(status, content, debug = false){
	status = Boolean(status);

	if(debug) status ? console.log(content) : console.error(content);

	return status
		? {status, data: content}
		: {status, error: content};
}

/**
 * close and delete database connection
 *
 * @ingroup CONN_FUNC
 * @param conn Database connection to close.
 *
 * @return the connection itself
 * */
async function close(conn){
	if(conn){
		await conn.end();
		conn = undefined;
	}

	return conn;
}

/**
 * open database connection
 *
 * @ingroup CONN_FUNC
 * @param conn Database connection to open.
 * @param config {#SqlConfig} Database connection to open.
 *
 * @return the connection itself
 * */
async function open(conn, config){
	if(!conn){
		conn = new _mariadb({
			...config,
			multipleStatements: true
		});
	}

	return conn;
}

/**
 * Get all tables from connected database
 *
 * @ingroup CONN_FUNC
 * @param conn Opened Database connection.
 *
 * @returns {#ConnResponse} if successcful, #ConnResponse.data contains array of table names
 * */
async function getAllTables(conn){
	return conn.query(`SHOW TABLES`)
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
 * Get all routines from connected database
 *
 * @ingroup CONN_FUNC
 * @param conn Opened Database connection.
 * @param database {**string**} Database name
 * @param rName {**string**} Either __PROCEDURE__ or __FUNCTION__
 *
 * @returns {#ConnResponse} if successful, #ConnResponse.data contains  array of selected routine names.
 * */
async function getAllRoutines(conn, database, rName){
	rName = rName.toUpperCase();

	const _sql = {
		query: `SHOW ${rName} STATUS WHERE Db = ?`,
		params: [ database ],
	};

	return conn.query(_sql.query, _sql.params)
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
 * Show CREATE query for the target name.
 *
 * @ingroup CONN_FUNC
 * @param conn Opened Database connection.
 * @param type {**string**} CREATE type, i.e. TABLE.
 * @param name {**string**} name of the CREATE query target.
 *
 * @returns {#ConnResponse} if successful, #ConnResponse.data contains CREATE TABLE query for selected table
 * */
async function showCreate(conn, type, name) {
	const self = this;

	return conn.query(`SHOW CREATE ${type.toUpperCase()} \`${name}\``)
		.then(res => response(true, res[0]))
		.catch(error => response(false, error, true));
}

module.exports = {
	response,
	close,
	open,
	getAllTables,
	getAllRoutines,
	showCreate,
};
