const fs = require('fs');
const importer = require('.');

const config = {
		host: 'localhost',
		port: 3306,
		user: 'root',
		password: '',
		database: 'test_db',
		charset: 'utf8mb4',
		rejectEmpty: true,
		trace: true,
		verbose: 2,
	};

(async () => {
	console.time('QUERY');

	// delete all tables and routine
	//~ await importer.init(config).emptyDatabase();

	// when importing from file, db will be always emptied first

	// import db structure and data
	//~ await importer.init(config).importFile('./from_pma.sql');

	// import db structure only
	await importer.init(config).importFile('./from_pma.sql', false);

	console.timeEnd('QUERY');

	process.exit(0);
})();
