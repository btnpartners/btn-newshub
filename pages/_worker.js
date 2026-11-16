// btn-newshub.pages.dev -> forwards every request to the NewsHub Worker (which does the real work).
const ORIGIN = 'btn-newshub.hamilton-512.workers.dev';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = ORIGIN;
    url.port = '';
    url.protocol = 'https:';
    return fetch(new Request(url, request));
  },
};
