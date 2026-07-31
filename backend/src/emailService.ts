import axios from "axios";
import config from "./config";
import { emit } from "./gossamer";

interface EmailRequestBody {
    token: string;
}

export async function getRequestEmailResponse(
    body: EmailRequestBody
): Promise<Response> {
    try {
        if (!body.token) {
            return Response.json(
                { error: "reCAPTCHA token is required" },
                { status: 400 }
            );
        }

        emit("email:request", { status: "validating" });

        const response = await axios.post(
            "https://www.google.com/recaptcha/api/siteverify",
            null,
            {
                params: {
                    secret: config.recaptchaSecretKey,
                    response: body.token,
                },
            }
        );

        const { success } = response.data || {};

        if (success) {
            if (!config.contactEmail) {
                emit("email:error", { error: "server_not_configured" });
                return Response.json(
                    { error: "server_not_configured" },
                    { status: 500 }
                );
            }

            return Response.json({ email: config.contactEmail }, { status: 200 });
        }

        return Response.json({ error: "recaptcha_failed" }, { status: 400 });
    } catch (error) {
        const err = error as Error & { response?: { data?: unknown } };
        emit("email:error", {
            context: "reCAPTCHA verification failed",
            error: err.message,
            axiosResponse: err.response?.data,
        });
        return Response.json({ error: "internal_error" }, { status: 500 });
    }
}
