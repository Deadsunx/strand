import { migrate } from "postgres-migrations";
import { getMigrationDatabaseConfig, getMigrationsDirectory } from "./dbTools";

async function run(): Promise<void> {
    await migrate(getMigrationDatabaseConfig(), getMigrationsDirectory());
    console.log("Applied pending migrations.");
}

run().catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
});
