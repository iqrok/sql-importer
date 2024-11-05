const SQLCompare = require('../lib/sqlCompare.class.js');
const config = {
		host: 'localhost',
		port: 3306,
		user: 'root',
		password: '',
		database: 'test_db',
		charset: 'utf8mb4',
		trace: true,
		verbose: 0,
	};

(async () => {
	const filepath = __dirname + '/compare_pma.sql';
	//~ const filepath = __dirname + '/from_pma.sql';
	//~ const filepath = __dirname + '/test_mysqldump.sql';

	console.time('QUERY');

	const compare = new SQLCompare();

	compare.init(config);

	const existing = await compare.existing();
	const fromFile = await compare.fromFile(filepath);

	const res = compare.compare(existing, fromFile);
	const errno = compare.getErrno(res);
	const diff = compare.getDiffString(res);

	console.timeEnd('QUERY');

	console.log(diff);
	console.log('errno', errno);
	if (errno & SQLCompare.errno.MODIFIED) {
		console.log('At least a column has been modified')
	}

	if (errno & SQLCompare.errno.REMOVED) {
		console.log('At least a column has been removed in new database')
	}

	if (errno & SQLCompare.errno.ADDED) {
		console.log('At least a column has been added in new database')
	}
})();
