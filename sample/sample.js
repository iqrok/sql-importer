const sqlFileImporter = require('..');

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

const importer = sqlFileImporter.init(config);

(async () => {
	const filepath = __dirname + '/from_pma.sql';

	console.time('QUERY');

	/** delete all tables and routine **/
	//~ await importer.emptyDatabase();

	/** Group queries inside sql file **/
	//~ const parsed = await importer.init(config).parse(filepath);
	//~ console.log(parsed.names);
	//~ console.log(parsed.queries.nonTable.routines[2]);
	//~ console.log(parsed.queries.view[2]);

	/** import db structure and data **/
	//~ const proc = await importer.init(config).importFile('./from_pma.sql');

	/** import db structure only **/
	//~ const proc = await importer.init(config).importFile('./from_pma.sql', {
			//~ withData: false,
		//~ });

	/** import db without dropping all tables and routines first. **/
	//~ const proc = await importer.init(config).importFile('./from_pma.sql', {
			//~ dropFirst: false,
		//~ });

	/** import db data and multiple rows insert statement will be splitted into
	 * single row statements. **/
	const proc = await importer.init(config).importFile(filepath, {
			withData: 'single',
			dropFirst: true,
		});

	console.log(proc);

	console.timeEnd('QUERY');
})();
