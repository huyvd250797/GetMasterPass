export const DEFAULT_USER_SESSION_HOURS=8;
export const ADMIN_SESSION_HOURS=8;
export const validSessionHours=value=>Number.isInteger(value)&&value>=1&&value<=168;
