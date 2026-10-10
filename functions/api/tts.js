import {handleTts} from '../_shared/routes.mjs';
import {asFunction} from '../_shared/adapter.mjs';

// POST /api/tts - one spoken line. Same-origin only, POST only.
const route=asFunction(handleTts);
export const onRequestPost=route;
export const onRequest=route;