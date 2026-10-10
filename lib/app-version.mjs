import pkg from '../package.json' with { type: 'json' };
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Version must use X.Y.Z');
export const APP_VERSION=pkg.version;
