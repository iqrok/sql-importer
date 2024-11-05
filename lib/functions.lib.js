/**
 * @file lib/functions.lib.js
 * */

/**
 * @defgroup STATIC_FUNC Static Functions
 * @brief Collection of static functions, mostly on parsing SQL queries.
 * */

/**
 * Deep compare 2 objects.
 *
 * ref https://stackoverflow.com/a/29536321
 *
 * @warning This is a recursive function.
 *
 * @ingroup STATIC_FUNC
 * @param obj1 {**Object**} First Object to compare
 * @param obj2 {**Object**} Second Object to compare
 * @returns {**bool**} Comparation status.
 * */
function objDeepCompare(obj1, obj2) {
	if (obj1 === obj2) return true;

	// needed for structurally different objects
	if (typeof(obj1) != typeof(obj2)) return false;

	// primitive values
	if (Object(obj1) !== obj1) return false;

	let keys = Object.keys(obj1);
	if (keys.length != Object.keys(obj2).length) return false;

	for (let i = 0; i< keys.length; i++) {
		let key = keys[i];
		if (!Object.prototype.hasOwnProperty.call(obj2, key)) return false;
		if (!objDeepCompare(obj1[key], obj2[key])) return false;
	}

	return true;
}

/**
 * Escape charcaters from a string to be passed as a regex
 *
 * @ingroup STATIC_FUNC
 * @param string {**string**} string to be escaped
 * @returns {**string**} Escaped string.
 * */
function escapeRegex(string) {
	return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Get delimiters from queries. Since Delimiter can be set freely inside a query
 *
 * @ingroup STATIC_FUNC
 * @param queries {**string[]**} array of queries.
 *
 * @returns {**string[]**} List of found delimiters.
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
 *
 * @ingroup STATIC_FUNC
 * @param queries   {**string[]**} array of queries
 * @param delimiter {**string**}   delimiter character
 * @param config    {#SqlConfig}   Database connection configuration
 *
 * @returns         {**string[]**} List of queries with removed delimiter.
 * */
function removeDelimiters(queries, delimiter, config){
	const removed = [];
	for(const item of queries){
		const regex = new RegExp('DELIMITER', 'gim');

		const trimmed = item
			.replace(regex, '')
			.split(delimiter)
			.filter(text => text.trim().length > 0);

		const length = trimmed.length;
		for(let idx = 0; idx < length; idx++){
			removed.push(changeDefiner(trimmed[idx], config));
		}
	}

	return removed;
}

/**
 * Change definer's name and host according to configuration
 *
 * @ingroup STATIC_FUNC
 * @param query  {**string**} query string conatining DEFINER clause
 * @param config {#SqlConfig} Database connection configuration
 *
 * @returns      {**string**} query string with modified DEFINER clause
 * */
function changeDefiner(query, config){
	return query.replace(
		/DEFINER=(.*?)\@(.*?)\s/,
		'DEFINER=`' + config.user + '`'
				+ '@`' + config.host + '` '
	);
}

/**
 * Convert ALTER statements with multiple values
 * into multiple ALTER statements for each values
 *
 * The idea is if 1 query is failed, it won't affect another queries.
 * Currently, only support ADD and MODIFY
 *
 * @ingroup STATIC_FUNC
 * @param query {**string**} ALTER statements with multiple values
 * @returns {**string[]**} inserts - multiple ALTER statements
 * */
function alterMultipleToSingle(query){
	// count how many times ADD or MODIFY appears in query
	const count = query.match(/(?:ADD|MODIFY)\s{0,}/gmi);

	// if there's only 1 appearance, return the same one
	if (!count || count?.length <= 1) return [ query ];

	const table = getNameFromQuery('ALTER', query);

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
 *
 * @ingroup STATIC_FUNC
 * @param query  {**string**} ALTER statements
 * @returns name {**bool**}   **true** if PRIMARY KEY is detected, otherwise **false**
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
 *
 * @ingroup STATIC_FUNC
 * @param query {**string**}   INSERT statements with multiple values
 *
 * @returns     {**string[]**} multiple INSERT statements
 * */
function insertMultipleToSingle(query){
	const self = this;
	const inserts = [];

	// split values inside query into array. max only 2 nested parentheses.
	// https://stackoverflow.com/a/35271017/3258981
	const matches = query.match(/\((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*\)/gim);
	if(!matches) return inserts;

	const table = getNameFromQuery('INSERT', query);
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
 *
 * @ingroup STATIC_FUNC
 * @param query {**string**}  CREATE TABLE statements
 *
 * @returns {**string[]**} columns - list of column's name
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
 *
 * @ingroup STATIC_FUNC
 * @param query {**string**} either FUNCTION, PROCEDURE AND TRIGGER statements
 *
 * @returns {**string**} name of each statement
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
 *
 * @ingroup STATIC_FUNC
 * @param type {**string**} query's type which table's name will be extracted
 * @param query {**string**}  sql query
 * @returns {**string**|**null**} extracted table's name if presents
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
 *
 * @ingroup STATIC_FUNC
 * @param type {**string**} query's type which table's name will be extracted
 * @param queries {**string[]**} array of sql queries with same type
 * @returns tables {**string[]**} extracted table's names if presents
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
 *
 * @ingroup STATIC_FUNC
 * @param query {**string**} ALTER query
 *
 * @returns {#TableDeps} res - tables dependencies
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
 *
 * @ingroup STATIC_FUNC
 * @param queries {**string**} ALTER queries
 *
 * @returns {**Object**} tObjDep - tables dependencies with table's name as key
 *
 * @code{.js}
 * tObjDep = {
 * 	'table_name_1': {
 * 		table: 'table_name_1',
 * 		dependencies: [ ... ],
 * 	},
 * };
 * @endcode
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
 *
 * ref: https://stackoverflow.com/a/54346588/3258981
 *
 * @ingroup STATIC_FUNC
 * @param queries {**string**} - ALTER queries
 *
 * @returns {**string[]**} sorted table from less dependent table first
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
 * Get all non-table CREATE queries, e.g. FUNCTION, PROCEDURE, & TRIGGER
 *
 * @ingroup STATIC_FUNC
 * @param sql {**string**} entire sql string from file.
 * @param config {#SqlConfig} Database connection configuration.
 *
 * @returns {#NonTableCreate} Non-Table CREATE queries
 * */
function getNonTableCreates(sql, config){
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
		const trimmed = removeDelimiters(matches, delimiter, config);

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
 *
 * @ingroup STATIC_FUNC
 * @param query {**string**} CREATE TABLE statements
 * @returns {**Object**} stripped query and list of found ALTER query
 *
 * |key|type|note|
 * |---|----|----|
 * |query|**string**|Stripped query|
 * |alter|**string[]**|List of ALTER queries found|
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
		alter.push(`ALTER TABLE \`${table}\` ADD ${match[2]} ${match[3]}`);
	}

	const retVal = { query, alter };

	// handle AUTO_INCREMENT & the last column comma
	const cols = getColumnsFromCreateTable(retVal.query);

	const lastCol = {
			name: undefined,
			content: undefined,
			length: undefined,
			pos: -1,
		};

	const autoIncCol = {
			regex: /\s{0,}AUTO_INCREMENT(?:\s{0,}=\s{0,}([\d]+)){0,}/gi,
			name: undefined,
			content: undefined,
			value: 1,
		};

	for (const key in cols) {
		/* Find last column name:
		 * same regex as for extracting column from CREATE TABLE
		 */
		const { InOrder } = regexForColDef();
		const colRegex = new RegExp(`${key}` +  `${InOrder}`, 'i');
		const match = query.match(colRegex);

		if (match) {
			const { index } = match;
			if(index > lastCol.pos) {
				lastCol.pos = index;
				lastCol.name = key;
			}
		}

		// find AUTO_INCREMENT column if not set
		if (!autoIncCol.name && cols[key].match(autoIncCol.regex)) {
			autoIncCol.name = key;
			autoIncCol.content = cols[key];

			// find AUTO_INCREMENT number
			for (const match of query.matchAll(autoIncCol.regex)) {
				if(isNaN(match && match[1])) continue;
				autoIncCol.value = Number(match[1])
			}

			// remove AUTO_INCREMENT from query
			retVal.query = query.replace(autoIncCol.regex, '');
		}
	}

	/* query to set AUTO_INCREMENT,
	 * must be set after PRIMARY KEY is set for this column
	 * */
	if (autoIncCol.name) {
		alter.push(`ALTER TABLE \`${table}\``
			+ ` MODIFY \`${autoIncCol.name}\` ${autoIncCol.content}`);
	}

	// trying to find comma at the last column definition
	const lRegex = new RegExp(`(?:${lastCol.name}.*?)(,)(?:\\r|\\n|\$)`, 'i');
	const lastComma = {
			match: retVal.query.match(lRegex),
			index: -1,
			get pos() { return this.match.index + this.index; },
		};

	// comma not found, return as it is
	if (!lastComma.match) return retVal;

	lastCol.content = lastComma.match[0];
	lastCol.length = lastComma.match[0].length;

	// find last comma index
	lastComma.index = lastCol.length;
	for(let idx = lastCol.length - 1; idx >= 0; idx--) {
		if(lastCol.content[idx] === ',') {
			lastComma.index = idx;
			break;
		}
	}

	// modify the query string
	retVal.query = retVal.query.slice(0, lastComma.pos)
		+ retVal.query.slice(lastComma.pos + 1);

	return retVal;
}

/**
 * Get regular expression for parsing column definition, either in CREATE TABLE
 * or ALTER
 *
 * @ingroup STATIC_FUNC
 *
 * @returns {Object} Collection of regular expression with key - value explained below.
 * */
function regexForColDef () {
	return {
		DATATYPE: '(?:\\S+\\s+(?:\\w+){1,})(?:\\({0,}([\\d]+){0,}\\){0,})',
		DEFAULT: '(?:\\s{1,}DEFAULT\\s+([^\\s]+)\\s{0,}){0,}',
		ISNULLABLE: '(?:\\s{1,}(NOT NULL|NULL)){0,}',
		UNSIGNED: '(?:\\s{1,}(UNSIGNED)){0,}',
		CHARACTER: '(?:\\s{1,}CHARACTER.*?SET\\s{1,}[\\w]+(?:\\s{1,}COLLATE\\s{1,}[\\w]+){0,}){0,}',
		AUTOINC: '(?:\\s{0,}(AUTO_INCREMENT){0,}){0,}',
		get InOrder() {
			return `${this.DATATYPE}${this.UNSIGNED}${this.ISNULLABLE}`
				+ `${this.CHARACTER}${this.DEFAULT}${this.AUTOINC}`;
		}
	};
}

/**
 * Generate string which contains #ColumnDef details.
 * In order to make #ColumnDef Object easier to read;
 *
 * @ingroup STATIC_FUNC
 * @param obj {#ColumnDef} Column Definitions.
 *
 * @returns {**Object**} String representation of #ColumnDef which splitted into
 * 	                     2 object, `def` for column definition itself, `key` for
 *                       column's keys information.
 *
 * |key|type|note|
 * |---|----|----|
 * |def|**string**|column definition|
 * |key|**string**|column's keys information|
 * */
function colDefFromObject(obj) {
	const res = { def: '', key: '' };

	// Column definition
	res.def = obj.type
		+ ' ' + (obj.isNullable ? 'NULL' : 'NOT NULL')
		+ ' ' + (obj.default ? `DEFAULT ${obj.default} ` : '')
		+ ' ' + (obj.isAutoIncrement ? `AUTO_INCREMENT` : '');

	// column keys
	if (obj.isPrimary) res.key += ' PRIMARY KEY;';

	if (Array.isArray(obj.unique)) {
		for (const item of obj.unique) {
			res.key += ' UNIQUE KEY `' + item.name + '`'
				+ '(' + item.columns.map(x => '`' + x + '`').join(',') + ')';
		}
	}

	if (Array.isArray(obj.index)) {
		for (const item of obj.index) {
			res.key += ' KEY `' + item.name + '`'
				+ '(' + item.columns.map(x => '`' + x + '`').join(',') + ')';
		}
	}

	if (Array.isArray(obj.foreign)) {
		for (const item of obj.foreign) {
			res.key += ' CONSTRAINT `' + item.name + '`'
				+ ' FOREIGN KEY (`' + item.column + '`)'
				+ ' REFERENCES `' + item.ref.table + '`'
				+ ' (`' + item.ref.column + '`);';
		}
	}

	res.def = res.def
		.replace(/\s{1,};/g, ';') // replace any double whitespaces into a space
		.replace(/\s{2,}/g, ' ') // replace any double whitespaces into a space
		.trim();

	return res;
}

/**
 * Generate #ColumnDef Object from match regex result.
 *
 * @ingroup STATIC_FUNC
 * @param match {**string[]**} Match regex result
 *
 * @returns {#ColumnDef} Column definition without column keys information.
 * */
function colDefToObject(match) {
	const type = match[2] ? `${match[1]}(${match[2]})` : match[1];
	const isUnsigned = (match[3] && match[3].toUpperCase() === 'UNSIGNED') ?? false;

	return {
		key: undefined,
		type: isUnsigned ? `${type} unsigned` : type,
		isUnsigned,
		datatype: match[1],
		typesize: match[2] ? Number(match[2]) : 0,
		length: match[1] === 'varchar' && match[2] ? Number(match[2]) : 0,
		isNullable: match[4] === 'NULL' || match[5] === 'NULL',
		default: match[5] || undefined,
		isAutoIncrement: match[6] ? true : false,
	};
}

/**
 * Get column definitions from CREATE TABLE query
 *
 * @ingroup STATIC_FUNC
 * @param query {**string**} CREATE TABLE query
 *
 * @returns {#ColumnDef|undefined} if query is valid, returns column definitions.
 * 									Otherwise undefined.
 * */
function parseColumnCreateQuery(query) {
	const reg = regexForColDef();

	const regex = new RegExp(
			'^([\\w]+)(?:\\({0,}([\\d]+){0,}\\){0,})'
				+ `${reg.UNSIGNED}${reg.ISNULLABLE}`
				+ `${reg.CHARACTER}${reg.DEFAULT}${reg.AUTOINC}`,
			'mi'
		);
	const match = query.match(regex);

	if (!match) return undefined;

	return colDefToObject(match);
}

/**
 * Check if columns has same definitions
 *
 * @ingroup STATIC_FUNC
 * @param col1 {#ColumnDef} first column to compare
 * @param col2 {#ColumnDef} second column to compare
 *
 * @return {**bool**} **true** if both columns has same definition.
 * 					Otherwise **false**.
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

/**
 * Parse entire SQL input
 *
 * @ingroup STATIC_FUNC
 * @param input {**string**} SQL queries input
 * @param config configuration containing user and host of SQL Database
 *
 * @return {#ParsedQuery} parsed query.
 * */
function parseSQLInput(input, config) {
	const iQueries = input.split(';');
	const length = iQueries.length;
	const queries = {
		...getNonTableCreates(input, config),
		table: [],
		alter: [],
		view: [],
		insert: [],
		drop: [],
		sort: [],
		misc: [],
	};

	for(let idx = 0; idx < length; idx++){
		const query = iQueries[idx].trim();

		if(query.match(/^INSERT\s/i)){
			const name = getNameFromQuery('INSERT', query);

			if(queries.insert[name] === undefined){
				queries.insert[name] = [];
			}

			queries.insert[name].push(query);
		} else if(query.match(/^ALTER\s/i)){
			const multiple = alterMultipleToSingle(query);
			queries.alter.push(...multiple);
		} else if(query.match(/^CREATE\s/i)){
			if(query.match(/\sVIEW\s/i)){
				queries.view.push(changeDefiner(query));
			} else if(query.match(/\sTABLE\s/i)){
				const name = getNameFromQuery('TABLE', query);

				if(queries.table[name] === undefined){
					queries.table[name] = [];
				}

				// strip col definitions from CREATE TABLE and add them into alter
				const stripped = stripColumnDefinitionFromCreate(query);
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
		tables: getNameFromQueries('TABLE', queries.table),
		views: getNameFromQueries('VIEW', queries.view),
		functions: getNameFromQueries('FUNCTION', queries.functions),
		procedures: getNameFromQueries('ROUTINE', queries.procedures),
	};

	queries.sort = topologySortDependencies(queries.alter);

	return { queries, names };
}

/**
 * Split ALTER TABLE query between adding KEY and FOREIGN KEY
 *
 * @ingroup STATIC_FUNC
 * @param alter {**string[]**} ALTER queries
 * @return {#AlterSplit} splitted ALTER queries.
 * */
function splitAlterKeyAndForeignKey(alter) {
	const queries = {
			key: [],
			foreign: [],
		};

	for (const item of alter) {
		if(item.match(/FOREIGN KEY/gi)) {
			queries.foreign.push(item);
		} else {
			queries.key.push(item);
		}
	}

	return queries;
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
	parseSQLInput,
	splitAlterKeyAndForeignKey,
	regexForColDef,
	colDefToObject,
	colDefFromObject,
	objDeepCompare,
};
