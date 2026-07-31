import config from "./config";
import * as db from "./dbClient";
import { emit } from "./gossamer";

type RouteHandler = (request: Request) => Promise<Response>;

let utRequestHandler: RouteHandler | null = null;

async function getUtRequestHandler(): Promise<RouteHandler> {
    if (utRequestHandler) return utRequestHandler;

    if (!config.UPLOADTHING_TOKEN) {
        throw new Error("Missing UPLOADTHING_TOKEN in config.js");
    }

    const { createUploadthing, createRouteHandler } = await import(
        "uploadthing/server"
    );

    const f = createUploadthing();

    const router = {
        previewUpload: f({
            "application/vnd.openxmlformats-officedocument.presentationml.presentation":
                { maxFileSize: "64MB", maxFileCount: 1 },
        })
            .middleware(async () => ({ uploadedBy: "dropsilk-preview" }))
            .onUploadComplete(async ({ file }) => {
                const publicUrl = file.ufsUrl;

                emit("upload:success", {
                    url: publicUrl,
                    key: file.key,
                });

                if (db.isDatabaseInitialized()) {
                    try {
                        await db.query(
                            `
                                INSERT INTO uploaded_files (file_key, file_url, file_name)
                                VALUES ($1, $2, $3)
                            `,
                            [file.key, publicUrl, file.name]
                        );

                        emit("upload:db_saved", { key: file.key });
                    } catch (dbError) {
                        const err = dbError as Error;
                        emit("upload:error", {
                            context: "DB Save Failed",
                            key: file.key,
                            error: err.message,
                        });
                    }
                }
                return { url: publicUrl };
            }),
    };

    const callbackUrl = process.env.PUBLIC_SERVER_URL
        ? `${process.env.PUBLIC_SERVER_URL}/api/uploadthing`
        : `http://localhost:${config.PORT}/api/uploadthing`;

    utRequestHandler = createRouteHandler({
        router,
        config: {
            token: config.UPLOADTHING_TOKEN,
            callbackUrl,
        },
    });

    return utRequestHandler;
}

export async function handleUploadThingWebRequest(
    request: Request
): Promise<Response> {
    try {
        const handler = await getUtRequestHandler();
        return await handler(request);
    } catch (err) {
        const error = err as Error;
        emit("upload:error", {
            context: "Handler Route Error",
            error: error.message,
        });
        return Response.json({ error: "UploadThing routing error" }, { status: 500 });
    }
}
