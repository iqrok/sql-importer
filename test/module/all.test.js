const sqlFileImporter = require(__basedir);
const mysql = new (require(`${__basedir}/lib/mariadb.class.js`))(__config.db);
const importer = sqlFileImporter.init(__config.db);




async function checkRoutine(){
    return mysql.query(`
        SELECT 
            routine_name, 
            SUM(IF(routine_type = "FUNCTION", 0, 1)) as isFunction,
            SUM(IF(routine_type = "PROCEDURE", 0, 1)) as isProcedure
        FROM information_schema.routines 
        WHERE routine_schema = ?
        `,[__config.db.database])
        .then(res => {

            if(res[0].isFunction <= 0){
                return false
            }

            if(res[0].isProcedure <= 0){
                return false
            }

            return true
        })
        .catch(err => false)
}

async function checkTable(){
    return mysql.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = ?
    `,[__config.db.database])
    .then(res => {
        return res[0].table_name == "d_access_proposal" ? true: false
    })
    .catch(err => false)
}

async function checkTableHasContent(){
    return mysql.query(`
        SELECT COUNT(1) as total FROM d_access_proposal
        `)
        .then(res => {
            return res[0].total > 0 ? true: false
        })
        .catch(err => false)
}




describe("From PMA's export", () => {

    test("Delete all tables and routine", async () => {
        await importer.emptyDatabase(false);
    })

    test("Import db structure and data", async () => {

        // import db from sql file
        const filepath = __basedir + '/sample/from_pma.sql';

        const proc = await importer.init(__config.db)
        .read(filepath)
        .importFile();


        // check if routines success imported
        const isRoutineExist = await checkRoutine()
        expect(isRoutineExist).toBe(true)


        // check if table success imported
        const isTableExist = await checkTable()
        expect(isTableExist).toBe(true)


        // check if table has content
        const isTableHasContent = await checkTableHasContent()
        expect(isTableHasContent).toBe(true)

    })

    test("Delete all tables and routine", async () => {
        await importer.emptyDatabase(false);
    })

    test("Import db structure only", async () => {

        // import db from sql file
        const filepath = __basedir + '/sample/from_pma.sql';

        const proc = await importer.init(__config.db)
        .read(filepath)
        .importFile({
            withData: false,
        });


        // check if routines success imported
        const isRoutineExist = await checkRoutine()
        expect(isRoutineExist).toBe(true)


        // check if table success imported
        const isTableExist = await checkTable()
        expect(isTableExist).toBe(true)


        // check if table has no content
        const isTableHasContent = await checkTableHasContent()
        expect(isTableHasContent).toBe(false)

    })

    test("Delete all tables and routine", async () => {
        await importer.emptyDatabase(false);
    })

    test("Import db without dropping all tables and routines first", async () => {

        // import db from sql file
        const filepath = __basedir + '/sample/from_pma.sql';

        const proc = await importer.init(__config.db)
        .read(filepath)
        .importFile({
            dropFirst: false,
        });


        // check if routines success imported
        const isRoutineExist = await checkRoutine()
        expect(isRoutineExist).toBe(true)


        // check if table success imported
        const isTableExist = await checkTable()
        expect(isTableExist).toBe(true)


        // check if table has no content
        const isTableHasContent = await checkTableHasContent()
        expect(isTableHasContent).toBe(true)

    })

    test("Import partially (Update Column)", async () => {

    })

    test("Import partially (Update Table)", async () => {

    })

})


// close connection
afterAll(async () => {
    await mysql.end();
});
