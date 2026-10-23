// The two edits the built page needs that the source page does not carry: the controls that only
// work against server.mjs, and the base URL of the host that runs the model endpoints.
//
// They are edits to the same file, so they live together here rather than inline in the build,
// and so a test can check them without running a 343 MB build. That matters more than it looks:
// the second edit is the difference between the model features working on a static host and every
// request going to a path that answers 404.

/** @param html the source page @param api the base URL of the host that runs /api, or '' for
 *  this origin @param capture false to keep the capture and export controls */
export const rewriteHtml=(html,{api='',capture=true}={})=>{
 let out=html;
 // Local capture writes remain available through npm start; public hosting serves the scene only.
 if(capture)out=out.replace('</head>','<style>.panel-bottom,#capture-suite,#export-status,#record{display:none!important}</style></head>');
 // Written by the build, never by the reader: there is no field, no localStorage key and no
 // credential on the machine. A page served by the host that runs the functions asks its own
 // origin, which is the default and the normal case.
 const base=String(api||'').trim().replace(/\/+$/,'');
 if(base){
  // A base URL that is not absolute would resolve against the page's own origin, which is the
  // thing this edit exists to leave behind.
  if(!/^https?:\/\/[^\s]+$/.test(base))throw new Error('QM_API must be an absolute URL to the host that runs /api');
  out=out.replace('</head>','<script>globalThis.QM_API='+JSON.stringify(base)+';</script></head>');}
 return out;};
