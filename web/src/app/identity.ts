// Generates a friendly random display name (e.g. "BoldWing198"), matching the
// spirit of the original client's anonymous names.

const ADJECTIVES = [
    "Bold", "Swift", "Bright", "Calm", "Keen", "Brave", "Lucky", "Quiet",
    "Rapid", "Clever", "Nimble", "Gentle", "Fierce", "Merry", "Noble",
];
const NOUNS = [
    "Wing", "Pilot", "Falcon", "Comet", "Drift", "Signal", "Voyage", "Beacon",
    "Cipher", "Nomad", "Harbor", "Ranger", "Quartz", "Cedar", "Vertex",
];

export function generateRandomName(): string {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const num = Math.floor(Math.random() * 900) + 100;
    return `${adj}${noun}${num}`;
}
