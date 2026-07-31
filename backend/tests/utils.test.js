// tests/utils.test.js

// Mock config to prevent loading side effects
jest.mock('../src/config', () => ({
    __esModule: true,
    default: {
        PORT: 8080,
        SHUTDOWN_TIMEOUT: 5000,
    },
}));

// Mock gossamer to prevent initialization
jest.mock('../src/gossamer', () => ({
    emit: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
}));

const { getCleanIPv4, isPrivateIP } = require('../src/utils');

describe('Utils Unit Tests', () => {

    describe('getCleanIPv4', () => {
        test('should return standard IPv4 as is', () => {
            expect(getCleanIPv4('192.168.1.1')).toBe('192.168.1.1');
        });
        test('should clean IPv6 mapped IPv4', () => {
            expect(getCleanIPv4('::ffff:192.168.1.1')).toBe('192.168.1.1');
        });
        test('should handle localhost IPv6', () => {
            expect(getCleanIPv4('::1')).toBe('127.0.0.1');
        });
        test('should return "unknown" for invalid/empty input', () => {
            expect(getCleanIPv4(null)).toBe('unknown');
        });
    });

    describe('isPrivateIP', () => {
        test('should identify 192.168.x.x as private', () => {
            // Implementation returns boolean OR regex match array
            expect(isPrivateIP('192.168.0.1')).toBeTruthy();
        });

        test('should identify 10.x.x.x as private', () => {
            expect(isPrivateIP('10.0.0.5')).toBeTruthy();
        });

        test('should identify 172.16.x.x range as private', () => {
            // Implementation returns regex match array, which is truthy
            expect(isPrivateIP('172.16.0.1')).toBeTruthy();
        });

        test('should identify public IPs as not private', () => {
            // Implementation returns false or null
            expect(isPrivateIP('8.8.8.8')).toBeFalsy();
        });
    });
});
