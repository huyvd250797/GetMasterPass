import { handleVersionRequest } from '../lib/version-api.mjs';
export default {fetch(request){return handleVersionRequest(request);}};
