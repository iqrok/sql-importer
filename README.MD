# SQL File Importer

Import or compare SQL file to database in MariaDB server.

Probably also works in MySQL server, but currently only tested in MariaDB 10.4 & 10.11.

## Installation

```bash
npm i sql-file-importer
```

## History

### v0.1.0

- Add **SQLCompare** to compare between existing database and SQL File
- Export class **SQLImporter** and **SQLCompare**
- Example
	```javascript
	const { SQLImporter, SQLCompare } = require('sql-file-importer');

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
		/* ------------------ import db ------------------ */
		const importer = new SQLImporter();

		importer.init(config);

		const proc = await importer
				.importFile(filepath, {
					withData: 'single',
					dropFirst: true,
				});

		/* ----------------- compare db ------------------ */
		const cmp = new SQLCompare();

		cmp.init(config);

		// fetch SQL from existing database
		const source = await cmp.existing();

		// fetch SQL from File
		const target = await cmp.fromFile('db_dump.sql');

		// compare
		const res = compare.compare(source, target);

		// get comparison error code
		const errno = compare.getErrno(res);

		// get diff report
		const diff = compare.getDiffString(res);

		console.log('Error code:', errno);
		console.log(diff)
	}();
	```

### v0.0.3

- Basic SQL file import

	```javascript
	const sqlFileImporter = require('sql-file-importer');

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
			/* import db data and multiple rows insert statement will be splitted into
			* single row statements.
			* */
			const proc = await importer.init(config).importFile(filepath, {
					withData: 'single',
					dropFirst: true,
				});
		}();
	```
