const sqlFileImporter = require(__basedir);
const importer = sqlFileImporter.init(__config.db);
const gen = require("./general")



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
        const isRoutineExist = await gen.checkRoutine()
        expect(isRoutineExist).toBe(true)


        // check if table success imported
        const isTableExist = await gen.checkTable()
        expect(isTableExist).toBe(true)


        // check if table has content
        const isTableHasContent = await gen.checkTableHasContent()
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
        const isRoutineExist = await gen.checkRoutine()
        expect(isRoutineExist).toBe(true)


        // check if table success imported
        const isTableExist = await gen.checkTable()
        expect(isTableExist).toBe(true)


        // check if table has no content
        const isTableHasContent = await gen.checkTableHasContent()
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
        const isRoutineExist = await gen.checkRoutine()
        expect(isRoutineExist).toBe(true)


        // check if table success imported
        const isTableExist = await gen.checkTable()
        expect(isTableExist).toBe(true)


        // check if table has no content
        const isTableHasContent = await gen.checkTableHasContent()
        expect(isTableHasContent).toBe(true)

    })


    test("Import partially (Add Empty Column)", async () => {
        // import db from sql file
        const filepath = __basedir + '/sample/from_pma_add_column.sql';

        const proc = await importer.init(__config.db)
        .read(filepath)
        .importFile();


        // check if routines success imported
        const isRoutineExist = await gen.checkRoutine()
        expect(isRoutineExist).toBe(true)


        // check if table success imported
        const isTableExist = await gen.checkTable()
        expect(isTableExist).toBe(true)


        // check if table has no content
        const isTableHasContent = await gen.checkTableHasContent()
        expect(isTableHasContent).toBe(true)


        // check if table has column "labCode" and has content "LT" 
        // meaning only new update that implemented
        const isTableHasLabCodeLT = await gen.checkTableHasLabCodeLT()
        expect(isTableHasLabCodeLT).toBe(true)


        // check new update
        // check if table has column "itemCode"
        const isTableHasItemCode = await gen.checkTableHasItemCode()
        expect(isTableHasItemCode).toBe(true)

        // check if table has column "itemCode" and has content
        const isTableHasItemCodeContent = await gen.checkTableHasItemCodeContent()
        expect(isTableHasItemCodeContent).toBe(false)
    })


    test("Import partially (Add Empty Table)", async () => {
        // import db from sql file
        const filepath = __basedir + '/sample/from_pma_add_table.sql';

        const proc = await importer.init(__config.db)
        .read(filepath)
        .importFile();


        // check if routines success imported
        const isRoutineExist = await gen.checkRoutine()
        expect(isRoutineExist).toBe(true)


        // check if table success imported
        const isTableExist = await gen.checkTable()
        expect(isTableExist).toBe(true)


        // check if table has no content
        const isTableHasContent = await gen.checkTableHasContent()
        expect(isTableHasContent).toBe(true)


        // check if table has column "labCode" and has content "LT" 
        // meaning only new update that implemented
        const isTableHasLabCodeLT = await gen.checkTableHasLabCodeLT()
        expect(isTableHasLabCodeLT).toBe(true)


        // check last update
        // check if table has column "itemCode"
        const isTableHasItemCode = await gen.checkTableHasItemCode()
        expect(isTableHasItemCode).toBe(true)

        // check if table has column "itemCode" and has content
        const isTableHasItemCodeContent = await gen.checkTableHasItemCodeContent()
        expect(isTableHasItemCodeContent).toBe(false)


        // check new update
        // check if new table exist
        const isTableItem = await gen.checkTableItem()
        expect(isTableItem).toBe(true)

        // check if new table exist and has content
        const isTableItemContent = await gen.checkTableItemHasContent()
        expect(isTableItemContent).toBe(false)
    })

})


// close connection
afterAll(async () => {
    gen.close()
});
