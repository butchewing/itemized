import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES } from './audit';

const accept = Object.keys(ACCEPTED_TYPES).join(',');
const maxMb = MAX_UPLOAD_BYTES / (1024 * 1024);

export const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Itemized</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.5; }
  body { max-width: 36rem; margin: 2rem auto; padding: 0 1rem; }
  label { display: block; font-weight: 600; margin-bottom: .5rem; }
  input[type=file] { display: block; margin-bottom: 1rem; max-width: 100%; }
  button { font: inherit; padding: .5rem 1rem; }
  #status { margin-top: 1.5rem; font-weight: 600; }
  .note { margin: 0 0 1rem; font-size: .9rem; opacity: .85; }
  small { display: block; margin-top: 2rem; opacity: .75; }
</style>
</head>
<body>
<main>
  <h1>Itemized</h1>
  <p>Upload a funeral home General Price List to check it against the FTC Funeral Rule.</p>
  <form id="form">
    <label for="file">General Price List (PDF or photo, up to ${maxMb} MB)</label>
    <input id="file" name="file" type="file" accept="${accept}" required>
    <p class="note">Documents are processed by Meta AI models. Upload only price lists you are allowed to share.</p>
    <button type="submit">Check this list</button>
  </form>
  <p id="status" role="status" aria-live="polite"></p>
  <small>Itemized is a compliance-review aid, not legal advice.</small>
</main>
<script>
const form = document.getElementById('form');
const statusEl = document.getElementById('status');
const LABELS = {
  queued: 'Waiting in line...',
  extracting: 'Reading the document...',
  checking: 'Checking against the rule...',
  done: 'Done.',
  failed: 'The check failed.',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  statusEl.textContent = 'Uploading...';
  try {
    const res = await fetch('/api/audits', { method: 'POST', body: new FormData(form) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Upload failed.');
    for (;;) {
      const audit = await (await fetch('/api/audits/' + body.id)).json();
      statusEl.textContent = LABELS[audit.status] + (audit.error ? ' ' + audit.error : '');
      if (audit.status === 'done' || audit.status === 'failed') break;
      await sleep(1500);
    }
  } catch (err) {
    statusEl.textContent = err.message;
  } finally {
    button.disabled = false;
  }
});
</script>
</body>
</html>`;
