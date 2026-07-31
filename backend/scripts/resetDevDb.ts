import { assertLocalDatabaseUrl, withClient } from "./dbTools";

async function run(): Promise<void> {
    assertLocalDatabaseUrl();

    await withClient(async (client) => {
        await client.query("DROP SCHEMA public CASCADE");
        await client.query("CREATE SCHEMA public");
        await client.query("GRANT ALL ON SCHEMA public TO public");
    });

    console.log("Reset local database schema.");
}

run().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
});
