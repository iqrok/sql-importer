const SQLImporter = require('./lib/sqlImporter.class.js');
const SQLCompare = require('./lib/sqlCompare.class.js');

/**
 * Avoiding breaking change.
 *
 * On previous version,
 * an instance of SQLImporter is exported instead of the SQLImporter class.
 * */

const instance = new SQLImporter();

instance.SQLImporter = SQLImporter;
instance.SQLCompare = SQLCompare;

module.exports = instance;
