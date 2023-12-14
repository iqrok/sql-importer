# SQL File Importer

Import sql file to database in mariadb server. Probably also works in MySQL server, but currently only tested in mariadb 10.4 & 15.1.

## Usage

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

	/** import db data and multiple rows insert statement will be splitted into
	 * single row statements. **/
	const proc = await importer.init(config).importFile(filepath, {
			withData: 'single',
			dropFirst: true,
		});
```
