/**
 *  @brief Parsed Query form SQL file
 */
struct ParsedQuery {
	string[] functions; /**< CREATE FUNCTION Queries */
	string[] procedures; /**< Parsed Query resul */
	string[] triggers; /**< CREATE PROCEDURE Queries */
	string[] table; /**< CREATE TABLE Queries */
	string[] alter; /**< ALTER TABLE Queries */
	string[] view; /**< CREATE VIEW Queries */
	Object insert; /**< INSERT INTO Queries, with each query grouped by table's name as key */
	string[] drop; /**< DROP TABLE Queries */
	string[] sort; /**< sorted table names based on table's dependencies */
	string[] misc; /**< other queries which not correctly parsed */
};

/**
 * @brief Failed Query
 */
struct FailedQuery {
	number code; /**< SQL Error number */
	string msg; /**< SQL Error message */
	string query; /**< Failed SQL Query */
};

/**
 * @brief Import SQL options
 */
struct ImportOptions {
	/**
	 * Whether to import data or not. Valid options are:
	 * |value|datatype|note|descripton|
	 * |-----|--------|---|-----|
	 * |**true**|boolean|*default*|Import data as it is|
	 * |**1**|number||alias for **true**|
	 * |`single`|string||Import data, but the SQL will be converted into multiple single INSERT statetments|
	 * |**2**|number||alias for `single`|
	 *
	 * Any other value will be treated as **false**, and no data will be imported.
	 * */
	bool|number|string withData;

	/**
	 * Should the table(s) be dropped first before importing or not. default is **true**
	 * */
	bool dropFirst;

	/**
	 * Close the SQL connection after importing is finisihed. default is **false**
	 * */
	bool closeConnection;
};

/**
 * @brief Import SQL options
 */
struct AlterSplit {
	string[] key; /**< ALTER TABLE Key queries */
	string[] foreign; /**< ALTER TABLE Foreign Key queries */
};

/**
 * @brief Alter query type
 */
enum AlterType_e {
	PRIMARY, /**< Adds PRIMARY KEY */
	MODIFY, /**< ALTER query modifies column definition */
	FOREIGN, /**< Adds FOREIGN KEY */
	UNIQUE, /**< Adds UNIQUE KEY */
	INDEX, /**< Adds INDEX KEY */
};

/**
 * @brief Foreign key information
 */
struct ForeignKey {
	string table; /**< name of the referenced table */
	string column; /**< name of the referenced column */
};

/**
 * @brief Import SQL options
 */
struct AlterParsed {
	enum AlterType_e type; /**< ALTER TABLE type */
	string name; /**< Name of the KEY */
	string column; /**< Single column name, available only for #MODIFY & #FOREIGN */
	string[] columns; /**< List of column's names related to the KEY */
	ForeignKey ref; /**< Referenced key. Only for #FOREIGN */
};

/**
 * @brief Configuration for connecting to database.
 * @details Other options which can be included in the configuration, can be
 * seen at https://mariadb.com/kb/en/node-js-connection-options/
 */
struct SqlConfig {
	string host; /**< Server host name or IP address */
	int port; /**< Server port number */
	string user; /**< Database username */
	string password; /**< Database password */
	string database; /**< Database name */
	string charset; /**< Database charset */
	int verbose; /**< Verbosity log level */
};

/**
 * @brief Column definitions
 * */
struct ColumnDef {
	string type; /**< column type, i.e. varchar(64), int(11) unsigned, etc. */
	bool isUnsigned; /**< Column has UNSIGNE attribute or not */
	string datatype; /**< Column datatype, i.e. varchar, int, timestamp, etc */
	int typesize; /**< Column datatype's size */
	int length; /**< Column varchar length. If column type is other than varchar, then length is 0  */
	bool isNullable; /**< Whether column can be set to NULL or not  */
	string default; /**< Column default value. `undefined` if column has none */
	bool isAutoIncrement; /**< Column is AUTO_INCREMENT or not */
	bool isPrimary /**< Column is primary key or not */
	KeyInfo[] unique; /**< if column has UNIQUE KEY set, the it contains the key info.
						Otherwise undefined*/
	KeyInfo[] index; /**< if column has INDEX KEY set, the it contains the key info.
						Otherwise undefined*/
	KeyInfo[] foreign; /**< if column has FOREIGN KEY set, the it contains the key info.
						Otherwise undefined*/
};

/**
 * @brief Key Informations
 * */
struct KeyInfo {
	string name; /**< Name of the KEY */
	string column; /**< Single column name, available only for #MODIFY & #FOREIGN */
	string[] columns; /**< List of column's names related to the KEY */
	ForeignKey ref; /**< Referenced key. Only for #FOREIGN */
};

/**
 * @brief Table Information
 * */
struct TableInfo {
	string name; /**< current table's name */
	ColumnDef columns; /**< Object with key is the table's name, which value
					contains #ColumnDef info*/
};

/**
 * @brief Differences Report
 *
 * The folowing is details of #DiffReport structure.
 *
 * @code{.js}
 * DiffReport = {
 * 	// information per table
 * 	'table_name_1': {
 * 		// information per column
 * 		'column_name_1': {
 * 			// if source column modified or removed in target,
 * 			// then 'source' contains old column information
 * 			'source': 'Source Column Info',
 *
 * 			// if target modified source column or added new column,
 * 			// then 'target' contains new column information
 * 			'target': 'Target Column Info',
 * 		},
 * 	},
 * };
 * @endcode
 * */
struct DiffReport {
	Object tables;
};

/**
 * @brief Connection Response
 * */
struct ConnResponse {
	bool status; /**< indicates whether the process run successfully or not */
	any error; /**< presents if status is false, otherwise it's undefined */
	any data; /**< presents if status is true, otherwise it's undefined. */
};

/**
 * @brief Colum Comparation detail
 */
struct ColCompDetail {
	string name; /**< Column's name */
	string detail; /**< column detail, i.e. 'INT NOT NULL' */
};

/**
 * @brief Table Comparation result
 */
struct TableCompare {
	ColCompDetail[] new; /**< new columns in the table */
	ColCompDetail[] same; /**< same columns in the table */
	ColCompDetail[] mod; /**< modified columns in the table */
	string[] nomore; /**< list of column names no longer exist */
};

/**
 * @brief Table dependencies
 * */
struct TableDeps {
	string table; /**< table's name */
	string[] dependencies; /**< table's dependencies */
};

/**
 * @brief Table dependencies
 * */
struct NonTableCreate {
	string[] functions; /**< CREATE FUNCTION queries */
	string[] procedures; /**< CREATE PROCEDURE queries */
	string[] triggers; /**< CREATE TRIGGER queries */
};
