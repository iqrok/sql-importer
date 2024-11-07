const { SQLImporter } = require('..');

const config = {
		host: 'localhost',
		port: 3306,
		user: 'root',
		password: '',
		database: 'test_db',
		charset: 'utf8mb4',
		trace: true,
		verbose: 1,
	};

const importer = new SQLImporter();

(async () => {
	const filepath = __dirname + '/from_pma.sql';
	//~ const filepath = __dirname + '/from_mysqldump.sql';

	console.time('QUERY');

	/** delete all tables and routine **/
	//~ await importer.init(config).emptyDatabase();

	/** Parse queries inside sql file **/
	//~ const proc = await importer.init(config)
		//~ .read(filepath)
		//~ .parse();

	/** import db structure and data **/
	//~ const proc = await importer.init(config)
		//~ .read(filepath)
		//~ .importFile();

	/** import db structure only **/
	//~ const proc = await importer.init(config)
		//~ .read(filepath)
		//~ .importFile({
				//~ withData: false,
			//~ });

	/** import db without dropping all tables and routines first. **/
	//~ const proc = await importer.init(config)
		//~ .read(filepath)
		//~ .importFile({
				//~ dropFirst: false,
				//~ withData: 'single',
				//~ closeConnection: true,
			//~ });

	/** import db data and multiple rows insert statement will be splitted into
	 * single row statements. **/
	const proc = await importer.init(config)
		.read(filepath)
		.importFile({
				withData: 'single',
				dropFirst: true,
				closeConnection: true,
			});

	console.log(proc);

	console.timeEnd('QUERY');

	//~ importer.close();
})();
