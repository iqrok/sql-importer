const SQLImporter = require('./lib/sqlImporter.class.js');
const SQLCompare = require('./lib/sqlCompare.class.js');

const version = require('./package.json')?.version?.split('.');

switch (version && version[0]) {

case '0': {
	/**
	 * Avoiding breaking change.
	 *
	 * On previous version 0.0.3,
	 * an instance of SQLImporter is exported instead of the SQLImporter class.
	 * */
	const instance = new SQLImporter();

	instance.SQLImporter = SQLImporter;
	instance.SQLCompare = SQLCompare;

	module.exports = instance;
} break;

default: {
	/**
	 * For version >= 1.x.x, export only the Class not the instance.
	 * */
	module.exports = {
		SQLImporter,
		SQLCompare,
	};
} break;

}
