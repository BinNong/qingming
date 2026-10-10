import {handleConfig} from '../_shared/routes.mjs';
import {asFunction} from '../_shared/adapter.mjs';

// GET /api/config - whether this deployment holds a prose key and a TTS key. The page asks once at
// load, because the synthesised voice picker only means anything when the second one is present.
const route=asFunction(handleConfig);
export const onRequestGet=route;
export const onRequest=route;