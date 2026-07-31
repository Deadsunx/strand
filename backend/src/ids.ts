import { customAlphabet } from "nanoid";

const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const idAlphabet = "0123456789abcdefghijklmnopqrstuvwxyz";

const generateCode = customAlphabet(codeAlphabet, 6);
const generateId = customAlphabet(idAlphabet, 12);
const generateSession = customAlphabet(idAlphabet, 10);

export function generateRoomCode(): string {
    return generateCode();
}

export function generateFlightCode(): string {
    return generateCode();
}

export function generateParticipantId(): string {
    return generateId();
}

export function generateSessionId(): string {
    return generateSession();
}
