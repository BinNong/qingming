import {handleStory} from '../_shared/routes.mjs';
import {asFunction} from '../_shared/adapter.mjs';

// POST /api/story - one portrait. Same-origin only, POST only; both refusals happen before the
// vendor is touched, because a rejected request is the cheap outcome.
const route=asFunction(handleStory);
export const onRequestPost=route;
export const onRequest=route;