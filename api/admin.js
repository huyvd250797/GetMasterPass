import {handleAdminRequest} from '../lib/auth-api.mjs';
export default {fetch:request=>handleAdminRequest(request)};
