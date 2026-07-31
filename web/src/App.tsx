import { useEffect } from "react";
import { useAppState, useAppActions } from "./app/AppContext.tsx";
import { Header } from "./components/Header.tsx";
import { Home } from "./components/Home.tsx";
import { Flight } from "./components/Flight.tsx";
import { Toast } from "./components/Toast.tsx";
import { Announcer } from "./components/Announcer.tsx";
import { InvitationToast } from "./components/InvitationToast.tsx";

export function App() {
    const screen = useAppState((s) => s.screen);
    const lastError = useAppState((s) => s.lastError);
    const actions = useAppActions();

    // Honour a shared invite link: ?code=ABC123 pre-fills the join flow.
    useEffect(() => {
        const code = new URLSearchParams(window.location.search)
            .get("code")
            ?.toUpperCase();
        if (code) actions.setError(null);
    }, [actions]);

    return (
        <div className="app">
            <a className="skip-link" href="#main">
                Skip to content
            </a>
            <Header />
            <main id="main" className="app-main" tabIndex={-1}>
                {screen === "home" ? <Home /> : <Flight />}
            </main>
            <Announcer />
            <InvitationToast />
            {lastError && (
                <Toast
                    message={lastError}
                    onDismiss={() => actions.setError(null)}
                />
            )}
        </div>
    );
}
