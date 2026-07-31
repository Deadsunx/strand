// React context exposing the singleton store + controller, plus typed hooks.

import { createContext, useContext, useRef, type ReactNode } from "react";
import { useStore } from "zustand";
import { createRuntime, type AppRuntime } from "./createController.ts";
import type { RoomController } from "./roomController.ts";
import type { AppState } from "../store/store.ts";

const AppContext = createContext<AppRuntime | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
    // Create the runtime exactly once for the app's lifetime.
    const runtimeRef = useRef<AppRuntime | null>(null);
    if (runtimeRef.current === null) {
        runtimeRef.current = createRuntime();
    }
    return (
        <AppContext.Provider value={runtimeRef.current}>
            {children}
        </AppContext.Provider>
    );
}

function useRuntime(): AppRuntime {
    const runtime = useContext(AppContext);
    if (!runtime) {
        throw new Error("useRuntime must be used within <AppProvider>");
    }
    return runtime;
}

/** Select a slice of app state; re-renders only when the slice changes. */
export function useAppState<T>(selector: (state: AppState) => T): T {
    const { store } = useRuntime();
    return useStore(store, selector);
}

/** The store's action bag (stable reference). */
export function useAppActions() {
    const { store } = useRuntime();
    return store.getState().actions;
}

/** The RoomController orchestrator. */
export function useController(): RoomController {
    return useRuntime().controller;
}
