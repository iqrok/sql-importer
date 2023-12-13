// will be executed for every test
global.__basedir = __dirname + "/..";
global.__config = {
    db: {
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'shinra',
        database: 'test_db',
        charset: 'utf8mb4',
        trace: true,
        verbose: 1,
    }
}