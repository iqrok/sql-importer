/**
 * @module StaticFunctions
 * */

/**
 * Column definitions
 * @typedef {Object} ColumnDef
 * @property {string|undefined} key - column key if defined.
 * @property {string} type - column type, i.e. varchar(64).
 * @property {string|undefined} isUnsigned - if column is unsigned,
 * 								then it would be set as 'UNSIGNED'.
 * 								otherwise undefined.
 * @property {number} length - varchar length. if column is not varchar, then 0.
 * @property {boolean} is_nullable - column is nullable or not.
 * @property {string|undefined} default - column default value.
 * 								if column has no default value, then undefined.
 */

/**
 * Escape charcaters from a string to be passed as a regex
 * @param {string} string - string to be escaped
 * @returns {string} Escaped string.
 * */
function escapeRegex(string) {
	return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Get delimiters from queries. Since Delimiter can be set freely inside a query
 * @param {string[]} queries - array of queries
 * @returns {string[]} List of found delimiters.
 * */
function getDelimiters(queries){
	let _delimiters = queries.match(/DELIMITER\s([\S]+)/gm);
	const delimiters = [];

	if(_delimiters){
		_delimiters = Array.from(new Set(_delimiters));
		const length = _delimiters.length;

		for(let idx = 0; idx < length; idx++){
			const delimiter = _delimiters[idx]
				.replace('DELIMITER', '')
				.trim();

			if(delimiter !== ';') delimiters.push(delimiter);
		}
	}

	return delimiters;
}

/**
 * Remove delimiter from queries
 * @param {string[]} queries - array of queries
 * @param {string} delimiter - delimiter character
 * @returns {string[]} List of queries with removed delimiter.
 * */
function removeDelimiters(queries, delimiter){
	const removed = [];
	for(const item of queries){
		const regex = new RegExp('DELIMITER', 'gim');

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
}

/**
 * Change definer's name and host according to configuration
 * @param {string} query - query string conatining DEFINER clause
 * @returns {string} query string with modified DEFINER clause
 * */
function changeDefiner(query){
	const self = this;

	return query.replace(
		/DEFINER=(.*?)\@(.*?)\s/,
		'DEFINER=`' + self._config.user + '`'
				+ '@`' + self._config.host + '` '
	);
}

/**
 * Convert ALTER statements with multiple values
 * into multiple ALTER statements for each values
 *
 * The idea is if 1 query is failed, it won't affect another queries.
 * Currently, only support ADD and MODIFY
 *
 * @param {string} query - ALTER statements with multiple values
 * @returns {string[]} inserts - multiple ALTER statements
 * */
function alterMultipleToSingle(query){
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
 * Check if alter statement contains "PRIMARY KEY"
 * @param {string} query - ALTER statements
 * @returns {string} name - name of each statement
 * */
function checkAlterHasPrimary(query){
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
 * Convert INSERT statements with multiple values into multiple INSERT statements
 * @param {string} query - INSERT statements with multiple values
 * @returns {string[]} inserts - multiple INSERT statements
 * */
function insertMultipleToSingle(query){
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
 * Get all column's name from CREATE statements
 * @param {string} query - INSERT statements with multiple values
 * @returns {string[]} columns - list of column's name
 * */
function getColumnsFromCreateTable(query){
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
}

/**
 * Get all routine's name from FUNCTION, PROCEDURE AND TRIGGER statement
 * @param {string} query - FUNCTION, PROCEDURE AND TRIGGER statements
 * @returns {string} name - name of each statement
 * */
function parseQueryRoutine(query){
	try{
		const parsedQuery = query.match(/\s(FUNCTION|PROCEDURE|TRIGGER)\s`(.*?)`/im);
		return parsedQuery[2];
	}catch(err){
		console.log(err);
		return "";
	}
}

/**
 * Get table's name from query
 * @param {string} type - query's type which table's name will be extracted
 * @param {string} query - sql query
 * @returns {string|null} tables - extracted table's name if presents
 * */
function getNameFromQuery(type, query){
	if(typeof(query) != 'string') return false;

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
}

/**
 * Get table's name from queries
 * @param {string} type - query's type which table's name will be extracted
 * @param {string[]} queries - array of sql queries with same type
 * @returns {string[]} tables - extracted table's names if presents
 * */
function getNameFromQueries(type, queries){
	const names = [];

	for(const query of queries){
		const name = getNameFromQuery(type, query);
		if(name) names.push(name);
	}

	return names;
}

/**
 * Get tables relationship indentified by FOREIGN KEYs
 * @param {string} query - ALTER query
 * @returns {Object} res - tables dependencies
 * @returns {string} res.table - table's name
 * @returns {string[]} res.dependencies - table's dependencies
 * */
function getForeignKeyRelationship(query){
	const table = getNameFromQuery('ALTER', query);
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
 * @param {string} queries - ALTER queries
 * @returns {Object} res - tables dependencies with table's name as key
 * */
function getTableDependencies(queries){
	// change to object to make it easier when trying to find dependencies
	const tObjDep = {};
	for(const query of queries){
		const tDep = getForeignKeyRelationship(query);
		tObjDep[tDep.table] = tDep.dependencies;
	}

	return tObjDep;
}

/**
 * Sort tables by dependencies
 * https://stackoverflow.com/a/54346588/3258981
 * @param {string} queries - ALTER queries
 * @returns {string[]} res - sorted table from less or no dependencies first
 * */
function topologySortDependencies(queries){
	const tDep = getTableDependencies(queries);
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
 * Get all CREATE clauses for not table, e.g. FUNCTION
 * @param {string} sql - entire sql string from file
 * @returns {Object} results - CREATE queries
 * @returns {string[]} results.functions - FUNCTION's CREATE queries
 * @returns {string[]} results.procedures - PROCEDURE's CREATE queries
 * @returns {string[]} results.triggers - TRIGGER's CREATE queries
 * */
function getNonTableCreates(sql){
	const results = {
		functions: [],
		procedures: [],
		triggers: [],
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
		} else {
			// no match, do nothing
		}
	}

	return results;
}

/**
 * Move column definitions inside CREATE TABLE to alter
 * @param {string} query - CREATE TABLE statements
 * @returns {{query: string, alter: string[]}} stripped query and list of found ALTER query
 * */
function stripColumnDefinitionFromCreate(query) {
	// remove whitespaces at the beginning of each line
	query = query.replace(/\n\s+/gmi, '\n');

	const regex = /^((PRIMARY KEY|UNIQUE KEY|KEY|CONSTRAINT)\s+(.*?)(?:(?:,$)|$))/gmi;

	const table = getNameFromQuery('TABLE', query);
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

/**
 * Get column definitions from CREATE TABLE query
 * @param {string} query - CREATE TABLE query
 * @returns {ColumnDef|undefined} if query is valid, returns column definitions.
 * 								Otherwise undefined.
 * */
function parseColumnCreateQuery(query) {
	const reg_DEFAULT = '(?:\\s{1,}DEFAULT\\s+([^\\s]+)\\s{0,}){0,}';
	const reg_ISNULLABLE = '(?:\\s{1,}(NOT NULL|NULL)){0,}';
	const reg_UNSIGNED = '(?:\\s{1,}(UNSIGNED)){0,}';
	const reg_CHARACTER = '(?:\\s{1,}CHARACTER.*?SET\\s{1,}[\\w]+\\s{1,}[\\w]+\\s{1,}\\w+){0,}';
	const reg_FIRST = '^([\\w]+)(?:\\({0,}([\\d]+){0,}\\){0,})';
	const reg_FINISH = `${reg_FIRST}${reg_UNSIGNED}${reg_ISNULLABLE}${reg_CHARACTER}${reg_DEFAULT}`;

	const regex = new RegExp(reg_FINISH, 'mi');
	const match = query.match(regex);

	if (!match) return undefined;

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

/**
 * Check if columns has same definitions
 * @param {ColumnDef} col1 - first column to compare
 * @param {ColumnDef} col2 - second column to compare
 * @return {boolean} true if both columns has same definition. Otherwise false.
 * */
function isColumnIdentical(col1, col2) {
	for(const key in col2) {
		// skip key, it's not set in query string
		if (key === 'key') continue;

		// no need to check any further
		if(col1[key] !== col2[key]) return false;
	}

	return true;
}

module.exports = {
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
};
