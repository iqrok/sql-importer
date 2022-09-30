const fs = require('fs');
const mysqlImporter = require('.');

const config = {
		host: 'localhost',
		port: 3306,
		user: 'root',
		password: '',
		database: 'test_db',
		charset: 'utf8mb4',
		trace: true,
		verbose: 2,
	};

(async () => {
	const filepath = './sugity_dev_db.sql';

	console.time('QUERY');

	const importer = mysqlImporter.init(config);

	/** delete all tables and routine **/
	//~ await importer.emptyDatabase();

	/** Group queries inside sql file **/
	//~ const parsed = await importer.init(config).parse(filepath);
	//~ console.log(parsed.names);
	//~ console.log(parsed.queries.nonTable.routines[2]);
	//~ console.log(parsed.queries.view[2]);

	/** import db structure and data **/
	//~ await importer.init(config).importFile('./from_pma.sql');

	/** import db structure only **/
	//~ await importer.init(config).importFile('./from_pma.sql', {
			//~ withData: false,
		//~ });

	/** import db without dropping all tables and routines first. **/
	//~ await importer.init(config).importFile('./from_pma.sql', {
			//~ dropFirst: false,
		//~ });

	/** import db without data and drop all tables and routines first. **/
	await importer.init(config).importFile(filepath, {
			withData: false,
			dropFirst: true,
		});

	console.timeEnd('QUERY');
})();
