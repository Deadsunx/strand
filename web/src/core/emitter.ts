// A tiny dependency-free typed event emitter.
//
// The headless core communicates with the UI layer exclusively through events
// (never by touching the DOM), so this is the seam between framework-agnostic
// logic and React. `TEvents` maps each event name to its payload type.

export type Listener<T> = (payload: T) => void;

export class TypedEmitter<TEvents extends Record<string, unknown>> {
    private readonly listeners: {
        [K in keyof TEvents]?: Set<Listener<TEvents[K]>>;
    } = {};

    /** Subscribe to an event. Returns an unsubscribe function. */
    on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
        (this.listeners[event] ??= new Set()).add(listener);
        return () => this.off(event, listener);
    }

    /** Subscribe to an event for a single emission. */
    once<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
        const wrapper: Listener<TEvents[K]> = (payload) => {
            this.off(event, wrapper);
            listener(payload);
        };
        return this.on(event, wrapper);
    }

    off<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): void {
        this.listeners[event]?.delete(listener);
    }

    emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
        // Copy to a array first so listeners may unsubscribe during emission.
        const current = this.listeners[event];
        if (!current) return;
        for (const listener of [...current]) {
            listener(payload);
        }
    }

    /** Remove every listener (used on teardown). */
    removeAll(): void {
        for (const key of Object.keys(this.listeners) as (keyof TEvents)[]) {
            this.listeners[key]?.clear();
        }
    }
}
