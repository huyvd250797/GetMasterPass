import { handleMasterRequest } from '../lib/master-api.mjs';
export default {fetch(request) {return handleMasterRequest(request);}};
