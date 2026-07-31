import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "./app/AppContext.tsx";
import { App } from "./App.tsx";
import { registerServiceWorker } from "./app/registerServiceWorker.ts";
import "./styles/index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

createRoot(rootElement).render(
    <StrictMode>
        <AppProvider>
            <App />
        </AppProvider>
    </StrictMode>
);

registerServiceWorker();
