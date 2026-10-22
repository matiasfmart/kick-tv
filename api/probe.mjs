import { handleRequest } from '../worker/probe.mjs';

export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/probe' || url.pathname === '/api/probe/') { url.pathname = '/probe'; }
    return handleRequest(new Request(url, { method: request.method }));
  }
};