const fs = require('fs');
const importer = require('.');

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
	console.time('QUERY');

	// delete all tables and routine
	//~ await importer.init(config).emptyDatabase();

	// Group queries inside sql file
	//~ const parsed = await importer.init(config).parse('./from_pma.sql');
	//~ console.log(parsed);

	// import db structure and data
	//~ await importer.init(config).importFile('./from_pma.sql');

	// import db structure only
	await importer.init(config).importFile('./from_pma.sql', {
			withData: false,
		});

	// import db without dropping all tables and routines first.
	//~ await importer.init(config).importFile('./from_pma.sql', {
			//~ dropFirst: false,
		//~ });

	console.timeEnd('QUERY');

	process.exit(0);
})();
