import {handleMasterDelivery} from '../lib/master-delivery.mjs';
export default {fetch(request){return handleMasterDelivery(request);}};
