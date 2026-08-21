/**
 * Runtime validation, behind a separate entry point so that zod never reaches
 * a host app. The recorder imports only the package root (types + constants,
 * zero runtime deps); the player imports both.
 */
export * from './schemas.js';
export * from './parse.js';
